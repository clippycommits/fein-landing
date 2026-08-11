# fein.vc source

The deployed `index.html` is generated — do not edit it by hand.

- `fein.tpl.html` — page body + styles + scripts, with `__GEIST_*_B64__` / `__INTER_B64__` / `__NEWSREADER_B64__` font and `__LOGO_SPRITE__` placeholders
- `build.js` — inlines fonts/logos, emits `../index.html` plus robots/sitemap/llms/favicon/manifest (run `node build.js` from this directory with the output dir set to `..`)
- `logos/` — brand marks inlined into the SVG sprite

Built from the fundgraph/fein project. Design: Vercel-black system (Geist, #000 ground, monochrome + one quiet blue accent), Aug 2026.

**Type:** Inter sets the interface, Geist the display headings, Geist Mono the
readouts inside the product pictures, and Newsreader italic the section labels
— lowercase, at reading size, in place of the tracked-out mono caps every dark
product page opens a section with. The serif is used nowhere else, so it is cut
against its own charset (`fonts.serif.charset.txt`, 52 codepoints, 6 KB) rather
than the page's 128; `assertSerifCharsetCovers` in `build.js` fails the build if
a label reaches for a glyph outside it. The classes in that voice are listed as
`SERIF_CLASSES` there: `.eyebrow`, `.wstep`, `.dlab`, `.works .lab`. All four
faces are OFL (Geist, Inter, Newsreader) and used unmodified apart from
subsetting.

**Editing copy:** run `node scripts/cms.mjs` from the repo root — it serves the
built page at `http://127.0.0.1:4870/` with click-to-edit copy. Publish applies
the edits to `fein.tpl.html`, reruns `build.js`, and commits the pipeline files
(add `--push` to also push). Copy rules (no em dashes) are
enforced at publish.

> **Note (2026-08-06):** several sessions committed straight to `../index.html`,
> leaving this template stale. It has been re-derived from the shipped page with
> `rederive-tpl.js` (reverses the font/sprite inlining) and `build.js` now
> reproduces `../index.html` exactly. If you edit `index.html` directly again,
> re-run `node rederive-tpl.js` here afterwards to keep the template canonical.
