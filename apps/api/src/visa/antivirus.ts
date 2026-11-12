import { connect } from 'node:net';

import { Injectable } from '@nestjs/common';

export type ScanVerdict = 'clean' | 'infected';

/** A failed scan (scanner down, timeout, protocol error): retried later, never read as clean. */
export class ScanFailedError extends Error {
  constructor(reason: string) {
    super(`Antivirus scan failed: ${reason}`);
    this.name = 'ScanFailedError';
  }
}

/** Virus scanning for uploaded documents (ADR-026). */
export abstract class AntivirusScanner {
  abstract readonly name: string;
  /** Throws `ScanFailedError` when no verdict could be reached. */
  abstract scan(bytes: Uint8Array): Promise<ScanVerdict>;
}

/** The standard antivirus test file: every scanner flags it, and it is harmless. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/**
 * Development and test scanner (refused in production unless ALLOW_MOCK_PROVIDERS): flags any
 * file containing the EICAR test string, so the infected path can be exercised end to end.
 */
@Injectable()
export class MockAntivirusScanner extends AntivirusScanner {
  readonly name = 'mock';
  /** Test hook: the next scans fail as if the scanner were down. */
  failNext = 0;

  scan(bytes: Uint8Array): Promise<ScanVerdict> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new ScanFailedError('mock scanner unavailable'));
    }
    return Promise.resolve(Buffer.from(bytes).includes(EICAR) ? 'infected' : 'clean');
  }
}

const CHUNK = 64 * 1024;

/**
 * ClamAV through clamd's `INSTREAM` command over TCP: the bytes are sent in length-prefixed
 * chunks and clamd answers `stream: OK` or `stream: <signature> FOUND`. Anything else (an error
 * line, a closed socket, a timeout) is a failed scan.
 */
export class ClamAvScanner extends AntivirusScanner {
  readonly name = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {
    super();
  }

  scan(bytes: Uint8Array): Promise<ScanVerdict> {
    return new Promise<ScanVerdict>((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      const replies: Buffer[] = [];
      let settled = false;
      const finish = (error: Error | null, verdict?: ScanVerdict) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else if (verdict) resolve(verdict);
      };
      socket.setTimeout(this.timeoutMs, () => finish(new ScanFailedError('timeout')));
      socket.on('error', (error: NodeJS.ErrnoException) =>
        finish(new ScanFailedError(error.code ?? 'socket_error')),
      );
      socket.on('data', (chunk: Buffer) => replies.push(chunk));
      socket.on('end', () => {
        const reply = Buffer.concat(replies).toString('utf8').replace(/\0/g, '').trim();
        if (/^stream: OK$/.test(reply)) finish(null, 'clean');
        else if (/^stream: .+ FOUND$/.test(reply)) finish(null, 'infected');
        else finish(new ScanFailedError('unexpected_reply'));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < bytes.byteLength; offset += CHUNK) {
          const chunk = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.byteLength));
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.byteLength);
          socket.write(size);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
    });
  }
}
