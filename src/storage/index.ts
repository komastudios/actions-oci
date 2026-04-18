import type { Readable } from "stream";

import { GcsStorageClient } from "./gcs";

/** Minimum set of object-store operations the OCI upload algorithm needs. */
export interface StorageClient {
  /** Returns null when the object does not exist (404). */
  head(key: string): Promise<ObjectMeta | null>;

  /** Upload raw bytes (or a stream) to a content-addressed blob key. */
  putBlob(key: string, body: Buffer | Readable, opts: PutOpts): Promise<ObjectMeta>;

  /** Upload a JSON-serialisable value. Implementations encode with UTF-8 no-BOM. */
  putJson(key: string, value: unknown, opts: PutOpts): Promise<ObjectMeta>;

  /**
   * List objects under a prefix. Each yielded entry carries the custom
   * metadata written at upload time — no extra round-trips needed.
   */
  list(prefix: string): AsyncIterable<ObjectMeta>;

  /** Return the public HTTPS URL at which `key` can be fetched (requires the object to have public-read ACL). */
  publicUrl(key: string): string;

  /** Return the canonical backend-native URI (e.g. gs://bucket/prefix/key). */
  backendUri(key: string): string;
}

export interface ObjectMeta {
  key: string;
  size: number;
  contentType: string;
  /** Custom user-metadata (x-goog-meta-* on GCS). All values are strings. */
  metadata: Record<string, string>;
}

export interface PutOpts {
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
  /**
   * "*" = create-only; fails if the object already exists. Used for the
   * `overwrite: false` path on manifests/<tag>. Not used for dedup-able
   * blobs in blobs/sha256/ (those are preceded by a HEAD probe).
   */
  ifNoneMatch?: "*";
}

/**
 * Construct a StorageClient for the requested service. This factory is the
 * gate that enforces the v1 "gcs only" contract.
 */
export function createClient(
  service: string,
  bucket: string,
  prefix: string,
): StorageClient {
  if (service !== "gcs") {
    throw new Error(
      `service: "${service || "(unset)"}" is not supported in v1; only "gcs" is accepted`,
    );
  }
  return new GcsStorageClient(bucket, normalizePrefix(prefix));
}

/** Normalize prefix: strip leading/trailing slashes. Empty string = bucket root. */
export function normalizePrefix(prefix: string): string {
  return prefix.replace(/^\/+|\/+$/g, "");
}

/** Join a prefix and key with a single `/`; skips the join when prefix is empty. */
export function joinKey(prefix: string, key: string): string {
  if (!prefix) return key;
  return `${prefix}/${key}`;
}
