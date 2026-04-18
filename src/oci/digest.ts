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
 * Gzip a file into a temp location and return the compressed file's path,
 * sha256 digest of the compressed bytes, and compressed size. Caller must
 * invoke `cleanup()` when done (best-effort unlink).
 */
export async function gzipFileToTemp(
  absPath: string,
  level: number,
): Promise<{ path: string; digest: StreamedDigest; cleanup: () => Promise<void> }> {
  const outPath = join(tmpdir(), `actions-oci-${randomUUID()}.gz`);
  const gzip = createGzip({ level });
  const out = createWriteStream(outPath);
  await pipeline(createReadStream(absPath), gzip, out);
  const digest = await sha256File(outPath);
  return {
    path: outPath,
    digest,
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
