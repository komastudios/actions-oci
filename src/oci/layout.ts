/**
 * Pure functions that build OCI manifest + index JSON. No I/O, no side
 * effects — safe to golden-master against spec §7.4/§7.5 in tests.
 */

import {
  EMPTY_CONFIG,
  MEDIA_TYPE_INDEX,
  MEDIA_TYPE_MANIFEST,
} from "./media-types";

export interface Descriptor {
  mediaType: string;
  digest: string;
  size: number;
  annotations?: Record<string, string>;
  data?: string;
}

export interface Manifest {
  schemaVersion: 2;
  mediaType: typeof MEDIA_TYPE_MANIFEST;
  artifactType: string;
  config: Descriptor;
  layers: Descriptor[];
  subject?: Descriptor;
  annotations?: Record<string, string>;
}

export interface ImageIndex {
  schemaVersion: 2;
  mediaType: typeof MEDIA_TYPE_INDEX;
  manifests: Descriptor[];
}

export function buildManifest(params: {
  artifactType: string;
  layers: Descriptor[];
  annotations: Record<string, string>;
  subjectDigest?: string;
  subjectSize?: number;
}): Manifest {
  const m: Manifest = {
    schemaVersion: 2,
    mediaType: MEDIA_TYPE_MANIFEST,
    artifactType: params.artifactType,
    config: { ...EMPTY_CONFIG },
    layers: params.layers,
  };
  if (params.subjectDigest && params.subjectSize != null) {
    m.subject = {
      mediaType: MEDIA_TYPE_MANIFEST,
      digest: params.subjectDigest,
      size: params.subjectSize,
    };
  }
  if (Object.keys(params.annotations).length > 0) {
    m.annotations = params.annotations;
  }
  return m;
}

/**
 * Serialize a manifest to UTF-8 bytes using the same key-order we constructed
 * it with. This is important because manifest bytes are the thing we hash —
 * a different JSON encoder that reorders keys would produce a different digest.
 */
export function canonicalizeManifest(m: Manifest): Buffer {
  return Buffer.from(JSON.stringify(m), "utf8");
}

/** Build index.json from the entries we gathered by listing manifests/. */
export function buildIndex(
  manifests: Array<{
    digest: string;
    size: number;
    mediaType: string;
    ref: string;
    artifactType?: string;
  }>,
): ImageIndex {
  const entries: Descriptor[] = manifests
    .slice()
    // Deterministic order: by ref name, then digest. Makes diffs readable and
    // makes "nothing changed" uploads produce byte-identical index.json.
    .sort((a, b) => (a.ref === b.ref ? a.digest.localeCompare(b.digest) : a.ref.localeCompare(b.ref)))
    .map((e) => {
      const desc: Descriptor = {
        mediaType: e.mediaType,
        digest: e.digest,
        size: e.size,
        annotations: { "org.opencontainers.image.ref.name": e.ref },
      };
      if (e.artifactType) {
        desc.annotations!["org.opencontainers.image.artifactType"] = e.artifactType;
      }
      return desc;
    });

  return {
    schemaVersion: 2,
    mediaType: MEDIA_TYPE_INDEX,
    manifests: entries,
  };
}

export const OCI_LAYOUT_JSON = {
  imageLayoutVersion: "1.0.0",
};
