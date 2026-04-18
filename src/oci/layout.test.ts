import {
  buildIndex,
  buildManifest,
  canonicalizeManifest,
} from "./layout";
import {
  EMPTY_CONFIG,
  MEDIA_TYPE_MANIFEST,
  MEDIA_TYPE_INDEX,
} from "./media-types";

describe("buildManifest", () => {
  test("matches spec §7.4 shape for two per-file layers", () => {
    const manifest = buildManifest({
      artifactType: "application/vnd.github.actions.artifact.v1+json",
      layers: [
        {
          mediaType: "application/javascript",
          digest:
            "sha256:e258d248fda94c63753607f7c4494ee0fcbe92f1a76bfdac795c9d84101eb317",
          size: 1234,
          annotations: { "org.opencontainers.image.title": "bundle.js" },
        },
        {
          mediaType: "application/json",
          digest:
            "sha256:5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
          size: 5678,
          annotations: { "org.opencontainers.image.title": "bundle.js.map" },
        },
      ],
      annotations: {
        "org.opencontainers.image.created": "2026-04-18T12:34:56Z",
        "org.opencontainers.image.ref.name": "test-results",
      },
    });

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.mediaType).toBe(MEDIA_TYPE_MANIFEST);
    expect(manifest.artifactType).toBe(
      "application/vnd.github.actions.artifact.v1+json",
    );
    expect(manifest.config).toEqual(EMPTY_CONFIG);
    expect(manifest.layers).toHaveLength(2);
    expect(manifest.annotations).toEqual({
      "org.opencontainers.image.created": "2026-04-18T12:34:56Z",
      "org.opencontainers.image.ref.name": "test-results",
    });
  });

  test("key order in serialized output follows spec §7.4", () => {
    const manifest = buildManifest({
      artifactType: "x/y",
      layers: [],
      annotations: { a: "1" },
    });
    const keys = Object.keys(JSON.parse(canonicalizeManifest(manifest).toString("utf8")));
    expect(keys).toEqual([
      "schemaVersion",
      "mediaType",
      "artifactType",
      "config",
      "layers",
      "annotations",
    ]);
  });

  test("omits annotations field when empty", () => {
    const manifest = buildManifest({ artifactType: "x/y", layers: [], annotations: {} });
    expect(manifest.annotations).toBeUndefined();
  });
});

describe("buildIndex", () => {
  test("sorts entries deterministically by ref then digest", () => {
    const idx = buildIndex([
      { ref: "zulu", digest: "sha256:zzz", size: 1, mediaType: MEDIA_TYPE_MANIFEST },
      { ref: "alpha", digest: "sha256:bbb", size: 1, mediaType: MEDIA_TYPE_MANIFEST },
      { ref: "alpha", digest: "sha256:aaa", size: 1, mediaType: MEDIA_TYPE_MANIFEST },
    ]);
    expect(idx.mediaType).toBe(MEDIA_TYPE_INDEX);
    expect(idx.manifests.map((m) => m.digest)).toEqual([
      "sha256:aaa",
      "sha256:bbb",
      "sha256:zzz",
    ]);
  });

  test("attaches ref.name annotation to every entry", () => {
    const idx = buildIndex([
      { ref: "dist", digest: "sha256:x", size: 10, mediaType: MEDIA_TYPE_MANIFEST },
    ]);
    expect(idx.manifests[0].annotations).toEqual({
      "org.opencontainers.image.ref.name": "dist",
    });
  });
});
