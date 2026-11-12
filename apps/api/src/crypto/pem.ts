/** Accepts a PEM, or the base64 of a PEM (single-line env vars and secret managers). */
export function decodePem(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed.replace(/\\n/g, '\n').trim();
  return Buffer.from(trimmed, 'base64').toString('utf8').trim();
}
