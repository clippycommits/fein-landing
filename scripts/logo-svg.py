#!/usr/bin/env python3
"""Regenerate src/logo.svg, the font-free vector of the fein tile.

The master is src/logo.png (1080x1080, #EF0000 tile, white "fein"). The
wordmark in it is Inter Regular, so this script sets "fein" from the Inter
face already in src/, converts the glyphs to a single path, and scales it to
the exact box the white pixels occupy in the master (x 272-762, y 440-668).
No <text>, no font: the SVG renders the same in a tab, in qlmanage and in an
email client. build.js reads the result for favicon.svg, the nav mark and
og.svg; scripts/icons.mjs rasterises it for favicon.ico and the maskable icon.

    uv run --with fonttools --with brotli python scripts/logo-svg.py
"""
import os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.recordingPen import RecordingPen

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src")
TEXT = "fein"
TILE = 1080
RED = "#EF0000"
BOX = (272, 440, 762, 668)  # white bbox in the master, measured with Pillow

f = instantiateVariableFont(TTFont(os.path.join(SRC, "Inter.woff2")), {"wght": 400})
cmap, gs, hmtx = f.getBestCmap(), f.getGlyphSet(), f["hmtx"]

# pair kerning from GPOS (format 1 and 2 pair-adjustment subtables)
kern = {}
for lk in f["GPOS"].table.LookupList.Lookup:
    for st in lk.SubTable:
        if st.LookupType == 9: st = st.ExtSubTable
        if st.LookupType != 2: continue
        cov = st.Coverage.glyphs
        if st.Format == 1:
            for g1, ps in zip(cov, st.PairSet):
                for r in ps.PairValueRecord:
                    kern.setdefault((g1, r.SecondGlyph), getattr(r.Value1, "XAdvance", 0) or 0)
        elif st.Format == 2:
            c1, c2 = st.ClassDef1.classDefs, st.ClassDef2.classDefs
            for g1 in cov:
                for g2, k2 in c2.items():
                    v = getattr(st.Class1Record[c1.get(g1, 0)].Class2Record[k2].Value1, "XAdvance", 0) or 0
                    if v: kern.setdefault((g1, g2), v)

names = [cmap[ord(c)] for c in TEXT]
rec, bp, x = RecordingPen(), BoundsPen(gs), 0
for i, n in enumerate(names):
    for p in (rec, bp): gs[n].draw(TransformPen(p, (1, 0, 0, -1, x, 0)))
    x += hmtx[n][0] + (kern.get((n, names[i + 1]), 0) if i + 1 < len(names) else 0)
bx0, by0, bx1, by1 = bp.bounds
s = (BOX[2] - BOX[0]) / (bx1 - bx0)
tx, ty = BOX[0] - bx0 * s, BOX[1] - by0 * s
pen = SVGPathPen(gs, ntos=lambda v: ("%.1f" % v).rstrip("0").rstrip("."))
rec.replay(TransformPen(pen, (s, 0, 0, s, tx, ty)))
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {TILE} {TILE}">\n'
       f'<rect width="{TILE}" height="{TILE}" fill="{RED}"/>\n'
       f'<path fill="#fff" d="{pen.getCommands()}"/>\n</svg>\n')
out = os.path.join(SRC, "logo.svg")
open(out, "w").write(svg)
print("wrote", os.path.relpath(out), len(svg), "bytes; wordmark height", round((by1 - by0) * s), "px of target", BOX[3] - BOX[1])
