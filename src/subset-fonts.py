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

Run after editing fonts.charset.txt or replacing a woff2:
    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python subset-fonts.py
"""
import io, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.subset import Subsetter, Options

FACES = [                                   # source, output, weight range
    ("GeistSans.woff2", "GeistSans.subset.woff2", (400, 600)),
    ("GeistMono.woff2", "GeistMono.subset.woff2", (400, 500)),
    ("Inter.woff2",     "Inter.subset.woff2",     (400, 600)),
]

here = os.path.dirname(os.path.abspath(__file__))
chars = open(os.path.join(here, "fonts.charset.txt"), encoding="utf8").read().rstrip("\n")
print(f"charset: {len(chars)} codepoints")

total_before = total_after = 0
for src, dst, (lo, hi) in FACES:
    sp, dp = os.path.join(here, src), os.path.join(here, dst)
    font = TTFont(sp, lazy=False)
    if "fvar" in font:                       # variable -> clip the weight axis
        font = instancer.instantiateVariableFont(font, {"wght": (lo, hi)}, inplace=True)
        # round-trip so the clipped gvar is materialised as a plain dict; the
        # subsetter walks it eagerly and trips over instancer's lazy proxy
        buf = io.BytesIO()
        font.save(buf); buf.seek(0)
        font = TTFont(buf, lazy=False)
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
    print(f"  {dst:26} {b:7,} -> {a:7,}  ({100*(a-b)/b:+.1f}%)  wght {lo}-{hi}")
print(f"  {'TOTAL':26} {total_before:7,} -> {total_after:7,}  ({total_after-total_before:+,} bytes)")
