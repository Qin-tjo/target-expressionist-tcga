/**
 * URL of the deployed Cloudflare Worker that proxies UCSC Xena with CORS headers,
 * so the published site can fetch live per-sample data (POINTS / OUTLIERS overlays).
 *
 * Deploy the Worker (see `cloudflare-worker/README.md`), then paste its URL here.
 * Leave empty to query Xena directly — that works on localhost (Xena whitelists it)
 * but is CORS-blocked on GitHub Pages.
 */
export const XENA_PROXY_URL = "";
