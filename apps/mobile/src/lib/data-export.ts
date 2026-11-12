import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}\.json$/;
const DEFAULT_NAME = 'suskii-data-export.json';

/**
 * Hands the account's data export (ADR-029) to the system share sheet, so the traveller saves it
 * where they choose. The file holds personal data, so the app's cache copy is deleted as soon as
 * the sheet closes, whatever the outcome.
 */
export async function shareDataExport(
  json: string,
  fileName: string | null,
  dialogTitle: string,
): Promise<void> {
  const file = new File(
    Paths.cache,
    fileName && SAFE_NAME.test(fileName) ? fileName : DEFAULT_NAME,
  );
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(json);
    await shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle });
  } finally {
    if (file.exists) file.delete();
  }
}

/** The file name from a `Content-Disposition` header, if any. */
export const attachmentName = (header: string | null): string | null =>
  /filename="([^"]+)"/.exec(header ?? '')?.[1] ?? null;
