import {
  mergeAnnotations,
  parseAnnotationsInput,
  standardAnnotations,
} from "./annotations";

describe("standardAnnotations", () => {
  const now = new Date("2026-04-18T12:34:56.789Z");

  test("emits the standard keys with a stable timestamp format", () => {
    const ann = standardAnnotations({
      tag: "dist",
      name: "dist",
      sha: "c0ffee1234567890",
      serverUrl: "https://github.com",
      repository: "example-org/example-repo",
      runId: "42",
      runAttempt: "1",
      job: "build",
      workflow: "CI",
      retentionDays: "7",
      now,
    });
    expect(ann).toEqual({
      "org.opencontainers.image.created": "2026-04-18T12:34:56Z",
      "org.opencontainers.image.ref.name": "dist",
      "org.opencontainers.image.revision": "c0ffee1234567890",
      "org.opencontainers.image.source": "https://github.com/example-org/example-repo",
      "org.opencontainers.image.url":
        "https://github.com/example-org/example-repo/actions/runs/42",
      "io.github.actions.artifact.name": "dist",
      "io.github.actions.artifact.retention-days": "7",
      "io.github.actions.artifact.run-id": "42",
      "io.github.actions.artifact.run-attempt": "1",
      "io.github.actions.artifact.job": "build",
      "io.github.actions.artifact.workflow": "CI",
    });
  });

  test("omits keys with empty or missing values", () => {
    const ann = standardAnnotations({ tag: "t", name: "t", now });
    expect(ann).toEqual({
      "org.opencontainers.image.created": "2026-04-18T12:34:56Z",
      "org.opencontainers.image.ref.name": "t",
      "io.github.actions.artifact.name": "t",
    });
  });
});

describe("parseAnnotationsInput", () => {
  test("parses key=value lines, trims whitespace, skips blanks and comments", () => {
    const raw = `  my.key = my value
# a comment
other.key=other-value
  `;
    expect(parseAnnotationsInput(raw)).toEqual({
      "my.key": "my value",
      "other.key": "other-value",
    });
  });

  test("rejects malformed entries", () => {
    expect(() => parseAnnotationsInput("no-equals")).toThrow();
  });

  test("duplicate keys: last wins", () => {
    expect(parseAnnotationsInput("a=1\na=2")).toEqual({ a: "2" });
  });
});

describe("mergeAnnotations", () => {
  test("user entries override standard ones", () => {
    const merged = mergeAnnotations({ a: "1", b: "2" }, { b: "override" });
    expect(merged).toEqual({ a: "1", b: "override" });
  });
});
