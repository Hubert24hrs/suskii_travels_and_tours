import { Directory, File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

import { appConfig, CLIENT_ID } from '../config';

import type { Booking } from './trips';

import { readJson, secureCache, writeJson } from './cache';

export interface SavedDocument {
  documentId: string;
  type: Booking['documents'][number]['type'];
  fileName: string;
  uri: string;
  savedAt: string;
}

const indexKey = (bookingId: string): string => `documents.${bookingId}`;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}$/;

/** App-private folder per booking: sandboxed and excluded from backups (ADR-020). */
const folder = (bookingId: string): Directory => new Directory(Paths.document, 'trips', bookingId);

/**
 * E-tickets and vouchers kept on the device for offline use (ADR-020). Downloads carry the same
 * credentials as the booking request; files open through the system share sheet, so any PDF
 * viewer works without network.
 */
export const documentStore = {
  saved(bookingId: string): SavedDocument[] {
    return (readJson<SavedDocument[]>(secureCache(), indexKey(bookingId)) ?? []).filter(
      (document) => new File(document.uri).exists,
    );
  },

  async download(
    bookingId: string,
    document: { id: string; type: SavedDocument['type']; fileName: string },
    headers: Record<string, string>,
  ): Promise<SavedDocument> {
    const directory = folder(bookingId);
    if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
    const fileName = SAFE_NAME.test(document.fileName) ? document.fileName : `${document.id}.pdf`;
    const file = await File.downloadFileAsync(
      `${appConfig.apiBaseUrl}/v1/bookings/${bookingId}/documents/${document.id}`,
      new File(directory, fileName),
      { headers: { ...headers, 'X-Suskii-Client': CLIENT_ID }, idempotent: true },
    );
    const saved: SavedDocument = {
      documentId: document.id,
      type: document.type,
      fileName,
      uri: file.uri,
      savedAt: new Date().toISOString(),
    };
    writeJson(secureCache(), indexKey(bookingId), [
      saved,
      ...documentStore.saved(bookingId).filter((item) => item.documentId !== document.id),
    ]);
    return saved;
  },

  open(document: SavedDocument, dialogTitle: string): Promise<void> {
    return shareAsync(document.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle,
    });
  },

  remove(bookingId: string): void {
    const directory = folder(bookingId);
    if (directory.exists) directory.delete();
    secureCache().remove(indexKey(bookingId));
  },
};
