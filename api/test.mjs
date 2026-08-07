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
  NOTIFY_TO: "team@commixcapital.com",
  MAIL_FROM: "Daniel at fein <daniel@fein.vc>",
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
  });
  const body = await res.json();
  ok(res.status === 200 && body.ok && body.mailed, "accepted and mailed");
  const mails = sent.filter((s) => s.path === "/emails");
  ok(mails.length === 3, `three sends (notify, welcome, nudge) — got ${mails.length}`);
  const [notify, welcome, nudge] = mails.map((s) => s.body);
  ok(notify.to?.[0] === "team@commixcapital.com" && notify.reply_to === "priya@meridianwealth.example",
    "notify goes to us, Reply-To the lead");
  ok(welcome.to?.[0] === "priya@meridianwealth.example" && welcome.html.includes("cal.com/daniel/fein-intro"),
    "welcome carries the booking link");
  ok(welcome.html.includes("name=Priya+Nair") || welcome.html.includes("name=Priya%20Nair"),
    "booking link prefills the name");
  ok(typeof nudge.scheduled_at === "string" && new Date(nudge.scheduled_at) > new Date(),
    "nudge is scheduled in the future");
  ok(kv.get("fein:nudge:priya@meridianwealth.example") === "em_3", "nudge id stored in redis");
  ok(!JSON.stringify(mails).match(/—|—/), "email copy contains no em dashes");
  ok(!JSON.stringify(mails).includes("fund "), "email copy never says 'fund'");
}

console.log("Honeypot + validation:");
{
  const before = sent.length;
  const hp = await post(enquiry, { email: "bot@x.example", website: "http://spam" });
  ok((await hp.json()).ok === true && sent.length === before, "honeypot accepted silently, nothing sent");
  const bad = await post(enquiry, { email: "not-an-email" });
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

console.log("Call redirect + health:");
{
  const res = await call(new Request("https://fein.vc/api/call?name=Priya%20Nair&email=priya@meridianwealth.example"));
  ok(res.status === 302 && res.headers.get("location").startsWith("https://cal.com/daniel/fein-intro"),
    "302s to the booking page");
  ok(res.headers.get("location").includes("email=priya"), "redirect prefills the email");
  const h = await (await health(new Request("https://fein.vc/api/health"))).json();
  ok(h.ok === true && h.missingConfig.length === 0, "health reports full config");
}

if (failures) { console.error(`\n${failures} LEAD TEST(S) FAILED`); process.exit(1); }
console.log("\nLEAD TESTS PASSED");
