# Static maps: HTTPS load balancer + Cloud CDN (GCS backend bucket)

This directory provisions a **classic global external HTTPS load balancer** with a **backend bucket** and **Cloud CDN** enabled, backed by the same Cloud Storage bucket you use for `npm run build:static-maps-cdn -- --upload`.

Docs index: [doc/pages/STATIC_MAPS_CDN.md](../../doc/pages/STATIC_MAPS_CDN.md).

## What gets created

All resource names default to the prefix `geodistricts-static-maps-*` (override with `STATIC_MAPS_RESOURCE_PREFIX`).

| Resource | Purpose |
| -------- | ------- |
| Backend bucket | Wraps your GCS bucket; **Cloud CDN** on; cache mode follows origin `Cache-Control` by default |
| URL map | Default route → that backend bucket (paths match object keys) |
| Global static IPv4 | Stable address for DNS |
| Managed SSL certificate | For `CDN_HOSTNAME` |
| Target HTTPS proxy | Terminates TLS, uses URL map + cert |
| Global forwarding rule | `443` → HTTPS proxy (scheme `EXTERNAL`, Premium tier) |

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk) (`gcloud`), authenticated (`gcloud auth login` + application default if needed).
- Roles roughly equivalent to Compute Admin + ability to use Cloud Storage (or custom roles covering compute backend buckets, forwarding rules, SSL certs, addresses).
- A **Cloud Storage bucket** that already exists in the same project, with **uniform bucket-level access** (required for backend buckets). Upload map assets under the `public-maps/` prefix (see main static maps doc).
- **Public reads** for anonymous browsers: typically grant `allUsers` the role **Storage Object Viewer** on a **dedicated** public bucket (or a managed-folder / IAM setup your security team approves). See [making data public](https://cloud.google.com/storage/docs/access-control/making-data-public) and [Cloud CDN with a bucket](https://cloud.google.com/cdn/docs/setting-up-cdn-with-bucket).

## Environment variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `PROJECT_ID` | yes | GCP project id |
| `STATIC_MAPS_BUCKET` | yes | Bucket **name** only (no `gs://`) |
| `CDN_HOSTNAME` | yes | DNS name that will point at the load balancer (e.g. `maps-cdn.example.com`) |
| `STATIC_MAPS_RESOURCE_PREFIX` | no | Prefix for Compute resource names; default `geodistricts-static-maps` |
| `STATIC_MAPS_CACHE_MODE` | no | Backend bucket CDN cache mode; default `USE_ORIGIN_HEADERS` (uses GCS `Cache-Control`, aligned with the static maps upload script) |

## Recommended order of operations

1. **Create** the dedicated GCS bucket (if needed) with uniform access; add public `objectViewer` (or your approved pattern).
2. **Upload** static map outputs: `STATIC_MAPS_GCS_PREFIX=gs://BUCKET/public-maps` and `npm run build:static-maps-cdn -- --upload` from repo root (after resolving `maps_landing`). Optional: upload can also happen after the LB exists.
3. **Run** `./provision.sh` from this directory with `PROJECT_ID`, `STATIC_MAPS_BUCKET`, `CDN_HOSTNAME` set.
4. **DNS**: Add an **A record** for `CDN_HOSTNAME` → the printed **global IPv4**. Propagation can take a few minutes.
5. **Certificate**: Google-managed cert stays `PROVISIONING` until DNS points at the LB. Check:
   ```bash
   gcloud compute ssl-certificates describe "${STATIC_MAPS_RESOURCE_PREFIX:-geodistricts-static-maps}-ssl-cert" \
     --global --format='yaml(managed.status,managed.domainStatus)'
   ```
6. **Rebuild** front-end URLs if the public base is new: set `STATIC_MAPS_CDN_BASE=https://<CDN_HOSTNAME>/public-maps`, run `npm run build:static-maps-cdn`, upload again, and set `cdnBaseUrl` in `frontend/src/environments/environment.prod.ts` to the same value (no trailing slash).

## Run the script

From repository root:

```bash
chmod +x deploy/static-maps-cdn/provision.sh
export PROJECT_ID='your-project'
export STATIC_MAPS_BUCKET='your-static-maps-bucket'
export CDN_HOSTNAME='maps-cdn.example.com'
./deploy/static-maps-cdn/provision.sh
```

## URL mapping

HTTPS path **must** match the **object name** in the bucket. With uploads to `gs://BUCKET/public-maps/...`, use:

- `STATIC_MAPS_CDN_BASE=https://<CDN_HOSTNAME>/public-maps`
- Example asset: `https://<CDN_HOSTNAME>/public-maps/states/CA.webp` → `gs://BUCKET/public-maps/states/CA.webp`

## Troubleshooting

- **403 from GCS / empty body**: Bucket or object IAM not public (or wrong bucket). Confirm `gcloud storage buckets describe gs://BUCKET` and IAM bindings.
- **Certificate stuck PROVISIONING**: DNS for `CDN_HOSTNAME` not pointing to the reserved IP, or wrong hostname on cert. To change the hostname, delete the SSL certificate resource and re-run (or use a new `STATIC_MAPS_RESOURCE_PREFIX`).
- **Wrong backend bucket GCS target**: Script updates `--gcs-bucket-name` on each run for the backend bucket resource.
- **Idempotency**: Re-running is safe for most resources. An **existing** managed cert is not recreated (to change domains, delete the cert resource first).

## Invalidate Cloud CDN

After replacing objects or when caches serve stale JSON/WebP:

```bash
URL_MAP="${STATIC_MAPS_RESOURCE_PREFIX:-geodistricts-static-maps}-url-map"
gcloud compute url-maps invalidate-cdn-cache "$URL_MAP" --path='/*' --global --async
# Optional: --host=maps-cdn.example.com
```

See [Invalidating cached content](https://cloud.google.com/cdn/docs/invalidating-cached-content).

## CI / automation

Use a service account with the same permissions; authenticate with Workload Identity or exported JSON key in the job, then invoke `provision.sh`. Do not commit keys. DNS steps usually remain manual unless you automate Cloud DNS in the same project.
