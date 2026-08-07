/**
 * Shared plumbing for the fein lead functions (Vercel, Web-handler style).
 *
 * The funnel: an enquiry immediately (1) notifies us with Reply-To set to
 * the lead, (2) sends the lead a booking link, (3) schedules a nudge for
 * +72h via Resend scheduled sends. Booking the call (cal.com webhook)
 * cancels the nudge. The email -> nudge-id mapping lives in Upstash Redis
 * because functions keep no disk; everything else is stateless.
 *
 * Env (Vercel project settings):
 *   RESEND_API_KEY            sending
 *   CAL_LINK                  booking page the "calendar" links point at,
 *                             e.g. https://cal.com/daniel/fein-intro (a Chili
 *                             Piper booking link drops straight in here)
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

// ---- email copy (site rules apply: no em dashes, never "fund") ------------
// Lead-facing mail is the SDR persona Olivia Greene, modelled on Ramp's
// "your interest in Ramp" outreach: it must read as personally written, so
// the HTML part is a bare Gmail-style message (default font, a plain link on
// "calendar", grey signature) — no brand shell, no buttons. Internal
// notifications keep MAIL_FROM.
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

export function welcomeEmail(lead) {
  const url = callUrl(lead);
  const p = 'style="margin:0 0 16px"';
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "your interest in fein",
    text: `Hi there,\n\nNoticed that you entered your name onto the fein website. Typically, as a next step, we schedule a 15-20 minute call to better understand your business's needs.\n\nDo you have any availability in the coming days? I've opened up my calendar, please feel free to throw some time on with me: ${url}\n\nI'll happily work around your schedule.\n\nKindly,\nOlivia\n\n\n${signatureText(url)}`,
    html: `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222"><p ${p}>Hi there,</p><p ${p}>Noticed that you entered your name onto the fein website. Typically, as a next step, we schedule a 15-20 minute call to better understand your business's needs.</p><p ${p}>Do you have any availability in the coming days? I've opened up my <a href="${esc(url)}" style="color:#1a73e8">calendar</a>, please feel free to throw some time on with me.</p><p ${p}>I'll happily work around your schedule.</p><p style="margin:0">Kindly,<br>Olivia</p>${signatureHtml(url)}</div>`,
  };
}

export function followupEmail(lead) {
  const url = callUrl(lead);
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "fein: your intro call is still open",
    text: `Hi ${lead.first || "there"},\n\nYou asked about fein a few days ago and we have not spoken yet. If it is still on your mind, pick a time: ${url}\n\nIf the timing is wrong, reply with a week that suits and we will come back to you then.\n\nKindly,\nOlivia`,
    scheduled_at: new Date(Date.now() + FOLLOWUP_HOURS * 3600_000).toISOString(),
  };
}

export function notifyEmail(lead) {
  const rows = [
    ["Name", `${lead.first ?? ""} ${lead.last ?? ""}`], ["Email", lead.email],
    ["Firm", lead.fund], ["AUM", lead.size], ["Pipeline", lead.crm], ["First question", lead.ask],
  ].filter(([, v]) => v && String(v).trim());
  return {
    from: cfg("MAIL_FROM"),
    to: [cfg("NOTIFY_TO")],
    reply_to: lead.email, // hit reply to talk to the lead directly
    subject: `fein lead: ${lead.fund || lead.email}${lead.size ? ` (${lead.size})` : ""}`,
    text: `New enquiry from the site.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nThey got the booking link straight away; a nudge goes out in ${FOLLOWUP_HOURS} hours unless they book first.`,
  };
}
