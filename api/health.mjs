import { json, missingConfig, cfg } from "./_lib.mjs";

export default async function handler() {
  return json({
    ok: true,
    missingConfig: missingConfig(),
    nudgeState: cfg("UPSTASH_REDIS_REST_URL") ? "redis" : "none (nudges can't be auto-cancelled)",
  });
}
