const fs = require("fs");
const path = require("path");

const SITE = "https://fein.vc";
const TITLE = "fein · the graph for venture capital teams";
// DESC: search-snippet length (~160 chars). DESC_LONG: link previews + JSON-LD,
// synced to the live hero + lede; both obey the copy rules (no em dashes, no "fund").
const DESC = "The open source memory layer for venture capital teams. fein turns your inbox, calendar, and CRM into one graph that answers inside Claude, ChatGPT, and Cursor.";
const DESC_LONG = "An open source memory layer built for venture capital. fein connects your inbox, calendar, and CRM, builds the graph of every relationship your venture capital team holds, and answers inside Claude, ChatGPT, and Cursor: the warm intro, the meeting brief, the reason you passed. Free and open source, on your servers, live in 14 days.";
const LASTMOD = "2026-08-07";

const sansB64 = fs.readFileSync("GeistSans.woff2").toString("base64");
const monoB64 = fs.readFileSync("GeistMono.woff2").toString("base64");
// Inter (variable 400-600, latin cut) carries body copy, sub headings, buttons
// and nav; Geist is the display face for h1 and h2 only.
const interB64 = fs.readFileSync("Inter.woff2").toString("base64");

// ---- inject fonts into shared body ----
let body = fs.readFileSync("fein.tpl.html", "utf8")
  .replace("__GEIST_SANS_B64__", sansB64)
  .replace("__GEIST_MONO_B64__", monoB64)
  .replace("__INTER_B64__", interB64);
if (body.indexOf("__GEIST") > -1 || body.indexOf("__INTER") > -1) throw new Error("font placeholder left");

// ---- brand-logo sprite (symbols referenced by <use href="#l-name">) ----
const LOGOS = { gmail: "logos/gmail.svg", gcal: "logos/gcal.svg", gdrive: "logos/gdrive.svg", attio: "logos/attio.svg", linkedin: "logos/linkedin.svg", notion: "logos/notion.svg", slack: "logos/slack.svg", granola: "logos/granola.svg", claude: "logos/claude.svg", openai: "logos/openai.svg", cursor: "logos/si-cursor.svg", gemini: "logos/si-gemini.svg", perplexity: "logos/si-perplexity.svg", copilot: "logos/si-githubcopilot.svg" };
const MONO = { openai: 1, cursor: 1, gemini: 1, perplexity: 1, copilot: 1 }; // monochrome marks -> recolor via currentColor
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
  ["What exactly is fein?", "One graph of every relationship your venture capital team holds, answering inside Claude, ChatGPT, and Cursor over MCP."],
  ["How is this different from Affinity or Attio?", "A CRM waits for you to update it. fein reads your CRM and everything around it, stays current on its own, and answers where you already work."],
  ["What does it cost?", "$5,000 once, then $1,000 a month. About $17,000 in year one, no per-seat pricing."],
  ["Can't we build this ourselves?", "Yes. It's open source, so clone away. The monthly buys the engineer who keeps it alive, so yours can build on top of it instead."],
  ["What happens if we cancel?", "Nothing stops. It runs on your servers, so the graph, the connectors, and every answer stay yours."],
  ["How long does setup take?", "Fourteen days, and the date is a commitment. Your part is two short calls; we do everything in between."],
  ["Is our data safe?", "It never leaves your infrastructure, access is checked per person, and every line of code is open to audit."],
  ["What does it connect to?", "Gmail, Google Calendar, Drive, LinkedIn, Attio, Affinity, and Granola. Answers land in Claude, ChatGPT, Gemini, and Cursor, and new connectors ship regularly."]
];

// feature list mirrors the visible #features + #how copy; AI answer engines read this verbatim
const FEATURES = [
  "Warm introduction paths: the warmest path to any founder, LP, or operator, and who should send it",
  "Meeting briefs: attendees, how you know them, and what was left open, assembled before you sit down",
  "Deal memory: every company seen, the memo, and exactly why you passed",
  "Cadence alerts: relationships drifting from their natural rhythm, flagged before they go cold",
  "Entity resolution: every duplicate contact across your tools resolved to one person",
  "One MCP endpoint: the same cited answer in Claude, ChatGPT, Gemini, and Cursor"
];

const ld = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": SITE + "/#org", name: "fein", alternateName: "Fein", url: SITE + "/", description: DESC_LONG, slogan: "the graph for venture capital teams", email: "sales@fein.vc", logo: SITE + "/icon-512.png", image: SITE + "/og.png", contactPoint: { "@type": "ContactPoint", contactType: "sales", email: "sales@fein.vc", url: SITE + "/#get-started" } },
    { "@type": "WebSite", "@id": SITE + "/#website", url: SITE + "/", name: "fein", description: DESC, inLanguage: "en", publisher: { "@id": SITE + "/#org" } },
    { "@type": "WebPage", "@id": SITE + "/#webpage", url: SITE + "/", name: TITLE, description: DESC, isPartOf: { "@id": SITE + "/#website" }, about: { "@id": SITE + "/#app" }, mainEntity: { "@id": SITE + "/#app" }, primaryImageOfPage: { "@type": "ImageObject", contentUrl: SITE + "/og.png", width: 1200, height: 630 }, datePublished: "2026-08-07", dateModified: LASTMOD, inLanguage: "en" },
    {
      "@type": "SoftwareApplication", "@id": SITE + "/#app", name: "fein", alternateName: "Fein",
      applicationCategory: "BusinessApplication", applicationSubCategory: "Relationship intelligence",
      operatingSystem: "Self-hosted (Docker)", description: DESC_LONG, url: SITE + "/",
      provider: { "@id": SITE + "/#org" }, isAccessibleForFree: true, featureList: FEATURES,
      audience: { "@type": "Audience", audienceType: "Venture capital teams" },
      offers: [
        { "@type": "Offer", name: "Build", price: "5000", priceCurrency: "USD", url: SITE + "/#pricing", description: "One-time setup: fein built, connected, and live on your servers in 14 days" },
        { "@type": "Offer", name: "Maintenance", priceCurrency: "USD", url: SITE + "/#pricing", description: "Monthly upkeep: connectors kept alive, graph kept current, new answers built on request", priceSpecification: { "@type": "UnitPriceSpecification", price: "1000", priceCurrency: "USD", unitText: "MONTH" } },
        { "@type": "Offer", name: "Clone it yourself", price: "0", priceCurrency: "USD", url: SITE + "/#pricing", description: "Free and open source: the same code we deploy for clients, run and maintained by your team" }
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
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#000000">
<meta name="author" content="fein">
<meta name="application-name" content="fein">
<meta name="apple-mobile-web-app-title" content="fein">
<meta name="format-detection" content="telephone=no">
<meta name="keywords" content="relationship graph, relationship intelligence, memory layer, venture capital, VC CRM, warm intros, deal memory, meeting prep, MCP server, Claude, ChatGPT, Cursor, Attio, Affinity, open source">
<link rel="icon" href="/favicon.ico" sizes="48x48 32x32 16x16">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<link rel="alternate" type="text/plain" href="/llms.txt" title="fein for AI assistants (summary)">
<link rel="alternate" type="text/plain" href="/llms-full.txt" title="fein for AI assistants (full page)">
<link rel="preconnect" href="https://gc.zgo.at">
<link rel="preconnect" href="https://fein.goatcounter.com">
<link rel="dns-prefetch" href="https://widget.intercom.io">
<link rel="dns-prefetch" href="https://js.intercomcdn.com">
<link rel="dns-prefetch" href="https://api-iam.intercom.io">
<meta property="og:type" content="website">
<meta property="og:site_name" content="fein">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC_LONG}">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="fein · the graph for venture capital teams">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${SITE}/og.png">
<meta name="twitter:image:alt" content="fein · the graph for venture capital teams">`;

// GoatCounter (fein.goatcounter.com) — standalone site only, never the artifact
// copy: claude.ai's CSP blocks external scripts. Hash routes count as pages so
// the #get-started funnel is visible.
const analytics = `<script data-goatcounter="https://fein.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>
<script>addEventListener("hashchange",function(){if(window.goatcounter&&goatcounter.count)goatcounter.count({path:location.pathname+location.hash})});</script>
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)}</script>
<script defer src="/_vercel/insights/script.js"></script>
<script defer src="/_vercel/speed-insights/script.js"></script>`;
// The /_vercel/* pair is Vercel Web Analytics + Speed Insights, first-party
// routes that only resolve on the Vercel deployment (both toggled on for
// fein-site); anywhere else they 404 quietly. Also in 404.html by hand.

// Intercom messenger — standalone site only, never the artifact (same CSP
// reason as GoatCounter). Anonymous visitor mode: no user fields on a
// marketing page. The snippet is what @intercom/messenger-js-sdk does
// internally; the site has no bundler so the npm package doesn't apply.
const INTERCOM_APP_ID = "i91a73cr";
const INTERCOM_API_BASE = "https://api-iam.intercom.io"; // EU: api-iam.eu.intercom.io / AU: api-iam.au.intercom.io
const intercom = INTERCOM_APP_ID ? `
<script>window.intercomSettings={api_base:"${INTERCOM_API_BASE}",app_id:"${INTERCOM_APP_ID}"}</script>
<script>(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic("reattach_activator");ic("update",w.intercomSettings)}else{var d=document;var i=function(){i.c(arguments)};i.q=[];i.c=function(a){i.q.push(a)};w.Intercom=i;var l=function(){var s=d.createElement("script");s.async=true;s.src="https://widget.intercom.io/widget/${INTERCOM_APP_ID}";var x=d.getElementsByTagName("script")[0];x.parentNode.insertBefore(s,x)};if(document.readyState==="complete")l();else if(w.attachEvent)w.attachEvent("onload",l);else w.addEventListener("load",l,false)}})()</script>` : "";

const indexHtml = `<!doctype html>
<html lang="en">
<head>
${headMeta}
${styleBlock}
${ldScript}
</head>
<body>
${rest}
${analytics}${intercom}
</body>
</html>`;

// ---- write site ----
const out = "..";
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), indexHtml);

// robots.txt — welcome AI answer engines explicitly
const aiBots = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "Claude-Web", "anthropic-ai", "PerplexityBot", "Perplexity-User", "Google-Extended", "Google-CloudVertexBot", "Google-NotebookLM", "GoogleAgent-Mariner", "Applebot-Extended", "Bytespider", "CCBot", "Amazonbot", "Meta-ExternalAgent", "Meta-ExternalFetcher", "cohere-ai", "cohere-training-data-crawler", "AI2Bot", "DuckAssistBot", "YouBot", "MistralAI-User", "DeepSeekBot", "Diffbot", "Timpibot", "omgilibot", "Webzio-Extended", "kagi-fetcher"];
const robots = `# fein · the graph for venture capital teams
# AI assistants welcome. Summary: ${SITE}/llms.txt · Full page: ${SITE}/llms-full.txt

User-agent: *
Allow: /

${aiBots.map(b => `User-agent: ${b}\nAllow: /`).join("\n\n")}

Sitemap: ${SITE}/sitemap.xml
`;
fs.writeFileSync(path.join(out, "robots.txt"), robots);

// sitemap.xml
fs.writeFileSync(path.join(out, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>${SITE}/</loc><lastmod>${LASTMOD}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority><image:image><image:loc>${SITE}/og.png</image:loc></image:image></url>
</urlset>
`);

// llms.txt — structured summary for AI crawlers (llms-full.txt carries the whole page)
const LLMS_SUMMARY = `> fein is an open source memory layer for venture capital teams: a live, permissioned relationship graph built from the team's inbox, calendar, and CRM, answering inside AI tools like Claude, ChatGPT, and Cursor over MCP: warm intros, meeting prep, and deal history, every fact linked to its source. Live in 14 days, self-hosted on the team's own infrastructure. Pricing: $5,000 one-time build + $1,000 per month, or free if the team runs it themselves (open source).`;
fs.writeFileSync(path.join(out, "llms.txt"), `# fein

${LLMS_SUMMARY}

Updated: ${LASTMOD}. Full page content in Markdown: ${SITE}/llms-full.txt

## What fein does
- Find the warmest introduction to any founder, LP, or operator, and who should make it.
- Prepare for meetings: who is in the room, how you know them, what you last discussed.
- Recall every company the team has seen, and exactly why it passed.
- Flag relationships going cold, judged by each contact's own cadence.

## How it works
- fein reads your existing systems (email, calendar, Google Drive, LinkedIn, CRMs like Attio and Affinity) and builds a relationship graph automatically, with no CRM to keep updated by hand.
- It serves answers over a single MCP endpoint, so you query it from Claude, ChatGPT, Gemini, Cursor, or any MCP client.
- Delivered forward-deployed: live in 14 days, two short calls from your team.

## Pricing
- $5,000 one-time build.
- $1,000 per month maintenance (connectors kept working, graph kept current, new answers built on request).
- About $17,000 in the first year.
- Month to month, no lock-in: cancel and the self-hosted software and graph remain yours.

## Security and data
- Self-hosted in the team's own environment; data never leaves it.
- Open source and auditable end to end: teams can clone the repo and run fein themselves; the paid offer is setup and upkeep.
- Per-person access, enforced on every query.
- Every query logged, tied to a person.

## Contact
- [Get started](${SITE}/#get-started): talk to sales about a 14 day build
- [Email sales](mailto:sales@fein.vc): sales@fein.vc

## Links
- [Full page content for LLMs](${SITE}/llms-full.txt): the whole page in Markdown
- [Sitemap](${SITE}/sitemap.xml): every indexable URL
`);

// llms-full.txt — the whole page, mirrored in Markdown for AI answer engines.
// Every line here restates visible site copy; keep it in sync when copy changes.
fs.writeFileSync(path.join(out, "llms-full.txt"), `# fein · the graph for venture capital teams

${LLMS_SUMMARY}

Updated: ${LASTMOD}. This file mirrors the full content of ${SITE}/ for AI assistants and answer engines. Summary version: ${SITE}/llms.txt

## What fein is

An open source memory layer built for venture capital. fein gives your venture capital team state of the art memory. It connects your inbox, calendar, and CRM, builds the graph of every relationship your venture capital team holds, and answers inside Claude, ChatGPT, and Cursor.

## The memory your team pretends it has

Every intro, every meeting, every pass your venture capital team has ever made, answered in seconds.

### That intro you need? Your team already has it.
Ask for the warmest path to any founder or LP. fein walks who actually emails and meets whom, and names the person best placed to send it.

### Walk in briefed. Every meeting.
Attendees, how you know them, and what was left open, assembled from your calendar and inbox before you sit down.

### Why did we pass? One question.
When a company comes back for its next round, the meeting, the memo, and the reasons are back in seconds.

### Relationships go cold. fein notices first.
It learns each relationship's natural cadence and flags the ones drifting from it, before the news does.

## Why fein has the answer

Most AI tools start every chat from zero. fein starts from everything your team has ever done.

1. Reads everything you already run: inbox, calendar, Drive, LinkedIn, and your CRM, read continuously. Nobody logs anything.
2. Builds one graph of it all: every duplicate contact across your tools resolves to one person, every relationship scored by strength and recency.
3. Answers wherever you ask: one MCP endpoint. Claude, ChatGPT, Gemini, and Cursor all give the same cited answer.

## In the tools you already use

Nothing to open, nothing to learn. Ask in plain language, get the answer with the email behind it. fein serves answers over a single MCP endpoint, so any MCP client can query the graph.

Reads from: Gmail, Google Calendar, Google Drive, LinkedIn, Attio, Affinity, and Granola. Answers in: Claude, ChatGPT, Gemini, and Cursor. New connectors ship regularly.

## Security

Your data never leaves your servers. fein reads your inbox, calendar, and CRM to do its job. It does that inside your walls, in code you can read.

- Self-hosted, always. It runs on your infrastructure. Nothing is sent to us, ever.
- Open source, end to end. Every line that touches your data is public. Audit it before it runs.
- Permissioned and logged. Access is checked per person on every query, and every query is logged. When LPs ask, you show the trail.

## Pricing

Every venture capital team needs a data engineer. Now every team can afford one.

| Option | Price | What you get |
| --- | --- | --- |
| A data hire | $200,000 per year | Brilliant, but one pair of hands. The graph lives in their head. |
| fein | $5,000 once + $1,000 per month | The graph, built and kept alive for you. Live in 14 days. |
| Clone it yourself | $0 forever | The same code we deploy for clients. You run it, you maintain it. |

The fein plan: reads inbox, calendar, Drive, LinkedIn, CRM; one graph, every relationship scored; answers in Claude, ChatGPT, Gemini, Cursor; open source, on your servers; connectors kept alive through every API change; new answers built as your team asks; no per-seat pricing.

About $17,000 in year one, less than one month of a data hire. Month to month, and if you cancel, everything keeps running.

## FAQ

${faqs.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}

## Contact

- [Talk to sales](${SITE}/#get-started): the form on the site, two short calls to go live
- [Email sales](mailto:sales@fein.vc): sales@fein.vc
- [Ask for the repo](mailto:sales@fein.vc): the code is open source, email for access
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
  name: "fein", short_name: "fein", description: "The graph for venture capital teams.",
  start_url: "/", display: "standalone", background_color: "#000000", theme_color: "#000000",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }
  ]
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
<text x="92" y="150" fill="#8f8f8f" font-size="22" font-weight="500" letter-spacing="4">THE GRAPH FOR VC TEAMS</text>
<text x="84" y="330" fill="#ffffff" font-size="200" font-weight="600" letter-spacing="-8">fein</text>
<text x="92" y="410" fill="#c9c9c9" font-size="38" font-weight="400">The relationship layer your AI acts on.</text>
<text x="92" y="458" fill="#7d7d7d" font-size="25" font-weight="400">Warm intros · meeting prep · deal memory, inside Claude &amp; ChatGPT</text>
<text x="92" y="560" fill="#ededed" font-size="26" font-weight="500">fein.vc</text>
</g>
</svg>
`);

console.log("built. index.html KB:", Math.round(indexHtml.length / 1024), "| artifact KB:", Math.round(body.length / 1024));
console.log("site files:", fs.readdirSync(out).join(", "));
