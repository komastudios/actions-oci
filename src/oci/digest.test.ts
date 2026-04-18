import { readFile, writeFile, mkdtemp, rm, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { gzipFileToTemp, sha256Buffer, sha256File } from "./digest";

describe("sha256Buffer", () => {
  test('"{}" hashes to the well-known empty-config digest', () => {
    const d = sha256Buffer(Buffer.from("{}", "utf8"));
    expect(d).toEqual({
      hex: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      size: 2,
    });
  });

  test("matches sha256File on the same bytes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "actions-oci-test-"));
    try {
      const f = join(dir, "hello.txt");
      await writeFile(f, "hello world\n", "utf8");
      const a = sha256Buffer(Buffer.from("hello world\n", "utf8"));
      const b = await sha256File(f);
      expect(b).toEqual(a);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("gzipFileToTemp", () => {
  test("returns a usable gzipped file with reported size matching on-disk size", async () => {
    const dir = await mkdtemp(join(tmpdir(), "actions-oci-gz-test-"));
    try {
      const src = join(dir, "input.txt");
      // Highly compressible input so we actually see a size reduction.
      await writeFile(src, "aaaaaaaaaaaaaaaa\n".repeat(500), "utf8");

      const gz = await gzipFileToTemp(src, 6);
      try {
        const bytes = await readFile(gz.path);
        const onDisk = await stat(gz.path);
        expect(gz.size).toBe(onDisk.size);
        expect(bytes[0]).toBe(0x1f);
        expect(bytes[1]).toBe(0x8b);
        // Gzip clearly wins on this input.
        const srcStat = await stat(src);
        expect(gz.size).toBeLessThan(srcStat.size);
      } finally {
        await gz.cleanup();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("two calls on the same input produce identical bytes on the same runner", async () => {
    // Not a correctness invariant anymore (stored blob digest is always the
    // uncompressed digest), but cheap and nice-to-have for cache hit-rate
    // stability within a single runner.
    const dir = await mkdtemp(join(tmpdir(), "actions-oci-gz-test-"));
    try {
      const src = join(dir, "input.txt");
      await writeFile(src, "stability check\n".repeat(200), "utf8");
      const a = await gzipFileToTemp(src, 6);
      const b = await gzipFileToTemp(src, 6);
      try {
        expect(a.size).toBe(b.size);
        const bytesA = await readFile(a.path);
        const bytesB = await readFile(b.path);
        expect(bytesA.equals(bytesB)).toBe(true);
      } finally {
        await a.cleanup();
        await b.cleanup();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
