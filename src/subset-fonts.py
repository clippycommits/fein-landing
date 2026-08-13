#!/usr/bin/env python3
"""Regenerate the subset webfonts that build.js inlines.

The shipped faces carry a 100-900 weight axis and the full Latin set. This site
renders 128 codepoints, and the @font-face descriptors already clamp weight to
400-600 / 400-500 / 400-600 -- so pinning the axis to those ranges is lossless:
the descriptor was already the contract, and a browser asking for 650 was being
clamped to 600 before the bytes ever mattered.

fonts.charset.txt is the single source of truth for the character set, and
build.js re-reads it to assert every codepoint on the built page is covered. Add
a character the subset lacks and THE BUILD FAILS, rather than the page quietly
shipping tofu.

Newsreader is the exception, and it is cut against its own, much smaller
charset. It sets the section labels and nothing else: eight short lowercase
phrases, no capitals (the CSS lowercases them), no arrows, no ticks. Cutting it
to the whole 128 costs 15 KB for glyphs no label will ever reach, and 6 KB is
the price of the same face at the size it is actually used. The guard that keeps
that honest is assertSerifCharsetCovers in build.js: it reads the label text out
of the built page and fails if a character strays outside
fonts.serif.charset.txt. Widen the label vocabulary and the build tells you to
widen the file.

Run after editing either charset or replacing a woff2:
    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python subset-fonts.py
"""
import io, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.subset import Subsetter, Options

# source, output, axis pins, charset file. A tuple pins a range (the face keeps
# the axis and the browser interpolates inside it); a number pins one instance.
FACES = [
    ("GeistSans.woff2", "GeistSans.subset.woff2", {"wght": (400, 600)}, "fonts.charset.txt"),
    ("GeistMono.woff2", "GeistMono.subset.woff2", {"wght": (400, 500)}, "fonts.charset.txt"),
    ("Inter.woff2",     "Inter.subset.woff2",     {"wght": (400, 600)}, "fonts.charset.txt"),
    # one instance, not a range: the labels are set at one size in one weight,
    # so the optical size that suits it (18, the face's own default, drawn for
    # text rather than for a headline) is baked in and both axes go away.
    ("Newsreader.woff2", "Newsreader.subset.woff2", {"wght": 400, "opsz": 18}, "fonts.serif.charset.txt"),
]

here = os.path.dirname(os.path.abspath(__file__))
charsets = {}
for name in {f[3] for f in FACES}:
    charsets[name] = open(os.path.join(here, name), encoding="utf8").read().rstrip("\n")
    print(f"{name}: {len(charsets[name])} codepoints")

total_before = total_after = 0
for src, dst, axes, csname in FACES:
    chars = charsets[csname]
    sp, dp = os.path.join(here, src), os.path.join(here, dst)
    font = TTFont(sp, lazy=False)
    if "fvar" in font:                       # variable -> clip or pin the axes
        font = instancer.instantiateVariableFont(font, axes, inplace=True)
        # round-trip so the clipped gvar is materialised as a plain dict; the
        # subsetter walks it eagerly and trips over instancer's lazy proxy
        buf = io.BytesIO()
        font.save(buf); buf.seek(0)
        font = TTFont(buf, lazy=False)
    # every codepoint the charset asks for that this face has no glyph for. The
    # three text faces have to cover their charset; a gap here is tofu waiting
    # to happen, so it is printed rather than swallowed.
    cmap = set().union(*[set(t.cmap) for t in font["cmap"].tables])
    gaps = [c for c in chars if ord(c) not in cmap]
    opts = Options()
    opts.layout_features = ["kern", "liga", "calt", "tnum", "ccmp", "locl", "mark", "mkmk"]
    opts.hinting = False
    opts.desubroutinize = True
    opts.drop_tables += ["DSIG"]
    s = Subsetter(options=opts)
    s.populate(text=chars)
    s.subset(font)
    font.flavor = "woff2"
    font.save(dp)
    b, a = os.path.getsize(sp), os.path.getsize(dp)
    total_before += b; total_after += a
    pins = " ".join(f"{k} {v[0]}-{v[1]}" if isinstance(v, tuple) else f"{k} {v}" for k, v in axes.items())
    print(f"  {dst:26} {b:7,} -> {a:7,}  ({100*(a-b)/b:+.1f}%)  {pins}")
    if gaps:
        print(f"  {'':26} !! not in this face: {''.join(gaps)}")
print(f"  {'TOTAL':26} {total_before:7,} -> {total_after:7,}  ({total_after-total_before:+,} bytes)")
