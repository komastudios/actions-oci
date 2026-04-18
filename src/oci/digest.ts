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
 *
 * The output is **normalised for determinism** across runners: the gzip
 * header's OS byte (offset 9) is rewritten to 0xff (unknown). Without this,
 * Node's bundled zlib writes 0x03 on Linux, 0x13 on macOS, 0x00 on Windows
 * — differing by one byte, which would give the same source file a
 * different sha256 on every matrix runner and defeat cross-platform dedup.
 *
 * Other header fields are already deterministic: MTIME is 0, FNAME is
 * absent, XFL follows directly from the compression level.
 */
export async function gzipFileToTemp(
  absPath: string,
  level: number,
): Promise<{ path: string; digest: StreamedDigest; cleanup: () => Promise<void> }> {
  const outPath = join(tmpdir(), `actions-oci-${randomUUID()}.gz`);
  const gzip = createGzip({ level });
  const out = createWriteStream(outPath);
  await pipeline(createReadStream(absPath), gzip, out);
  await normalizeGzipHeader(outPath);
  const digest = await sha256File(outPath);
  return {
    path: outPath,
    digest,
    cleanup: () => fsp.unlink(outPath).catch(() => undefined),
  };
}

/**
 * Overwrite the gzip OS byte (offset 9) with 0xff. Keeps the rest of the
 * file untouched. This is a no-op if the byte is already 0xff, which
 * means calling it repeatedly on the same file is safe and idempotent.
 *
 * Throws if the file doesn't look like a gzip stream (bad magic), so we
 * fail loud if Node ever changes its default format.
 */
async function normalizeGzipHeader(path: string): Promise<void> {
  const fh = await fsp.open(path, "r+");
  try {
    const head = Buffer.alloc(10);
    const { bytesRead } = await fh.read(head, 0, 10, 0);
    if (bytesRead < 10 || head[0] !== 0x1f || head[1] !== 0x8b) {
      throw new Error(
        `gzip header missing or wrong magic on ${path} (first 10 bytes: ${head
          .slice(0, Math.min(bytesRead, 10))
          .toString("hex")})`,
      );
    }
    if (head[9] !== 0xff) {
      const patch = Buffer.from([0xff]);
      await fh.write(patch, 0, 1, 9);
    }
  } finally {
    await fh.close();
  }
}

/** Read a small Readable into a single Buffer. Intended for manifests, not content. */
export async function readAll(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
