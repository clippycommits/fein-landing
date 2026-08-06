const fs = require("fs");
const path = require("path");

const SITE = "https://fein.vc";
const TITLE = "fein — the fund graph for venture capital";
const DESC = "fein is the relationship layer for AI to act on your fund. It turns your inbox, calendar, and CRM into one graph Claude and ChatGPT can query — the warmest intro, meeting prep, or why you passed — grounded in your own data. Live in 14 days, self-hosted.";
const LASTMOD = "2026-08-06";

const sansB64 = fs.readFileSync("GeistSans.woff2").toString("base64");
const monoB64 = fs.readFileSync("GeistMono.woff2").toString("base64");

// ---- inject fonts into shared body ----
let body = fs.readFileSync("fein.tpl.html", "utf8")
  .replace("__GEIST_SANS_B64__", sansB64)
  .replace("__GEIST_MONO_B64__", monoB64);
if (body.indexOf("__GEIST") > -1) throw new Error("font placeholder left");

// ---- brand-logo sprite (symbols referenced by <use href="#l-name">) ----
const LOGOS = { gmail: "logos/gmail.svg", gcal: "logos/gcal.svg", gdrive: "logos/gdrive.svg", attio: "logos/attio.svg", granola: "logos/granola.svg", claude: "logos/claude.svg", openai: "logos/openai.svg", cursor: "logos/si-cursor.svg" };
const MONO = { openai: 1, cursor: 1 }; // monochrome marks -> recolor via currentColor
function symbolFor(name, file) {
  let s = fs.readFileSync(file, "utf8").replace(/<\?xml[^>]*\?>/i, "").trim();
  const vb = (s.match(/viewBox="([^"]+)"/i) || [null, "0 0 24 24"])[1];
  // namespace internal ids so gradients/clips can't collide across logos
  Array.from(s.matchAll(/id="([^"]+)"/g)).map(m => m[1]).forEach(function (id) {
    const p = name + "_" + id;
    s = s.split('id="' + id + '"').join('id="' + p + '"')
         .split('url(#' + id + ')').join('url(#' + p + ')')
         .split('href="#' + id + '"').join('href="#' + p + '"')
         .split('xlink:href="#' + id + '"').join('xlink:href="#' + p + '"');
  });
  let inner = s.replace(/^[\s\S]*?<svg[^>]*>/i, "").replace(/<\/svg>\s*$/i, "");
  if (MONO[name]) inner = '<g fill="currentColor">' + inner.replace(/fill="[^"]*"/gi, "") + '</g>';
  return '<symbol id="l-' + name + '" viewBox="' + vb + '">' + inner + '</symbol>';
}
let sprite = '<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">';
Object.keys(LOGOS).forEach(function (k) { sprite += symbolFor(k, LOGOS[k]); });
sprite += '</svg>';
body = body.replace("__LOGO_SPRITE__", sprite);
if (body.indexOf("__LOGO_SPRITE__") > -1) throw new Error("logo sprite placeholder left");

// artifact version = body only (claude.ai wraps head/body)
fs.writeFileSync("fein-landing.html", body);

// ---- split <style> out to head for the standalone doc ----
const sEnd = body.indexOf("</style>") + "</style>".length;
const styleBlock = body.slice(0, sEnd);
const rest = body.slice(sEnd);

// ---- FAQ (mirrors the visible section) ----
const faqs = [
  ["What is fein?", "One relationship graph for your fund. It connects your inbox, calendar, Drive, and CRM, then answers questions inside Claude, ChatGPT, and Cursor: who's closest to a founder, how to prep for a meeting, and why you passed last time."],
  ["How is this different from a CRM like Affinity or Attio?", "A CRM is a place you have to keep current. fein reads the systems you already use, including your CRM like Attio, and stays current on its own. It answers from inside your AI tools instead of asking you to open another app. You log nothing."],
  ["What does it cost?", "$5,000 once to build it, then $1,000 a month. About $17,000 in year one, less than one month of a data hire. One build fee, one monthly line, no per-seat pricing."],
  ["How long until it's live, and what do we do?", "Fourteen days. Your part is two short calls: thirty minutes to map your systems, one more to walk your team through it. We do everything in between."],
  ["Where does our data live, and who can see what?", "On your own infrastructure. Nothing leaves your environment. The code is open source, so you can audit exactly what touches your data, and access is checked per person on every query."],
  ["What does it connect to, and how do we use it?", "Your inbox, calendar, Google Drive, and a CRM like Attio go in. You ask from Claude, ChatGPT, or Cursor over a single MCP endpoint. No new app to open."]
];

const ld = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": SITE + "/#org", name: "fein", url: SITE + "/", description: DESC, email: "hello@fein.vc", logo: SITE + "/favicon.svg" },
    { "@type": "WebSite", "@id": SITE + "/#website", url: SITE + "/", name: "fein", inLanguage: "en", publisher: { "@id": SITE + "/#org" } },
    { "@type": "WebPage", "@id": SITE + "/#webpage", url: SITE + "/", name: TITLE, description: DESC, isPartOf: { "@id": SITE + "/#website" }, about: { "@id": SITE + "/#org" }, inLanguage: "en" },
    {
      "@type": "SoftwareApplication", name: "fein", applicationCategory: "BusinessApplication",
      operatingSystem: "Web (self-hosted)", description: DESC, url: SITE + "/", provider: { "@id": SITE + "/#org" },
      audience: { "@type": "Audience", audienceType: "Venture capital funds" },
      offers: [
        { "@type": "Offer", name: "Build", price: "5000", priceCurrency: "USD", description: "One-time setup and build" },
        { "@type": "Offer", name: "Maintenance", priceCurrency: "USD", description: "Monthly maintenance and updates", priceSpecification: { "@type": "UnitPriceSpecification", price: "1000", priceCurrency: "USD", unitText: "MONTH" } }
      ]
    },
    { "@type": "FAQPage", "@id": SITE + "/#faq", mainEntity: faqs.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }
  ]
};
const ldScript = '<script type="application/ld+json">' + JSON.stringify(ld) + "</script>";

const headMeta = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<link rel="canonical" href="${SITE}/">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<meta name="author" content="fein">
<meta name="keywords" content="fund graph, relationship intelligence, venture capital, warm intros, VC CRM, Attio, MCP, Claude, ChatGPT, deal sourcing, meeting prep">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
<meta property="og:type" content="website">
<meta property="og:site_name" content="fein">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="fein — the fund graph for venture capital">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${SITE}/og.png">`;

const indexHtml = `<!doctype html>
<html lang="en">
<head>
${headMeta}
${styleBlock}
${ldScript}
</head>
<body>
${rest}
</body>
</html>`;

// ---- write site ----
const out = "..";
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), indexHtml);

// robots.txt — welcome AI answer engines explicitly
const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-Web", "anthropic-ai", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "Bytespider", "CCBot", "Amazonbot", "Meta-ExternalAgent", "cohere-ai"];
const robots = `User-agent: *
Allow: /

${aiBots.map(b => `User-agent: ${b}\nAllow: /`).join("\n\n")}

Sitemap: ${SITE}/sitemap.xml
`;
fs.writeFileSync(path.join(out, "robots.txt"), robots);

// sitemap.xml
fs.writeFileSync(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${LASTMOD}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
`);

// llms.txt — structured summary for AI crawlers
fs.writeFileSync(path.join(out, "llms.txt"), `# fein

> fein is the fund graph for venture capital. It connects a fund's inbox, calendar, and CRM into one live relationship graph and answers questions from inside AI tools like Claude and ChatGPT: warm intros, meeting prep, and deal history. Live in 14 days, self-hosted on the fund's own infrastructure. Pricing: $5,000 one-time build + $1,000 per month.

## What fein does
- Find the warmest introduction to any founder, LP, or operator, and who should make it.
- Prepare for meetings: who is in the room, how you know them, what you last discussed.
- Recall every company the fund has seen, and exactly why it passed.
- Flag relationships going cold, judged by each contact's own cadence.

## How it works
- fein reads your existing systems (email, calendar, Google Drive, CRMs like Attio) and builds a relationship graph automatically — no CRM to keep updated by hand.
- It serves answers over a single MCP endpoint, so you query it from Claude, ChatGPT, or Cursor.
- Delivered forward-deployed: live in 14 days, two short calls from your team.

## Pricing
- $5,000 one-time build.
- $1,000 per month maintenance (connectors kept working, graph kept current, new answers built on request).
- About $17,000 in the first year.

## Security and data
- Self-hosted in the fund's own environment; data never leaves it.
- Open source and auditable end to end.
- Per-person access, enforced on every query.

## Contact
- Get started: ${SITE}/#get-started
- Email: hello@fein.vc
`);

// favicon.svg — theme-adaptive graph mark
fs.writeFileSync(path.join(out, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<style>line{stroke:#000;stroke-width:2.4}circle{fill:#000}@media(prefers-color-scheme:dark){line{stroke:#fff}circle{fill:#fff}}</style>
<line x1="7" y1="24" x2="22" y2="9"/><line x1="22" y1="9" x2="24.5" y2="24"/>
<circle cx="7" cy="24" r="3.6"/><circle cx="22" cy="9" r="3.6"/><circle cx="24.5" cy="24" r="2.4"/>
</svg>
`);

// web manifest
fs.writeFileSync(path.join(out, "site.webmanifest"), JSON.stringify({
  name: "fein", short_name: "fein", description: "The fund graph for venture capital.",
  start_url: "/", display: "standalone", background_color: "#000000", theme_color: "#000000",
  icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }]
}, null, 2));

// GitHub Pages helpers
fs.writeFileSync(path.join(out, "CNAME"), "fein.vc\n");
fs.writeFileSync(path.join(out, ".nojekyll"), "");

// og.svg — square canvas (1200x1200) with the 1200x630 design centered vertically,
// so a centered crop recovers it undistorted (qlmanage renders square SVGs 1:1).
fs.writeFileSync("og.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
<defs><style>
@font-face{font-family:'Geist';font-weight:400 600;src:url(data:font/woff2;base64,${sansB64}) format('woff2');}
text{font-family:'Geist','Helvetica Neue',Arial,sans-serif}
</style></defs>
<rect width="1200" height="1200" fill="#000000"/>
<g transform="translate(0,285)">
<g stroke="#2b2b2b" stroke-width="2" fill="#2b2b2b">
<line x1="960" y1="150" x2="1068" y2="248"/><line x1="1068" y1="248" x2="998" y2="382"/><line x1="1068" y1="248" x2="1132" y2="340"/><line x1="998" y1="382" x2="1086" y2="486"/><line x1="1132" y1="340" x2="1086" y2="486"/>
<circle cx="960" cy="150" r="7"/><circle cx="1068" cy="248" r="10" fill="#ffffff" stroke="#ffffff"/><circle cx="998" cy="382" r="6"/><circle cx="1132" cy="340" r="5"/><circle cx="1086" cy="486" r="6"/>
</g>
<text x="92" y="150" fill="#8f8f8f" font-size="22" font-weight="500" letter-spacing="4">THE FUND GRAPH FOR VC</text>
<text x="84" y="330" fill="#ffffff" font-size="200" font-weight="600" letter-spacing="-8">fein</text>
<text x="92" y="410" fill="#c9c9c9" font-size="38" font-weight="400">The relationship layer your AI acts on.</text>
<text x="92" y="458" fill="#7d7d7d" font-size="25" font-weight="400">Warm intros · meeting prep · deal memory — inside Claude &amp; ChatGPT</text>
<text x="92" y="560" fill="#ededed" font-size="26" font-weight="500">fein.vc</text>
</g>
</svg>
`);

console.log("built. index.html KB:", Math.round(indexHtml.length / 1024), "| artifact KB:", Math.round(body.length / 1024));
console.log("site files:", fs.readdirSync(out).join(", "));
