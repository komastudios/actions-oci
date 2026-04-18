/**
 * Canonical annotation set attached to every manifest we produce, plus
 * parsers for the user-provided `annotations` multi-line input.
 */

export interface StandardAnnotationContext {
  tag: string;
  name: string;
  retentionDays?: string;
  // GitHub runtime context. Only fields that are stable given the same
  // commit + workflow inputs are carried into the manifest — run-id,
  // run-attempt, per-run URLs, and wall-clock timestamps are deliberately
  // omitted so two runs producing the same content at the same tag yield
  // byte-identical manifests (and thus the same manifest digest).
  sha?: string;
  serverUrl?: string;
  repository?: string;
  job?: string;
  workflow?: string;
  matrix?: string; // toJSON(matrix) if the caller chose to pass it through
  platform?: string; // optional input passthrough
}

/** Build the deterministic annotation map (standard + context) for a manifest. */
export function standardAnnotations(ctx: StandardAnnotationContext): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string | undefined): void => {
    if (v !== undefined && v !== "") out[k] = v;
  };

  put("org.opencontainers.image.ref.name", ctx.tag);
  put("org.opencontainers.image.revision", ctx.sha);
  if (ctx.serverUrl && ctx.repository) {
    put("org.opencontainers.image.source", `${ctx.serverUrl}/${ctx.repository}`);
  }

  put("io.github.actions.artifact.name", ctx.name);
  put("io.github.actions.artifact.retention-days", ctx.retentionDays);
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
