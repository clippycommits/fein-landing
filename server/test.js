/**
 * Offline test for the lead service: a stub Resend records every API call,
 * the service runs as a child process pointed at it, and we drive the whole
 * funnel: enquiry -> three sends, booking webhook -> nudge cancelled,
 * bad signature -> 401, honeypot -> silent accept, /call -> prefit redirect.
 */
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRET = "whsec_test";
let failures = 0;
const ok = (cond, label) => {
  console.log(`  ${cond ? "ok " : "FAIL"} ${label}`);
  if (!cond) failures++;
};

// Stub Resend: record calls, hand out ids.
const sent = [];
const stub = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  sent.push({ method: req.method, path: req.url, body });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ id: `em_${sent.length}` }));
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubPort = stub.address().port;

// Run the service from a temp copy so leads.jsonl never pollutes the repo.
const dir = mkdtempSync(join(tmpdir(), "fein-leads-test-"));
cpSync(join(HERE, "leads.js"), join(dir, "leads.js"));
const PORT = 4871;
const child = spawn(process.execPath, [join(dir, "leads.js")], {
  env: {
    ...process.env,
    PORT: String(PORT),
    RESEND_BASE_URL: `http://127.0.0.1:${stubPort}`,
    RESEND_API_KEY: "re_test",
    CAL_LINK: "https://cal.com/daniel/fein-intro",
    CALCOM_WEBHOOK_SECRET: SECRET,
    NOTIFY_TO: "team@commixcapital.com",
    MAIL_FROM: "Daniel at fein <daniel@fein.vc>",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stderr.on("data", (d) => process.stderr.write(d));
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${BASE}/health`)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 100));
}

try {
  console.log("Enquiry:");
  const res = await fetch(`${BASE}/enquiry`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://fein.vc" },
    body: JSON.stringify({
      email: "Priya@MeridianWealth.example", first: "Priya", last: "Nair",
      fund: "Meridian Wealth", size: "$250M – $1B", crm: "Affinity", ask: "warm paths",
    }),
  });
  const body = await res.json();
  ok(res.status === 200 && body.ok && body.mailed, "accepted and mailed");
  ok(res.headers.get("access-control-allow-origin") === "https://fein.vc", "CORS allows fein.vc");
  ok(sent.length === 3, `three sends (notify, welcome, nudge) — got ${sent.length}`);
  const [notify, welcome, nudge] = sent.map((s) => s.body);
  ok(notify.to?.[0] === "team@commixcapital.com" && notify.reply_to === "priya@meridianwealth.example",
    "notify goes to us, Reply-To the lead");
  ok(welcome.to?.[0] === "priya@meridianwealth.example" && welcome.html.includes("cal.com/daniel/fein-intro"),
    "welcome carries the booking link");
  ok(welcome.html.includes("name=Priya+Nair") || welcome.html.includes("name=Priya%20Nair"),
    "booking link prefills the name");
  ok(typeof nudge.scheduled_at === "string" && new Date(nudge.scheduled_at) > new Date(),
    "nudge is scheduled in the future");
  ok(!JSON.stringify(sent).match(/—|—/), "email copy contains no em dashes");

  console.log("Honeypot + validation:");
  const hp = await fetch(`${BASE}/enquiry`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "bot@x.example", website: "http://spam" }),
  });
  ok((await hp.json()).ok === true && sent.length === 3, "honeypot accepted silently, nothing sent");
  const bad = await fetch(`${BASE}/enquiry`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  ok(bad.status === 400, "bad email is a 400");

  console.log("Booking webhook:");
  const payload = JSON.stringify({
    triggerEvent: "BOOKING_CREATED",
    payload: {
      title: "fein intro", startTime: "2026-08-12T10:00:00Z",
      attendees: [{ email: "priya@meridianwealth.example", name: "Priya Nair" }],
    },
  });
  const sig = createHmac("sha256", SECRET).update(payload).digest("hex");
  const wrong = await fetch(`${BASE}/webhooks/calcom`, {
    method: "POST", headers: { "x-cal-signature-256": "0".repeat(64) }, body: payload,
  });
  ok(wrong.status === 401, "wrong signature is a 401");
  const hook = await fetch(`${BASE}/webhooks/calcom`, {
    method: "POST", headers: { "x-cal-signature-256": sig }, body: payload,
  });
  ok((await hook.json()).ok === true, "signed webhook accepted");
  const cancel = sent.find((s) => s.path.includes("/cancel"));
  ok(cancel && cancel.path === "/emails/em_3/cancel", "the scheduled nudge was cancelled");
  ok(sent.some((s) => s.body?.subject?.startsWith("fein call booked")), "we get a booked notification");

  console.log("Call redirect:");
  const call = await fetch(`${BASE}/call?name=Priya%20Nair&email=priya@meridianwealth.example`, { redirect: "manual" });
  ok(call.status === 302 && call.headers.get("location").startsWith("https://cal.com/daniel/fein-intro"),
    "302s to the booking page");

  const health = await (await fetch(`${BASE}/health`)).json();
  ok(health.pendingFollowups === 0, "no pending follow-ups after booking");
} finally {
  const gone = new Promise((r) => child.on("exit", r));
  child.kill();
  await gone;
  stub.close();
  rmSync(dir, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} LEAD TEST(S) FAILED`); process.exit(1); }
console.log("\nLEAD TESTS PASSED");
