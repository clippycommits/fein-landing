import { cfg, json, resend, redis, logEvent, originOk, softLimit } from "./_lib.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// The landing page posts JSON via fetch. A visitor with JavaScript off gets a
// native form POST instead, so the body may be urlencoded and the reply has to
// be a page rather than JSON. Both paths run the same guards.
//
// `intent` picks the notification. Absent (the original subscribe field) it is
// a plain "contact me"; "info-pack" is the homepage's "Receive an Information
// Pack" button, and for now only tells us to send it by hand.
async function readBody(request) {
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return await request.json().catch(() => ({}));
  const form = await request.formData().catch(() => null);
  return form ? Object.fromEntries(form.entries()) : {};
}

const wantsJson = (request) => (request.headers.get("accept") ?? "").includes("application/json");

const page = (body) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>fein</title><body style="margin:0;background:#fff;color:#111;font:400 17px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">` +
      `<main style="max-width:880px;margin:0 auto;padding:48px 32px"><p>${body}</p>` +
      `<p style="font-size:15px"><a href="/" style="color:#111;text-underline-offset:3px">Back</a></p></main>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );

const fail = (request, message, status) =>
  wantsJson(request) ? json({ error: message }, status) : page(message);

export async function POST(request) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);

  const body = await readBody(request);

  // Honeypot: the real field is off-screen and never filled by a person.
  if (body.website) return wantsJson(request) ? json({ ok: true }) : page("Thanks. We will be in touch.");

  // Time gate: `t` is ms between the field opening and submit. Only the fetch
  // path sends it, so its absence is not a rejection — the honeypot and the
  // origin check still stand for a no-JavaScript post.
  const t = Number(body.t);
  if (Number.isFinite(t) && t < 1200) return fail(request, "too fast", 400);

  if (!originOk(request)) return fail(request, "bad origin", 403);

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return fail(request, "Enter a valid email address.", 400);
  const pack = String(body.intent ?? "") === "info-pack";
  const thanks = pack ? "Thanks. The information pack will be on its way." : "Thanks. We will be in touch.";

  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  // Backstop for when Upstash is absent and the Redis caps below never trip.
  if (!softLimit(`s:${ip}`, 8)) return fail(request, "Too many requests. Try again later.", 429);
  try {
    const hour = await redis("INCR", `fein:sl:h:${ip}`);
    if (hour === 1) await redis("EXPIRE", `fein:sl:h:${ip}`, "3600");
    if ((hour ?? 0) > 8) {
      await logEvent({ type: "subscribe-rate-limited", ip, email });
      return fail(request, "Too many requests. Try again later.", 429);
    }
  } catch { /* fail open: Redis being down must not cost a lead */ }

  await logEvent({ type: pack ? "info-pack" : "subscribe", email, ip });

  if (!cfg("RESEND_API_KEY")) {
    console.error("subscribe received but RESEND_API_KEY is missing; no email sent");
    return wantsJson(request) ? json({ ok: true, mailed: false }) : page(thanks);
  }
  try {
    await resend("/emails", {
      from: cfg("MAIL_FROM"),
      to: [cfg("NOTIFY_TO")],
      reply_to: email, // hit reply to answer them directly
      subject: pack ? "Request Information Pack" : `fein enquiry: ${email}`,
      text: pack
        ? `${email} asked to receive the information pack, from the fein homepage.\n\nReply to this mail to send it to them.\n\nip: ${ip}`
        : `${email} asked to be contacted, from the fein landing page.\n\nReply to this mail to answer them.\n\nip: ${ip}`,
    });
  } catch (err) {
    // The address is already in the event log, so a send failure is not a lost
    // lead. Tell the visitor it worked rather than asking them to retype it.
    console.error("subscribe send failed:", err.message);
    await logEvent({ type: "subscribe-send-error", email, error: err.message });
    return wantsJson(request) ? json({ ok: true, mailed: false }) : page(thanks);
  }
  return wantsJson(request) ? json({ ok: true, mailed: true }) : page(thanks);
}
