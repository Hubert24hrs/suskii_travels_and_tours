/**
 * Hands a PDF the API answered with to the browser as a download. The file is read with the
 * visitor's session like any other answer (never a link that carries a token), kept as an
 * object URL only long enough for the browser to take it, and named here: the name is ours,
 * never one a server header or a page chose.
 */
export function savePdf(data: unknown, fileName: string): boolean {
  if (!(data instanceof Blob)) return false;
  const url = URL.createObjectURL(data);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
