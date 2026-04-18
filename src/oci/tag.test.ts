import { expandTag, slugify, validateTag } from "./tag";

describe("expandTag", () => {
  const ctx = {
    name: "dist",
    sha: "c0ffee1234567890abcdef",
    runId: "42",
    runAttempt: "1",
    job: "build",
    refName: "feature/My Branch",
  };

  test("default template expands to name", () => {
    expect(expandTag("${name}", ctx)).toEqual({ value: "dist", unknownTokens: [] });
  });

  test("multi-token template", () => {
    expect(expandTag("${name}-${sha:0:7}", ctx).value).toBe("dist-c0ffee1");
  });

  test("run_id / run_attempt / job", () => {
    expect(expandTag("${name}-${run_id}-${run_attempt}-${job}", ctx).value).toBe(
      "dist-42-1-build",
    );
  });

  test("ref_slug slugifies branch names", () => {
    expect(expandTag("${ref_slug}", ctx).value).toBe("feature-my-branch");
  });

  test("unknown tokens are returned literally and reported", () => {
    const r = expandTag("${name}-${bogus}", ctx);
    expect(r.value).toBe("dist-${bogus}");
    expect(r.unknownTokens).toEqual(["bogus"]);
  });
});

describe("slugify", () => {
  test("collapses non-alphanumerics to dashes", () => {
    expect(slugify("Foo Bar/baz_qux!")).toBe("foo-bar-baz-qux");
  });
  test("trims leading/trailing dashes", () => {
    expect(slugify("--foo--")).toBe("foo");
  });
});

describe("validateTag", () => {
  test("accepts sensible tags", () => {
    ["dist", "linux-x64", "v1.2.3", "a_b-c.d"].forEach((t) => {
      expect(() => validateTag(t)).not.toThrow();
    });
  });
  test("rejects slashes and other invalid chars", () => {
    ["foo/bar", "foo bar", "foo:bar", "-leading", ""].forEach((t) => {
      expect(() => validateTag(t)).toThrow();
    });
  });
});
