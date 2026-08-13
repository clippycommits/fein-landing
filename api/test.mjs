/**
 * Offline test for the Vercel lead functions: fetch is patched to record
 * Resend calls and emulate Upstash, then the handlers are driven directly
 * with Request objects. Run: node api/test.mjs
 */
import { createHmac } from "node:crypto";

const SECRET = "whsec_test";
Object.assign(process.env, {
  RESEND_API_KEY: "re_test",
  RESEND_BASE_URL: "https://resend.test",
  CAL_LINK: "https://cal.com/daniel/fein-intro",
  CALCOM_WEBHOOK_SECRET: SECRET,
  NOTIFY_TO: "daniel@fein.vc",
  MAIL_FROM: "fein site <system@fein.vc>",
  UPSTASH_REDIS_REST_URL: "https://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "tok_test",
});

let failures = 0;
const ok = (cond, label) => {
  console.log(`  ${cond ? "ok " : "FAIL"} ${label}`);
  if (!cond) failures++;
};

// ---- fake Resend + Upstash behind global fetch ----------------------------
const sent = [];          // Resend calls
const kv = new Map();     // Upstash state
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : undefined;
  if (u.startsWith("https://resend.test")) {
    const path = u.slice("https://resend.test".length);
    // GET /emails is what a booking uses to find its own pending mail, so the
    // fake has to keep the send log the way Resend does: newest first, with the
    // scheduled ones still marked scheduled until something cancels them.
    if (path.startsWith("/emails?")) {
      const data = sent.filter((s) => s.path === "/emails").map((s) => ({
        id: s.id, to: s.body?.to ?? [], subject: s.body?.subject,
        scheduled_at: s.body?.scheduled_at ?? null,
        last_event: s.body?.scheduled_at ? (s.cancelled ? "canceled" : "scheduled") : "delivered",
      })).reverse();
      return Response.json({ object: "list", has_more: false, data });
    }
    const cancel = path.match(/^\/emails\/([^/]+)\/cancel$/);
    if (cancel) {
      const row = sent.find((s) => s.id === cancel[1]);
      if (!row) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
      row.cancelled = true;
    }
    sent.push({ path, body, id: `em_${sent.length + 1}`, headers: init.headers ?? {} });
    return Response.json({ id: `em_${sent.length}` });
  }
  if (u.startsWith("https://redis.test")) {
    const [op, key, value] = body;
    let result = null;
    if (op === "SET") { kv.set(key, value); result = "OK"; }
    if (op === "GET") result = kv.get(key) ?? null;
    if (op === "DEL") result = kv.delete(key) ? 1 : 0;
    if (op === "LPUSH") { kv.set(key, [value, ...(kv.get(key) ?? [])]); result = kv.get(key).length; }
    return Response.json({ result });
  }
  throw new Error(`unexpected fetch: ${u}`);
};

const { POST: enquiry } = await import("./enquiry.mjs");
const { GET: call } = await import("./call.mjs");
const { GET: calEmbedRoute } = await import("./cal.mjs");
const { GET: health } = await import("./health.mjs");
const { POST: webhook } = await import("./webhooks/calcom.mjs");

const post = (handler, body, headers = {}) =>
  handler(new Request("https://fein.vc/api/x", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));

console.log("Enquiry:");
{
  const res = await post(enquiry, {
    email: "Priya@MeridianWealth.example", first: "Priya", last: "Nair",
    fund: "Meridian Wealth", size: "$250M - $1B", crm: "Affinity", ask: "warm paths",
    t: 30000, // the real form always sends ms-since-open; the gate rejects < 2.5s
  });
  const body = await res.json();
  ok(res.status === 200 && body.ok && body.mailed, "accepted and mailed");
  const mails = sent.filter((s) => s.path === "/emails");
  ok(mails.length === 3, `three sends (notify, welcome, nudge) — got ${mails.length}`);
  const [notify, welcome, nudge] = mails.map((s) => s.body);
  ok(notify.to?.[0] === "daniel@fein.vc" && notify.reply_to === "priya@meridianwealth.example",
    "notify goes to us, Reply-To the lead");
  ok(welcome.to?.[0] === "priya@meridianwealth.example" && welcome.text.includes("cal.com/daniel/fein-intro"),
    "welcome carries the booking link");
  ok(welcome.text.includes("name=Priya+Nair") || welcome.text.includes("name=Priya%20Nair"),
    "booking link prefills the name");
  ok(welcome.subject === "your interest in fein", "welcome subject replicates the SDR pattern");
  ok(welcome.text.startsWith("Hi Priya,") && welcome.html.includes(">Hi Priya,</p>"),
    "welcome greets the lead by first name");
  ok(!JSON.stringify([welcome, nudge]).includes("my calendar") &&
    welcome.text.includes("Daniel's calendar") && welcome.text.includes("Daniel, our founder"),
    "the calendar is framed as Daniel's (founder), never Olivia's");
  const { welcomeEmail } = await import("./_lib.mjs");
  ok(welcomeEmail({ email: "x@y.example" }).text.startsWith("Hi there,"),
    "greeting falls back to 'there' when the form has no first name");
  ok([welcome, nudge].every((m) => m.text.includes("Speak soon,\nOlivia")) &&
    welcome.html.includes("Speak soon,<br>Olivia"),
    "both lead emails sign off warmly");
  ok(!JSON.stringify([welcome, nudge]).match(/!|excited|thrilled/i),
    "warmth stays unfussy: no exclamation marks, no gush");
  ok(welcome.from === "Olivia Greene <olivia.greene@fein.vc>" && nudge.from === welcome.from,
    "lead-facing mail comes from the Olivia persona");
  ok(welcome.html?.includes(">calendar</a>") && welcome.html.includes("cal.com/daniel/fein-intro"),
    "welcome html links the word 'calendar' to the booking page");
  ok(welcome.html.includes("New Business @ fein") && welcome.html.includes("Book a meeting"),
    "welcome carries the signature block");
  ok(!welcome.html.includes("POSTAL") && !welcome.html.match(/<br>\s*<\/p>$/),
    "signature address line stays out until POSTAL_ADDRESS is set");
  ok([notify, nudge].every((m) => !m.html && m.text), "notify and nudge stay plain text");
  ok(typeof nudge.scheduled_at === "string" && new Date(nudge.scheduled_at) > new Date(),
    "nudge is scheduled in the future");
  const pending = await (await fetch("https://resend.test/emails?limit=100")).json();
  ok(pending.data.some((r) => r.last_event === "scheduled" && r.to.includes("priya@meridianwealth.example")),
    "the nudge is findable in resend's own schedule, which is what a booking cancels");
  ok(!JSON.stringify(mails).match(/—|—/), "email copy contains no em dashes");
}

console.log("Copy that follows what the lead ticked:");
{
  const { welcomeEmail, followupEmail, bookingEmail, interestPhrase, whenLine } = await import("./_lib.mjs");
  ok(interestPhrase("Warm introductions, Meeting prep, Deal history") ===
    "warm introductions, meeting prep and deal history", "interests read as a sentence, not a list");
  ok(interestPhrase(null) === null && interestPhrase("") === null, "nothing ticked, nothing to say");
  const lead = { email: "a@b.example", first: "Ada", interests: "Warm introductions, Meeting prep" };
  const said = "You mentioned warm introductions and meeting prep, so I've let Daniel know and he'll make sure to cover those.";
  ok(welcomeEmail(lead).text.includes(said) && welcomeEmail(lead).html.includes(said.slice(0, 40)),
    "the welcome answers what they ticked, in both parts");
  ok(!welcomeEmail({ email: "a@b.example" }).text.includes("You mentioned"),
    "and says nothing at all when they ticked nothing");
  ok(followupEmail(lead).text.includes("warm introductions and meeting prep"),
    "the nudge remembers it too");
  const w = whenLine("2026-08-20T09:30:00Z", "Europe/London");
  ok(w === "Thursday 20 August at 10:30 am BST", `the time is in their timezone, not ours — got ${w}`);
  ok(whenLine("2026-08-20T09:30:00Z", "Not/AZone").includes("Thursday 20 August"),
    "an unknown timezone falls back to UTC rather than breaking the mail");
  ok(whenLine(undefined, "Europe/London") === null && !bookingEmail(lead).text.includes("null"),
    "no usable time means the copy simply does not mention one");
}

console.log("Honeypot + validation:");
{
  const before = sent.length;
  const hp = await post(enquiry, { email: "bot@x.example", website: "http://spam" });
  ok((await hp.json()).ok === true && sent.length === before, "honeypot accepted silently, nothing sent");
  const bad = await post(enquiry, { email: "not-an-email", t: 30000 });
  ok(bad.status === 400, "bad email is a 400");
  const notJson = await post(enquiry, "{nope");
  ok(notJson.status === 400, "bad json is a 400");
}

console.log("Booking webhook:");
{
  const payload = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: {
      title: "fein intro", startTime: "2026-08-12T10:00:00Z",
      attendees: [{ email: "priya@meridianwealth.example", name: "Priya Nair" }],
    },
  });
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  const wrong = await post(webhook, payload, { "x-cal-signature-256": "0".repeat(64) });
  ok(wrong.status === 401, "wrong signature is a 401");
  const hook = await post(webhook, payload, { "x-cal-signature-256": sig });
  ok((await hook.json()).ok === true, "signed webhook accepted");
  const cancel = sent.find((s) => s.path.includes("/cancel"));
  ok(cancel && cancel.path === "/emails/em_3/cancel", "the scheduled nudge was cancelled");
  const still = await (await fetch("https://resend.test/emails?limit=100")).json();
  ok(!still.data.some((r) => r.last_event === "scheduled" && r.to.includes("priya@meridianwealth.example")),
    "and nothing is left in the schedule for someone who has booked");
  ok(sent.some((s) => s.body?.subject?.startsWith("fein call booked")), "we get a booked notification");

  const booked = sent.map((s) => s.body).filter((b) => b?.subject === "your call with Daniel").pop();
  ok(booked?.to?.[0] === "priya@meridianwealth.example" && booked.from.includes("Olivia"),
    "the lead gets one mail from Olivia about the booking");
  ok(booked.text.includes("Wednesday 12 August at 10:00 am"),
    "it says when, in words, not an ISO string");
  ok(booked.text.includes("do send it over and he'll have it ready for you"),
    "it asks for the question that makes the call worth having");
  ok(!booked.text.includes("Book a meeting") && !booked.text.includes("cal.com"),
    "and never offers a calendar to someone already holding an invite");
  ok(!JSON.stringify(booked).match(/—|—|!/), "booking mail keeps the copy rules");

  const other = JSON.stringify({ triggerEvent: "BOOKING_REQUESTED", payload: {} });
  const otherSig = createHmac("sha256", SECRET).update(other).digest("hex");
  const ignored = await post(webhook, other, { "x-cal-signature-256": otherSig });
  ok((await ignored.json()).ignored === "BOOKING_REQUESTED", "other events acknowledged, not acted on");
}

console.log("Cancellations:");
{
  const cancelled = (by) => JSON.stringify({
    triggerEvent: "BOOKING_CANCELLED",
    payload: {
      uid: "bk_1", title: "fein intro", startTime: "2026-08-12T10:00:00Z",
      attendees: [{ email: "priya@meridianwealth.example", name: "Priya Nair", timeZone: "Europe/London" }],
      cancelledBy: by,
    },
  });
  let mark = sent.length;
  const theirs = cancelled({ email: "priya@meridianwealth.example" });
  const res1 = await post(webhook, theirs, {
    "x-cal-signature-256": createHmac("sha256", SECRET).update(theirs).digest("hex"),
  });
  ok((await res1.json()).offeredAnother === true, "the attendee dropping the slot is answered");
  const offer = sent.slice(mark).map((s) => s.body).find((b) => b?.subject === "another time for the fein call");
  ok(offer && offer.text.includes("No problem at all about Wednesday 12 August at 11:00 am BST coming off") && offer.text.includes("cal.com/daniel/fein-intro"),
    "it names the slot they dropped and hands back the calendar");

  mark = sent.length;
  const ours = cancelled({ email: "daniel@fein.vc" });
  const res2 = await post(webhook, ours, {
    "x-cal-signature-256": createHmac("sha256", SECRET).update(ours).digest("hex"),
  });
  ok((await res2.json()).offeredAnother === false && sent.length === mark,
    "us cancelling says nothing to the lead, because we know why");
}

console.log("Booking modal path (demo page):");
{
  const before = sent.length;
  const res = await post(enquiry, {
    email: "sam@northgate.example", first: "Sam", last: "Okafor",
    region: "Europe", interests: ["Warm introductions", "Meeting prep"],
    booking: "modal", source: "demo", t: 30000,
  });
  ok((await res.json()).mailed === true, "accepted and mailed");
  const [notify, welcome, nudge] = sent.slice(before).filter((s) => s.path === "/emails").map((s) => s.body);
  ok(typeof welcome.scheduled_at === "string" && new Date(welcome.scheduled_at) > new Date(),
    "the welcome is held, not sent, when the page is opening the modal itself");
  ok(typeof nudge.scheduled_at === "string" && new Date(nudge.scheduled_at) > new Date(welcome.scheduled_at),
    "the nudge still sits behind the welcome");
  ok(notify.text.includes("booking modal opened") && notify.text.includes("hear nothing else"),
    "our notification says which funnel this lead is in");

  // ...and booking in that modal takes both scheduled sends away, leaving one
  // mail: the confirmation, which is the whole of what a booked lead hears
  // from a person.
  const payload = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: {
      uid: "bk_sam", title: "fein intro", startTime: "2026-08-20T09:00:00Z",
      attendees: [{ email: "sam@northgate.example", name: "Sam Okafor", timeZone: "Europe/Stockholm" }],
      responses: { notes: { value: "Part of the world: Europe\nInterested in: Warm introductions, Meeting prep" } },
    },
  });
  const mark = sent.length;
  const hook = await post(webhook, payload, {
    "x-cal-signature-256": createHmac("sha256", SECRET).update(payload).digest("hex"),
  });
  ok((await hook.json()).ok === true, "signed webhook accepted");
  const cancels = sent.slice(mark).filter((s) => s.path.includes("/cancel")).map((s) => s.path);
  ok(cancels.length === 2, `booking cancels both the held welcome and the nudge — got ${cancels.length}`);
  const toLead = sent.slice(mark).filter((s) => s.path === "/emails" && s.body?.to?.[0] === "sam@northgate.example");
  ok(toLead.length === 1 && toLead[0].body.subject === "your call with Daniel",
    `a lead who books gets exactly one mail from us, and it is the confirmation — got ${toLead.length}`);
  ok(toLead[0].headers["Idempotency-Key"] === "booking-bk_sam",
    "keyed on the booking, so a webhook cal.com retries cannot mail them twice");
  ok(toLead[0].body.text.includes("warm introductions and meeting prep"),
    "which still knows what they ticked, read back off the notes the modal prefilled");
  ok(toLead[0].body.text.includes("Thursday 20 August at 11:00 am"),
    "and states the time where they are, not where the server is");
}

console.log("The whole funnel with no Upstash at all:");
{
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const before = sent.length;
  await post(enquiry, { email: "ines@harbourline.example", first: "Ines", booking: "modal", t: 30000 });
  const [, welcome] = sent.slice(before).filter((s) => s.path === "/emails").map((s) => s.body);
  ok(typeof welcome.scheduled_at === "string",
    "the welcome is still held: taking it back needs resend's schedule, not ours");
  const payload = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: { uid: "bk_ines", startTime: "2026-08-21T14:00:00Z", attendees: [{ email: "ines@harbourline.example", name: "Ines" }] },
  });
  const mark = sent.length;
  await post(webhook, payload, {
    "x-cal-signature-256": createHmac("sha256", SECRET).update(payload).digest("hex"),
  });
  ok(sent.slice(mark).filter((s) => s.path.includes("/cancel")).length === 2,
    "and the booking still takes both sends away with no redis in the picture");
  const left = await (await fetch("https://resend.test/emails?limit=100")).json();
  ok(!left.data.some((r) => r.last_event === "scheduled" && r.to.includes("ines@harbourline.example")),
    "nothing is left queued for someone who booked");
  Object.assign(process.env, { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: tok });
}

console.log("Call redirect + health:");
{
  const res = await call(new Request("https://fein.vc/api/call?name=Priya%20Nair&email=priya@meridianwealth.example"));
  ok(res.status === 302 && res.headers.get("location").startsWith("https://cal.com/daniel/fein-intro"),
    "302s to the booking page");
  ok(res.headers.get("location").includes("email=priya"), "redirect prefills the email");
  const embed = await (await calEmbedRoute()).json();
  ok(embed.origin === "https://cal.com" && embed.link === "daniel/fein-intro",
    "/api/cal splits CAL_LINK the way the embed wants it");
  const h = await (await health(new Request("https://fein.vc/api/health"))).json();
  ok(h.ok === true && h.missingConfig.length === 0, "health reports full config");
}

// Run over everything the suite has sent, so it covers each journey above.
console.log("Who every mail comes from:");
{
  const mails = sent.filter((s) => s.path === "/emails" && s.body?.to?.[0]).map((s) => s.body);
  const [internal, external] = [
    mails.filter((m) => m.to[0] === "daniel@fein.vc"),
    mails.filter((m) => m.to[0] !== "daniel@fein.vc"),
  ];
  ok(external.length > 4 && external.every((m) => m.from === "Olivia Greene <olivia.greene@fein.vc>"),
    `everything a lead reads comes from Olivia — ${external.length} mails, ${new Set(external.map((m) => m.from)).size} sender`);
  ok(internal.length > 2 && internal.every((m) => m.from === "fein site <system@fein.vc>"),
    `everything addressed to us comes from the machine address — ${internal.length} mails`);
  ok(!internal.some((m) => /noah|olivia|daniel/i.test(m.from)),
    "and the machine address carries nobody's name, so no notification reads as written by a person");
  // Olivia writes the way she speaks. Flattening the contractions out is what
  // turns this mail from a person into a product announcement, and it is a
  // thing a careless edit does without noticing, so it is pinned here.
  // Verb contractions only: a possessive apostrophe ("a fund's own history")
  // would pass a looser pattern without the copy being in her voice at all.
  const SPOKEN = /\b(I'll|I've|I'm|we'll|we've|we're|he'll|he's|she'll|she's|you'll|you've|you'd|you're|it's|that's|there's|let's)\b/i;
  ok(external.every((m) => SPOKEN.test(m.text)),
    "every lead-facing mail is still written in Olivia's voice, contractions and all");
  // The HTML part carries them as &#39;, which is what renders in a client.
  ok(external.every((m) => SPOKEN.test(String(m.html ?? m.text).replace(/&#39;/g, "'"))),
    "including the HTML part, which is the one a reader actually sees");
}

if (failures) { console.error(`\n${failures} LEAD TEST(S) FAILED`); process.exit(1); }
console.log("\nLEAD TESTS PASSED");
