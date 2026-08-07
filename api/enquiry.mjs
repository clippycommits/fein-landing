import { cfg, json, resend, redis, logEvent, welcomeEmail, followupEmail, notifyEmail } from "./_lib.mjs";

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
  const clean = {
    email,
    first: str(lead.first), last: str(lead.last), fund: str(lead.fund),
    size: str(lead.size), crm: str(lead.crm), ask: str(lead.ask, 2000),
  };
  await logEvent({ type: "enquiry", ...clean });

  if (!cfg("RESEND_API_KEY")) {
    console.error("enquiry received but RESEND_API_KEY is missing; no emails sent");
    return json({ ok: true, mailed: false });
  }
  try {
    await resend("/emails", notifyEmail(clean));
    await resend("/emails", welcomeEmail(clean));
    const nudge = await resend("/emails", followupEmail(clean));
    if (nudge.id) {
      // 7-day TTL: the nudge fires at +72h, so stale keys clean themselves up.
      await redis("SET", `fein:nudge:${email}`, nudge.id, "EX", "604800");
      await logEvent({ type: "followup-scheduled", email, emailId: nudge.id });
    }
  } catch (err) {
    console.error("send failed:", err.message);
    await logEvent({ type: "send-error", email, error: err.message });
    return json({ ok: true, mailed: false });
  }
  return json({ ok: true, mailed: true });
}
