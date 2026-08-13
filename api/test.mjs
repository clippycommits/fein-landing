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
  MAIL_FROM: "Noah Frank <noah@fein.vc>",
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
    sent.push({ path: u.slice("https://resend.test".length), body });
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
  ok(kv.get("fein:nudge:priya@meridianwealth.example") === "em_3", "nudge id stored in redis");
  ok(!JSON.stringify(mails).match(/—|—/), "email copy contains no em dashes");
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
  ok(!kv.has("fein:nudge:priya@meridianwealth.example"), "nudge key deleted");
  ok(sent.some((s) => s.body?.subject?.startsWith("fein call booked")), "we get a booked notification");
  const other = JSON.stringify({ triggerEvent: "BOOKING_CANCELLED", payload: {} });
  const otherSig = createHmac("sha256", SECRET).update(other).digest("hex");
  const ignored = await post(webhook, other, { "x-cal-signature-256": otherSig });
  ok((await ignored.json()).ignored === "BOOKING_CANCELLED", "other events acknowledged, not acted on");
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
  ok(kv.get("fein:welcome:sam@northgate.example") === `em_${sent.length - 1}`,
    "held welcome id stored in redis so the booking can cancel it");
  ok(typeof nudge.scheduled_at === "string" && new Date(nudge.scheduled_at) > new Date(welcome.scheduled_at),
    "the nudge still sits behind the welcome");
  ok(notify.text.includes("booking modal opened") && notify.text.includes("hear nothing else"),
    "our notification says which funnel this lead is in");

  // ...and booking in that modal takes both scheduled sends away
  const payload = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: {
      title: "fein intro", startTime: "2026-08-20T09:00:00Z",
      attendees: [{ email: "sam@northgate.example", name: "Sam Okafor" }],
    },
  });
  const mark = sent.length;
  const hook = await post(webhook, payload, {
    "x-cal-signature-256": createHmac("sha256", SECRET).update(payload).digest("hex"),
  });
  ok((await hook.json()).ok === true, "signed webhook accepted");
  const cancels = sent.slice(mark).filter((s) => s.path.includes("/cancel")).map((s) => s.path);
  ok(cancels.length === 2, `booking cancels both the held welcome and the nudge — got ${cancels.length}`);
  ok(!kv.has("fein:welcome:sam@northgate.example") && !kv.has("fein:nudge:sam@northgate.example"),
    "both keys deleted");
  ok(sent.slice(mark).every((s) => s.path.includes("/cancel") || s.body?.subject?.startsWith("fein call booked")),
    "someone who books in the modal is never written to about booking");
}

console.log("Booking modal path with no Upstash:");
{
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  const before = sent.length;
  await post(enquiry, { email: "ines@harbourline.example", first: "Ines", booking: "modal", t: 30000 });
  const [, welcome] = sent.slice(before).filter((s) => s.path === "/emails").map((s) => s.body);
  ok(!welcome.scheduled_at,
    "with no redis to cancel it, the welcome sends now rather than arriving late to someone who booked");
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

if (failures) { console.error(`\n${failures} LEAD TEST(S) FAILED`); process.exit(1); }
console.log("\nLEAD TESTS PASSED");
