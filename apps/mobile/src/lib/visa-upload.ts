import { VISA_DOCUMENT_TYPES } from '@suskii/shared';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';

export interface PickedDocument {
  bytes: Uint8Array;
  name: string;
  /** Declared type for the request; the API sniffs the bytes and ignores it. */
  type: string;
}

function declaredType(name: string, mimeType: string | undefined): string | null {
  if (mimeType && (VISA_DOCUMENT_TYPES as readonly string[]).includes(mimeType)) return mimeType;
  const extension = /\.([A-Za-z]+)$/.exec(name)?.[1]?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return null;
}

/**
 * Lets the traveller pick a PDF, JPEG or PNG for a visa checklist item (ADR-026) and reads it.
 * The picker's cache copy is deleted once read, so no passport scan lingers on the phone outside
 * the app's control; the upload itself is encrypted at rest and virus-scanned by the API.
 */
export async function pickVisaDocument(): Promise<PickedDocument | 'cancelled' | 'unsupported'> {
  const result = await getDocumentAsync({
    type: [...VISA_DOCUMENT_TYPES],
    copyToCacheDirectory: true,
    multiple: false,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return 'cancelled';
  const file = new File(asset.uri);
  try {
    const type = declaredType(asset.name, asset.mimeType);
    if (!type) return 'unsupported';
    return { bytes: await file.bytes(), name: asset.name, type };
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {
      // Best effort: the OS clears the picker's cache folder too.
    }
  }
}
