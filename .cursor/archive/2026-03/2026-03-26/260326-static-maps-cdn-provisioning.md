# 260326

## 2153 static maps Cloud CDN provisioning and DNS

### Prompt

/archive

### Response / actions

Plan (associated work): [.cursor/plans/static_path_sans_cdn_1fd280d8.plan.md](../../../plans/static_path_sans_cdn_1fd280d8.plan.md)

✅ **RESOLVED** / **IMPLEMENTED** (across the archived session):

- Explained `STATIC_MAPS_CDN_BASE` (browser HTTPS base) vs `STATIC_MAPS_GCS_PREFIX` / `gs://` upload target.
- Clarified Cloud CDN optional vs direct `storage.googleapis.com`; iterated plan to **provision** CDN via repo script (not console-only).
- **Implemented** [deploy/static-maps-cdn/provision.sh](../../../../deploy/static-maps-cdn/provision.sh), [deploy/static-maps-cdn/README.md](../../../../deploy/static-maps-cdn/README.md), and [doc/pages/STATIC_MAPS_CDN.md](../../../../doc/pages/STATIC_MAPS_CDN.md) “Cloud CDN (provisioned load balancer)” subsection (plan file not edited per user).
- Ran `npm run build:static-maps-cdn -- --dry-run` and full `build:static-maps-cdn` with placeholder CDN base; noted `--upload` / `provision.sh` need local GCP env.
- Documented **gcloud** bucket create (`gcloud storage buckets create`, uniform access, `add-iam-policy-binding` for public reads).
- User ran `provision.sh` successfully (backend bucket + CDN, URL map, static IP, managed cert, HTTPS proxy, forwarding rule); output included DNS A record instructions for `maps-cdn.geodistricts.org`.
- Provided **Namecheap Advanced DNS** steps (A record host `maps-cdn` → LB IPv4, remove conflicts).
- Explained **Google-managed SSL** provisioning: typically ~15–60+ minutes after correct DNS; stays PROVISIONING until DNS validates.
