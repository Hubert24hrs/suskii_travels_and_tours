import { Injectable } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../common/request-context';
import { uuidv7 } from '../common/uuid';
import { FieldEncryption } from '../crypto/field-encryption';
import { PrismaService } from '../infra/prisma.service';
import { noteContext } from '../crypto/encryption-contexts';

export interface BookingNoteView {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
}

/**
 * Internal notes staff keep on a booking (phase 10). The text is encrypted per note because staff
 * may record personal details; notes never reach the traveller's views, only the data export.
 */
@Injectable()
export class BookingNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
    private readonly audit: AuditService,
  ) {}

  async add(
    bookingId: string,
    staff: { userId: string; context: RequestContext },
    text: string,
  ): Promise<BookingNoteView> {
    const id = uuidv7();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.bookingNote.create({
        data: {
          id,
          bookingId,
          authorId: staff.userId,
          bodyEncrypted: this.encryption.encrypt(text, noteContext(id)),
        },
      });
      await this.audit.record(
        {
          action: 'booking.note_added',
          actorUserId: staff.userId,
          targetType: 'booking',
          targetId: bookingId,
          context: staff.context,
          metadata: { noteId: id },
        },
        tx,
      );
      return { id, authorId: row.authorId, text, createdAt: row.createdAt.toISOString() };
    });
  }

  /** Notes on a booking, oldest first. */
  async list(bookingId: string): Promise<BookingNoteView[]> {
    const rows = await this.prisma.bookingNote.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      authorId: row.authorId,
      text: this.encryption.decrypt(row.bodyEncrypted, noteContext(row.id)),
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
