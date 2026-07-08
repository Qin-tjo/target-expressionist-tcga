/**
 * Target Expressionist — UCSC Xena CORS proxy (Cloudflare Worker)
 *
 * WHY THIS EXISTS
 * ---------------
 * The app is a static site (GitHub Pages). For genes that aren't pre-bundled with
 * per-sample data, the POINTS / OUTLIERS overlays fetch the raw values live from
 * UCSC Xena. Xena's hub only sends CORS headers to whitelisted origins
 * (localhost + xenabrowser.net), so a browser on `*.github.io` is blocked from
 * reading the response.
 *
 * This Worker sits in the middle: the browser calls the Worker (same-origin-safe,
 * because the Worker DOES send CORS headers), the Worker calls Xena
 * server-to-server (CORS doesn't apply between servers), then relays the JSON back.
 *
 * It is a THIN, stateless relay hardcoded to Xena's data endpoint — it is NOT an
 * open proxy (it will not forward to arbitrary URLs), and it only answers the
 * app's own origins.
 */

const XENA_DATA_ENDPOINT = "https://toil.xenahubs.net/data/";

// Origins allowed to use this proxy (prevents others burning your Worker quota).
// Add your GitHub Pages origin; localhost is included for local testing.
const ALLOWED_ORIGINS = new Set([
  "https://qin-tjo.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

const DEFAULT_ORIGIN = "https://qin-tjo.github.io";

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    // CORS preflight (not strictly needed for text/plain POSTs, but safe).
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") {
      return new Response("Only POST is supported.", { status: 405, headers: cors });
    }

    // Relay the Xena query body verbatim to the hardcoded Xena data endpoint.
    const body = await request.text();
    let upstream;
    try {
      upstream = await fetch(XENA_DATA_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
      });
    } catch {
      return new Response("Upstream (UCSC Xena) unreachable.", { status: 502, headers: cors });
    }

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      },
    });
  },
};
