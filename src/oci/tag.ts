/** Resolve ${token} placeholders in the `tag` input against the runtime context. */

export interface TagContext {
  name: string;
  sha?: string;
  runId?: string;
  runAttempt?: string;
  job?: string;
  refName?: string;
}

const KNOWN_TOKENS = new Set([
  "name",
  "sha",
  "sha:0:7",
  "run_id",
  "run_attempt",
  "job",
  "ref_slug",
]);

/**
 * Expand ${name}, ${sha}, ${sha:0:7}, ${run_id}, ${run_attempt}, ${job},
 * ${ref_slug} in the input template. Unknown tokens are left literal and a
 * warning is returned so the caller can surface it via core.warning.
 */
export function expandTag(
  template: string,
  ctx: TagContext,
): { value: string; unknownTokens: string[] } {
  const unknown: string[] = [];
  const out = template.replace(/\$\{([a-z0-9_:]+)\}/gi, (match, token: string) => {
    switch (token) {
      case "name":
        return ctx.name;
      case "sha":
        return ctx.sha ?? "";
      case "sha:0:7":
        return (ctx.sha ?? "").slice(0, 7);
      case "run_id":
        return ctx.runId ?? "";
      case "run_attempt":
        return ctx.runAttempt ?? "";
      case "job":
        return ctx.job ?? "";
      case "ref_slug":
        return slugify(ctx.refName ?? "");
      default:
        if (!KNOWN_TOKENS.has(token)) unknown.push(token);
        return match;
    }
  });
  return { value: out, unknownTokens: unknown };
}

/**
 * Best-effort slug: lowercase, replace any run of non-[a-z0-9] with a single
 * dash, trim leading/trailing dashes. Matches what most CI systems produce.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * OCI image-spec allows fairly permissive ref.name annotations, but the
 * distribution spec further constrains tags. We enforce the stricter
 * distribution-compatible set so our tags are usable with tools like
 * oras/skopeo/crane without surprises.
 *
 * Pattern: `^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$`  (distribution spec §2.2.2)
 */
export function validateTag(tag: string): void {
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/.test(tag)) {
    throw new Error(
      `invalid tag "${tag}": tags must match ^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$ (OCI distribution spec §2.2.2)`,
    );
  }
}
