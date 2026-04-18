import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
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
  test("normalises the OS byte to 0xff for deterministic cross-runner digests", async () => {
    const dir = await mkdtemp(join(tmpdir(), "actions-oci-gz-test-"));
    try {
      const src = join(dir, "input.txt");
      await writeFile(src, "deterministic gzip please\n".repeat(40), "utf8");

      const gz1 = await gzipFileToTemp(src, 6);
      try {
        const bytes = await readFile(gz1.path);
        expect(bytes[0]).toBe(0x1f);
        expect(bytes[1]).toBe(0x8b);
        expect(bytes.readUInt32LE(4)).toBe(0); // MTIME always 0
        expect(bytes[9]).toBe(0xff); // OS byte normalised
      } finally {
        await gz1.cleanup();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("same input + level produces identical output bytes across two calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "actions-oci-gz-test-"));
    try {
      const src = join(dir, "input.txt");
      await writeFile(src, "stability check\n".repeat(200), "utf8");

      const a = await gzipFileToTemp(src, 6);
      const b = await gzipFileToTemp(src, 6);
      try {
        expect(a.digest).toEqual(b.digest);
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
