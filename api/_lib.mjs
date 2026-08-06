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
 *   CAL_LINK                  e.g. https://cal.com/daniel/fein-intro
 *   CALCOM_WEBHOOK_SECRET     cal.com webhook signing secret
 *   NOTIFY_TO                 where lead notifications go
 *   MAIL_FROM                 e.g. "Daniel at fein <daniel@fein.vc>"
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
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function callUrl(lead) {
  const u = new URL(cfg("CAL_LINK") ?? "https://cal.com");
  const name = [lead.first, lead.last].filter(Boolean).join(" ");
  if (name) u.searchParams.set("name", name);
  if (lead.email) u.searchParams.set("email", lead.email);
  return u.toString();
}

function shell(bodyHtml) {
  return `<div style="margin:0;padding:32px 16px;background:#ffffff;color:#111111;
    font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
    <div style="max-width:520px;margin:0 auto">
      <div style="font-weight:600;letter-spacing:.01em;padding-bottom:14px;border-bottom:1px solid #e5e5e5">fein</div>
      <div style="padding-top:18px">${bodyHtml}</div>
      <div style="margin-top:28px;padding-top:14px;border-top:1px solid #e5e5e5;color:#8a8a8a;font-size:12.5px">
        fein, the graph for venture capital teams · <a href="https://fein.vc" style="color:#8a8a8a">fein.vc</a>
      </div>
    </div></div>`;
}
const cta = (href, label) => `<a href="${esc(href)}" style="display:inline-block;margin:6px 0 2px;
  padding:10px 18px;border-radius:6px;background:#0070F3;color:#ffffff;text-decoration:none;font-weight:600">${label}</a>`;

export function welcomeEmail(lead) {
  const url = callUrl(lead);
  const first = lead.first || "there";
  return {
    from: cfg("MAIL_FROM"),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "Your fein intro call",
    html: shell(
      `<p>Hi ${esc(first)},</p>
       <p>Thanks for reaching out about fein${lead.fund ? ` for ${esc(lead.fund)}` : ""}.
       The next step is a 30 minute call: we map where your team's data lives and
       show you the first answers from a live graph.</p>
       <p>${cta(url, "Pick a time")}</p>
       <p>If nothing there works, reply to this email and we will find a slot.</p>
       <p>Daniel</p>`),
    text: `Hi ${first},\n\nThanks for reaching out about fein${lead.fund ? ` for ${lead.fund}` : ""}. The next step is a 30 minute call: we map where your team's data lives and show you the first answers from a live graph.\n\nPick a time: ${url}\n\nIf nothing there works, just reply to this email.\n\nDaniel`,
  };
}

export function followupEmail(lead) {
  const url = callUrl(lead);
  return {
    from: cfg("MAIL_FROM"),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "Still want to see your graph?",
    html: shell(
      `<p>Hi ${esc(lead.first || "there")},</p>
       <p>You asked about fein a few days ago and we have not spoken yet.
       If it is still on your mind, the calendar is here:</p>
       <p>${cta(url, "Pick a time")}</p>
       <p>If the timing is wrong, no problem: reply with a week that suits and
       we will come back to you then.</p>
       <p>Daniel</p>`),
    text: `Hi ${lead.first || "there"},\n\nYou asked about fein a few days ago and we have not spoken yet. If it is still on your mind: ${url}\n\nIf the timing is wrong, reply with a week that suits and we will come back to you then.\n\nDaniel`,
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
    html: shell(
      `<p>New enquiry from the site.</p>
       <table style="border-collapse:collapse;width:100%">${rows.map(([k, v]) =>
         `<tr><td style="padding:6px 12px 6px 0;color:#8a8a8a;white-space:nowrap;vertical-align:top">${esc(k)}</td>
              <td style="padding:6px 0">${esc(v)}</td></tr>`).join("")}</table>
       <p style="color:#8a8a8a">They got the booking link straight away; a nudge goes out in ${FOLLOWUP_HOURS} hours unless they book first.</p>`),
    text: rows.map(([k, v]) => `${k}: ${v}`).join("\n"),
  };
}
