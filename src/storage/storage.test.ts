import { createClient, normalizePrefix, joinKey } from "./index";
import { MemoryStorageClient } from "./memory";

describe("createClient factory", () => {
  test('accepts service: "gcs"', () => {
    expect(() => createClient("gcs", "some-bucket", "prefix")).not.toThrow();
  });

  test('rejects service: "" (missing)', () => {
    expect(() => createClient("", "b", "")).toThrow(/only "gcs" is accepted/);
  });

  test('rejects service: "s3" (unsupported)', () => {
    expect(() => createClient("s3", "b", "")).toThrow(/only "gcs" is accepted/);
  });

  test('rejects service: "r2" (unsupported)', () => {
    expect(() => createClient("r2", "b", "")).toThrow(/only "gcs" is accepted/);
  });
});

describe("normalizePrefix", () => {
  test("strips leading and trailing slashes", () => {
    expect(normalizePrefix("/foo/bar/")).toBe("foo/bar");
    expect(normalizePrefix("foo/bar")).toBe("foo/bar");
    expect(normalizePrefix("")).toBe("");
    expect(normalizePrefix("//")).toBe("");
  });
});

describe("joinKey", () => {
  test("empty prefix returns key unchanged", () => {
    expect(joinKey("", "foo")).toBe("foo");
  });
  test("non-empty prefix joins with a single slash", () => {
    expect(joinKey("proj", "foo")).toBe("proj/foo");
    expect(joinKey("proj/sub", "blobs/sha256/abc")).toBe("proj/sub/blobs/sha256/abc");
  });
});

describe("contentEncoding round-trips through MemoryStorageClient", () => {
  test("putBlob records the contentEncoding flag when set, elides it when omitted", async () => {
    const m = new MemoryStorageClient();
    const bytes = Buffer.from("some bytes");

    await m.putBlob("blobs/sha256/raw", bytes, {
      contentType: "application/octet-stream",
    });
    await m.putBlob("blobs/sha256/gzip", bytes, {
      contentType: "application/octet-stream",
      contentEncoding: "gzip",
    });

    const raw = await m.head("blobs/sha256/raw");
    const gz = await m.head("blobs/sha256/gzip");
    expect(raw?.contentEncoding).toBeUndefined();
    expect(gz?.contentEncoding).toBe("gzip");
  });
});
