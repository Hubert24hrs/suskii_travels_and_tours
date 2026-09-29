import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { MAX_SAVED_TRAVELLERS, PASSENGER_ISSUES, type TravellerInput } from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { FieldEncryption } from '../crypto/field-encryption';
import type { Traveller } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { documentHint } from './booking-codes';
import { travellerLimit } from './booking.errors';
import type { TravellerDto } from './bookings.schemas';
import { passportContext } from './bookings.service';

const dateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

const passportRequired = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.BAD_REQUEST,
    'validation-failed',
    'Validation failed',
    'One or more fields are invalid.',
    {
      errors: [
        {
          location: 'body',
          path: 'document.number',
          code: 'custom',
          message: PASSENGER_ISSUES.documentRequired,
        },
      ],
    },
  );

export function toTravellerDto(traveller: Traveller): TravellerDto {
  return {
    id: traveller.id,
    title: traveller.title as TravellerDto['title'],
    gender: traveller.gender as TravellerDto['gender'],
    givenNames: traveller.givenNames,
    surname: traveller.surname,
    dateOfBirth: isoDate(traveller.dateOfBirth),
    nationality: traveller.nationality,
    document:
      traveller.documentHint && traveller.issuingCountry && traveller.documentExpiry
        ? {
            hint: traveller.documentHint,
            issuingCountry: traveller.issuingCountry,
            expiryDate: isoDate(traveller.documentExpiry),
          }
        : null,
    createdAt: traveller.createdAt.toISOString(),
    updatedAt: traveller.updatedAt.toISOString(),
  };
}

/**
 * Saved travellers of an account (ADR-015): at most MAX_SAVED_TRAVELLERS, passport numbers
 * encrypted with a record-bound context and only ever returned as a three-character hint.
 */
@Injectable()
export class TravellersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<TravellerDto[]> {
    const travellers = await this.prisma.traveller.findMany({
      where: { userId },
      orderBy: [{ surname: 'asc' }, { givenNames: 'asc' }, { createdAt: 'asc' }],
    });
    return travellers.map(toTravellerDto);
  }

  async create(
    userId: string,
    input: TravellerInput,
    context: RequestContext,
  ): Promise<TravellerDto> {
    if (input.document && !input.document.number) throw passportRequired();
    const id = uuidv7();
    const traveller = await this.prisma.$transaction(async (tx) => {
      // Serialise per user so two parallel creates cannot both pass the limit check.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if ((await tx.traveller.count({ where: { userId } })) >= MAX_SAVED_TRAVELLERS) {
        throw travellerLimit(MAX_SAVED_TRAVELLERS);
      }
      const created = await tx.traveller.create({
        data: { id, userId, ...this.fields(id, input, null) },
      });
      await this.audit.record(
        {
          action: 'traveller.created',
          actorUserId: userId,
          targetType: 'traveller',
          targetId: id,
          context,
        },
        tx,
      );
      return created;
    });
    return toTravellerDto(traveller);
  }

  /** Replaces a traveller; a document without a number keeps the stored passport number. */
  async update(
    userId: string,
    travellerId: string,
    input: TravellerInput,
    context: RequestContext,
  ): Promise<TravellerDto> {
    const existing = await this.prisma.traveller.findFirst({ where: { id: travellerId, userId } });
    if (!existing) throw new NotFoundException();
    if (input.document && !input.document.number && !existing.passportEncrypted) {
      throw passportRequired();
    }
    const traveller = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.traveller.update({
        where: { id: existing.id },
        data: this.fields(existing.id, input, existing),
      });
      await this.audit.record(
        {
          action: 'traveller.updated',
          actorUserId: userId,
          targetType: 'traveller',
          targetId: existing.id,
          context,
        },
        tx,
      );
      return updated;
    });
    return toTravellerDto(traveller);
  }

  async remove(userId: string, travellerId: string, context: RequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.traveller.deleteMany({ where: { id: travellerId, userId } });
      if (count === 0) throw new NotFoundException();
      await this.audit.record(
        {
          action: 'traveller.deleted',
          actorUserId: userId,
          targetType: 'traveller',
          targetId: travellerId,
          context,
        },
        tx,
      );
    });
  }

  private fields(id: string, input: TravellerInput, existing: Traveller | null) {
    const document = input.document;
    const passportEncrypted = document
      ? document.number
        ? this.encryption.encrypt(document.number, passportContext('traveller', id))
        : (existing?.passportEncrypted ?? null)
      : null;
    return {
      title: input.title,
      gender: input.gender,
      givenNames: input.givenNames,
      surname: input.surname,
      dateOfBirth: dateOnly(input.dateOfBirth),
      nationality: input.nationality,
      passportEncrypted,
      documentHint: document
        ? document.number
          ? documentHint(document.number)
          : (existing?.documentHint ?? null)
        : null,
      issuingCountry: document?.issuingCountry ?? null,
      documentExpiry: document ? dateOnly(document.expiryDate) : null,
    };
  }
}
