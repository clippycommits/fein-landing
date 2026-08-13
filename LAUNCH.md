# Launch checklist — fein.vc

Everything runs on Vercel: one project serves the static site and the
`/api/*` lead functions on the same domain. Push to main = deploy.

## The one command

```bash
bash scripts/funnel-wizard.sh
```

Ten stages, ~45 minutes, re-runnable (state in `~/.config/fein/funnel.env`):
import the repo into Vercel, point fein.vc at it, Upstash Redis, Resend
domain + key, cal.com event + webhook, Vercel env vars, FormSubmit fallback
activation, end-to-end smoke test, and retiring the old VPS service.

## The booking funnel

```
/demo form ("Find a time")
   ├─ GET /api/cal on first keystroke      (CAL_LINK, split for the embed)
   └─ POST /api/enquiry                    (Vercel function, same origin)
        ├─ notification → daniel@fein.vc   (Reply-To: the lead)
        ├─ welcome email → lead, "Pick a time" → cal.com (prefilled)
        │    HELD +15m when the page says `booking: "modal"`, id in Upstash
        ├─ nudge scheduled +72h (Resend scheduled send; id in Upstash)
        └─ cal.com modal opens over the page, name/email/notes prefilled
cal.com BOOKING_CREATED webhook → /api/webhooks/calcom (HMAC-verified)
        ├─ cancels the held welcome AND the nudge (ids in Upstash)
        └─ "fein call booked" notification → daniel@fein.vc
```

The hold is what makes "we only chase the ones who did not book" true. Booking
in the modal usually happens within a minute of the form, so the welcome is
scheduled rather than sent and the webhook takes it away again: a lead who
books hears from cal.com and from nobody else. A lead who closes the modal gets
it at +15m and the nudge at +72h, as before. Any client that does not claim
`booking: "modal"` (the pe page, or a demo page whose embed was blocked) keeps
the immediate send, so a blocked embed costs a modal and never a lead.

- Functions: `api/enquiry.mjs`, `api/call.mjs`, `api/cal.mjs`,
  `api/webhooks/calcom.mjs`, `api/health.mjs`, shared plumbing in
  `api/_lib.mjs`. Zero dependencies, Web-handler style.
- Env (Vercel → Settings → Environment Variables): `RESEND_API_KEY`,
  `CAL_LINK`, `CALCOM_WEBHOOK_SECRET`, `NOTIFY_TO`, `MAIL_FROM`,
  `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. The cal.com link
  lives only in the env: changing it is an env edit + redeploy, no code.
  The modal reads it too, through `/api/cal`, so no page hardcodes it.
  `WELCOME_HOLD_MINUTES` (default 15) is how long the held welcome waits.
- Event log: Redis list `fein:log` (enquiries, sends, bookings, call
  clicks), best effort — the email notifications are the primary record.
- Tests: `node api/test.mjs` — fully offline (fetch patched to fake Resend +
  Upstash), 41 assertions including webhook signature verification, both
  scheduled-send cancellations, and the copy rules (no em dashes).
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

GoatCounter: https://fein.goatcounter.com (credentials in
`~/.config/fein/goatcounter.txt`). Page views, hash routes, `lead-submitted`
and `call-click` events; server-side call clicks also land in `fein:log`.

## Remaining nice-to-haves (not blocking)

- `sales@fein.vc` is advertised in the footer, JSON-LD, the contact-modal
  confirmation, and the mailto fallback — confirm the mailbox exists in
  Google Workspace.
- After FormSubmit activation, swap the base64 address in `index.html` for
  the random alias FormSubmit issues.
