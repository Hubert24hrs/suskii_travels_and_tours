import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

import { appConfig, CLIENT_ID } from '../config';

import type { SessionStore } from './session';

const SAFE_NAME = /^[A-Za-z0-9._-]{1,120}\.pdf$/;

/**
 * A price request or a trip plan as a PDF (ADR-099, ADR-104), handed to the system share
 * sheet so the traveller keeps or passes it on where they choose. `path` is one of the API's
 * own PDF routes. The file is read with the account's session, written to the app's cache and
 * deleted as soon as the sheet closes, whatever the outcome: nothing of it stays on the phone
 * unless the traveller saved it somewhere themselves.
 */
export async function sharePlanPdf(
  session: SessionStore,
  path: `/v1/${string}/pdf`,
  fileName: string,
  dialogTitle: string,
): Promise<void> {
  const file = new File(Paths.cache, SAFE_NAME.test(fileName) ? fileName : 'suskii-plan.pdf');
  const download = () => {
    if (file.exists) file.delete();
    const access = session.accessToken();
    return File.downloadFileAsync(`${appConfig.apiBaseUrl}${path}`, file, {
      headers: {
        'X-Suskii-Client': CLIENT_ID,
        ...(access ? { Authorization: `Bearer ${access}` } : {}),
      },
      idempotent: true,
    });
  };
  try {
    try {
      await download();
    } catch (error) {
      // An expired access token: rotate once and retry.
      if (!session.signedIn || !(await session.refresh())) throw error;
      await download();
    }
    await shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
  } finally {
    if (file.exists) file.delete();
  }
}
