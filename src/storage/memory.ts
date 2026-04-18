import type { Readable } from "stream";

import { ObjectMeta, PutOpts, StorageClient } from "./index";

/**
 * In-memory StorageClient for tests. Keys are tracked with their bytes,
 * content-type, and custom metadata. `ifNoneMatch: "*"` is honoured.
 * `publicRead` is recorded as a metadata flag so tests can assert scoping.
 */
export class MemoryStorageClient implements StorageClient {
  readonly objects = new Map<
    string,
    { body: Buffer; meta: ObjectMeta; publicRead: boolean }
  >();
  constructor(
    public readonly bucket: string = "test-bucket",
    public readonly prefix: string = "",
  ) {}

  async head(key: string): Promise<ObjectMeta | null> {
    const e = this.objects.get(key);
    return e ? { ...e.meta, metadata: { ...e.meta.metadata } } : null;
  }

  async putBlob(
    key: string,
    body: Buffer | Readable,
    opts: PutOpts,
  ): Promise<ObjectMeta> {
    if (opts.ifNoneMatch === "*" && this.objects.has(key)) {
      throw new Error(`object already exists: ${key}`);
    }
    const bytes = Buffer.isBuffer(body) ? body : await consume(body);
    const meta: ObjectMeta = {
      key,
      size: bytes.length,
      contentType: opts.contentType,
      metadata: { ...(opts.metadata ?? {}) },
    };
    this.objects.set(key, { body: bytes, meta, publicRead: opts.publicRead === true });
    return { ...meta, metadata: { ...meta.metadata } };
  }

  async putJson(key: string, value: unknown, opts: PutOpts): Promise<ObjectMeta> {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    return this.putBlob(key, body, opts);
  }

  async *list(prefix: string): AsyncIterable<ObjectMeta> {
    for (const [k, v] of this.objects.entries()) {
      if (k.startsWith(prefix)) {
        yield { ...v.meta, metadata: { ...v.meta.metadata } };
      }
    }
  }

  publicUrl(key: string): string {
    return `https://storage.googleapis.com/${this.bucket}/${this.prefix ? this.prefix + "/" : ""}${key}`;
  }

  backendUri(key: string): string {
    return `gs://${this.bucket}/${this.prefix ? this.prefix + "/" : ""}${key}`;
  }

  // Test helpers -----------------------------------------------------------
  bodyOf(key: string): Buffer | undefined {
    return this.objects.get(key)?.body;
  }

  isPublic(key: string): boolean {
    return this.objects.get(key)?.publicRead === true;
  }
}

async function consume(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
