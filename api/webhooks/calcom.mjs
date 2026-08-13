import { createHmac, timingSafeEqual } from "node:crypto";
import {
  cfg, json, resend, redis, logEvent,
  cancelScheduledFor, bookingEmail, cancelledEmail, whenLine, callUrl,
} from "../_lib.mjs";

/** cal.com webhooks. The HMAC is computed over the raw request body, which is
 * why this reads text first.
 *
 * BOOKING_CREATED   cancel whatever we still have scheduled for them, send the
 *                   one mail a booked lead gets, tell us.
 * BOOKING_CANCELLED if the attendee dropped it themselves, offer another time.
 *                   If Daniel dropped it, do nothing: he knows why.
 */
export async function POST(request) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const raw = await request.text();
  const secret = cfg("CALCOM_WEBHOOK_SECRET");
  const sig = request.headers.get("x-cal-signature-256") ?? "";
  const want = createHmac("sha256", secret ?? "").update(raw).digest("hex");
  const ok = secret && sig.length === want.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  if (!ok) return json({ error: "bad signature" }, 401);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }
  const event = body.triggerEvent;
  if (event !== "BOOKING_CREATED" && event !== "BOOKING_CANCELLED") {
    return json({ ok: true, ignored: event });
  }

  const p = body.payload ?? {};
  const attendee = p.attendees?.[0] ?? {};
  const email = String(attendee.email ?? p.responses?.email?.value ?? "").toLowerCase();
  const name = String(attendee.name ?? p.responses?.name?.value ?? "").trim();
  const when = whenLine(p.startTime, attendee.timeZone);
  // What they ticked on the form, read back off the notes the modal prefilled.
  // A lead who typed over that field just loses the line, which is why nothing
  // downstream requires it.
  const interests = (String(p.responses?.notes?.value ?? "").match(/Interested in:\s*(.+)/) ?? [])[1] ?? null;
  const lead = { first: name.split(" ")[0] || null, last: null, email, interests };

  if (event === "BOOKING_CANCELLED") {
    // cal.com reports who did it; without that we cannot tell a lead dropping
    // a slot from Daniel clearing his week, so we say nothing.
    const by = String(p.cancelledBy?.email ?? p.cancelledBy ?? "").toLowerCase();
    const byAttendee = !!by && !!email && by === email;
    await logEvent({ type: "cancelled", email, by: by || null, byAttendee, startTime: p.startTime ?? "" });
    if (byAttendee && cfg("RESEND_API_KEY") && email) {
      try {
        await resend("/emails", cancelledEmail(lead, { when }), "POST",
          { "Idempotency-Key": `cancelled-${p.uid ?? email}` });
      } catch (err) {
        console.error("cancelled mail failed:", err.message);
      }
    }
    return json({ ok: true, offeredAnother: byAttendee });
  }

  await logEvent({ type: "booked", email, name, startTime: p.startTime ?? "", title: p.title });

  // Booking makes everything we have queued for them wrong: the welcome that
  // was held back for the modal, and the +72h nudge. Cancel both by sweeping
  // Resend for pending sends to this address, which needs no state of our own.
  try {
    const cancelled = await cancelScheduledFor(email);
    if (cancelled.length) await logEvent({ type: "scheduled-cancelled", email, ids: cancelled });
  } catch (err) {
    console.error("sweep failed:", err.message); // worst case: one extra email
  }
  // Housekeeping for deployments that still carry the old Upstash keys. Both
  // are best effort and no longer load bearing.
  for (const key of [`fein:welcome:${email}`, `fein:nudge:${email}`]) {
    try { await redis("DEL", key); } catch { /* no redis, nothing to clean */ }
  }

  if (cfg("RESEND_API_KEY") && email) {
    // The idempotency key is the booking uid, so a webhook cal.com retries
    // cannot mail the same person twice about the same booking.
    try {
      await resend("/emails", bookingEmail(lead, { when }), "POST",
        { "Idempotency-Key": `booking-${p.uid ?? email}` });
    } catch (err) {
      console.error("booking mail failed:", err.message); // the invite still went
    }
  }
  if (cfg("RESEND_API_KEY") && cfg("NOTIFY_TO")) {
    try {
      await resend("/emails", {
        from: cfg("MAIL_FROM"), to: [cfg("NOTIFY_TO")],
        reply_to: email || undefined, // hit reply to talk to them before the call
        subject: `fein call booked: ${name || email}${when ? ` on ${when}` : ""}`,
        text: `${name || email} booked${when ? ` for ${when}` : ""}.\nEvent: ${p.title ?? ""}${
          interests ? `\nInterested in: ${interests}` : ""
        }\n\nThey have the invite from cal.com and one mail from Olivia asking what they want fein to answer on the call. Nothing else is queued for them.${
          email ? `\nRebook link: ${callUrl(lead)}` : ""}`,
      });
    } catch (err) {
      console.error("notify failed:", err.message); // the booking itself is already logged
    }
  }
  return json({ ok: true });
}
