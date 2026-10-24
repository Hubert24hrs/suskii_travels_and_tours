import { publicEnv } from './env';
import { ensureFreshSession } from './session';

/** The file types the API serves for documents and photos (uploads are checked by magic bytes). */
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Saves a file the API serves as an attachment (driver documents, licences, condition photos).
 * Every read is audited by the API; the bytes go straight to a download, never into the page.
 * The extension comes from the response's content type, so the name needs none.
 */
export async function downloadFile(path: string, name: string): Promise<boolean> {
  await ensureFreshSession();
  const response = await fetch(`${publicEnv.apiBaseUrl}${path}`, {
    credentials: 'include',
    redirect: 'error',
  });
  if (!response.ok) return false;
  const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
  const extension = EXTENSIONS[type];
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = extension ? `${name}.${extension}` : name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
