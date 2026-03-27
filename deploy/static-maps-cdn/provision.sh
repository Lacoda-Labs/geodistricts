#!/usr/bin/env bash
# Provision a classic global external HTTPS load balancer + backend bucket with Cloud CDN.
# Requires: gcloud CLI, billing-enabled project, and an existing GCS bucket (uniform bucket-level access).
# See README.md for env vars and DNS ordering.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
STATIC_MAPS_BUCKET="${STATIC_MAPS_BUCKET:-}"
CDN_HOSTNAME="${CDN_HOSTNAME:-}"
RESOURCE_PREFIX="${STATIC_MAPS_RESOURCE_PREFIX:-geodistricts-static-maps}"
# Honor origin Cache-Control from GCS (matches npm run build:static-maps-cdn -- --upload).
CACHE_MODE="${STATIC_MAPS_CACHE_MODE:-USE_ORIGIN_HEADERS}"

die() {
  echo "error: $*" >&2
  exit 1
}

[[ -n "$PROJECT_ID" ]] || die "set PROJECT_ID to your GCP project id"
[[ -n "$STATIC_MAPS_BUCKET" ]] || die "set STATIC_MAPS_BUCKET to the Cloud Storage bucket name (not gs://)"
[[ -n "$CDN_HOSTNAME" ]] || die "set CDN_HOSTNAME to the DNS name for this CDN (e.g. maps-cdn.example.com)"

readonly BB="${RESOURCE_PREFIX}-backend"
readonly URL_MAP="${RESOURCE_PREFIX}-url-map"
readonly SSL_CERT="${RESOURCE_PREFIX}-ssl-cert"
readonly HTTPS_PROXY="${RESOURCE_PREFIX}-https-proxy"
readonly ADDR_NAME="${RESOURCE_PREFIX}-ipv4"
readonly FW_RULE="${RESOURCE_PREFIX}-https"

run() {
  echo "> $*" >&2
  "$@"
}

gcloud config set project "$PROJECT_ID" --quiet

if ! run gcloud storage buckets describe "gs://${STATIC_MAPS_BUCKET}" --format='value(name)' >/dev/null 2>&1; then
  die "bucket gs://${STATIC_MAPS_BUCKET} not found or not accessible in project ${PROJECT_ID}"
fi

echo "--- Backend bucket (${BB}) with Cloud CDN ---"
if gcloud compute backend-buckets describe "$BB" >/dev/null 2>&1; then
  run gcloud compute backend-buckets update "$BB" \
    --gcs-bucket-name="$STATIC_MAPS_BUCKET" \
    --enable-cdn \
    "--cache-mode=${CACHE_MODE}"
else
  run gcloud compute backend-buckets create "$BB" \
    --gcs-bucket-name="$STATIC_MAPS_BUCKET" \
    --enable-cdn \
    "--cache-mode=${CACHE_MODE}"
fi

echo "--- URL map (${URL_MAP}) ---"
if gcloud compute url-maps describe "$URL_MAP" --global >/dev/null 2>&1; then
  run gcloud compute url-maps set-default-service "$URL_MAP" --default-backend-bucket="$BB" --global
else
  run gcloud compute url-maps create "$URL_MAP" --default-backend-bucket="$BB" --global
fi

echo "--- Global static IPv4 (${ADDR_NAME}) ---"
if gcloud compute addresses describe "$ADDR_NAME" --global >/dev/null 2>&1; then
  echo "  (address already exists)"
else
  run gcloud compute addresses create "$ADDR_NAME" \
    --network-tier=PREMIUM \
    --ip-version=IPV4 \
    --global
fi

LB_IP="$(gcloud compute addresses describe "$ADDR_NAME" --global --format='get(address)')"
readonly LB_IP

echo "--- Managed SSL certificate (${SSL_CERT}) for ${CDN_HOSTNAME} ---"
if gcloud compute ssl-certificates describe "$SSL_CERT" --global >/dev/null 2>&1; then
  echo "  (certificate resource already exists; delete it to change domains: gcloud compute ssl-certificates delete ${SSL_CERT} --global)"
else
  run gcloud compute ssl-certificates create "$SSL_CERT" \
    "--domains=${CDN_HOSTNAME}" \
    --global
fi

echo "--- Target HTTPS proxy (${HTTPS_PROXY}) ---"
if gcloud compute target-https-proxies describe "$HTTPS_PROXY" --global >/dev/null 2>&1; then
  run gcloud compute target-https-proxies update "$HTTPS_PROXY" \
    --url-map="$URL_MAP" \
    "--ssl-certificates=${SSL_CERT}" \
    --global
else
  run gcloud compute target-https-proxies create "$HTTPS_PROXY" \
    "--url-map=${URL_MAP}" \
    "--ssl-certificates=${SSL_CERT}" \
    --global
fi

echo "--- Global HTTPS forwarding rule (${FW_RULE}) ---"
if gcloud compute forwarding-rules describe "$FW_RULE" --global >/dev/null 2>&1; then
  echo "  (forwarding rule already exists; verify it targets ${HTTPS_PROXY} and ${ADDR_NAME} in console if you changed resources)"
else
  run gcloud compute forwarding-rules create "$FW_RULE" \
    --load-balancing-scheme=EXTERNAL \
    --network-tier=PREMIUM \
    "--target-https-proxy=${HTTPS_PROXY}" \
    --ports=443 \
    "--address=${ADDR_NAME}" \
    --global
fi

echo ""
echo "==================================================================="
echo "Load balancer IPv4: ${LB_IP}"
echo ""
echo "DNS: create an A record for ${CDN_HOSTNAME} -> ${LB_IP}"
echo "      (Google-managed cert stays PROVISIONING until DNS points here.)"
echo ""
echo "Check certificate:"
echo "  gcloud compute ssl-certificates describe ${SSL_CERT} --global --format='yaml(managed.status,managed.domainStatus)'"
echo ""
echo "Object paths: requests like https://${CDN_HOSTNAME}/public-maps/states/CA.webp map to object"
echo "  gs://${STATIC_MAPS_BUCKET}/public-maps/states/CA.webp"
echo ""
echo "Build / frontend (after cert is ACTIVE):"
echo "  export STATIC_MAPS_CDN_BASE='https://${CDN_HOSTNAME}/public-maps'"
echo "  npm run build:static-maps-cdn && npm run build:static-maps-cdn -- --upload"
echo "  Set cdnBaseUrl in frontend/src/environments/environment.prod.ts to the same as STATIC_MAPS_CDN_BASE"
echo ""
echo "Invalidate Cloud CDN cache after asset URL or content changes if needed:"
echo "  gcloud compute url-maps invalidate-cdn-cache ${URL_MAP} --path='/*' --global --async"
echo "  (add --host=${CDN_HOSTNAME} to limit host)"
echo "==================================================================="
