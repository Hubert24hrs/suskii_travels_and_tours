import { openDocument, sealDocument, sha256Hex } from './document-crypto';

describe('visa document encryption', () => {
  const id = '0192d3a0-7c1e-7b2a-9f00-00000000d001';
  const plaintext = Buffer.from('%PDF-1.7\nA passport scan that must never be stored in clear\n');

  it('round-trips with the document key and id, and hides the plaintext', () => {
    const sealed = sealDocument(plaintext, id);
    expect(sealed.blob.includes(plaintext)).toBe(false);
    expect(sealed.blob.includes(Buffer.from('passport'))).toBe(false);
    expect(sealed.sha256).toBe(sha256Hex(plaintext));
    expect(openDocument(sealed.blob, sealed.dataKey, id).equals(plaintext)).toBe(true);
  });

  it('uses a fresh key and IV for every document', () => {
    const first = sealDocument(plaintext, id);
    const second = sealDocument(plaintext, id);
    expect(first.dataKey).not.toBe(second.dataKey);
    expect(first.blob.equals(second.blob)).toBe(false);
  });

  it('refuses a blob moved to another document, another key or tampered bytes', () => {
    const sealed = sealDocument(plaintext, id);
    const other = sealDocument(plaintext, '0192d3a0-7c1e-7b2a-9f00-00000000d002');
    expect(() =>
      openDocument(sealed.blob, sealed.dataKey, '0192d3a0-7c1e-7b2a-9f00-00000000d002'),
    ).toThrow();
    expect(() => openDocument(sealed.blob, other.dataKey, id)).toThrow();
    const tampered = Buffer.from(sealed.blob);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => openDocument(tampered, sealed.dataKey, id)).toThrow();
    expect(() => openDocument(Buffer.from('not a sealed document'), sealed.dataKey, id)).toThrow();
  });
});
