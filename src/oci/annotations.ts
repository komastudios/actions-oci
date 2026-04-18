/**
 * Canonical annotation set attached to every manifest we produce, plus
 * parsers for the user-provided `annotations` multi-line input.
 */

export interface StandardAnnotationContext {
  tag: string;
  name: string;
  retentionDays?: string;
  // GitHub runtime context:
  sha?: string;
  serverUrl?: string;
  repository?: string;
  runId?: string;
  runAttempt?: string;
  job?: string;
  workflow?: string;
  matrix?: string; // toJSON(matrix) if the caller chose to pass it through
  platform?: string; // optional input passthrough
  now?: Date; // injectable for determinism in tests
}

/** Build the full annotation map (standard + context) for a manifest. */
export function standardAnnotations(ctx: StandardAnnotationContext): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string | undefined): void => {
    if (v !== undefined && v !== "") out[k] = v;
  };

  const now = (ctx.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z");

  put("org.opencontainers.image.created", now);
  put("org.opencontainers.image.ref.name", ctx.tag);
  put("org.opencontainers.image.revision", ctx.sha);
  if (ctx.serverUrl && ctx.repository) {
    put("org.opencontainers.image.source", `${ctx.serverUrl}/${ctx.repository}`);
    if (ctx.runId) {
      put(
        "org.opencontainers.image.url",
        `${ctx.serverUrl}/${ctx.repository}/actions/runs/${ctx.runId}`,
      );
    }
  }

  put("io.github.actions.artifact.name", ctx.name);
  put("io.github.actions.artifact.retention-days", ctx.retentionDays);
  put("io.github.actions.artifact.run-id", ctx.runId);
  put("io.github.actions.artifact.run-attempt", ctx.runAttempt);
  put("io.github.actions.artifact.job", ctx.job);
  put("io.github.actions.artifact.workflow", ctx.workflow);
  put("io.github.actions.artifact.matrix", ctx.matrix);
  put("io.github.actions.artifact.platform", ctx.platform);

  return out;
}

/**
 * Parse the multi-line `annotations:` input. Lines are `key=value`; blank
 * lines and lines starting with `#` are ignored. Whitespace around `key` and
 * `value` is trimmed. Duplicate keys: last wins.
 */
export function parseAnnotationsInput(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`annotations: malformed entry (expected key=value): ${line}`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

/** Merge: user-supplied annotations take precedence over the standard set. */
export function mergeAnnotations(
  standard: Record<string, string>,
  user: Record<string, string>,
): Record<string, string> {
  return { ...standard, ...user };
}
