import { createHmac, timingSafeEqual } from "node:crypto";
import { cfg, json, resend, redis, logEvent } from "../_lib.mjs";

/** cal.com BOOKING_CREATED: cancel the scheduled nudge, tell us. The HMAC is
 * computed over the raw request body, which is why this reads text first. */
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
  if (body.triggerEvent !== "BOOKING_CREATED") return json({ ok: true, ignored: body.triggerEvent });

  const p = body.payload ?? {};
  const attendee = p.attendees?.[0] ?? {};
  const email = String(attendee.email ?? p.responses?.email?.value ?? "").toLowerCase();
  const when = p.startTime ?? "";
  await logEvent({ type: "booked", email, name: attendee.name, startTime: when, title: p.title });

  // Booking makes both scheduled sends redundant: the nudge, and the welcome
  // held back for the leads who were handed the modal (see _lib.mjs). Cancel
  // whichever are still pending, so booking in the modal means we never write
  // to them about booking at all.
  for (const [key, kind] of [
    [`fein:welcome:${email}`, "welcome-cancelled"],
    [`fein:nudge:${email}`, "followup-cancelled"],
  ]) {
    try {
      const id = await redis("GET", key);
      if (id) {
        await resend(`/emails/${id}/cancel`, {});
        await redis("DEL", key);
        await logEvent({ type: kind, email, emailId: id });
      }
    } catch (err) {
      console.error(`cancel ${key} failed:`, err.message); // worst case: one extra email
    }
  }
  if (cfg("RESEND_API_KEY") && cfg("NOTIFY_TO")) {
    try {
      await resend("/emails", {
        from: cfg("MAIL_FROM"), to: [cfg("NOTIFY_TO")],
        subject: `fein call booked: ${attendee.name || email}${when ? ` at ${when}` : ""}`,
        text: `${attendee.name || email} booked${when ? ` for ${when}` : ""}.\nEvent: ${p.title ?? ""}`,
      });
    } catch (err) {
      console.error("notify failed:", err.message); // the booking itself is already logged
    }
  }
  return json({ ok: true });
}
