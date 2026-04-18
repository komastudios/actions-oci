import { promises as fsp, createReadStream, createWriteStream } from "fs";
import { join, relative, resolve, sep, posix } from "path";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { pipeline } from "stream/promises";

import * as core from "@actions/core";
import * as glob from "@actions/glob";
import archiver from "archiver";

import { createClient, ObjectMeta, StorageClient } from "./storage";
import { sha256Buffer, sha256File, gzipFileToTemp } from "./oci/digest";
import {
  EMPTY_CONFIG_BYTES,
  MEDIA_TYPE_MANIFEST,
  detectMediaType,
  withGzipSuffix,
} from "./oci/media-types";
import {
  buildIndex,
  buildManifest,
  canonicalizeManifest,
  Descriptor,
  OCI_LAYOUT_JSON,
} from "./oci/layout";
import { expandTag, slugify, validateTag } from "./oci/tag";
import {
  mergeAnnotations,
  parseAnnotationsInput,
  standardAnnotations,
} from "./oci/annotations";
import { getBoolean, getEnum, getInt, getMultiline } from "./utils/inputs";

const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";
const CACHE_CONTROL_INDEX = "no-cache";

async function run(): Promise<void> {
  try {
    await main();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    core.setFailed(msg);
  }
}

async function main(): Promise<void> {
  // ---- Parse inputs ------------------------------------------------------
  const service = core.getInput("service", { required: true });
  const bucket = core.getInput("bucket", { required: true });
  const prefix = core.getInput("prefix", { required: false });

  const name = core.getInput("name", { required: false }) || "artifact";
  const pathLines = getMultiline("path");
  if (pathLines.length === 0) throw new Error("path: at least one pattern is required");

  const ifNoneFound = getEnum("if-no-files-found", ["warn", "error", "ignore"] as const, "warn");
  const retentionDays = getInt("retention-days", undefined, 1, 90);
  const compressionLevel = getInt("compression-level", 6, 0, 9)!;
  const overwrite = getBoolean("overwrite", false);
  const includeHidden = getBoolean("include-hidden-files", false);
  const archive = getBoolean("archive", false);

  const artifactType =
    core.getInput("artifact-type", { required: false }) ||
    "application/vnd.github.actions.artifact.v1+json";
  const defaultLayerMediaType =
    core.getInput("layer-media-type", { required: false }) || "application/octet-stream";
  const tagTemplate = core.getInput("tag", { required: false }) || "${name}";
  const annotationsInput = core.getInput("annotations", { required: false });
  const subjectDigest = core.getInput("subject-digest", { required: false });

  // ---- Resolve tag ------------------------------------------------------
  const tagCtx = {
    name,
    sha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    job: process.env.GITHUB_JOB,
    refName: process.env.GITHUB_REF_NAME,
  };
  const { value: resolvedTag, unknownTokens } = expandTag(tagTemplate, tagCtx);
  if (unknownTokens.length > 0) {
    core.warning(`tag: unknown tokens ignored: ${unknownTokens.join(", ")}`);
  }
  validateTag(resolvedTag);

  // ---- Build annotations ------------------------------------------------
  const standard = standardAnnotations({
    tag: resolvedTag,
    name,
    retentionDays: retentionDays != null ? String(retentionDays) : undefined,
    sha: process.env.GITHUB_SHA,
    serverUrl: process.env.GITHUB_SERVER_URL,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    job: process.env.GITHUB_JOB,
    workflow: process.env.GITHUB_WORKFLOW,
  });
  const userAnnotations = parseAnnotationsInput(annotationsInput);
  const annotations = mergeAnnotations(standard, userAnnotations);

  // ---- Storage client ---------------------------------------------------
  const storage = createClient(service, bucket, prefix);
  core.info(`backend: ${service} bucket=${bucket} prefix=${prefix || "(root)"} tag=${resolvedTag}`);

  // ---- File discovery ---------------------------------------------------
  const globber = await glob.create(pathLines.join("\n"), {
    followSymbolicLinks: false,
    matchDirectories: false,
    implicitDescendants: true,
  });
  const matched = await globber.glob();
  const searchPaths = globber.getSearchPaths();
  const commonRoot =
    searchPaths.length === 1
      ? searchPaths[0]
      : commonAncestorDir(matched) || process.cwd();
  const filtered = matched
    .filter((abs) => includeHidden || !hasHiddenComponent(abs, commonRoot))
    .sort();

  if (filtered.length === 0) {
    const msg = `no files matched: ${pathLines.join(", ")}`;
    if (ifNoneFound === "error") throw new Error(msg);
    if (ifNoneFound === "warn") core.warning(msg);
    else core.info(msg);
    return;
  }
  core.info(`matched ${filtered.length} file(s) under ${commonRoot}`);

  // ---- 3. Upload content blobs (dedup-aware) ----------------------------
  const transferStats = { uploaded: 0, deduplicated: 0 };
  const layers: Descriptor[] = [];
  const layerResults: UploadBlobResult[] = [];

  if (archive) {
    const zip = await zipFilesToTemp(filtered, commonRoot, compressionLevel);
    try {
      const layer = await uploadBlob(storage, zip.path, {
        mediaType: "application/zip",
        titleAnnotation: `${name}.zip`,
        stats: transferStats,
        retentionDays,
        compress: false,
      });
      layers.push(layer.descriptor);
      layerResults.push(layer);
    } finally {
      await zip.cleanup();
    }
  } else {
    for (const abs of filtered) {
      const rel = toPosix(relative(commonRoot, abs));
      const baseMedia = detectMediaType(rel, defaultLayerMediaType);
      const layer = await uploadBlob(storage, abs, {
        mediaType: baseMedia,
        titleAnnotation: rel,
        stats: transferStats,
        retentionDays,
        compress: compressionLevel > 0,
        compressionLevel,
      });
      layers.push(layer.descriptor);
      layerResults.push(layer);
    }
  }

  // ---- 4,5. Build + hash the manifest -----------------------------------
  // Upload the empty config blob (shared by all OCI artifacts in this bucket).
  await ensureEmptyConfigBlob(storage, transferStats, retentionDays);

  if (subjectDigest) {
    // Spec §7 requires both digest and size for a valid subject descriptor;
    // we don't have a path to resolve the size in v1, so warn and skip
    // rather than emit an invalid manifest.
    core.warning(
      "subject-digest is provided but subject attachment is not yet supported in v1; ignored.",
    );
  }
  const manifest = buildManifest({
    artifactType,
    layers,
    annotations,
  });
  const manifestBytes = canonicalizeManifest(manifest);
  const manifestDigest = sha256Buffer(manifestBytes);
  const manifestDigestRef = `sha256:${manifestDigest.hex}`;

  // ---- 6. Content-addressed manifest blob under blobs/ ------------------
  const manifestBlobKey = `blobs/sha256/${manifestDigest.hex}`;
  const manifestBlobHead = await storage.head(manifestBlobKey);
  if (!manifestBlobHead) {
    await storage.putBlob(manifestBlobKey, manifestBytes, {
      contentType: MEDIA_TYPE_MANIFEST,
      cacheControl: CACHE_CONTROL_IMMUTABLE,
      metadata: blobMetadata(manifestDigestRef, retentionDays),
    });
    transferStats.uploaded += manifestDigest.size;
  } else {
    transferStats.deduplicated += manifestDigest.size;
  }

  // ---- 7. Named reference at manifests/<tag> ----------------------------
  const namedKey = `manifests/${resolvedTag}`;
  if (!overwrite) {
    const existing = await storage.head(namedKey);
    if (existing) {
      throw new Error(
        `artifact already exists at tag "${resolvedTag}"; set overwrite: true to replace`,
      );
    }
  }
  await storage.putJson(namedKey, manifest, {
    contentType: MEDIA_TYPE_MANIFEST,
    metadata: {
      digest: manifestDigestRef,
      size: String(manifestDigest.size),
      mediaType: MEDIA_TYPE_MANIFEST,
      artifactType,
      ref: resolvedTag,
      ...(retentionDays != null ? { "retention-days": String(retentionDays) } : {}),
    },
  });

  // ---- 9. List all current manifests; 10,11: regenerate index.json ------
  const indexEntries: Array<{
    digest: string;
    size: number;
    mediaType: string;
    ref: string;
    artifactType?: string;
  }> = [];
  for await (const entry of storage.list("manifests/")) {
    const entryRef = entry.metadata["ref"] ?? entry.key.replace(/^manifests\//, "");
    const digest = entry.metadata["digest"];
    const sizeStr = entry.metadata["size"];
    if (!digest || !sizeStr) {
      core.warning(
        `manifests/${entryRef}: missing digest/size metadata; skipping in index regeneration`,
      );
      continue;
    }
    indexEntries.push({
      digest,
      size: Number(sizeStr),
      mediaType: entry.metadata["mediaType"] ?? MEDIA_TYPE_MANIFEST,
      ref: entryRef,
      artifactType: entry.metadata["artifactType"],
    });
  }
  const index = buildIndex(indexEntries);

  await storage.putJson("index.json", index, {
    contentType: "application/vnd.oci.image.index.v1+json",
    cacheControl: CACHE_CONTROL_INDEX,
  });

  // oci-layout is static but may not exist yet. Write it if missing.
  const layoutHead = await storage.head("oci-layout");
  if (!layoutHead) {
    await storage.putJson("oci-layout", OCI_LAYOUT_JSON, {
      contentType: "application/vnd.oci.image.layout.header.v1+json",
    });
  }

  // ---- Outputs ----------------------------------------------------------
  const blobCount = layers.length + 2; // layers + empty config + manifest
  core.setOutput("artifact-id", manifestDigestRef);
  core.setOutput("artifact-digest", manifestDigestRef);
  core.setOutput("artifact-url", storage.backendUri(manifestBlobKey));
  core.setOutput("manifest-uri", storage.backendUri(manifestBlobKey));
  core.setOutput("index-uri", storage.backendUri("index.json"));
  core.setOutput("tag", resolvedTag);
  core.setOutput("blob-count", String(blobCount));
  core.setOutput("bytes-uploaded", String(transferStats.uploaded));
  core.setOutput("bytes-deduplicated", String(transferStats.deduplicated));

  // Per-file upload report, Docker-style short digest (first 12 hex chars)
  // + size + title. Split into "pushed" (new PUTs) and "already present"
  // (dedup hits — same content-addressed blob was found in the bucket and
  // skipped). For pushed-and-compressed layers we also print the
  // uncompressed source digest + size so downstream consumers have the
  // full chain (source sha256 → compressed sha256 → stored blob).
  const pushed = layerResults.filter((r) => r.pushed);
  const dedup = layerResults.filter((r) => !r.pushed);

  if (pushed.length > 0) {
    core.info(`pushed ${pushed.length} new blob(s):`);
    for (const r of pushed) {
      core.info(
        `  ${r.digestHex.slice(0, 12)}  ${r.size.toString().padStart(10)}  ${r.title}`,
      );
      if (r.sourceDigestHex !== undefined && r.sourceSize !== undefined) {
        core.info(
          `    ↳ source sha256:${r.sourceDigestHex}  (${r.sourceSize} B, gzipped)`,
        );
      }
    }
  }
  if (dedup.length > 0) {
    core.info(`${dedup.length} blob(s) already present:`);
    for (const r of dedup) {
      core.info(
        `  ${r.digestHex.slice(0, 12)}  ${r.size.toString().padStart(10)}  ${r.title}`,
      );
    }
  }
  if (pushed.length === 0 && dedup.length === 0) {
    core.info("no layer blobs to report");
  }

  // Final status line, Docker `docker push` convention:
  //   <ref>: digest: sha256:<hex> size: <manifest-bytes>
  // followed by a totals summary.
  core.info(
    `${resolvedTag}: digest: ${manifestDigestRef} size: ${manifestDigest.size}`,
  );
  core.info(
    `  ${blobCount} blobs, ${transferStats.uploaded} B uploaded, ${transferStats.deduplicated} B deduplicated`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blobMetadata(
  digestRef: string,
  retentionDays: number | undefined,
): Record<string, string> {
  const md: Record<string, string> = { digest: digestRef };
  if (retentionDays != null) md["retention-days"] = String(retentionDays);
  return md;
}

async function ensureEmptyConfigBlob(
  storage: StorageClient,
  stats: { uploaded: number; deduplicated: number },
  retentionDays: number | undefined,
): Promise<void> {
  const key = "blobs/sha256/44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a";
  const head = await storage.head(key);
  if (head) {
    stats.deduplicated += EMPTY_CONFIG_BYTES.length;
    return;
  }
  await storage.putBlob(key, EMPTY_CONFIG_BYTES, {
    contentType: "application/vnd.oci.empty.v1+json",
    cacheControl: CACHE_CONTROL_IMMUTABLE,
    metadata: blobMetadata(
      "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      retentionDays,
    ),
  });
  stats.uploaded += EMPTY_CONFIG_BYTES.length;
}

interface UploadBlobOpts {
  mediaType: string;
  titleAnnotation: string;
  stats: { uploaded: number; deduplicated: number };
  retentionDays?: number;
  compress: boolean;
  compressionLevel?: number;
}

interface UploadBlobResult {
  descriptor: Descriptor;
  /** true if a PUT was issued; false if the blob already existed and we skipped. */
  pushed: boolean;
  /** raw sha256 hex (no "sha256:" prefix) of the stored blob bytes (post-compression if compressed). */
  digestHex: string;
  /** Size of the stored blob in bytes. */
  size: number;
  /** Title annotation (relative path for per-file, name.zip for archive). */
  title: string;
  /** Uncompressed source digest, set only when the layer was gzipped on upload. */
  sourceDigestHex?: string;
  /** Uncompressed source size in bytes, paired with sourceDigestHex. */
  sourceSize?: number;
}

async function uploadBlob(
  storage: StorageClient,
  absPath: string,
  opts: UploadBlobOpts,
): Promise<UploadBlobResult> {
  let uploadPath = absPath;
  let cleanup: (() => Promise<void>) | undefined;
  let mediaType = opts.mediaType;
  const encodingAnnotation: Record<string, string> = {};
  let uncompressedHex: string | undefined;
  let uncompressedSize: number | undefined;

  if (opts.compress) {
    // Digest the uncompressed source first so downstream consumers
    // (e.g. download_plugins.ps1) can verify the decompressed bytes
    // against a known-good sha256, rather than trusting gzip alone.
    // One extra streamed read of absPath — fine at our file sizes.
    const uncompressed = await sha256File(absPath);
    uncompressedHex = uncompressed.hex;
    uncompressedSize = uncompressed.size;

    const gz = await gzipFileToTemp(absPath, opts.compressionLevel ?? 6);
    uploadPath = gz.path;
    cleanup = gz.cleanup;
    const gzipMedia = withGzipSuffix(mediaType);
    if (gzipMedia) {
      mediaType = gzipMedia;
    } else {
      encodingAnnotation["io.github.actions.artifact.encoding"] = "gzip";
    }
    encodingAnnotation["io.github.actions.artifact.uncompressed-digest"] =
      `sha256:${uncompressed.hex}`;
    encodingAnnotation["io.github.actions.artifact.uncompressed-size"] =
      String(uncompressed.size);
  }

  try {
    const digest = await sha256File(uploadPath);
    const digestRef = `sha256:${digest.hex}`;
    const key = `blobs/sha256/${digest.hex}`;

    // HEAD-probe first; only PUT if the content-addressed blob isn't
    // already present. This is the dedup contract — the whole reason
    // for a content-addressed store. Uses the COMPRESSED digest (what
    // actually gets stored), never the uncompressed source digest.
    const existing = await storage.head(key);
    let pushed = false;
    if (!existing) {
      await storage.putBlob(key, createReadStream(uploadPath), {
        contentType: mediaType,
        cacheControl: CACHE_CONTROL_IMMUTABLE,
        metadata: blobMetadata(digestRef, opts.retentionDays),
      });
      opts.stats.uploaded += digest.size;
      pushed = true;
    } else {
      opts.stats.deduplicated += digest.size;
    }

    const descriptor: Descriptor = {
      mediaType,
      digest: digestRef,
      size: digest.size,
      annotations: {
        "org.opencontainers.image.title": opts.titleAnnotation,
        ...encodingAnnotation,
      },
    };
    return {
      descriptor,
      pushed,
      digestHex: digest.hex,
      size: digest.size,
      title: opts.titleAnnotation,
      sourceDigestHex: uncompressedHex,
      sourceSize: uncompressedSize,
    };
  } finally {
    if (cleanup) await cleanup();
  }
}

async function zipFilesToTemp(
  files: string[],
  commonRoot: string,
  compressionLevel: number,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const outPath = join(tmpdir(), `actions-oci-${randomUUID()}.zip`);
  const out = createWriteStream(outPath);
  const zip = archiver("zip", { zlib: { level: compressionLevel } });

  const done = new Promise<void>((resolvePromise, rejectPromise) => {
    out.on("close", () => resolvePromise());
    out.on("error", rejectPromise);
    zip.on("error", rejectPromise);
  });

  zip.pipe(out);
  for (const abs of files) {
    const rel = toPosix(relative(commonRoot, abs));
    zip.file(abs, { name: rel });
  }
  await zip.finalize();
  await done;

  return {
    path: outPath,
    cleanup: () => fsp.unlink(outPath).catch(() => undefined),
  };
}

function hasHiddenComponent(absPath: string, commonRoot: string): boolean {
  const rel = relative(commonRoot, absPath);
  return rel.split(sep).some((seg) => seg.startsWith("."));
}

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

/** Least-common-ancestor directory of a list of absolute paths. */
function commonAncestorDir(paths: string[]): string {
  if (paths.length === 0) return "";
  if (paths.length === 1) return resolve(paths[0], "..");
  let parts = paths[0].split(sep);
  for (let i = 1; i < paths.length; i++) {
    const other = paths[i].split(sep);
    let j = 0;
    while (j < parts.length && j < other.length && parts[j] === other[j]) j++;
    parts = parts.slice(0, j);
  }
  return parts.join(sep) || sep;
}

void run();
