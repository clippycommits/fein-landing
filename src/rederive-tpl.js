// One-shot: re-derive fein.tpl.html from ../index.html after sessions that
// edited the built file directly. Reverses build.js's inlining (fonts, sprite).
const fs = require("fs");

const idx = fs.readFileSync("../index.html", "utf8");
const sans = fs.readFileSync("GeistSans.woff2").toString("base64");
const mono = fs.readFileSync("GeistMono.woff2").toString("base64");
const inter = fs.readFileSync("Inter.woff2").toString("base64");

const s0 = idx.indexOf("<style>");
const s1 = idx.indexOf("</style>") + "</style>".length;
if (s0 < 0) throw new Error("no style block");
const style = idx.slice(s0, s1);

const b0 = idx.indexOf("<body>") + "<body>".length;
const b1 = idx.lastIndexOf("</body>");
let body = idx.slice(b0, b1);

// build.js appends GoatCounter to the standalone site; if it stays in the
// template, every rederive+build cycle stacks another copy and it leaks into
// the artifact build (which must not carry it).
body = body.replace(/\s*<script data-goatcounter[\s\S]*?<\/script>\s*<script>[^<]*goatcounter[\s\S]*?<\/script>/g, "");
// same for the Intercom pair (settings + widget loader), also build.js-appended
body = body.replace(/\s*<script>window\.intercomSettings[\s\S]*?<\/script>\s*<script>[\s\S]*?widget\.intercom\.io[\s\S]*?<\/script>/g, "");
body = body.trimEnd() + "\n";
// build.js emits a newline after <body>; pin the seam or each cycle grows a blank line
body = body.replace(/^\s+/, "\n\n\n");

const sp0 = body.indexOf('<svg width="0" height="0"');
if (sp0 < 0) throw new Error("no sprite");
const sp1 = body.indexOf("</svg>", sp0) + "</svg>".length;
const sprite = body.slice(sp0, sp1);
if (!/symbol id="l-gmail"/.test(sprite)) throw new Error("sprite boundary wrong");
body = body.slice(0, sp0) + "__LOGO_SPRITE__" + body.slice(sp1);

let tpl = style + body;
if (!tpl.includes(sans) || !tpl.includes(mono) || !tpl.includes(inter)) throw new Error("font b64 not found");
tpl = tpl.replace(sans, "__GEIST_SANS_B64__").replace(mono, "__GEIST_MONO_B64__").replace(inter, "__INTER_B64__");

fs.writeFileSync("fein.tpl.html", tpl);
console.log("re-derived fein.tpl.html:", Math.round(tpl.length / 1024), "KB");
