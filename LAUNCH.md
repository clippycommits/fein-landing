# Launch checklist — fein.vc

## The one command

```bash
bash scripts/funnel-wizard.sh
```

The wizard walks every remaining human step in order: Namecheap DNS (site +
api subdomain), Resend domain + API key, cal.com event type + webhook, pushes
the config to the VPS, enforces Pages HTTPS, activates the FormSubmit
fallback, and smoke-tests the funnel end to end. Re-runnable; it remembers
values already captured (in `~/.config/fein/funnel.env`).

## The booking funnel (live once the wizard finishes)

```
contact-sales wizard on fein.vc
   └─ POST https://api.fein.vc/enquiry     (lead service on the Hostinger VPS)
        ├─ notification → team@commixcapital.com   (Reply-To: the lead)
        ├─ welcome email → lead, "Pick a time" → cal.com (prefilled)
        ├─ nudge email scheduled +72h (Resend scheduled send)
        └─ success screen shows "Pick a time" too (api.fein.vc/call redirect)
cal.com BOOKING_CREATED webhook → api.fein.vc/webhooks/calcom
        ├─ cancels the scheduled nudge
        └─ "fein call booked" notification → team@commixcapital.com
```

- Service: `/opt/fein-leads` on root@167.88.38.87 (systemd unit `fein-leads`,
  Caddy terminates TLS for api.fein.vc). Logs: `journalctl -u fein-leads`.
- Leads are an append-only event log: `/opt/fein-leads/leads.jsonl`
  (enquiries, sends, bookings, call clicks).
- The cal.com link lives only in the VPS `.env` (`CAL_LINK`) — emails and the
  site both go through `api.fein.vc/call`, so changing the link is an `.env`
  edit + `systemctl restart fein-leads`, no site rebuild.
- Code + tests: `server/leads.js`, `server/test.js` (`node server/test.js`,
  fully offline against a stub Resend).
- FormSubmit remains as the fallback relay if the lead service is down
  (partial/abandoned leads also go there, deliberately: they must not
  trigger the booking funnel emails).

## Analytics (done — 2026-08-07)

GoatCounter: https://fein.goatcounter.com (credentials in
`~/.config/fein/goatcounter.txt`). Page views, hash routes, `lead-submitted`
and `call-click` events. Server-side, `call-click` events are also in
leads.jsonl.

## Remaining nice-to-haves (not blocking)

- `hello@fein.vc` is advertised in the footer, JSON-LD, and the mailto
  fallback — confirm the mailbox exists in Google Workspace.
- After FormSubmit activation, swap the base64 address in `index.html` for
  the random alias FormSubmit issues.
