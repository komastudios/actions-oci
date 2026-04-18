# actions-oci

GitHub Actions that persist workflow artifacts as an **OCI Image
Layout** on object storage. `v1` is a drop-in replacement for
`actions/upload-artifact@v6`, gated to **Google Cloud Storage** as the
backend.

## Sub-actions

| Action | Status |
|---|---|
| `komastudios/actions-oci/upload-artifact@v1` | Implemented |
| `komastudios/actions-oci/download-artifact@v1` | Planned |

## Usage

```yaml
permissions:
  id-token: write   # for OIDC auth to GCP
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: ./build.sh                  # produces dist/

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ vars.GCP_SERVICE_ACCOUNT }}

      - uses: komastudios/actions-oci/upload-artifact@v1
        with:
          service: gcs
          bucket: ${{ vars.ARTIFACT_BUCKET }}
          prefix: my-project
          name: dist
          path: dist/
          retention-days: 7
          compression-level: 6
```

Most `actions/upload-artifact@v6` inputs are accepted verbatim — only
two new ones are required:

- `service: gcs` — explicit backend selection (only `gcs` is legal in v1)
- `bucket:` — target GCS bucket

## Inputs

| Input | Required | Default | Notes |
|---|---|---|---|
| `service` | yes | — | `gcs` is the only accepted value in v1. |
| `bucket` | yes | — | GCS bucket name. Must allow per-object ACLs (see below). |
| `prefix` | no | `""` | Key prefix under which the OCI layout lives. |
| `name` | no | `artifact` | Logical artifact name; becomes the OCI reference tag. |
| `path` | yes | — | File / directory / wildcard pattern(s). Multi-line supported. |
| `if-no-files-found` | no | `warn` | `warn` \| `error` \| `ignore` |
| `retention-days` | no | `""` | 1-90. Written to object metadata for bucket lifecycle rules. |
| `compression-level` | no | `6` | 0-9 for zlib per-layer gzip. |
| `overwrite` | no | `false` | Replace existing `manifests/<tag>` entry. |
| `include-hidden-files` | no | `false` | Include dotfiles. |
| `archive` | no | `false` | `true` = single-zip layer (v6 wire format); `false` = per-file layers + dedup. |
| `tag` | no | `${name}` | Tokens: `${name}`, `${sha}`, `${sha:0:7}`, `${run_id}`, `${run_attempt}`, `${job}`, `${ref_slug}` |
| `artifact-type` | no | `application/vnd.github.actions.artifact.v1+json` | Value of `.artifactType` in the manifest. |
| `layer-media-type` | no | `application/octet-stream` | Default per-file layer mediaType. |
| `annotations` | no | `""` | Multi-line `key=value` pairs merged into manifest annotations (override the standard set). |
| `subject-digest` | no | `""` | *(Reserved — not wired in v1.)* |

## Outputs

| Output | Description |
|---|---|
| `artifact-id` | Manifest digest (`sha256:…`). |
| `artifact-digest` | Alias of `artifact-id`. |
| `artifact-url` | Public HTTPS URL of the manifest blob under `blobs/sha256/…`. |
| `manifest-uri` | `gs://…` URI of the manifest blob. |
| `index-uri` | `gs://…` URI of the regenerated `index.json`. |
| `tag` | Resolved reference tag (after token expansion). |
| `blob-count` | Blobs referenced by the manifest (layers + empty config + manifest). |
| `bytes-uploaded` | Bytes actually transferred to the bucket. |
| `bytes-deduplicated` | Bytes not transferred because the blob was already present. |

## Bucket layout

The action writes an OCI Image Layout under `gs://<bucket>/<prefix>/`:

```
<prefix>/
├── oci-layout
├── index.json                  # derived; regenerated from manifests/ after every upload
├── manifests/
│   └── <tag>                   # one object per named artifact; body IS the manifest JSON
└── blobs/
    └── sha256/
        ├── <layer-1>           # content-addressed
        ├── <layer-2>
        ├── 44136fa…            # the OCI empty-config object, uploaded once
        └── <manifest-digest>   # the manifest, stored here too for OCI tooling
```

Uploads under `blobs/sha256/` are written with `predefinedAcl:
publicRead` so they are directly fetchable over anonymous HTTPS.
Everything else (`manifests/<tag>`, `index.json`, `oci-layout`) inherits
the bucket's default ACL and is only readable by principals with
`storage.objects.get` on the bucket.

## Index regeneration strategy

Unlike the S3-oriented spec this is derived from, `index.json` is **not
mutated in place** with `If-Match` / `ETag` optimistic concurrency.
Instead:

1. The manifest is PUT under `manifests/<tag>` with its digest + size +
   mediaType written as custom object metadata.
2. After the PUT, the action `LIST`s `manifests/` and synthesizes
   `index.json` from the listing — reading digest + size straight from
   the object metadata, no body downloads.
3. `index.json` is PUT unconditionally.

Benefits:

- No concurrent-writer contention on `index.json`. Different tags land
  independently; same tag is last-writer-wins by design.
- `index.json` can be rebuilt from the bucket at any time — re-run any
  upload (or a future `repair` subcommand) and it comes back.

## Bucket prerequisites

- **Uniform Bucket-Level Access must be OFF.** The action sets
  `predefinedAcl: publicRead` on every blob PUT; UBLA-enabled buckets
  reject that directive and the step fails with a specific error.
- **IAM** on the target bucket (the service account that the workflow
  assumes via Workload Identity Federation):
  - `storage.objects.create`
  - `storage.objects.get`
  - `storage.objects.update`
  - `storage.buckets.get` (optional, for friendlier error messages)
- **Credentials** come from Application Default Credentials. Run
  `google-github-actions/auth@v2` with WIF in the job before this
  action. No credentials are accepted as inputs.

## License

MIT — see [LICENSE](./LICENSE).
