import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';

import { ClamAvScanner, EICAR, MockAntivirusScanner, ScanFailedError } from './antivirus';

/** A stand-in for clamd: reads an INSTREAM session and answers like the real daemon. */
function fakeClamd(
  reply: (payload: Buffer) => string | null,
): Promise<{ server: Server; port: number }> {
  const server = createServer((socket: Socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const command = 'zINSTREAM\0';
      if (buffer.length < command.length) return;
      // Walk the length-prefixed chunks until the zero-length terminator.
      let offset = command.length;
      const parts: Buffer[] = [];
      while (buffer.length >= offset + 4) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          const answer = reply(Buffer.concat(parts));
          if (answer === null) return; // simulate a hung daemon
          socket.end(`${answer}\0`);
          return;
        }
        if (buffer.length < offset + 4 + size) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as AddressInfo).port }),
    ),
  );
}

describe('antivirus scanners', () => {
  it('the mock flags the EICAR test file and can simulate an outage', async () => {
    const mock = new MockAntivirusScanner();
    await expect(mock.scan(Buffer.from('%PDF-1.7 fine'))).resolves.toBe('clean');
    await expect(mock.scan(Buffer.from(`%PDF-1.7 ${EICAR}`))).resolves.toBe('infected');
    mock.failNext = 1;
    await expect(mock.scan(Buffer.from('x'))).rejects.toBeInstanceOf(ScanFailedError);
  });

  it('streams the file to clamd in chunks and reads its verdict', async () => {
    const received: Buffer[] = [];
    const { server, port } = await fakeClamd((payload) => {
      received.push(payload);
      return payload.includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND' : 'stream: OK';
    });
    try {
      const scanner = new ClamAvScanner('127.0.0.1', port, 5_000);
      // Larger than one 64 KiB chunk, so the chunking is exercised.
      const big = Buffer.alloc(200_000, 7);
      await expect(scanner.scan(big)).resolves.toBe('clean');
      expect(received[0]?.equals(big)).toBe(true);
      await expect(scanner.scan(Buffer.from(EICAR))).resolves.toBe('infected');
    } finally {
      server.close();
    }
  });

  it('never reads an error, a strange reply, a timeout or a refused connection as clean', async () => {
    const { server, port } = await fakeClamd(() => 'INSTREAM size limit exceeded. ERROR');
    const hung = await fakeClamd(() => null);
    try {
      await expect(
        new ClamAvScanner('127.0.0.1', port, 5_000).scan(Buffer.from('x')),
      ).rejects.toBeInstanceOf(ScanFailedError);
      await expect(
        new ClamAvScanner('127.0.0.1', hung.port, 200).scan(Buffer.from('x')),
      ).rejects.toBeInstanceOf(ScanFailedError);
    } finally {
      server.close();
      hung.server.close();
    }
    // Nothing listens on the closed port any more.
    await expect(
      new ClamAvScanner('127.0.0.1', port, 1_000).scan(Buffer.from('x')),
    ).rejects.toBeInstanceOf(ScanFailedError);
  });
});
