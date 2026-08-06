import { cfg, json, resend, redis, logEvent, welcomeEmail, followupEmail, notifyEmail } from "./_lib.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max).trim() || null);

export default async function handler(request) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  let lead;
  try {
    lead = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  // Honeypot: the visible form never fills `website`. Pretend success.
  if (lead.website) return json({ ok: true });
  const email = String(lead.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "enter a valid email" }, 400);
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
