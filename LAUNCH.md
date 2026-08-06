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
contact-sales wizard on fein.vc
   └─ POST /api/enquiry                    (Vercel function, same origin)
        ├─ notification → team@commixcapital.com   (Reply-To: the lead)
        ├─ welcome email → lead, "Pick a time" → cal.com (prefilled)
        ├─ nudge scheduled +72h (Resend scheduled send; id in Upstash)
        └─ success screen shows "Pick a time" too (/api/call redirect)
cal.com BOOKING_CREATED webhook → /api/webhooks/calcom (HMAC-verified)
        ├─ cancels the scheduled nudge (id looked up in Upstash)
        └─ "fein call booked" notification → team@commixcapital.com
```

- Functions: `api/enquiry.mjs`, `api/call.mjs`, `api/webhooks/calcom.mjs`,
  `api/health.mjs`, shared plumbing in `api/_lib.mjs`. Zero dependencies,
  Web-handler style.
- Env (Vercel → Settings → Environment Variables): `RESEND_API_KEY`,
  `CAL_LINK`, `CALCOM_WEBHOOK_SECRET`, `NOTIFY_TO`, `MAIL_FROM`,
  `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. The cal.com link
  lives only in the env: changing it is an env edit + redeploy, no code.
- Event log: Redis list `fein:log` (enquiries, sends, bookings, call
  clicks), best effort — the email notifications are the primary record.
- Tests: `node api/test.mjs` — fully offline (fetch patched to fake Resend +
  Upstash), 22 assertions including webhook signature verification, nudge
  cancellation, and the copy rules (no em dashes, never "fund").
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

- `hello@fein.vc` is advertised in the footer, JSON-LD, and the mailto
  fallback — confirm the mailbox exists in Google Workspace.
- After FormSubmit activation, swap the base64 address in `index.html` for
  the random alias FormSubmit issues.
