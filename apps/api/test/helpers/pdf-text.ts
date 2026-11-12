import { inflateSync } from 'node:zlib';

import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';

/**
 * The text drawn on a generated PDF's pages, one drawn string per line. Enough for a test to
 * read what a document says; it knows only how pdf-lib writes text with the standard fonts.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const lines: string[] = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((entry) => pdf.context.lookup(entry))
        : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const raw = Buffer.from(stream.contents);
      let drawn: string;
      try {
        drawn = inflateSync(raw).toString('latin1');
      } catch {
        drawn = raw.toString('latin1');
      }
      for (const match of drawn.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
        lines.push(Buffer.from(match[1] ?? '', 'hex').toString('latin1'));
      }
    }
  }
  return lines.join('\n');
}
