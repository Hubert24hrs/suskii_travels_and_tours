import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { randomToken } from '../crypto/random';

/** Private object storage for generated documents; never public, served through the API. */
export abstract class ObjectStorage {
  abstract put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** `null` when the object does not exist. */
  abstract get(key: string): Promise<Buffer | null>;
  /** Removes the object; deleting one that does not exist is not an error. */
  abstract delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;

const assertKey = (key: string): void => {
  if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error('Invalid object key');
};

/**
 * Local filesystem storage for development and tests (OBJECT_STORAGE=filesystem, refused in
 * production). Keys are validated so they can never escape the storage directory.
 */
@Injectable()
export class FileSystemObjectStorage extends ObjectStorage {
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    this.root = resolve(config.OBJECT_STORAGE_DIR);
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    assertKey(key);
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    // Write then rename, so a reader never sees a half-written file.
    const temporary = `${path}.${randomToken(6)}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, path);
  }

  async get(key: string): Promise<Buffer | null> {
    assertKey(key);
    try {
      return await readFile(join(this.root, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    try {
      await unlink(join(this.root, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
