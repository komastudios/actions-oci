import type { Readable } from "stream";
import { Storage, type File, type Bucket } from "@google-cloud/storage";

import { joinKey, ObjectMeta, PutOpts, StorageClient } from "./index";

/**
 * GCS implementation of StorageClient. Uses Application Default Credentials —
 * callers are expected to run `google-github-actions/auth@v2` beforehand.
 *
 * S3→GCS mapping:
 *   HEAD                → file.getMetadata() (404 surfaces as null)
 *   If-None-Match: *    → preconditionOpts.ifGenerationMatch = 0
 *   ListObjectsV2       → bucket.getFiles({ prefix, autoPaginate: true })
 *   x-amz-meta-*        → metadata.metadata  (nested object)
 *   Cache-Control       → metadata.cacheControl
 *
 * Uploaded objects inherit the bucket's default ACL — no per-object ACL
 * directives are set. Configure bucket access via IAM (UBLA-friendly).
 */
export class GcsStorageClient implements StorageClient {
  private readonly storage: Storage;
  private readonly bucketHandle: Bucket;
  public readonly bucket: string;
  public readonly prefix: string;

  constructor(bucket: string, prefix: string) {
    this.bucket = bucket;
    this.prefix = prefix;
    this.storage = new Storage();
    this.bucketHandle = this.storage.bucket(bucket);
  }

  private file(key: string): File {
    return this.bucketHandle.file(joinKey(this.prefix, key));
  }

  async head(key: string): Promise<ObjectMeta | null> {
    try {
      const [md] = await this.file(key).getMetadata();
      return gcsMetadataToObjectMeta(key, md);
    } catch (err: unknown) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async putBlob(key: string, body: Buffer | Readable, opts: PutOpts): Promise<ObjectMeta> {
    const saveOpts: Record<string, unknown> = {
      contentType: opts.contentType,
      resumable: false,
      metadata: {
        cacheControl: opts.cacheControl,
        // contentEncoding goes on the object metadata (not the custom .metadata
        // bag). GCS uses it to decide whether to transcode on read.
        contentEncoding: opts.contentEncoding,
        metadata: opts.metadata ?? {},
      },
    };
    if (opts.ifNoneMatch === "*") {
      saveOpts.preconditionOpts = { ifGenerationMatch: 0 };
    }

    const file = this.file(key);
    try {
      await file.save(body as Buffer, saveOpts);
    } catch (err: unknown) {
      if (opts.ifNoneMatch === "*" && isPreconditionFailed(err)) {
        throw new Error(
          `object already exists: ${joinKey(this.prefix, key)} (overwrite: false)`,
        );
      }
      throw err;
    }
    // After save, re-read metadata so we return authoritative size + etag.
    const [md] = await file.getMetadata();
    return gcsMetadataToObjectMeta(key, md);
  }

  async putJson(key: string, value: unknown, opts: PutOpts): Promise<ObjectMeta> {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    return this.putBlob(key, body, opts);
  }

  async *list(prefix: string): AsyncIterable<ObjectMeta> {
    // GCS returns paginated results; @google-cloud/storage auto-paginates when
    // autoPaginate is true, but that reads the whole result into memory. We use
    // getFilesStream for back-pressure-friendly iteration.
    const fullPrefix = joinKey(this.prefix, prefix);
    const stream = this.bucketHandle.getFilesStream({ prefix: fullPrefix });
    for await (const file of stream as AsyncIterable<File>) {
      const md = file.metadata;
      const relKey = file.name.startsWith(this.prefix + "/")
        ? file.name.slice(this.prefix.length + 1)
        : file.name;
      yield gcsMetadataToObjectMeta(relKey, md);
    }
  }

  publicUrl(key: string): string {
    return `https://storage.googleapis.com/${encodeURIComponent(this.bucket)}/${joinKey(this.prefix, key)
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }

  backendUri(key: string): string {
    return `gs://${this.bucket}/${joinKey(this.prefix, key)}`;
  }
}

function gcsMetadataToObjectMeta(
  relKey: string,
  md: Record<string, unknown> | undefined,
): ObjectMeta {
  const m = md ?? {};
  const size = Number((m as { size?: string | number }).size ?? 0);
  const contentType = String(
    (m as { contentType?: string }).contentType ?? "application/octet-stream",
  );
  const contentEncoding = (m as { contentEncoding?: string }).contentEncoding;
  const custom = ((m as { metadata?: Record<string, string> }).metadata ?? {}) as Record<string, string>;
  return {
    key: relKey,
    size,
    contentType,
    contentEncoding,
    metadata: { ...custom },
  };
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: number }).code;
  return code === 404;
}

function isPreconditionFailed(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: number }).code;
  return code === 412;
}
