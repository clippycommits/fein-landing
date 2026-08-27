import { json, missingConfig, cfg } from "./_lib.mjs";
import { calReady } from "./_calcom.mjs";

export async function GET(request) {
  const upstash = !!((cfg("UPSTASH_REDIS_REST_URL") ?? cfg("KV_REST_API_URL")) && (cfg("UPSTASH_REDIS_REST_TOKEN") ?? cfg("KV_REST_API_TOKEN")));
  return json({
    ok: true,
    missingConfig: missingConfig(),
    // Cancelling the welcome and the nudge on a booking is a sweep of Resend's
    // own schedule now, so it works on Resend alone. Upstash is what the per-IP
    // rate limit and the event log need, and nothing else.
    scheduledSends: "cancelled on booking (resend sweep)",
    rateLimit: upstash ? "redis" : "none (per-IP caps and the event log are off)",
    // The homepage terminal books straight into cal.com when the key is set,
    // and falls back to the email funnel (CAL_LINK) when it is not.
    booking: calReady() ? "cal.com api" : "link only",
  });
}
