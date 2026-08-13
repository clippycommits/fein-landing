// Which part of the world the visitor is in, so the demo form can preselect it.
// Reads Vercel's edge geolocation header rather than calling a third party, so
// no address leaves the platform and there is nothing extra to trust.
//
// The response is derived from the caller's IP, so it MUST NOT be cached: a
// shared cache would hand one visitor's region to the next. Hence the explicit
// private/no-store, and hence not using the json() helper in _lib.mjs, which
// sets no cache headers of its own.

const NORTH_AMERICA = new Set(["US", "CA", "MX", "PR", "BM", "GL"]);

const EUROPE = new Set([
  "GB", "IE", "FR", "DE", "ES", "PT", "IT", "NL", "BE", "LU", "AT", "CH",
  "DK", "SE", "NO", "FI", "IS", "PL", "CZ", "SK", "HU", "SI", "HR", "RO",
  "BG", "GR", "EE", "LV", "LT", "MT", "CY", "RS", "BA", "ME", "MK", "AL",
  "UA", "MD", "LI", "MC", "AD", "SM", "VA", "XK", "FO", "GI", "JE", "GG", "IM",
]);

export async function GET(request) {
  const cc = (request.headers.get("x-vercel-ip-country") || "").toUpperCase();
  const region = NORTH_AMERICA.has(cc) ? "North America"
    : EUROPE.has(cc) ? "Europe"
    : cc ? "Rest of World"
    : null; // no header (local dev, or an unknown edge): let the client decide

  return new Response(JSON.stringify({ country: cc || null, region }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store, max-age=0",
    },
  });
}
