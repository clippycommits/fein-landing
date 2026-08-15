# Launch checklist — fein.vc

Everything runs on Vercel: one project serves the static site and the
`/api/*` lead functions on the same domain. Push to main = deploy.

## The one command

```bash
bash scripts/funnel-wizard.sh
```

Eleven stages, ~50 minutes, re-runnable (state in `~/.config/fein/funnel.env`):
import the repo into Vercel, point fein.vc at it, Upstash Redis, Resend
domain + key, email authentication (SPF/DKIM/DMARC), cal.com event + webhook,
Vercel env vars, FormSubmit fallback activation, end-to-end smoke test, and
retiring the old VPS service.

## The booking funnel

```
"Get a demo" (any page)  →  two-step modal (src/demo-modal.html, injected
   site-wide by build.js; /demo stays the no-JS + direct-URL fallback)
   step 1: work email only · step 2: name, region, interests
   ├─ GET /api/cal on open                 (CAL_LINK, split for the embed)
   └─ POST /api/enquiry                    (Vercel function, same origin)
        ├─ notification → daniel@fein.vc   (Reply-To: the lead)
        ├─ welcome → lead, Daniel's calendar, what the call is
        │    HELD +15m when the page says `booking: "modal"`
        ├─ nudge scheduled +72h (Resend scheduled send)
        └─ cal.com modal opens over the page, name/email/notes prefilled
cal.com BOOKING_CREATED   → /api/webhooks/calcom (HMAC-verified)
        ├─ cancels every pending send to that address (welcome, nudge)
        ├─ confirmation → lead, what the twenty minutes are for, and the
        │    one ask: send a question you want fein to answer
        ├─ pre-call drip scheduled (timed off the call, not the booking):
        │    >26h out: deck+prep mail at T-24h, short note at T-2h
        │    3-26h out: the deck+prep mail alone at T-2h
        │    <3h out: nothing (the confirmation just went)
        │    deck: DECK_URL, default https://fein.vc/deck/fein-deck.pdf
        └─ "fein call booked" notification → daniel@fein.vc
cal.com BOOKING_RESCHEDULED → /api/webhooks/calcom
        └─ sweeps the pending drip, re-times it against the new slot,
           sends nothing now (cal.com already sent the updated invite)
cal.com BOOKING_CANCELLED → /api/webhooks/calcom
        ├─ sweeps the pending drip, whoever cancelled
        └─ if THEY cancelled: "another time for the fein call" + the calendar
           if we cancelled: nothing, we know why
```

The cal.com webhook must have **Booking created, Booking cancelled and
Booking rescheduled** ticked (Settings → Developer → Webhooks), or the drip
outlives cancellations and mis-times reschedules.

One mail per thing that can happen to a lead, and never two for one. The four
journeys and what each one gets:

| what they did | from cal.com | from us |
| --- | --- | --- |
| booked in the modal | invite | confirmation (the welcome is cancelled before it was due), then the pre-call drip |
| closed the modal, never booked | nothing | welcome at +15m, one nudge at +72h, then we stop |
| booked later, from the email | invite | welcome, then confirmation; the nudge is cancelled; then the pre-call drip |
| moved the call | updated invite | nothing new; the drip is swept and re-timed for the new slot |
| booked, then cancelled it themselves | cancellation | the pending drip is swept; "another time" with the calendar |

Cancelling those scheduled sends is a sweep of Resend's own schedule for
anything still pending to that address (`cancelScheduledFor` in `_lib.mjs`).
It needs no state of ours, which is the point: it used to need ids kept in
Upstash, Upstash was never provisioned, and the cancellations were therefore
silently not happening. The window is the last 300 sends, months at this
volume; if sending ever outgrows that, a 72h old nudge could fall off the end
and the cost is one extra nudge, never a lost lead.

The hold is what makes "we only write to the ones who did not book" true.
Booking in the modal usually happens within a minute of the form, so the
welcome is scheduled rather than sent and the booking takes it away again. Any
client that does not claim `booking: "modal"` (the pe page, or a demo page
whose embed was blocked) keeps the immediate send, so a blocked embed costs a
modal and never a lead.

- Functions: `api/enquiry.mjs`, `api/call.mjs`, `api/cal.mjs`,
  `api/webhooks/calcom.mjs`, `api/health.mjs`, shared plumbing in
  `api/_lib.mjs`. Zero dependencies, Web-handler style.
- Env (Vercel → Settings → Environment Variables): `RESEND_API_KEY`,
  `CAL_LINK`, `CALCOM_WEBHOOK_SECRET`, `NOTIFY_TO`, `MAIL_FROM`. The cal.com
  link lives only in the env: changing it is an env edit + redeploy, no code.
  The modal reads it too, through `/api/cal`, so no page hardcodes it.
  `WELCOME_HOLD_MINUTES` (default 15) is how long the held welcome waits.
- Upstash (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) is now
  optional and still unset: it buys the per-IP rate limit and the `fein:log`
  event list, and nothing else. No email depends on it. `/api/health` reports
  which of the two you are running.
- Tests: `node api/test.mjs` — fully offline (fetch patched to fake Resend's
  send, list and cancel, plus Upstash), 61 assertions including webhook
  signature verification, who gets which mail in each of the four journeys,
  the no-Upstash path, and the copy rules (no em dashes, no gush).
- FormSubmit remains the fallback relay if the functions are unreachable;
  abandoned partial leads go ONLY there, deliberately, so they never
  trigger the booking funnel emails.
- Health: https://fein.vc/api/health (`missingConfig` should be `[]`).

## History

- The first funnel iteration ran on the Hostinger VPS behind Caddy
  (api.fein.vc). Superseded by the Vercel functions; the wizard's last stage
  retires it (`systemctl disable --now fein-leads caddy`). GitHub Pages was
  the original site host; the `CNAME` file is gone and DNS now points at
  Vercel, so Pages can be switched off in the repo settings whenever.

## Analytics (done — 2026-08-07)

Vercel Web Analytics is the one counter. Page views, hash routes,
`lead-submitted` and `call-click` events; server-side call clicks also land in
`fein:log`.

GoatCounter (https://fein.goatcounter.com) was retired Aug 2026 and its local
credentials file deleted. The account itself was registered to a
`commixcapital.com` mailbox and must be deleted at goatcounter.com directly.
The `data-goatcounter` strippers in `src/rederive-tpl.js` and `scripts/cms.mjs`
are retained deliberately: they clear stale tags out of old templates.

## Email authentication (done — 2026-08-13)

The first live lead notification went to spam. Resend's own three records
(the MX and SPF on `send`, and `resend._domainkey`) authenticate the sending
*service*; they do not give `fein.vc` itself an SPF or a DMARC record.
Without those, Google Workspace saw `noah@fein.vc → daniel@fein.vc` arriving
from Amazon SES, read it as our own domain being spoofed, and filed it as
spam. The `Reply-To:` pointing at the lead's unrelated domain made it look
more like BEC, not less.

Four records, all in Namecheap Advanced DNS:

| Host | Value | Authenticates |
|---|---|---|
| `@` | `v=spf1 include:_spf.google.com ~all` | Workspace outbound |
| `_dmarc` | `v=DMARC1; p=none; rua=mailto:daniel@fein.vc` | the policy itself |
| `resend._domainkey` | (Resend generates) | the funnel emails |
| `google._domainkey` | (Google Admin generates) | mail sent by hand |

DKIM is what carries the DMARC pass: `resend._domainkey` signs `d=fein.vc`,
which aligns with the `From:` domain. The root SPF is for Workspace, not for
Resend — Resend's envelope domain is `send.fein.vc`, which has its own.

`p=` only governs mail that FAILS, so the fix was going from "no DMARC record
at all" to "a record exists"; `p=none` is enough for that. It stays at `none`
until the `rua` reports show Google and Resend both passing, because
`sales@fein.vc` (a Group would rewrite messages and break the signature) and
anything forwarded out of `daniel@fein.vc` would fail today. Ramp when the
reports are clean: `none` → `quarantine; pct=25` → `quarantine` → `reject`.

Verify by sending a test enquiry and opening ⋮ → Show original on what
arrives. Want `dkim=pass header.i=@fein.vc` and `dmarc=pass (p=NONE)
header.from=fein.vc`.

Two traps, both hit on the way in:

- Namecheap discards an inline row edit unless you click the green ✓ on that
  row, then re-renders the old value, so the page looks like it saved.
  Delete and recreate rather than edit, reload, and read the value back.
- A malformed record is worse than a missing one: RFC 7489 says a receiver
  MUST treat a syntax error as if no record were present. `aspf=r p=none` (a
  dropped semicolon) parses as `aspf` with the value `r p=none` and voids the
  whole record while still looking plausible in the panel. Stage 5 of the
  wizard checks for exactly this, against the authoritative nameservers
  rather than a cache.

## Remaining nice-to-haves (not blocking)

- `sales@fein.vc` is advertised in the footer, JSON-LD, the contact-modal
  confirmation, and the mailto fallback — confirm the mailbox exists in
  Google Workspace.
- After FormSubmit activation, swap the base64 address in `index.html` for
  the random alias FormSubmit issues.
