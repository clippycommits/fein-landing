# fein.vc

A single page on Vercel. Push to `main` deploys (Vercel Git integration; if a push deploys nothing, `vercel deploy --prod --yes`).

The page is one Claude Code session, replayed and then live: `index.html` is
the static transcript (what a crawler or a no-JavaScript visitor gets),
`site.js` replays it and then runs the prompt, `site.css` is the look. No
build step: edit them directly.

- The prompt takes `1` (book a call), `2` (information pack) and `3` (ask a
  question). Booking reads Daniel's open times from cal.com (`api/slots.mjs`)
  and books the pick straight in (`api/book.mjs`); the cal.com webhook then
  sends the confirmation and the pre-call drip as before. If the calendar
  cannot be read, the same answers go to `api/enquiry.mjs` and the booking
  link arrives by email (see `LAUNCH.md`).
- Spam: every endpoint has a honeypot, a floor on how fast a person could
  have answered, a same-site origin check and per-IP caps on Upstash; bookings
  additionally only accept a start time `/api/slots` signed in the last half
  hour. `node api/test.mjs` runs the whole funnel offline (87 assertions).
- Env for booking, on top of the funnel's (`LAUNCH.md`): `CALCOM_API_KEY`,
  `CALCOM_EVENT_TYPE_ID`, `SLOT_SECRET`.
- Fonts: Apple devices render SF Mono through `ui-monospace`; everyone else
  gets the self-hosted Geist Mono in `fonts/` (OFL).
- `terms.html` is `/terms` (`cleanUrls` in `vercel.json`). `404.html`,
  `robots.txt`, `sitemap.xml` and `vercel.json` are hand-maintained; every
  retired path 301s to `/`.
- Brand: `logo.svg`, `logo.png` (the email-signature URL is https://fein.vc/logo.png), `logo-128.png` and the favicons.
  `node scripts/icons.mjs` regenerates the rasters from `src/logo.png` / `src/logo.svg`; `scripts/logo-svg.py` regenerates `src/logo.svg`.

The previous single-page site (white, prose) is in git history before the
terminal landed; the retired product site (the "memory layer" homepage, its
sub-pages and the `src/` build pipeline) is at `3daf2ff`.
