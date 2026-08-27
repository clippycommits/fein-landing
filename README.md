# fein.vc

A single page on Vercel. Push to `main` deploys (Vercel Git integration; if a push deploys nothing, `vercel deploy --prod --yes`).

- `index.html` is the whole site. It is hand-written: edit it directly. There is no build step.
- `api/` holds the Vercel functions behind the form on the page (see `LAUNCH.md`).
- `404.html`, `robots.txt`, `sitemap.xml` and `vercel.json` are hand-maintained. Every retired path 301s to `/` in `vercel.json`.
- Brand: `logo.svg`, `logo.png` (the email-signature URL is https://fein.vc/logo.png), `logo-128.png` and the favicons.
  `node scripts/icons.mjs` regenerates the rasters from `src/logo.png` / `src/logo.svg`; `scripts/logo-svg.py` regenerates `src/logo.svg`.

The retired product site (the "memory layer" homepage, its sub-pages and the `src/` build pipeline) is in git history; the last commit that carried it is `3daf2ff`.
