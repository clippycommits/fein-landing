/**
 * Shared plumbing for the fein lead functions (Vercel, Web-handler style).
 *
 * The funnel: an enquiry immediately (1) notifies us with Reply-To set to
 * the lead, (2) sends the lead a booking link, (3) schedules a nudge for
 * +72h via Resend scheduled sends. Booking the call (cal.com webhook)
 * cancels the nudge. The email -> nudge-id mapping lives in Upstash Redis
 * because functions keep no disk; everything else is stateless.
 *
 * (2) has one exception. The demo page opens the cal.com booking modal on
 * top of itself the moment the enquiry is accepted, so for that client the
 * welcome is scheduled +WELCOME_HOLD_MINUTES instead of sent, and the same
 * webhook cancels it. Someone who books in the modal therefore hears from
 * cal.com and nobody else; only the people who filled the form in and did
 * not book get written to. Clients that say nothing (the pe page, or a demo
 * page whose embed never loaded) keep the immediate send.
 *
 * Env (Vercel project settings):
 *   RESEND_API_KEY            sending
 *   CAL_LINK                  booking page the "calendar" links point at,
 *                             e.g. https://cal.com/daniel/fein-intro
 *   CALCOM_WEBHOOK_SECRET     cal.com webhook signing secret
 *   NOTIFY_TO                 where lead notifications go
 *   MAIL_FROM                 internal notification sender, e.g. "fein site <noah@fein.vc>"
 *   SALES_FROM                (optional) lead-facing persona; defaults to
 *                             "Olivia Greene <olivia.greene@fein.vc>"
 *   POSTAL_ADDRESS            (optional) last line of the sales signature
 *   UPSTASH_REDIS_REST_URL    nudge state (optional: without it the nudge
 *   UPSTASH_REDIS_REST_TOKEN  still sends; it just can't be auto-cancelled)
 */

export const cfg = (k) => process.env[k] || null;
export const REQUIRED = ["RESEND_API_KEY", "CAL_LINK", "CALCOM_WEBHOOK_SECRET", "NOTIFY_TO", "MAIL_FROM"];
export const missingConfig = () => REQUIRED.filter((k) => !cfg(k));

export const FOLLOWUP_HOURS = Number(cfg("FOLLOWUP_HOURS") ?? 72);
// Long enough that it never lands while they are still picking a time in the
// modal, short enough to still read as a reply to what they just did.
export const WELCOME_HOLD_MINUTES = Number(cfg("WELCOME_HOLD_MINUTES") ?? 15);

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// ---- resend ---------------------------------------------------------------
export async function resend(path, body, method = "POST") {
  const base = cfg("RESEND_BASE_URL") ?? "https://api.resend.com"; // overridable for tests
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${cfg("RESEND_API_KEY")}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// ---- upstash redis (REST, single-command POST body) -----------------------
export async function redis(...command) {
  const url = cfg("UPSTASH_REDIS_REST_URL"), token = cfg("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`redis ${command[0]} -> ${res.status}`);
  return data.result ?? null;
}

// Best-effort event log: a Redis list, newest first. The email notifications
// are the primary record; losing a log line must never fail a request.
export async function logEvent(ev) {
  try {
    await redis("LPUSH", "fein:log", JSON.stringify({ at: new Date().toISOString(), ...ev }));
  } catch (err) {
    console.error("log failed:", err.message);
  }
}

// ---- email copy (site rules apply: no em dashes) --------------------------
// Lead-facing mail is the SDR persona Olivia Greene, modelled on Ramp's
// "your interest in Ramp" outreach: it must read as personally written, so
// the HTML part is a bare Gmail-style message (default font, a plain link on
// "calendar", grey signature) — no brand shell, no buttons. Internal
// notifications keep MAIL_FROM.
// The calendar behind CAL_LINK is Daniel's (the founder), so the copy has
// Olivia arranging a call WITH Daniel, never offering "my calendar" — the
// booking page showing a different name would break the persona.
// Register: warm but unfussy. Thank them, offer a way out ("just reply"),
// sign off "Speak soon". No exclamation marks, no "excited", no flattery.
export const salesFrom = () => cfg("SALES_FROM") ?? "Olivia Greene <olivia.greene@fein.vc>";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function callUrl(lead) {
  const u = new URL(cfg("CAL_LINK") ?? "https://cal.com");
  const name = [lead.first, lead.last].filter(Boolean).join(" ");
  if (name) u.searchParams.set("name", name);
  if (lead.email) u.searchParams.set("email", lead.email);
  return u.toString();
}

// The same CAL_LINK split the way the cal.com embed wants it: an origin to
// frame and the path under it. Served to the page by /api/cal so the booking
// modal moves with the env var too, and no page ever hardcodes the calendar.
export function calEmbed() {
  const u = new URL(cfg("CAL_LINK") ?? "https://cal.com");
  return { origin: u.origin, link: u.pathname.replace(/^\/+|\/+$/g, "") };
}

// The grey Gmail-style signature. The address line only appears once
// POSTAL_ADDRESS is set; never invent one.
function signatureHtml(url) {
  const addr = cfg("POSTAL_ADDRESS");
  return `<p style="margin:40px 0 0;color:#888888">Olivia Greene<br>New Business @ fein | <a href="${esc(url)}" style="color:#1a73e8">Book a meeting</a>${addr ? `<br>${esc(addr)}` : ""}</p>`;
}

function signatureText(url) {
  const addr = cfg("POSTAL_ADDRESS");
  return `Olivia Greene\nNew Business @ fein | Book a meeting: ${url}${addr ? `\n${addr}` : ""}`;
}

// `hold` schedules this instead of sending it, for the client that is about to
// put the calendar on the screen itself. The copy does not change: someone who
// closed the modal without booking has not read a word of this yet.
export function welcomeEmail(lead, { hold = false } = {}) {
  const url = callUrl(lead);
  const hi = `Hi ${lead.first || "there"},`;
  const p = 'style="margin:0 0 16px"';
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    ...(hold ? { scheduled_at: new Date(Date.now() + WELCOME_HOLD_MINUTES * 60_000).toISOString() } : {}),
    subject: "your interest in fein",
    text: `${hi}\n\nThanks for putting your name down on the fein website, it is lovely to hear from you. Typically, as a next step, we schedule a 15-20 minute call with Daniel, our founder, to get to know you and better understand what your team needs.\n\nDo you have any availability in the coming days? I've opened up Daniel's calendar, so please feel free to grab whichever time suits you best: ${url}\n\nHe'll happily work around your schedule, and if nothing there suits, just reply here and we'll find a time that does.\n\nSpeak soon,\nOlivia\n\n\n${signatureText(url)}`,
    html: `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222"><p ${p}>${esc(hi)}</p><p ${p}>Thanks for putting your name down on the fein website, it is lovely to hear from you. Typically, as a next step, we schedule a 15-20 minute call with Daniel, our founder, to get to know you and better understand what your team needs.</p><p ${p}>Do you have any availability in the coming days? I've opened up Daniel's <a href="${esc(url)}" style="color:#1a73e8">calendar</a>, so please feel free to grab whichever time suits you best.</p><p ${p}>He'll happily work around your schedule, and if nothing there suits, just reply here and we'll find a time that does.</p><p style="margin:0">Speak soon,<br>Olivia</p>${signatureHtml(url)}</div>`,
  };
}

export function followupEmail(lead) {
  const url = callUrl(lead);
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "fein: your intro call is still open",
    text: `Hi ${lead.first || "there"},\n\nYou asked about fein a few days ago and we have not spoken yet. No rush at all, but if it is still on your mind, Daniel, our founder, would be glad to say hello: ${url}\n\nAnd if the timing is simply wrong, just reply with a week that suits you and we'll come back to you then.\n\nSpeak soon,\nOlivia`,
    scheduled_at: new Date(Date.now() + FOLLOWUP_HOURS * 3600_000).toISOString(),
  };
}

export function notifyEmail(lead, { hold = false } = {}) {
  const rows = [
    ["Name", `${lead.first ?? ""} ${lead.last ?? ""}`], ["Email", lead.email],
    ["Firm", lead.fund], ["Website", lead.site], ["Region", lead.region],
    ["AUM", lead.size], ["Pipeline", lead.crm],
    ["Interested in", lead.interests], ["First question", lead.ask],
  ].filter(([, v]) => v && String(v).trim());
  return {
    from: cfg("MAIL_FROM"),
    to: [cfg("NOTIFY_TO")],
    reply_to: lead.email, // hit reply to talk to the lead directly
    subject: `fein lead: ${lead.fund || lead.email}${lead.size ? ` (${lead.size})` : ""}`,
    text: `New enquiry from the site.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${hold
      ? `The booking modal opened in front of them. If they book, cal.com tells you and they hear nothing else from us. If they do not, the booking link reaches them in ${WELCOME_HOLD_MINUTES} minutes and a nudge in ${FOLLOWUP_HOURS} hours.`
      : `They got the booking link straight away; a nudge goes out in ${FOLLOWUP_HOURS} hours unless they book first.`}`,
  };
}
