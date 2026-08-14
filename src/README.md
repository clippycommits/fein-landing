# fein.vc source

The deployed `index.html` is generated: do not edit it by hand.

- `fein.tpl.html`: page body + styles + scripts, with `__GEIST_*_B64__` / `__INTER_B64__` font, `__AV_*__` avatar, and `__LOGO_SPRITE__` placeholders
- `build.js`: inlines fonts/logos, emits `../index.html` plus the sub-pages and robots/sitemap/llms/favicon/manifest (run `node build.js` from this directory with the output dir set to `..`)
- `404.html`: the not-found page; the root `404.html` is built from it (fonts inlined, chat launcher patched in), so edit it here, never at the root
- `logos/`: brand marks inlined into the SVG sprite

Built from the fundgraph/fein project. Design: Vercel-black system (Geist, #000
ground, monochrome + one quiet blue accent), Aug 2026. The acid-chartreuse
`.pick` panel is the one deliberate exception to that palette: a merchandising
accent on the managed-setup card, used consistently across the pages that sell
the plans.

**Type:** Inter sets the interface and body copy, Geist the display headings
(h1 and h2), and Geist Mono the readouts inside the product mockups. Section
labels are small lowercase grey Inter, letter-spacing 0. The Newsreader italic
label voice is retired: its build guard (`assertSerifCharsetCovers`) and class
list (`SERIF_CLASSES`) no longer exist in `build.js`, and the face files stay
on disk (`Newsreader.subset.woff2`, `fonts.serif.charset.txt`) in case that
voice comes back. Geist, Geist Mono, and Inter are OFL and used unmodified
apart from subsetting.

**Editing copy:** run `node scripts/cms.mjs` from the repo root: it serves the
built page at `http://127.0.0.1:4870/` with click-to-edit copy. Publish applies
the edits to `fein.tpl.html`, reruns `build.js`, and commits the pipeline files
(add `--push` to also push). Copy rules (no em dashes) are
enforced at publish.

> **Note (2026-08-06):** several sessions committed straight to `../index.html`,
> leaving this template stale. It has been re-derived from the shipped page with
> `rederive-tpl.js`, and `build.js` now reproduces `../index.html` exactly. If
> you edit `index.html` directly again, re-run `node rederive-tpl.js` here
> afterwards to keep the template canonical. The script reverses the current
> build (subset fonts, both sprite halves, avatars, analytics, chat launcher);
> head metadata and JSON-LD are build-owned, so a hand edit there belongs in
> `build.js` instead.
