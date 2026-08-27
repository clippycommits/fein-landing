import { cfg, json, redis, logEvent, originOk, softLimit } from "./_lib.mjs";
import { calReady, cal, eventTypeId, slotOk, slotLabel, tzName } from "./_calcom.mjs";

/** Book the intro call from the homepage terminal, straight into cal.com.
 *
 * POST { name, email, fund?, note?, start, token, tz, t, website }
 *   -> { ok, booked, uid, start, when, meetingUrl, tz }
 *
 * cal.com then sends the invite, and its BOOKING_CREATED webhook (see
 * webhooks/calcom.mjs) sends the one mail a booked lead gets, schedules the
 * pre-call drip and notifies us. Nothing is mailed from here.
 *
 * Guards, in order: honeypot, a floor on how long the answers took, same-site
 * origin, a valid email, a start time we offered in the last half hour (signed
 * by /api/slots), link-stuffed notes, and per-IP caps tighter than the
 * enquiry's, because a booking lands on a real calendar. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max).trim() || null);

export async function POST(request) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  let b;
  try {
    b = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (b.website) return json({ ok: true, booked: false }); // honeypot: pretend success
  // Four answers and a pick: a person needs longer than this.
  const t = Number(b.t);
  if (!Number.isFinite(t) || t < 4000) return json({ error: "too fast" }, 400);
  if (!originOk(request)) return json({ error: "bad origin" }, 403);

  const email = String(b.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "enter a valid email" }, 400);
  const name = str(b.name, 120);
  if (!name) return json({ error: "enter a name" }, 400);
  const start = str(b.start, 40);
  if (!start || isNaN(new Date(start).getTime())) return json({ error: "pick a time" }, 400);
  if (!slotOk(start, b.token)) return json({ error: "that offer has expired, pick a time again", retry: true }, 400);
  const fund = str(b.fund, 120), note = str(b.note, 1000);
  if (note && (note.match(/https?:\/\//gi) || []).length > 2) return json({ error: "too many links" }, 400);
  const tz = tzName(str(b.tz, 60) || "UTC");

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (!softLimit(`b:${ip}`, 3)) return json({ error: "too many requests" }, 429);
  try {
    const hour = await redis("INCR", `fein:rl:b:h:${ip}`);
    if (hour === 1) await redis("EXPIRE", `fein:rl:b:h:${ip}`, "3600");
    const day = await redis("INCR", `fein:rl:b:d:${ip}`);
    if (day === 1) await redis("EXPIRE", `fein:rl:b:d:${ip}`, "86400");
    if ((hour ?? 0) > 3 || (day ?? 0) > 5) {
      await logEvent({ type: "rate-limited", ip, email, channel: "book" });
      return json({ error: "too many requests" }, 429);
    }
  } catch { /* fail open: Redis being down must not cost a booking */ }

  if (!calReady()) return json({ error: "calendar unavailable", fallback: cfg("CAL_LINK") }, 503);

  // What Daniel sees on the invite. The webhook copies it into the notification.
  const notes = [fund ? `Fund: ${fund}` : null, note ? `Problem: ${note}` : null, "Booked from the fein.vc terminal."]
    .filter(Boolean).join("\n");
  let booking;
  try {
    booking = await cal("/bookings", {
      method: "POST",
      version: "2024-08-13",
      body: {
        start,
        eventTypeId: eventTypeId(),
        attendee: { name, email, timeZone: tz, language: "en" },
        bookingFieldsResponses: { notes },
        metadata: { source: "fein.vc terminal", fund: fund ?? "" },
      },
    });
  } catch (err) {
    console.error("booking failed:", err.message);
    await logEvent({ type: "book-error", email, start, error: err.message.slice(0, 300) });
    // A slot taken between the offer and the pick is the one failure the
    // visitor can fix themselves; anything else gets the public calendar.
    const taken = err.status === 409 || /not available|no longer available|already booked|conflict/i.test(err.message);
    return json({ error: taken ? "that time just went, pick another" : "calendar unavailable", retry: taken, fallback: cfg("CAL_LINK") }, taken ? 409 : 502);
  }
  const uid = booking.uid ?? null;
  const bookedStart = booking.start ?? start;
  await logEvent({ type: "terminal-booked", email, name, fund, start: bookedStart, uid });
  return json({
    ok: true, booked: true, uid, start: bookedStart, tz,
    when: slotLabel(bookedStart, tz),
    meetingUrl: booking.meetingUrl ?? (typeof booking.location === "string" && /^https?:/.test(booking.location) ? booking.location : null),
  });
}
