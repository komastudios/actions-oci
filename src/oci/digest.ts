import { createHash } from "crypto";
import { createReadStream, createWriteStream, promises as fsp } from "fs";
import { createGzip } from "zlib";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

export interface StreamedDigest {
  hex: string;
  size: number;
}

/** sha256 of a file on disk. Streams the content, never buffers the whole file. */
export async function sha256File(absPath: string): Promise<StreamedDigest> {
  const hash = createHash("sha256");
  let size = 0;
  const rs = createReadStream(absPath);
  for await (const chunk of rs as AsyncIterable<Buffer>) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { hex: hash.digest("hex"), size };
}

/** sha256 of an in-memory buffer. */
export function sha256Buffer(buf: Buffer): StreamedDigest {
  return { hex: createHash("sha256").update(buf).digest("hex"), size: buf.length };
}

/**
 * Gzip a file into a temp location and return the compressed file's path
 * and compressed size. No digest is computed — callers hash the *source*
 * bytes (which drive dedup) before ever calling this, and the stored blob
 * digest is always the uncompressed digest when `Content-Encoding: gzip`
 * is set on upload.
 */
export async function gzipFileToTemp(
  absPath: string,
  level: number,
): Promise<{ path: string; size: number; cleanup: () => Promise<void> }> {
  const outPath = join(tmpdir(), `actions-oci-${randomUUID()}.gz`);
  const gzip = createGzip({ level });
  const out = createWriteStream(outPath);
  await pipeline(createReadStream(absPath), gzip, out);
  const stat = await fsp.stat(outPath);
  return {
    path: outPath,
    size: stat.size,
    cleanup: () => fsp.unlink(outPath).catch(() => undefined),
  };
}

/** Read a small Readable into a single Buffer. Intended for manifests, not content. */
export async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
