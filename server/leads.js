/**
 * fein lead service. One small process behind Caddy at api.fein.vc.
 *
 *   POST /enquiry           contact-sales wizard submits here (JSON)
 *   GET  /call              302 to the cal.com booking page, prefilled
 *   POST /webhooks/calcom   cal.com BOOKING_CREATED cancels the follow-up
 *   GET  /health            liveness + which config is missing
 *
 * The funnel: a submitted enquiry immediately (1) notifies us with Reply-To
 * set to the lead, (2) sends the lead a booking link from Daniel, and
 * (3) schedules a nudge for +3 days via Resend scheduled sends. Booking the
 * call cancels the nudge. Leads are an append-only JSONL event log next to
 * this file; no database.
 *
 * Zero dependencies. Config from ./.env (KEY=VALUE lines) or the process env:
 *   RESEND_API_KEY        required for sending (service runs without it, but
 *                         /enquiry only logs + notifies nothing)
 *   CAL_LINK              e.g. https://cal.com/daniel/fein-intro
 *   CALCOM_WEBHOOK_SECRET signing secret from the cal.com webhook
 *   NOTIFY_TO             where lead notifications go
 *   MAIL_FROM             e.g. "Daniel at fein <daniel@fein.vc>"
 *   ALLOWED_ORIGINS       comma-separated, default https://fein.vc,https://www.fein.vc
 *   PORT                  default 8787
 */
import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const LOG = join(ROOT, "leads.jsonl");

// ---- config ---------------------------------------------------------------
const cfg = { ...envFile(join(ROOT, ".env")), ...process.env };
const PORT = Number(cfg.PORT ?? 8787);
const ORIGINS = (cfg.ALLOWED_ORIGINS ?? "https://fein.vc,https://www.fein.vc").split(",");
const FOLLOWUP_HOURS = Number(cfg.FOLLOWUP_HOURS ?? 72);
const RESEND_BASE = cfg.RESEND_BASE_URL ?? "https://api.resend.com"; // overridable for tests

function envFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const missing = ["RESEND_API_KEY", "CAL_LINK", "CALCOM_WEBHOOK_SECRET", "NOTIFY_TO", "MAIL_FROM"]
  .filter((k) => !cfg[k]);

// ---- event log ------------------------------------------------------------
// Append-only. On boot, replay to know which follow-ups are still pending.
const pendingFollowup = new Map(); // lower(email) -> resend email id
if (existsSync(LOG)) {
  for (const line of readFileSync(LOG, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type === "followup-scheduled") pendingFollowup.set(ev.email, ev.emailId);
      if (ev.type === "followup-cancelled" || ev.type === "booked") pendingFollowup.delete(ev.email);
    } catch {}
  }
}
const logEvent = (ev) => appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...ev }) + "\n");

// ---- resend ---------------------------------------------------------------
async function resend(path, body, method = "POST") {
  const res = await fetch(RESEND_BASE + path, {
    method,
    headers: { authorization: `Bearer ${cfg.RESEND_API_KEY}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function callUrl(lead) {
  const u = new URL(cfg.CAL_LINK ?? "https://cal.com");
  if (lead.first || lead.last) u.searchParams.set("name", [lead.first, lead.last].filter(Boolean).join(" "));
  if (lead.email) u.searchParams.set("email", lead.email);
  return u.toString();
}

// Restrained, mostly-text emails: system font, hairlines, one quiet blue CTA.
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

function welcomeEmail(lead) {
  const url = callUrl(lead);
  const first = lead.first || "there";
  return {
    from: cfg.MAIL_FROM,
    to: [lead.email],
    reply_to: cfg.NOTIFY_TO,
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

function followupEmail(lead) {
  const url = callUrl(lead);
  return {
    from: cfg.MAIL_FROM,
    to: [lead.email],
    reply_to: cfg.NOTIFY_TO,
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

function notifyEmail(lead) {
  const rows = [
    ["Name", `${lead.first ?? ""} ${lead.last ?? ""}`], ["Email", lead.email],
    ["Firm", lead.fund], ["AUM", lead.size], ["Pipeline", lead.crm], ["First question", lead.ask],
  ].filter(([, v]) => v && String(v).trim());
  return {
    from: cfg.MAIL_FROM,
    to: [cfg.NOTIFY_TO],
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

// ---- http -----------------------------------------------------------------
const RATE = new Map(); // ip -> timestamps
function rateLimited(ip) {
  const now = Date.now();
  const hits = (RATE.get(ip) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  RATE.set(ip, hits);
  return hits.length > 5;
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-headers", "content-type");
    res.setHeader("access-control-allow-methods", "POST");
  }
}

const json = (res, obj, status = 200) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error("body too large")); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function handleEnquiry(req, res) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? req.socket.remoteAddress;
  if (rateLimited(ip)) return json(res, { error: "too many requests" }, 429);
  let lead;
  try {
    lead = JSON.parse((await readBody(req)).toString("utf8"));
  } catch {
    return json(res, { error: "bad json" }, 400);
  }
  // Honeypot: the visible form never fills `website`. Pretend success.
  if (lead.website) return json(res, { ok: true });
  const email = String(lead.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json(res, { error: "enter a valid email" }, 400);
  const clean = {
    id: randomUUID().slice(0, 8),
    email,
    first: str(lead.first), last: str(lead.last), fund: str(lead.fund),
    size: str(lead.size), crm: str(lead.crm), ask: str(lead.ask, 2000),
  };
  logEvent({ type: "enquiry", ...clean, ip });

  if (!cfg.RESEND_API_KEY) {
    console.error("enquiry logged but RESEND_API_KEY is missing; no emails sent");
    return json(res, { ok: true, mailed: false });
  }
  // Notify + welcome + scheduled nudge. A failure in one must not lose the
  // lead (it is already logged) or block the response for long.
  try {
    await resend("/emails", notifyEmail(clean));
    await resend("/emails", welcomeEmail(clean));
    const nudge = await resend("/emails", followupEmail(clean));
    if (nudge.id) {
      pendingFollowup.set(email, nudge.id);
      logEvent({ type: "followup-scheduled", email, emailId: nudge.id });
    }
  } catch (err) {
    console.error("send failed:", err.message);
    logEvent({ type: "send-error", email, error: err.message });
    return json(res, { ok: true, mailed: false });
  }
  return json(res, { ok: true, mailed: true });
}

const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max).trim() || null);

async function handleCalcomWebhook(req, res) {
  const raw = await readBody(req);
  const sig = req.headers["x-cal-signature-256"] ?? "";
  const want = createHmac("sha256", cfg.CALCOM_WEBHOOK_SECRET ?? "").update(raw).digest("hex");
  const ok = sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  if (!cfg.CALCOM_WEBHOOK_SECRET || !ok) return json(res, { error: "bad signature" }, 401);

  let body;
  try { body = JSON.parse(raw.toString("utf8")); } catch { return json(res, { error: "bad json" }, 400); }
  if (body.triggerEvent !== "BOOKING_CREATED") return json(res, { ok: true, ignored: body.triggerEvent });

  const p = body.payload ?? {};
  const attendee = p.attendees?.[0] ?? {};
  const email = String(attendee.email ?? p.responses?.email?.value ?? "").toLowerCase();
  const when = p.startTime ?? "";
  logEvent({ type: "booked", email, name: attendee.name, startTime: when, title: p.title });

  // Booking makes the nudge redundant: cancel the scheduled send.
  const nudgeId = pendingFollowup.get(email);
  if (nudgeId) {
    try {
      await resend(`/emails/${nudgeId}/cancel`, {});
      logEvent({ type: "followup-cancelled", email, emailId: nudgeId });
    } catch (err) {
      console.error("cancel failed:", err.message); // worst case: one extra email
    }
    pendingFollowup.delete(email);
  }
  if (cfg.RESEND_API_KEY && cfg.NOTIFY_TO) {
    try {
      await resend("/emails", {
        from: cfg.MAIL_FROM, to: [cfg.NOTIFY_TO],
        subject: `fein call booked: ${attendee.name || email}${when ? ` at ${when}` : ""}`,
        text: `${attendee.name || email} booked${when ? ` for ${when}` : ""}.\nEvent: ${p.title ?? ""}`,
      });
    } catch (err) {
      console.error("notify failed:", err.message); // the booking itself is already logged
    }
  }
  return json(res, { ok: true });
}

const server = createServer(async (req, res) => {
  cors(req, res);
  const path = new URL(req.url, "http://x").pathname;
  try {
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.method === "GET" && path === "/health") {
      return json(res, { ok: true, pendingFollowups: pendingFollowup.size, missingConfig: missing });
    }
    if (req.method === "GET" && path === "/call") {
      // The site and both emails link here, so the cal.com link can change
      // in .env without rebuilding anything.
      const q = new URL(req.url, "http://x").searchParams;
      const dest = callUrl({ first: q.get("name"), email: q.get("email") });
      logEvent({ type: "call-click", email: q.get("email") ?? null });
      res.writeHead(302, { location: dest });
      return res.end();
    }
    if (req.method === "POST" && path === "/enquiry") return await handleEnquiry(req, res);
    if (req.method === "POST" && path === "/webhooks/calcom") return await handleCalcomWebhook(req, res);
    return json(res, { error: "not found" }, 404);
  } catch (err) {
    console.error(`${req.method} ${path}:`, err);
    return json(res, { error: "internal error" }, 500);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fein leads on 127.0.0.1:${PORT}${missing.length ? ` (missing config: ${missing.join(", ")})` : ""}`);
});
