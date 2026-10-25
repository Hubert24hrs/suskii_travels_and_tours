import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config/config';

import { assertKey, ObjectStorage } from './object-storage';
import { EMPTY_PAYLOAD_HASH, encodePath, sha256Hex, signRequest } from './sigv4';

/** A failed call to the object store: status and the store's error code only, never the key. */
export class ObjectStorageError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Object storage request failed (${status} ${code})`);
    this.name = 'ObjectStorageError';
  }
}

/**
 * Any S3-compatible store (OBJECT_STORAGE=s3, ADR-057): AWS S3, Google Cloud Storage through its
 * XML API with HMAC keys, Cloudflare R2 or MinIO. Requests are signed with SigV4 (no SDK), sent
 * with a timeout and never follow redirects. The bucket stays private; objects are served only
 * through the API's own routes, as with the filesystem store.
 */
@Injectable()
export class S3ObjectStorage extends ObjectStorage {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    const {
      OBJECT_STORAGE_ENDPOINT: endpoint,
      OBJECT_STORAGE_BUCKET: bucket,
      OBJECT_STORAGE_ACCESS_KEY_ID: accessKeyId,
      OBJECT_STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
    } = config;
    // The env schema requires all four with OBJECT_STORAGE=s3.
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('OBJECT_STORAGE=s3 needs an endpoint, a bucket and credentials');
    }
    this.endpoint = new URL(endpoint);
    this.bucket = bucket;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const response = await this.send('PUT', key, data, { 'content-type': contentType });
    if (!response.ok) throw await this.failure(response);
  }

  async get(key: string): Promise<Buffer | null> {
    const response = await this.send('GET', key);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) throw await this.failure(response);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.send('DELETE', key);
    // S3 answers 204 whether or not the object existed; some stores answer 404 for a missing one.
    if (!response.ok && response.status !== 404) throw await this.failure(response);
    await response.body?.cancel();
  }

  private async send(
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    assertKey(key);
    const pathStyle = this.config.OBJECT_STORAGE_PATH_STYLE;
    const host = pathStyle ? this.endpoint.host : `${this.bucket}.${this.endpoint.host}`;
    const base = this.endpoint.pathname.replace(/\/$/, '');
    const path = encodePath(`${base}${pathStyle ? `/${this.bucket}` : ''}/${key}`);
    const headers = signRequest({
      method,
      host,
      path,
      headers: extraHeaders,
      payloadHash: body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH,
      region: this.config.OBJECT_STORAGE_REGION,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      date: new Date(),
    });
    // fetch sets Host from the URL; sending it again is not allowed.
    const { host: _host, ...sendHeaders } = headers;
    return fetch(`${this.endpoint.protocol}//${host}${path}`, {
      method,
      headers: sendHeaders,
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(this.config.OBJECT_STORAGE_TIMEOUT_MS),
    });
  }

  /** The store's error code from its XML body (e.g. AccessDenied), without anything else. */
  private async failure(response: Response): Promise<ObjectStorageError> {
    const text = await response.text().catch(() => '');
    const code = /<Code>([A-Za-z]{1,64})<\/Code>/.exec(text)?.[1] ?? 'Unknown';
    return new ObjectStorageError(response.status, code);
  }
}
