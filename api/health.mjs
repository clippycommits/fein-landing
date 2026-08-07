import { json, missingConfig, cfg } from "./_lib.mjs";

export async function GET(request) {
  return json({
    ok: true,
    missingConfig: missingConfig(),
    nudgeState: cfg("UPSTASH_REDIS_REST_URL") ? "redis" : "none (nudges can't be auto-cancelled)",
  });
}
