/**
 * Shared plumbing for the fein lead functions (Vercel, Web-handler style).
 *
 * The funnel: an enquiry immediately (1) notifies us with Reply-To set to
 * the lead, (2) sends the lead a booking link, (3) schedules a nudge for
 * +72h via Resend scheduled sends. Booking the call (cal.com webhook)
 * cancels the nudge, and cancelling the booking themselves offers another
 * time. Nothing here keeps state: a booking finds its own pending mail by
 * sweeping Resend's schedule for the attendee's address.
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
 *   MAIL_FROM                 internal notification sender, e.g. "fein site
 *                             <system@fein.vc>". Machine mail to us, so it
 *                             carries no person's name: everything a lead
 *                             reads comes from SALES_FROM instead.
 *   SALES_FROM                (optional) lead-facing persona; defaults to
 *                             "Olivia Greene <olivia.greene@fein.vc>"
 *   POSTAL_ADDRESS            (optional) last line of the sales signature
 *   UPSTASH_REDIS_REST_URL    (optional) per-IP rate limit and the event log.
 *   UPSTASH_REDIS_REST_TOKEN  No email depends on either one.
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
export async function resend(path, body, method = "POST", headers = {}) {
  const base = cfg("RESEND_BASE_URL") ?? "https://api.resend.com"; // overridable for tests
  const res = await fetch(base + path, {
    method,
    headers: { authorization: `Bearer ${cfg("RESEND_API_KEY")}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

// ---- upstash redis (REST, single-command POST body) -----------------------
export async function redis(...command) {
  // Two spellings: UPSTASH_* from a hand-created Upstash database, KV_* from
  // the Vercel-marketplace Upstash resource (which keeps the old Vercel KV
  // variable names when it connects to the project).
  const url = cfg("UPSTASH_REDIS_REST_URL") ?? cfg("KV_REST_API_URL"),
    token = cfg("UPSTASH_REDIS_REST_TOKEN") ?? cfg("KV_REST_API_TOKEN");
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

// ---- form-spam guards shared by /api/enquiry and /api/message ----

// Same-site check: browsers send an Origin header on every fetch() POST, so a
// request with none (curl, generic form-spam bots) or someone else's origin is
// not the site's own form posting. Preview deploys post from *.vercel.app.
// The endpoints return an explicit error on rejection, so a real visitor
// behind something exotic still lands on the widget's mailto fallback.
export function originOk(request) {
  const o = request.headers.get("origin");
  if (!o) return false;
  try {
    const h = new URL(o).hostname;
    // fein.vc is the only domain that serves the site and its forms. The old
    // domain 301s to it at the edge, so no page ever loads to post from it.
    return h === "fein.vc" || h === "www.fein.vc" || h === "localhost" || h.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

// Fallback rate limit for when Upstash is not configured (redis() returns null
// and the Redis caps never trip): a per-warm-instance counter. Cold starts
// reset it, so it is a backstop rather than the real limiter, but it turns
// "unlimited" into "a handful per instance per hour" with zero dependencies.
const softHits = new Map();
export function softLimit(bucket, max, windowMs = 3600_000) {
  const now = Date.now();
  if (softHits.size > 1000) softHits.clear();
  const rec = softHits.get(bucket) ?? { n: 0, reset: now + windowMs };
  if (now > rec.reset) { rec.n = 0; rec.reset = now + windowMs; }
  rec.n += 1;
  softHits.set(bucket, rec);
  return rec.n <= max;
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

/** Cancel every send still sitting in Resend's schedule for one address.
 *
 * This is what makes "we only write to the ones who did not book" true, and it
 * replaces the Upstash lookup that used to do it. Resend's list endpoint
 * carries `to`, `scheduled_at` and `last_event`, so a booking can find its own
 * pending mail by recipient without us having kept an id anywhere. That matters
 * because the ids were kept in Upstash, Upstash was never provisioned, and the
 * cancellations were therefore silently not happening.
 *
 * The list is every email newest first, so the window is the last `pages` x 100
 * sends. At this volume that is months. If sending ever grows enough that a
 * 72h old nudge falls off the end, the cost is one extra nudge to someone who
 * booked, never a lost lead, and the fix is more pages.
 */
export async function cancelScheduledFor(email, pages = 3) {
  const want = String(email ?? "").toLowerCase();
  if (!want) return [];
  const cancelled = [];
  let after = null;
  for (let i = 0; i < pages; i++) {
    const page = await resend(`/emails?limit=100${after ? `&after=${after}` : ""}`, undefined, "GET");
    const rows = page.data ?? [];
    for (const row of rows) {
      if (row.last_event !== "scheduled") continue;
      if (!(row.to ?? []).some((t) => String(t).toLowerCase() === want)) continue;
      try {
        await resend(`/emails/${row.id}/cancel`, {});
        cancelled.push(row.id);
      } catch (err) {
        console.error(`cancel ${row.id} failed:`, err.message); // worst case: one extra email
      }
    }
    if (!page.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return cancelled;
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
//
// One mail per thing that can happen to a lead, and never two for one:
//
//   filled the form, has not booked   -> welcomeEmail    (the calendar)
//   still not booked 72h later        -> followupEmail   (one nudge, then stop)
//   booked                            -> bookingEmail    (what to expect)
//   booked, then cancelled themselves -> cancelledEmail  (the calendar again)
//
// Since the demo page opens the calendar itself, most bookings now happen
// before the welcome is due, and the welcome is cancelled unsent. So for a
// lead who books, bookingEmail is the only thing they get from a person, which
// is why it carries the one question that makes the call worth having rather
// than a restatement of the invite cal.com already sent them.
export const salesFrom = () => cfg("SALES_FROM") ?? "Olivia Greene <olivia.greene@fein.vc>";

/** "warm introductions and meeting prep", from what they ticked on the form.
 * Lowercased because it lands mid sentence; null when they ticked nothing, and
 * every mail that uses it drops the whole line rather than saying "you asked
 * about nothing". */
export function interestPhrase(interests) {
  const list = String(interests ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    .map((s) => s.charAt(0).toLowerCase() + s.slice(1));
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "Thursday 20 August at 3:30 pm BST", in the attendee's own timezone, which
 * is the only one they can act on. Falls back to UTC when cal.com sends a
 * timezone Intl does not know, and to null when there is no usable time, in
 * which case the copy simply does not mention one. */
export function whenLine(startTime, timeZone) {
  const d = new Date(startTime ?? "");
  if (isNaN(d.getTime())) return null;
  const fmt = (tz) => {
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short", timeZone: tz }).format(d);
    return `${day} at ${time}`;
  };
  try { return fmt(timeZone || "UTC"); } catch { return fmt("UTC"); }
}

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
// POSTAL_ADDRESS is set; never invent one. `url` is omitted for a lead who is
// already booked: offering "Book a meeting" to someone holding an invite reads
// as mail that does not know who it is talking to.
function signatureHtml(url) {
  const addr = cfg("POSTAL_ADDRESS");
  const book = url ? ` | <a href="${esc(url)}" style="color:#1a73e8">Book a meeting</a>` : "";
  return `<p style="margin:40px 0 0;color:#888888">Olivia Greene<br>New Business @ fein${book}${addr ? `<br>${esc(addr)}` : ""}</p>`;
}

function signatureText(url) {
  const addr = cfg("POSTAL_ADDRESS");
  return `Olivia Greene\nNew Business @ fein${url ? ` | Book a meeting: ${url}` : ""}${addr ? `\n${addr}` : ""}`;
}

// The paragraph shell both lead-facing HTML mails wear: Gmail's default face,
// no shell, no buttons. Kept here so the four emails cannot drift apart.
const P = 'style="margin:0 0 16px"';
const htmlMail = (paras) =>
  `<div dir="ltr" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222">${paras.join("")}</div>`;

// `hold` schedules this instead of sending it, for the client that is about to
// put the calendar on the screen itself. The copy does not change: someone who
// closed the modal without booking has not read a word of this yet, and a mail
// that opened with "I saw you close that" would be worse than one that does
// not know. What it does not do any more is re-explain the call: on the demo
// page they have just read the page and seen the calendar, so this is short
// and its job is the link.
export function welcomeEmail(lead, { hold = false } = {}) {
  const url = callUrl(lead);
  const hi = `Hi ${lead.first || "there"},`;
  const want = interestPhrase(lead.interests);
  const opening = "Thanks for putting your name down on the fein website, it is lovely to hear from you. Typically, as a next step, we schedule a 15-20 minute call with Daniel, our founder, to get to know you and better understand what your team needs.";
  const started = want ? `You mentioned ${want}, so I've let Daniel know and he'll make sure to cover those.` : null;
  const closing = "He'll happily work around your schedule, and if nothing there suits, just reply here and we'll find a time that does.";
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    ...(hold ? { scheduled_at: new Date(Date.now() + WELCOME_HOLD_MINUTES * 60_000).toISOString() } : {}),
    subject: "your interest in fein",
    text: [
      hi, opening, started,
      `Do you have any availability in the coming days? I've opened up Daniel's calendar, so please feel free to grab whichever time suits you best: ${url}`,
      closing, "Speak soon,\nOlivia", `\n${signatureText(url)}`,
    ].filter(Boolean).join("\n\n"),
    html: htmlMail([
      `<p ${P}>${esc(hi)}</p>`,
      `<p ${P}>${esc(opening)}</p>`,
      started ? `<p ${P}>${esc(started)}</p>` : "",
      `<p ${P}>Do you have any availability in the coming days? I've opened up Daniel's <a href="${esc(url)}" style="color:#1a73e8">calendar</a>, so please feel free to grab whichever time suits you best.</p>`,
      `<p ${P}>${esc(closing)}</p>`,
      `<p style="margin:0">Speak soon,<br>Olivia</p>`,
      signatureHtml(url),
    ].filter(Boolean)),
  };
}

// One nudge, at +72h, and then we stop. Plain text on purpose: a chaser that
// arrives dressed the same as the first mail reads like a sequence, and this
// is meant to read like Olivia remembering.
export function followupEmail(lead) {
  const url = callUrl(lead);
  const want = interestPhrase(lead.interests);
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "fein: your intro call is still open",
    text: [
      `Hi ${lead.first || "there"},`,
      `You asked about fein a few days ago and we have not spoken yet. No rush at all, but if it is still on your mind, Daniel, our founder, would be glad to say hello: ${url}`,
      want ? `Twenty minutes is all it takes, and he'll happily show you ${want} running on a fund's real history.` : null,
      "And if the timing is simply wrong, just reply with a week that suits you and I'll come back to you then.",
      "Speak soon,\nOlivia",
    ].filter(Boolean).join("\n\n"),
    scheduled_at: new Date(Date.now() + FOLLOWUP_HOURS * 3600_000).toISOString(),
  };
}

// Sent when the booking lands, which for most leads is now the only mail from
// a person they will get: the welcome was cancelled before it was due. So it
// does not restate the invite cal.com has already sent (time, link, reschedule
// all live there and would only disagree with it later). It says what the
// twenty minutes are for, and asks for the one thing that makes them good,
// which is a real question of their own to put to fein on the call.
export function bookingEmail(lead, { when = null } = {}) {
  const hi = `Hi ${lead.first || "there"},`;
  const want = interestPhrase(lead.interests);
  const booked = when
    ? `Lovely, that's you booked in with Daniel for ${when}. The invite has the joining link in it, and a link to move the call if your day changes.`
    : "Lovely, that's you booked in with Daniel. The invite has the joining link in it, and a link to move the call if your day changes.";
  const shape = "He'll spend the twenty minutes showing you fein answering a real question from a fund's own history, so you can see for yourself whether it fits the stack your team is already running. He's looking forward to it.";
  const started = want ? `You mentioned ${want}, so that's where he'll start.` : null;
  const ask = "And if there's a question you'd want fein to answer, do send it over and he'll have it ready for you. Anything else you need before then, just let me know.";
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "your call with Daniel",
    text: [hi, booked, shape, started, ask, "Speak soon,\nOlivia", `\n${signatureText(null)}`]
      .filter(Boolean).join("\n\n"),
    html: htmlMail([
      `<p ${P}>${esc(hi)}</p>`,
      `<p ${P}>${esc(booked)}</p>`,
      `<p ${P}>${esc(shape)}</p>`,
      started ? `<p ${P}>${esc(started)}</p>` : "",
      `<p ${P}>${esc(ask)}</p>`,
      `<p style="margin:0">Speak soon,<br>Olivia</p>`,
      signatureHtml(null),
    ].filter(Boolean)),
  };
}

// ---- the pre-call drip ----------------------------------------------------
// Booked is not done: between the invite and the call there is room for one
// or two mails that make the twenty minutes worth more, which is the deck and
// how to prepare. Timed off the call itself, not the booking:
//
//   more than 26h out  -> prep mail 24h before, a short note 2h before
//   3h to 26h out      -> the prep mail alone, 2h before
//   under 3h out       -> nothing; the confirmation just went and the invite
//                         carries everything they need
//
// Both are Resend scheduled sends to the attendee, so the same sweep that
// cancels a welcome or a nudge (cancelScheduledFor) takes these away when the
// booking is cancelled, and a reschedule sweeps then re-times them. Nothing
// here keeps state either.
export const DECK_URL_DEFAULT = "https://fein.vc/deck/fein-deck.pdf";
export const deckUrl = () => cfg("DECK_URL") ?? DECK_URL_DEFAULT;

/** When the drip lands, relative to the call. Pure, so the tests can pin it.
 * Returns [] when there is no room, [{kind, at}] otherwise, ordered. The 29
 * day cap is Resend's scheduling window: a booking further out than that gets
 * its prep mail at the cap, which is still before the call. */
export function dripSchedule(startTime, now = new Date()) {
  const start = new Date(startTime ?? "");
  if (isNaN(start.getTime())) return [];
  const H = 3600_000, ms = start - now;
  if (ms <= 3 * H) return [];
  const cap = now.getTime() + 29 * 24 * H;
  if (ms <= 26 * H) return [{ kind: "prep", at: new Date(start - 2 * H) }];
  const out = [{ kind: "prep", at: new Date(Math.min(start - 24 * H, cap)) }];
  const dayAt = start - 2 * H;
  if (dayAt <= cap) out.push({ kind: "day", at: new Date(dayAt) });
  return out;
}

// The deck and how to prepare, a day before the call (or two hours before,
// when the call was booked close in). The one mail in the funnel allowed
// bullet points: it is a checklist by nature, and prose would bury it.
export function prepEmail(lead, { when = null, scheduledAt } = {}) {
  const url = deckUrl();
  const hi = `Hi ${lead.first || "there"},`;
  const opening = when
    ? `Your call with Daniel is coming up on ${when}, and I wanted to send over a couple of things so the twenty minutes go as far as they can.`
    : "Your call with Daniel is coming up, and I wanted to send over a couple of things so the twenty minutes go as far as they can.";
  const deckLine = `First, a short deck on what fein is and how teams run it: ${url}. It's five minutes over a coffee, and none of it is required reading.`;
  const prep = [
    "Bring a real question, the kind you'd want answered on an ordinary working day. The best demos start there, and Daniel will build yours around it.",
    "It helps to know what your team runs for email, calendar, notes and the CRM, since that's what fein reads.",
    "And if a colleague should see this too, just forward them the invite.",
  ];
  const closing = "If the time no longer suits, the invite has a link to move it, no need to explain.";
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    scheduled_at: new Date(scheduledAt).toISOString(),
    subject: "before your call with Daniel",
    text: [hi, opening, deckLine, prep.map((p) => `- ${p}`).join("\n"), closing,
      "Speak soon,\nOlivia", `\n${signatureText(null)}`].join("\n\n"),
    html: htmlMail([
      `<p ${P}>${esc(hi)}</p>`,
      `<p ${P}>${esc(opening)}</p>`,
      `<p ${P}>First, a <a href="${esc(url)}" style="color:#1a73e8">short deck</a> on what fein is and how teams run it. It&#39;s five minutes over a coffee, and none of it is required reading.</p>`,
      `<ul style="margin:0 0 16px;padding-left:20px">${prep.map((p) => `<li style="margin:0 0 8px">${esc(p)}</li>`).join("")}</ul>`,
      `<p ${P}>${esc(closing)}</p>`,
      `<p style="margin:0">Speak soon,<br>Olivia</p>`,
      signatureHtml(null),
    ]),
  };
}

// Two hours before the call: the deck again for whoever never opened it, and
// the same one ask the confirmation made. Plain text like the nudge, and for
// the same reason: dressed the same as the prep mail it would read as a
// sequence, and this is meant to read like Olivia checking in.
export function dayOfEmail(lead, { scheduledAt } = {}) {
  const url = deckUrl();
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    scheduled_at: new Date(scheduledAt).toISOString(),
    subject: "your fein call today",
    text: [
      `Hi ${lead.first || "there"},`,
      "Just a quick note before your call with Daniel later today. The joining link is in the calendar invite.",
      `If you've not had a minute for the deck, here it is again: ${url}. And if there's a question you'd like fein to answer live, just reply with it and Daniel will have it on screen when you join.`,
      "Speak soon,\nOlivia",
    ].join("\n\n"),
  };
}

/** The drip for one booking: [{mail, key}], ready to send. The idempotency
 * key carries the booking uid AND the start time, so a webhook cal.com
 * retries cannot schedule the same mail twice, while a reschedule (new start
 * time, same uid) mints new keys and is free to schedule again after the
 * sweep. */
export function dripEmails(lead, { startTime, timeZone = null, uid = null, now = new Date() } = {}) {
  const when = whenLine(startTime, timeZone);
  return dripSchedule(startTime, now).map(({ kind, at }) => ({
    mail: kind === "prep" ? prepEmail(lead, { when, scheduledAt: at }) : dayOfEmail(lead, { scheduledAt: at }),
    key: `${kind === "prep" ? "prep" : "prepday"}-${uid ?? lead.email}-${startTime}`,
  }));
}

// Only ever sent when the attendee cancelled it themselves. Someone who books
// and then drops the slot is still interested and has just left the funnel
// silently, since the nudge that would have caught them was cancelled by the
// booking. Daniel cancelling is a different thing entirely and must never
// trigger this, which the webhook checks before calling it.
export function cancelledEmail(lead, { when = null } = {}) {
  const url = callUrl(lead);
  const hi = `Hi ${lead.first || "there"},`;
  const off = when
    ? `No problem at all about ${when} coming off the calendar, these things happen.`
    : "No problem at all about the call coming off the calendar, these things happen.";
  const back = "And if it's easier to tell me what you're after over email first, just reply here and I'll help however I can.";
  return {
    from: salesFrom(),
    to: [lead.email],
    reply_to: cfg("NOTIFY_TO"),
    subject: "another time for the fein call",
    text: [hi, off, `Whenever you'd like another time, Daniel's calendar is still open, so please feel free to grab whichever slot suits: ${url}`, back,
      "Speak soon,\nOlivia", `\n${signatureText(url)}`].filter(Boolean).join("\n\n"),
    html: htmlMail([
      `<p ${P}>${esc(hi)}</p>`,
      `<p ${P}>${esc(off)}</p>`,
      `<p ${P}>Whenever you'd like another time, Daniel's <a href="${esc(url)}" style="color:#1a73e8">calendar</a> is still open, so please feel free to grab whichever slot suits.</p>`,
      `<p ${P}>${esc(back)}</p>`,
      `<p style="margin:0">Speak soon,<br>Olivia</p>`,
      signatureHtml(url),
    ]),
  };
}

export function notifyEmail(lead, { hold = false } = {}) {
  const rows = [
    ["Name", `${lead.first ?? ""} ${lead.last ?? ""}`], ["Email", lead.email],
    ["Firm", lead.fund], ["Website", lead.site], ["Region", lead.region],
    ["AUM", lead.size], ["Pipeline", lead.crm], ["Page", lead.source],
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
