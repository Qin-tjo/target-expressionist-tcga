# UCSC Xena CORS proxy (Cloudflare Worker)

A ~40-line stateless relay that lets the **published** site pull live per-sample
data for the POINTS / OUTLIERS overlays. See the header comment in `worker.js`
for the full "why".

Cloudflare's free tier (100,000 requests/day) is far more than a portfolio needs.

## Deploy (once, ~2 minutes)

From this folder:

```bash
cd cloudflare-worker
npx wrangler login          # opens a browser to authorize your Cloudflare account
npx wrangler deploy         # deploys the Worker, prints its URL
```

It prints a URL like:

```
https://xena-cors-proxy.<your-subdomain>.workers.dev
```

## Wire it into the app

Paste that URL into **`src/config.ts`**:

```ts
export const XENA_PROXY_URL = "https://xena-cors-proxy.<your-subdomain>.workers.dev";
```

Then commit + push — GitHub Actions rebuilds and redeploys, and POINTS/OUTLIERS
work for every gene on the live site.

> The app only uses the proxy on non-localhost origins. On `localhost` it still
> talks to Xena directly (Xena whitelists localhost), so local dev is unaffected.

## Notes

- The Worker is **hardcoded** to Xena's `/data/` endpoint — it is not an open
  proxy and won't forward to arbitrary URLs.
- It only answers requests from the origins listed in `ALLOWED_ORIGINS` in
  `worker.js`. If you fork/rename, update that list with your Pages origin.
