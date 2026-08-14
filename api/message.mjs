import { cfg, json, resend, redis, logEvent } from "./_lib.mjs";

// The "Send a message" widget's endpoint. Deliberately lighter than /api/enquiry:
// one notify mail to NOTIFY_TO with reply_to set to the visitor, and nothing sent
// to the visitor at all. The reply they get is Daniel answering from his inbox,
// which is the whole point of the widget; an automated welcome here would make
// the personal channel feel like a ticket queue.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max).trim() || null);

export async function POST(request) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  // Same guards as /api/enquiry: honeypot field the visible form never fills,
  // and a floor on ms-between-open-and-submit that humans can't get under.
  if (body.website) return json({ ok: true });
  const t = Number(body.t);
  if (!Number.isFinite(t) || t < 2000) return json({ error: "too fast" }, 400);

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "enter a valid email" }, 400);
  const message = str(body.message, 4000);
  if (!message) return json({ error: "write a message" }, 400);

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  try {
    const hour = await redis("INCR", `fein:rl:m:h:${ip}`);
    if (hour === 1) await redis("EXPIRE", `fein:rl:m:h:${ip}`, "3600");
    if ((hour ?? 0) > 5) {
      await logEvent({ type: "rate-limited", ip, email, channel: "message" });
      return json({ error: "too many requests" }, 429);
    }
  } catch { /* fail open: Redis being down must not cost a message */ }

  const clean = { email, name: str(body.name, 120), page: str(body.page, 60) };
  await logEvent({ type: "message", ...clean, length: message.length });

  if (!cfg("RESEND_API_KEY")) {
    console.error("message received but RESEND_API_KEY is missing; not delivered");
    return json({ ok: true, mailed: false });
  }
  try {
    await resend("/emails", {
      from: cfg("MAIL_FROM"),
      to: [cfg("NOTIFY_TO")],
      reply_to: email, // hit reply to answer them directly
      subject: `fein message: ${clean.name || email}`,
      text: `Sent from the site widget${clean.page ? ` on ${clean.page}` : ""}.\n\nFrom: ${clean.name ? `${clean.name} <${email}>` : email}\n\n${message}`,
    });
  } catch (err) {
    console.error("message send failed:", err.message);
    await logEvent({ type: "send-error", email, error: err.message, channel: "message" });
    return json({ ok: true, mailed: false });
  }
  return json({ ok: true, mailed: true });
}
