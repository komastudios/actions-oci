import { writeFile, mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { sha256Buffer, sha256File } from "./digest";

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
