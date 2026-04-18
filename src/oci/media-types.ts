/** OCI and IANA media types used by the action. */

export const MEDIA_TYPE_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
export const MEDIA_TYPE_INDEX = "application/vnd.oci.image.index.v1+json";
export const MEDIA_TYPE_EMPTY = "application/vnd.oci.empty.v1+json";

/**
 * The well-known "empty JSON object" config blob, mandated by
 * OCI image-spec v1.1.1 "Guidelines for Artifact Usage" case 2. The literal
 * bytes are `{}` — 2 bytes. sha256 is fixed and can be hardcoded.
 */
export const EMPTY_CONFIG = {
  mediaType: MEDIA_TYPE_EMPTY,
  digest:
    "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  size: 2,
  /** base64("{}") = "e30=" — see spec §7.1 data-embedded form. */
  data: "e30=",
} as const;

export const EMPTY_CONFIG_BYTES: Buffer = Buffer.from("{}", "utf8");

/** Small convenience lookup — best-effort, caller can override with layer-media-type. */
const EXT_TO_MEDIA_TYPE: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".wasm": "application/wasm",
  ".zip": "application/zip",
  ".tar": "application/vnd.oci.image.layer.v1.tar",
  ".gz": "application/gzip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
};

export function detectMediaType(filename: string, fallback: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return fallback;
  const ext = filename.slice(dot).toLowerCase();
  return EXT_TO_MEDIA_TYPE[ext] ?? fallback;
}

/**
 * If a compressed layer uses a structured media type, append `+gzip`.
 * Otherwise keep the media type and expect a `io.github.actions.artifact.encoding`
 * annotation to be set by the caller.
 */
export function withGzipSuffix(mediaType: string): string | null {
  if (mediaType === "application/octet-stream") return null;
  if (mediaType.endsWith("+gzip")) return mediaType;
  // Only attach +gzip to structured types we produced above.
  return `${mediaType}+gzip`;
}
