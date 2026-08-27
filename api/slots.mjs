import { cfg, json } from "./_lib.mjs";
import { calReady, availableSlots, offer, signSlot, slotLabel, tzName } from "./_calcom.mjs";

/** The "pick a time" box on the homepage terminal.
 *
 * GET /api/slots?tz=Europe/London
 *   -> { tz, slots: [{ start, label, token }], fallback }
 *
 * `token` is what /api/book needs to accept the start (see _calcom.mjs).
 * `fallback` is CAL_LINK, for "another time" and for when the calendar cannot
 * be read. Not cached: the tokens are minted per request. */
export async function GET(request) {
  const tz = tzName(new URL(request.url).searchParams.get("tz") || "UTC");
  const fallback = cfg("CAL_LINK");
  const headers = { "content-type": "application/json", "cache-control": "private, no-store" };
  if (!calReady()) return new Response(JSON.stringify({ tz, slots: [], fallback }), { headers });
  try {
    const starts = await availableSlots({ tz });
    const slots = offer(starts, { tz }).map((start) => ({ start, label: slotLabel(start, tz), token: signSlot(start) }));
    return new Response(JSON.stringify({ tz, slots, fallback }), { headers });
  } catch (err) {
    console.error("slots failed:", err.message);
    return json({ tz, slots: [], fallback, error: "calendar unavailable" });
  }
}
