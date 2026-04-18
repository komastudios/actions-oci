import { createClient, normalizePrefix, joinKey } from "./index";

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
