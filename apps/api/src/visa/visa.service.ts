import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';

import {
  CLOSED_VISA_STATUSES,
  VISA_OFFICER_TRANSITIONS,
  VISA_UPLOAD_STATUSES,
  visaChecklistSchema,
  zero,
  toWire,
  type VisaApplicationStatus,
} from '@suskii/shared';

import { AuditService } from '../audit/audit.service';
import { bookingUrl } from '../bookings/booking-urls';
import { BookingsService, type BookingCaller } from '../bookings/bookings.service';
import { storedMoney } from '../bookings/inhouse-catalog';
import { INHOUSE_SUPPLIER } from '../bookings/inhouse-items';
import { BackgroundTasks } from '../common/background-tasks';
import { ProblemDetailsException } from '../common/problem-details';
import type { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { FieldEncryption } from '../crypto/field-encryption';
import type {
  BookingActorType,
  Prisma,
  VisaDocument,
  VisaProduct,
} from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { EmailProvider } from '../notifications/email';
import { VISA_DISCLAIMER, visaUpdateTemplate } from '../notifications/templates';
import type { Pricer } from '../pricing/pricing.service';
import { PricingService } from '../pricing/pricing.service';
import type { ClientContext } from '../search/client-context';

import { documentNameContext } from './document-crypto';
import type {
  eligibilityQuerySchema,
  eligibilitySchema,
  officerApplicationListSchema,
  officerApplicationQuerySchema,
  OfficerApplicationDto,
  upsertVisaRuleSchema,
  VisaApplicationDto,
  visaProductCardSchema,
  visaProductDetailSchema,
  visaRuleSchema,
} from './visa.schemas';

type ProductCard = z.infer<typeof visaProductCardSchema>;
type VisaRuleDto = z.infer<typeof visaRuleSchema>;

export interface StaffActor {
  userId: string;
  context: RequestContext;
}

export const applicationConflict = (detail: string): ProblemDetailsException =>
  new ProblemDetailsException(HttpStatus.CONFLICT, 'visa-application-conflict', detail);

export const documentsIncomplete = (missing: string[]): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'documents-incomplete',
    'Some required documents are missing',
    'Upload a clean copy of every required item before submitting.',
    { missing },
  );

const APPLICATION_INCLUDE = {
  product: true,
  documents: { orderBy: { uploadedAt: 'desc' } },
  events: { orderBy: { occurredAt: 'asc' } },
  booking: {
    select: {
      id: true,
      reference: true,
      userId: true,
      contactEncrypted: true,
      passengers: true,
    },
  },
} satisfies Prisma.VisaApplicationInclude;

type ApplicationRecord = Prisma.VisaApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** The upload shown for each checklist item: the newest one not replaced by a later upload. */
export function currentDocuments(documents: readonly VisaDocument[]): Map<string, VisaDocument> {
  const current = new Map<string, VisaDocument>();
  for (const document of [...documents].sort(
    (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime(),
  )) {
    if (document.supersededAt || current.has(document.checklistKey)) continue;
    current.set(document.checklistKey, document);
  }
  return current;
}

/**
 * Visa assistance (ADR-026): eligibility from the officers' rules table (never a guess), the
 * product catalog, the traveller's view of each application with its checklist and messages,
 * submission, and the officer workflow (status changes, customer messages, internal notes) with
 * every change recorded as an event and in the audit log.
 */
@Injectable()
export class VisaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly bookings: BookingsService,
    private readonly encryption: FieldEncryption,
    private readonly audit: AuditService,
    private readonly email: EmailProvider,
    private readonly background: BackgroundTasks,
  ) {}

  // -------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------

  async eligibility(
    query: z.output<typeof eligibilityQuerySchema>,
    client: ClientContext,
  ): Promise<z.infer<typeof eligibilitySchema>> {
    const [rule, products, pricer] = await Promise.all([
      this.prisma.visaRule.findUnique({
        where: {
          nationality_destination_purpose: {
            nationality: query.nationality,
            destination: query.destination,
            purpose: query.purpose,
          },
        },
      }),
      this.prisma.visaProduct.findMany({
        where: {
          status: 'published',
          destination: query.destination,
          purposes: { has: query.purpose },
        },
        orderBy: { priceMinor: 'asc' },
      }),
      this.pricing.pricer('visa', query.currency),
    ]);
    const cards = products.map((product) => this.card(product, pricer, client));
    return {
      requirement: rule?.requirement ?? 'unknown',
      maxStayDays: rule?.maxStayDays ?? null,
      notes: rule?.notes ?? null,
      verifiedAt: rule?.verifiedAt ? isoDate(rule.verifiedAt) : null,
      sample: rule?.sample ?? false,
      // Visa-free and not-available trips need no assistance to buy.
      products:
        rule?.requirement === 'visa_free' || rule?.requirement === 'not_available' ? [] : cards,
      disclaimer: VISA_DISCLAIMER,
    };
  }

  async products(
    destination: string | undefined,
    currency: string,
    client: ClientContext,
  ): Promise<ProductCard[]> {
    const [rows, pricer] = await Promise.all([
      this.prisma.visaProduct.findMany({
        where: { status: 'published', ...(destination ? { destination } : {}) },
        orderBy: [{ destination: 'asc' }, { priceMinor: 'asc' }],
        take: 200,
      }),
      this.pricing.pricer('visa', currency),
    ]);
    return rows.map((row) => this.card(row, pricer, client));
  }

  async product(
    slug: string,
    currency: string,
    client: ClientContext,
  ): Promise<z.infer<typeof visaProductDetailSchema>> {
    const row = await this.prisma.visaProduct.findUnique({ where: { slug } });
    if (row?.status !== 'published') throw new NotFoundException();
    const pricer = await this.pricing.pricer('visa', currency);
    return {
      ...this.card(row, pricer, client),
      checklist: visaChecklistSchema.parse(row.checklist),
      disclaimer: VISA_DISCLAIMER,
    };
  }

  private card(product: VisaProduct, pricer: Pricer, client: ClientContext): ProductCard {
    const base = storedMoney(product.price);
    const price = pricer(
      { base, taxes: zero(base.currency) },
      {
        vertical: 'visa',
        supplier: INHOUSE_SUPPLIER,
        channel: client.channel,
        userTier: client.userTier,
        benefits: client.benefits,
        destinationCountry: product.destination,
        passengers: 1,
        now: new Date(),
      },
    ).breakdown.total;
    return {
      id: product.id,
      slug: product.slug,
      title: product.title,
      summary: product.summary,
      sample: product.sample,
      destination: product.destination,
      purposes: product.purposes,
      processingDaysMin: product.processingDaysMin,
      processingDaysMax: product.processingDaysMax,
      price: toWire(price),
      governmentFeeNote: product.governmentFeeNote,
    };
  }

  // -------------------------------------------------------------------------
  // Owner
  // -------------------------------------------------------------------------

  /** The application if the caller owns its booking; otherwise 404 (like the booking itself). */
  async loadForOwner(
    bookingId: string,
    applicationId: string,
    caller: Pick<BookingCaller, 'client' | 'token'>,
  ): Promise<ApplicationRecord> {
    await this.bookings.load(bookingId, caller);
    const application = await this.prisma.visaApplication.findFirst({
      where: { id: applicationId, bookingId },
      include: APPLICATION_INCLUDE,
    });
    if (!application) throw new NotFoundException();
    return application;
  }

  async reload(applicationId: string): Promise<ApplicationRecord> {
    return this.prisma.visaApplication.findUniqueOrThrow({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
  }

  ownerView(application: ApplicationRecord): VisaApplicationDto {
    const base = this.baseView(application);
    const canUpload = VISA_UPLOAD_STATUSES.includes(application.status);
    const missing = this.missing(application);
    return {
      ...base,
      messages: application.events
        .filter((event) => event.message !== null || event.toStatus !== null)
        .map((event) => ({
          occurredAt: event.occurredAt.toISOString(),
          status: event.toStatus,
          message: event.message,
        })),
      canUpload,
      canSubmit: canUpload && missing.length === 0,
    };
  }

  private baseView(application: ApplicationRecord) {
    const checklist = visaChecklistSchema.parse(application.product.checklist);
    const current = currentDocuments(application.documents);
    const applicant = application.booking.passengers.find(
      (passenger) => passenger.position === application.applicantPosition,
    );
    return {
      id: application.id,
      bookingId: application.bookingId,
      applicantPosition: application.applicantPosition,
      applicantName: applicant ? `${applicant.givenNames} ${applicant.surname}` : '',
      status: application.status,
      destination: application.destination,
      purpose: application.purpose,
      travelDate: isoDate(application.travelDate),
      submittedAt: application.submittedAt?.toISOString() ?? null,
      closedAt: application.closedAt?.toISOString() ?? null,
      checklist: checklist.map((item) => {
        const document = current.get(item.key);
        return { ...item, document: document ? this.documentView(document) : null };
      }),
      disclaimer: VISA_DISCLAIMER,
    };
  }

  documentView(document: VisaDocument) {
    const fileName =
      document.deletedAt || !document.fileNameEncrypted
        ? 'deleted'
        : this.encryption.decrypt(document.fileNameEncrypted, documentNameContext(document.id));
    return {
      id: document.id,
      checklistKey: document.checklistKey,
      status: document.status,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      fileName,
      uploadedAt: document.uploadedAt.toISOString(),
    };
  }

  /** Required checklist items without a clean current document. */
  private missing(application: ApplicationRecord): string[] {
    const current = currentDocuments(application.documents);
    return visaChecklistSchema
      .parse(application.product.checklist)
      .filter((item) => item.required && current.get(item.key)?.status !== 'clean')
      .map((item) => item.key);
  }

  async submit(
    bookingId: string,
    applicationId: string,
    caller: BookingCaller,
  ): Promise<VisaApplicationDto> {
    const application = await this.loadForOwner(bookingId, applicationId, caller);
    if (!VISA_UPLOAD_STATUSES.includes(application.status)) {
      throw applicationConflict('This application cannot be submitted now.');
    }
    const missing = this.missing(application);
    if (missing.length > 0) throw documentsIncomplete(missing);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.visaApplication.updateMany({
        where: { id: application.id, status: application.status },
        data: { status: 'submitted', submittedAt: new Date() },
      });
      if (count !== 1) throw applicationConflict('The application changed; reload it.');
      await tx.visaApplicationEvent.create({
        data: {
          applicationId: application.id,
          kind: 'submitted',
          fromStatus: application.status,
          toStatus: 'submitted',
          actorType: 'customer',
          actorUserId: caller.client.userId,
        },
      });
      await this.audit.record(
        {
          action: 'visa.application_submitted',
          actorUserId: caller.client.userId,
          targetType: 'visa_application',
          targetId: application.id,
          context: caller.context,
          metadata: { bookingId },
        },
        tx,
      );
    });
    return this.ownerView(await this.reload(application.id));
  }

  /** Emails the booking contact about a change (best effort, after the change is saved). */
  notify(application: ApplicationRecord, status: VisaApplicationStatus, message: string | null) {
    this.background.run('visa-update', async () => {
      const contact = this.bookings.contact({
        id: application.booking.id,
        contactEncrypted: application.booking.contactEncrypted,
      });
      await this.email.send({
        to: contact.email,
        ...visaUpdateTemplate({
          reference: application.booking.reference,
          status,
          message,
          bookingUrl: application.booking.userId
            ? bookingUrl(this.config, application.booking.id)
            : null,
        }),
      });
    });
  }

  // -------------------------------------------------------------------------
  // Officers
  // -------------------------------------------------------------------------

  async officerList(
    query: z.output<typeof officerApplicationQuerySchema>,
  ): Promise<z.infer<typeof officerApplicationListSchema>['applications']> {
    const rows = await this.prisma.visaApplication.findMany({
      where: query.status ? { status: query.status } : {},
      include: { booking: { select: { reference: true, passengers: true } } },
      // Oldest waiting first: submissions are worked in order.
      orderBy: [{ submittedAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'asc' }],
      take: query.limit,
    });
    return rows.map((row) => {
      const applicant = row.booking.passengers.find(
        (passenger) => passenger.position === row.applicantPosition,
      );
      return {
        id: row.id,
        bookingReference: row.booking.reference,
        applicantName: applicant ? `${applicant.givenNames} ${applicant.surname}` : '',
        nationality: row.nationality,
        destination: row.destination,
        purpose: row.purpose,
        travelDate: isoDate(row.travelDate),
        status: row.status,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async officerDetail(applicationId: string): Promise<OfficerApplicationDto> {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!application) throw new NotFoundException();
    return this.officerView(application);
  }

  private officerView(application: ApplicationRecord): OfficerApplicationDto {
    const applicant = application.booking.passengers.find(
      (passenger) => passenger.position === application.applicantPosition,
    );
    return {
      ...this.baseView(application),
      bookingReference: application.booking.reference,
      nationality: application.nationality,
      passport:
        applicant?.documentHint && applicant.issuingCountry && applicant.documentExpiry
          ? {
              hint: applicant.documentHint,
              issuingCountry: applicant.issuingCountry,
              expiryDate: isoDate(applicant.documentExpiry),
            }
          : null,
      allowedTransitions: [...VISA_OFFICER_TRANSITIONS[application.status]],
      events: application.events.map((event) => ({
        occurredAt: event.occurredAt.toISOString(),
        kind: event.kind,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        message: event.message,
        note: event.note,
        actorType: event.actorType,
      })),
      documents: application.documents.map((document) => ({
        ...this.documentView(document),
        supersededAt: document.supersededAt?.toISOString() ?? null,
        deletedAt: document.deletedAt?.toISOString() ?? null,
      })),
    };
  }

  async transition(
    applicationId: string,
    input: { to: VisaApplicationStatus; message: string | null; note: string | null },
    staff: StaffActor,
  ): Promise<OfficerApplicationDto> {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!application) throw new NotFoundException();
    if (!VISA_OFFICER_TRANSITIONS[application.status].includes(input.to)) {
      throw applicationConflict(
        `An application cannot move from ${application.status} to ${input.to}.`,
      );
    }
    const closing = CLOSED_VISA_STATUSES.includes(input.to);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.visaApplication.updateMany({
        where: { id: application.id, status: application.status },
        data: { status: input.to, ...(closing ? { closedAt: new Date() } : {}) },
      });
      if (count !== 1) throw applicationConflict('The application changed; reload it.');
      await this.event(tx, application.id, staff, {
        kind: 'status_changed',
        fromStatus: application.status,
        toStatus: input.to,
        message: input.message,
        note: input.note,
      });
      await this.audit.record(
        {
          action: 'visa.application_status_changed',
          actorUserId: staff.userId,
          targetType: 'visa_application',
          targetId: application.id,
          context: staff.context,
          metadata: { from: application.status, to: input.to },
        },
        tx,
      );
    });
    this.notify(application, input.to, input.message);
    return this.officerDetail(application.id);
  }

  async comment(
    applicationId: string,
    input: { message: string | null; note: string | null },
    staff: StaffActor,
  ): Promise<OfficerApplicationDto> {
    const application = await this.prisma.visaApplication.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!application) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      await this.event(tx, application.id, staff, {
        kind: input.message ? 'message' : 'note',
        fromStatus: null,
        toStatus: null,
        message: input.message,
        note: input.note,
      });
      await this.audit.record(
        {
          action: input.message ? 'visa.application_message' : 'visa.application_note',
          actorUserId: staff.userId,
          targetType: 'visa_application',
          targetId: application.id,
          context: staff.context,
          metadata: {},
        },
        tx,
      );
    });
    if (input.message) this.notify(application, application.status, input.message);
    return this.officerDetail(application.id);
  }

  async event(
    tx: Prisma.TransactionClient,
    applicationId: string,
    staff: StaffActor | null,
    event: {
      kind: string;
      fromStatus: VisaApplicationStatus | null;
      toStatus: VisaApplicationStatus | null;
      message: string | null;
      note: string | null;
    },
  ): Promise<void> {
    const actorType: BookingActorType = staff ? 'staff' : 'system';
    await tx.visaApplicationEvent.create({
      data: {
        applicationId,
        ...event,
        actorType,
        actorUserId: staff?.userId ?? null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Rules (visa:process)
  // -------------------------------------------------------------------------

  async rules(filter: { nationality?: string | undefined; destination?: string | undefined }) {
    const rows = await this.prisma.visaRule.findMany({
      where: {
        ...(filter.nationality ? { nationality: filter.nationality } : {}),
        ...(filter.destination ? { destination: filter.destination } : {}),
      },
      orderBy: [{ nationality: 'asc' }, { destination: 'asc' }, { purpose: 'asc' }],
      take: 1000,
    });
    return rows.map((row) => this.ruleView(row));
  }

  async upsertRule(
    input: z.output<typeof upsertVisaRuleSchema>,
    staff: StaffActor,
  ): Promise<VisaRuleDto> {
    const data = {
      requirement: input.requirement,
      maxStayDays: input.maxStayDays,
      notes: input.notes,
      verifiedAt: input.verifiedAt ? new Date(`${input.verifiedAt}T00:00:00.000Z`) : null,
      // An officer's rule is real data, even where a demo row existed before.
      sample: false,
    };
    const row = await this.prisma.visaRule.upsert({
      where: {
        nationality_destination_purpose: {
          nationality: input.nationality,
          destination: input.destination,
          purpose: input.purpose,
        },
      },
      create: {
        nationality: input.nationality,
        destination: input.destination,
        purpose: input.purpose,
        ...data,
      },
      update: data,
    });
    await this.audit.record({
      action: 'visa.rule_upserted',
      actorUserId: staff.userId,
      targetType: 'visa_rule',
      targetId: row.id,
      context: staff.context,
      metadata: { requirement: row.requirement },
    });
    return this.ruleView(row);
  }

  async deleteRule(ruleId: string, staff: StaffActor): Promise<void> {
    const { count } = await this.prisma.visaRule.deleteMany({ where: { id: ruleId } });
    if (count !== 1) throw new NotFoundException();
    await this.audit.record({
      action: 'visa.rule_deleted',
      actorUserId: staff.userId,
      targetType: 'visa_rule',
      targetId: ruleId,
      context: staff.context,
      metadata: {},
    });
  }

  private ruleView(row: Prisma.VisaRuleGetPayload<object>): VisaRuleDto {
    return {
      id: row.id,
      nationality: row.nationality,
      destination: row.destination,
      purpose: row.purpose,
      requirement: row.requirement,
      maxStayDays: row.maxStayDays,
      notes: row.notes,
      verifiedAt: row.verifiedAt ? isoDate(row.verifiedAt) : null,
      sample: row.sample,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

export type { ApplicationRecord };
