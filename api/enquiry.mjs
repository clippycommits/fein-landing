import { cfg, json, resend, redis, logEvent, welcomeEmail, followupEmail, notifyEmail, WELCOME_HOLD_MINUTES } from "./_lib.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max).trim() || null);

export async function POST(request) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  let lead;
  try {
    lead = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  // Honeypot: the visible form never fills `website`. Pretend success.
  if (lead.website) return json({ ok: true });
  // Time gate: `t` is ms between the modal opening and submit. The real form
  // always sends it and humans can't fill five fields this fast. An error
  // (not fake success) so a tripped-up real visitor still lands on the
  // client's relay fallback.
  const t = Number(lead.t);
  if (!Number.isFinite(t) || t < 2500) return json({ error: "too fast" }, 400);
  const email = String(lead.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "enter a valid email" }, 400);

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // Per-IP rate limit (needs Upstash; without it redis() returns null and the
  // caps never trip). Redis being down must not cost a lead.
  try {
    const hour = await redis("INCR", `fein:rl:h:${ip}`);
    if (hour === 1) await redis("EXPIRE", `fein:rl:h:${ip}`, "3600");
    const day = await redis("INCR", `fein:rl:d:${ip}`);
    if (day === 1) await redis("EXPIRE", `fein:rl:d:${ip}`, "86400");
    if ((hour ?? 0) > 5 || (day ?? 0) > 12) {
      await logEvent({ type: "rate-limited", ip, email });
      return json({ error: "too many requests" }, 429);
    }
  } catch { /* fail open */ }

  // reCAPTCHA v3, armed only when RECAPTCHA_SECRET is set (the page needs the
  // matching site key in RECAPTCHA_KEY). Rejection is an error so a blocked
  // real visitor (adblocker ate the script) still delivers via the relay.
  const secret = cfg("RECAPTCHA_SECRET");
  if (secret) {
    let human = true;
    try {
      const v = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: String(lead.captcha ?? ""), remoteip: ip }),
      }).then((r) => r.json());
      human = !!v.success && (v.score === undefined || v.score >= 0.5);
    } catch { /* verifier unreachable: fail open, the other guards hold */ }
    if (!human) {
      await logEvent({ type: "captcha-reject", ip, email });
      return json({ error: "captcha" }, 400);
    }
  }
  // `site` is the company URL the demo form asks for. It is deliberately NOT
  // called `website`: that key is the honeypot above, and a form that put a real
  // URL in it would have every genuine submission answered with a fake success.
  // `interests` arrives as an array of checkbox values and is flattened here so
  // the notify mail and the event log can both treat it as one string.
  const clean = {
    email,
    first: str(lead.first), last: str(lead.last), fund: str(lead.fund),
    size: str(lead.size), crm: str(lead.crm), ask: str(lead.ask, 2000),
    site: str(lead.site, 200),
    region: str(lead.region, 40),
    // which page sent the lead ("pe", "fundraising", "portfolio"; the demo
    // modal sends none). The segment pages exist to learn which desk converts,
    // so the attribution has to survive into the log and the notify mail.
    source: str(lead.source, 40),
    interests: Array.isArray(lead.interests)
      ? (lead.interests.slice(0, 12).map((v) => str(v, 60)).filter(Boolean).join(", ") || null)
      : null,
  };
  // `booking: "modal"` is the demo page saying it has the cal.com embed loaded
  // and is opening it over this response. Then the welcome waits a few minutes
  // (and the booking webhook cancels it), so a lead who books in the modal is
  // never written to about booking. Any client that does not say this, including
  // a demo page whose embed was blocked, gets the immediate send as before.
  //
  // Holding it is only sound if the booking can take it away again. It can:
  // the webhook sweeps Resend for pending sends to the attendee, so this needs
  // no state of ours and no Upstash (see cancelScheduledFor in _lib.mjs).
  const hold = lead.booking === "modal";
  await logEvent({ type: "enquiry", ...clean, booking: hold ? "modal" : null });

  if (!cfg("RESEND_API_KEY")) {
    console.error("enquiry received but RESEND_API_KEY is missing; no emails sent");
    return json({ ok: true, mailed: false });
  }
  try {
    await resend("/emails", notifyEmail(clean, { hold }));
    const welcome = await resend("/emails", welcomeEmail(clean, { hold }));
    if (hold && welcome.id) {
      await logEvent({ type: "welcome-held", email, emailId: welcome.id, minutes: WELCOME_HOLD_MINUTES });
    }
    const nudge = await resend("/emails", followupEmail(clean));
    if (nudge.id) await logEvent({ type: "followup-scheduled", email, emailId: nudge.id });
  } catch (err) {
    console.error("send failed:", err.message);
    await logEvent({ type: "send-error", email, error: err.message });
    return json({ ok: true, mailed: false });
  }
  return json({ ok: true, mailed: true });
}
