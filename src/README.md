# fein.vc source

The deployed `index.html` is generated — do not edit it by hand.

- `fein.tpl.html` — page body + styles + scripts, with `__GEIST_*_B64__` font and `__LOGO_SPRITE__` placeholders
- `build.js` — inlines fonts/logos, emits `../index.html` plus robots/sitemap/llms/favicon/manifest (run `node build.js` from this directory with the output dir set to `..`)
- `logos/` — brand marks inlined into the SVG sprite

Built from the fundgraph/fein project. Design: Vercel-black system (Geist, #000 ground, monochrome + one quiet blue accent), Aug 2026.

> **Note (2026-08-06):** several sessions committed straight to `../index.html`,
> leaving this template stale. It has been re-derived from the shipped page with
> `rederive-tpl.js` (reverses the font/sprite inlining) and `build.js` now
> reproduces `../index.html` exactly. If you edit `index.html` directly again,
> re-run `node rederive-tpl.js` here afterwards to keep the template canonical.
