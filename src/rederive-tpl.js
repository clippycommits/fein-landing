// Re-derive fein.tpl.html from the built ../index.html, for the sessions that
// edit the built page directly and leave the template stale. It is the inverse
// of build.js's home-page assembly, and it has to stay in step with build.js:
// the removals simulated below mirror HOME_CUT and the change-replay strip
// exactly, so if those change there, change them here in the same commit.
//
// What is recovered from index.html: the <style> block and the whole shipped
// body, with the subset fonts, the four inlined avatars and the hero sprite
// reversed to their placeholders, the end-of-body sprite dropped (build.js
// derives both halves from the LOGOS map), and the analytics and chat-launcher
// appends stripped. Left in, every rederive+build cycle would stack another
// copy of those appends, and the chat block would leak into the artifact
// build, which must not carry it.
//
// What is NOT recovered, because the home page does not ship it: the HOME_CUT
// sections and the #change replay script, which render on /integrations and
// /security instead. Nobody can have hand-edited them on a page they are not
// on, so the template already on disk is still their source of truth, and this
// script splices them back in at the exact seams the build's removals left.
// Head metadata and JSON-LD are build.js-owned (regenerated every build); a
// hand edit there belongs in build.js, not here.
//
// After running this, `node build.js` must reproduce ../index.html byte for
// byte. Treat any diff as a bug in this script, not in build.js.
const fs = require("fs");

const b64 = f => fs.readFileSync(f).toString("base64");
const idx = fs.readFileSync("../index.html", "utf8");
const tplOld = fs.readFileSync("fein.tpl.html", "utf8");

// ---- 1. style + body out of the built document ----
// The first <style> is the shared sheet build.js hoists into <head>; the chat
// launcher carries a second one, stripped with its block below.
const s0 = idx.indexOf("<style>");
if (s0 < 0) throw new Error("index.html: no style block");
const styleBlock = idx.slice(s0, idx.indexOf("</style>") + "</style>".length);
let body = idx.slice(idx.indexOf("<body>") + "<body>".length, idx.lastIndexOf("</body>"));

// ---- 2. strip what build.js appends after the page markup ----
// the Intercom launcher + messenger, wrapped in <!--fein-chat--> delimiters
body = body.replace(/\s*<!--fein-chat:start-->[\s\S]*?<!--fein-chat:end-->/g, "");
// the "Get a demo" modal, wrapped in <!--fein-demo--> delimiters (src/demo-modal.html)
body = body.replace(/\s*<!--fein-demo:start-->[\s\S]*?<!--fein-demo:end-->/g, "");
// the GoatCounter pair (loader + hashchange counter)
body = body.replace(/\s*<script data-goatcounter[\s\S]*?<\/script>\s*<script>[^<]*goatcounter[\s\S]*?<\/script>/g, "");
// the Vercel insights stub and its two first-party loaders
body = body.replace(/\s*<script>window\.va=window\.va[\s\S]*?<\/script>\s*<script defer src="\/_vercel\/insights\/script\.js"><\/script>\s*<script defer src="\/_vercel\/speed-insights\/script\.js"><\/script>/g, "");
// PostHog, only present when a key is set in build.js
body = body.replace(/\s*<script>!function\(t,e\)\{var o,n,p,r;e\.__SV[\s\S]*?<\/script>/g, "");

// ---- 3. the two sprite halves ----
// End-of-body half first: build.js appends it after the markup, the template
// never carries it. Everything after it must now be whitespace; anything else
// is an append this script does not know how to strip, so stop rather than
// silently bake it into the template.
const rp0 = body.lastIndexOf('<svg width="0" height="0"');
if (rp0 < 0) throw new Error("index.html: no sprite found");
const rp1 = body.indexOf("</svg>", rp0) + "</svg>".length;
const restSprite = body.slice(rp0, rp1);
if (!/symbol id="l-/.test(restSprite) || /<section/.test(restSprite)) throw new Error("end-of-body sprite boundary wrong");
const tail = body.slice(rp1);
if (tail.trim() !== "") throw new Error("unrecognised markup after the end-of-body sprite (a build.js append this script does not strip?): " + JSON.stringify(tail.trim().slice(0, 80)));
if (body[rp0 - 1] !== "\n") throw new Error("unexpected seam before the end-of-body sprite");
body = body.slice(0, rp0 - 1);

// Hero half: stands exactly where __LOGO_SPRITE__ was.
const sp0 = body.indexOf('<svg width="0" height="0"');
if (sp0 < 0) throw new Error("index.html: hero sprite not found");
const sp1 = body.indexOf("</svg>", sp0) + "</svg>".length;
if (!/symbol id="l-github"/.test(body.slice(sp0, sp1))) throw new Error("hero sprite boundary wrong (no l-github symbol)");
body = body.slice(0, sp0) + "__LOGO_SPRITE__" + body.slice(sp1);

// build.js emits `<body>\n` before the template body; drop that one newline so
// the seam does not grow a blank line per rederive+build cycle
if (body[0] !== "\n") throw new Error("unexpected seam after <body>");
let tpl = styleBlock + body.slice(1);

// ---- 4. subset fonts back to placeholders ----
// build.js inlines the *.subset.woff2 cuts, not the full faces; if a base64 is
// missing here, subset-fonts.py probably reran since the page was last built.
[["GeistSans.subset.woff2", "__GEIST_SANS_B64__"],
 ["GeistMono.subset.woff2", "__GEIST_MONO_B64__"],
 ["Inter.subset.woff2", "__INTER_B64__"]].forEach(function ([file, ph]) {
  const b = b64(file);
  if (!tpl.includes(b)) throw new Error(ph + ": base64 of " + file + " not found in index.html (fonts re-subset since the last build?)");
  tpl = tpl.split(b).join(ph);
});

// ---- 5. avatars back to placeholders ----
// Mirror of build.js's AVATARS map. Anna posts twice, hence split/join.
const AVATARS = { AV_DR: "avatars/dev-raman.webp", AV_MF: "avatars/marcus-feld.webp", AV_AL: "avatars/anna-lindqvist.webp", AV_DH: "avatars/daniel.webp" };
for (const [token, file] of Object.entries(AVATARS)) {
  const b = b64(file);
  if (!tpl.includes(b)) throw new Error("__" + token + "__: base64 of " + file + " not found in index.html");
  tpl = tpl.split(b).join("__" + token + "__");
}

// ---- 6. splice back what the home page deliberately does not ship ----
// Replay build.js's removals against the old template, recording the text each
// one took and the 48-char seam it left, then undo them on the derived body,
// last removal first (the sections sit consecutively, so an earlier removal's
// seam only exists again once the later ones are back). A `have` probe skips
// blocks the built page still carries, so the script also works on a page
// built before a block joined the strip list.
const C = 48;
const CUTS = []; // { removed, prefix, suffix, have } in build.js removal order
let sim = tplOld.slice(tplOld.indexOf("</style>") + "</style>".length);
function record(m, have) {
  CUTS.push({ removed: m[0], prefix: sim.slice(Math.max(0, m.index - C), m.index), suffix: sim.slice(m.index + m[0].length, m.index + m[0].length + C), have: have });
  sim = sim.slice(0, m.index) + sim.slice(m.index + m[0].length);
}
["change", "proof", "why", "crm", "how"].forEach(function (id) { // = build.js HOME_CUT
  const m = sim.match(new RegExp('\\n?<section id="' + id + '"[\\s\\S]*?</section>'));
  if (!m) throw new Error("template: section to cut not found: #" + id);
  record(m, '<section id="' + id + '"');
});
const mr = sim.match(/\n?\/\*change-replay:start\*\/[\s\S]*?\/\*change-replay:end\*\//);
if (!mr) throw new Error("template: change-replay markers not found");
record(mr, "/*change-replay:start*/");

for (let k = CUTS.length - 1; k >= 0; k--) {
  const cut = CUTS[k];
  if (tpl.includes(cut.have)) continue; // page still ships it, nothing to splice
  const seam = cut.prefix + cut.suffix;
  const i = tpl.indexOf(seam);
  if (i < 0) throw new Error("cannot find the seam to restore a cut block; the built page was edited within " + C + " chars of it: " + JSON.stringify(cut.prefix.slice(-24) + "|" + cut.suffix.slice(0, 24)));
  if (tpl.indexOf(seam, i + 1) > -1) throw new Error("cut-block seam is not unique: " + JSON.stringify(cut.prefix.slice(-24) + "|" + cut.suffix.slice(0, 24)));
  tpl = tpl.slice(0, i + cut.prefix.length) + cut.removed + tpl.slice(i + cut.prefix.length);
}

// ---- 7. guards, then write ----
["__LOGO_SPRITE__", "__GEIST_SANS_B64__", "__GEIST_MONO_B64__", "__INTER_B64__", "__AV_DR__", "__AV_MF__", "__AV_AL__", "__AV_DH__", "/*change-replay:start*/", "<!--fein-nav:html:start-->", "/*fein-nav:css:start*/"].forEach(function (need) {
  if (!tpl.includes(need)) throw new Error("re-derived template is missing " + need);
});
if (/intercomSettings|data-goatcounter|_vercel/.test(tpl)) throw new Error("an analytics or chat append survived into the template");

fs.writeFileSync("fein.tpl.html", tpl);
console.log("re-derived fein.tpl.html:", Math.round(tpl.length / 1024), "KB; now run `node build.js` and check `git diff ../index.html` is empty");
