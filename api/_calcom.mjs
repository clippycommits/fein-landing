/**
 * cal.com for the terminal on the homepage: read Daniel's open slots and book
 * one. Two functions use this, /api/slots and /api/book.
 *
 * Env (Vercel project settings):
 *   CALCOM_API_KEY          a cal.com API key for Daniel's account
 *   CALCOM_EVENT_TYPE_ID    the intro-call event type (the one CAL_LINK opens)
 *   SLOT_SECRET             (optional) signs the slots we offer; falls back to
 *                           CALCOM_WEBHOOK_SECRET
 *
 * Without the first two, /api/slots offers nothing and the terminal falls back
 * to the email funnel (the welcome mail carries CAL_LINK), so the key can be
 * pulled at any time without breaking the page.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cfg } from "./_lib.mjs";

export const CAL_API = "https://api.cal.com/v2";
export const eventTypeId = () => Number(cfg("CALCOM_EVENT_TYPE_ID") ?? 0) || null;
export const calReady = () => !!(cfg("CALCOM_API_KEY") && eventTypeId());

export async function cal(path, { method = "GET", body, version } = {}) {
  const base = cfg("CALCOM_BASE_URL") ?? CAL_API; // overridable for tests
  const res = await fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${cfg("CALCOM_API_KEY")}`,
      "content-type": "application/json",
      "cal-api-version": version,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === "error") {
    const err = new Error(`cal ${method} ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return data.data ?? data;
}

// ---- signed offers ----------------------------------------------------------
// /api/slots hands out each start time with a token; /api/book only books a
// start that carries a valid one. So a bot cannot fill the calendar by posting
// arbitrary times at /api/book: it has to be a time we offered, in the last
// half hour, and the per-IP caps decide how many of those it gets.
export const SLOT_TTL_MS = 30 * 60_000;
const secret = () => cfg("SLOT_SECRET") ?? cfg("CALCOM_WEBHOOK_SECRET") ?? "";
const mac = (s) => createHmac("sha256", secret()).update(s).digest("hex").slice(0, 32);

export function signSlot(start, now = Date.now()) {
  const exp = now + SLOT_TTL_MS;
  return `${exp}.${mac(`${start}|${exp}`)}`;
}

export function slotOk(start, token, now = Date.now()) {
  const [expS, sig] = String(token ?? "").split(".");
  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  const want = mac(`${start}|${exp}`);
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

// ---- availability -------------------------------------------------------------
export function tzName(tz) {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return tz; } catch { return "UTC"; }
}

const ymd = (d) => d.toISOString().slice(0, 10);

/** Every open start time, ISO strings ascending, from tomorrow for `days` days.
 * Today is left out: same-day slots are Daniel's to give, not the page's. */
export async function availableSlots({ tz = "UTC", days = 10 } = {}) {
  const start = new Date(Date.now() + 24 * 3600_000);
  const end = new Date(start.getTime() + days * 86400_000);
  const data = await cal(
    `/slots?eventTypeId=${eventTypeId()}&start=${ymd(start)}&end=${ymd(end)}&timeZone=${encodeURIComponent(tz)}`,
    { version: "2024-09-04" },
  );
  // cal.com answers in the zone we asked for ("...T09:00:00.000+01:00"); the
  // bookings API wants UTC, so every start is carried around in UTC from here.
  return Object.values(data ?? {}).flat()
    .map((s) => (typeof s === "string" ? s : s?.start))
    .filter(Boolean)
    .map((s) => new Date(s))
    .filter((d) => !isNaN(d.getTime()))
    .map((d) => d.toISOString())
    .sort();
}

const partsIn = (iso, tz) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false }).format(d)) % 24;
  return { day, hour };
};

/** A short offer from a long list: for each of the next `dayCount` days with
 * something open in working hours, one morning slot and one afternoon slot in
 * the visitor's own zone. A day whose only openings fall outside 9 to 6 for
 * the visitor is skipped rather than offered at midnight; the "another time"
 * option and the public calendar carry every other hour. Eight choices read
 * as a menu; forty read as a calendar. Pure, so the tests can pin it. */
export function offer(starts, { tz = "UTC", dayCount = 4 } = {}) {
  const byDay = new Map();
  for (const s of starts) {
    const { day, hour } = partsIn(s, tz);
    if (hour < 9 || hour >= 18) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({ start: s, hour });
  }
  const out = [];
  for (const [, list] of [...byDay.entries()].slice(0, dayCount)) {
    const morning = list.find((x) => x.hour < 13) ?? null;
    const afternoon = list.find((x) => x.hour >= 14 && x !== morning) ?? list.find((x) => x.hour >= 13 && x !== morning) ?? null;
    for (const x of [morning, afternoon]) if (x) out.push(x.start);
  }
  return out;
}

/** "Thu 28 Aug, 10:00" in the visitor's zone. */
export function slotLabel(start, tz) {
  const d = new Date(start);
  if (isNaN(d.getTime())) return String(start);
  try {
    const day = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d);
    return `${day}, ${time}`;
  } catch {
    return d.toISOString();
  }
}
