const fs = require("fs");
const path = require("path");

const SITE = "https://fein.vc";
const TITLE = "fein · the shared memory of a venture capital team";
// DESC: search-snippet length (~160 chars). DESC_LONG: link previews + JSON-LD,
// synced to the live hero + lede; both obey the copy rules (no em dashes).
const DESC = "The open-source data layer for venture capital teams. It reads your email, calendar, and CRM. It resolves them into one graph. It answers in Claude, ChatGPT, and Cursor.";
const DESC_LONG = "The shared memory of a venture capital team. fein is the open-source data layer for investment teams. It reads your email, calendar, notes, and CRM. It resolves them into one live graph of every relationship your firm has. It answers in Claude, ChatGPT, and Cursor. It shows the source for each answer. It gives the warm introduction, the meeting brief, and the reason you passed, from your team's history in seconds. It is self-hosted and open source. It is live in 14 days.";
const LASTMOD = "2026-08-10";

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
const LOGOS = { gmail: "logos/gmail.svg", gcal: "logos/gcal.svg", gdrive: "logos/gdrive.svg", attio: "logos/attio.svg", linkedin: "logos/linkedin.svg", notion: "logos/notion.svg", slack: "logos/slack.svg", granola: "logos/granola.svg", claude: "logos/claude.svg", openai: "logos/openai.svg", cursor: "logos/si-cursor.svg", gemini: "logos/si-gemini.svg", perplexity: "logos/si-perplexity.svg", copilot: "logos/si-githubcopilot.svg", github: "logos/github.svg" };
const MONO = { openai: 1, cursor: 1, gemini: 1, perplexity: 1, copilot: 1, github: 1 }; // monochrome marks -> recolor via currentColor
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
  ["What exactly is fein?", "fein is an open-source data layer for your firm's relationships. It reads your email, calendar, notes, and CRM. It resolves them into one graph. It answers over MCP in Claude, ChatGPT, and Cursor. It is not a CRM that you fill in. It maintains itself."],
  ["How is this different from Affinity or Attio?", "A CRM is a database that your team fills in by hand. fein reads your CRM and everything around it. It resolves this into one graph. The graph stays current automatically. fein answers where your team already works. It sits on top of the CRM. It needs no new data entry."],
  ["What does it cost?", "It costs $5,000 once, then $1,000 each month. This is about $17,000 in the first year. There is no per-seat pricing."],
  ["Can't we build this ourselves?", "Yes. It is open source, so you can clone it. The monthly fee pays for the engineer who keeps it current. Then your engineer can build on top of it."],
  ["What happens if we cancel?", "Nothing stops. It runs on your servers. The graph, the connectors, and every answer stay yours."],
  ["How long does setup take?", "Fourteen days. The date is a commitment. Your part is two short calls. We do everything between them."],
  ["Is our data safe?", "Your data never leaves your infrastructure. fein checks access for each person. Every line of code is open to audit."],
  ["What does it connect to?", "It connects to Gmail, Google Calendar, Drive, LinkedIn, Attio, Affinity, and Granola. Answers appear in Claude, ChatGPT, Gemini, and Cursor. We add new connectors often."]
];

// feature list mirrors the visible #features + #how copy; AI answer engines read this verbatim
const FEATURES = [
  "Warm introduction paths: the weighted shortest path to a founder, an LP, or an operator, and the best person to make the introduction",
  "Meeting briefs: the attendees, how you know each of them, and what was open, from your calendar and inbox, before the meeting starts",
  "Deal memory: every company you saw, the memo, and the exact reason you passed, with each line traced to its source document",
  "Cadence alerts: relationships that drift from their learned rhythm, flagged before they go cold",
  "Entity resolution: every duplicate contact across your tools resolved to one identity, scored from real signals, not an LLM guess",
  "One MCP endpoint: the same cited answer in Claude, ChatGPT, Gemini, and Cursor, from structured graph traversal, not document scraping"
];

const ld = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": SITE + "/#org", name: "fein", alternateName: "Fein", url: SITE + "/", description: DESC_LONG, slogan: "the shared memory of a venture capital team", email: "sales@fein.vc", logo: SITE + "/icon-512.png", image: SITE + "/og.png", sameAs: ["https://github.com/clippycommits/fein"], contactPoint: { "@type": "ContactPoint", contactType: "sales", email: "sales@fein.vc", url: SITE + "/#get-started" } },
    { "@type": "WebSite", "@id": SITE + "/#website", url: SITE + "/", name: "fein", description: DESC, inLanguage: "en", publisher: { "@id": SITE + "/#org" } },
    { "@type": "WebPage", "@id": SITE + "/#webpage", url: SITE + "/", name: TITLE, description: DESC, isPartOf: { "@id": SITE + "/#website" }, about: { "@id": SITE + "/#app" }, mainEntity: { "@id": SITE + "/#app" }, primaryImageOfPage: { "@type": "ImageObject", contentUrl: SITE + "/og.png", width: 1200, height: 630 }, datePublished: "2026-08-07", dateModified: LASTMOD, inLanguage: "en" },
    {
      "@type": "SoftwareApplication", "@id": SITE + "/#app", name: "fein", alternateName: "Fein",
      applicationCategory: "BusinessApplication", applicationSubCategory: "Relationship intelligence",
      operatingSystem: "Self-hosted (Docker)", description: DESC_LONG, url: SITE + "/",
      provider: { "@id": SITE + "/#org" }, isAccessibleForFree: true, featureList: FEATURES,
      audience: { "@type": "Audience", audienceType: "Venture capital teams" },
      offers: [
        { "@type": "Offer", name: "Build", price: "5000", priceCurrency: "USD", availability: "https://schema.org/InStock", url: SITE + "/#pricing", description: "One-time setup: fein built, connected, and live on your servers in 14 days" },
        { "@type": "Offer", name: "Maintenance", priceCurrency: "USD", availability: "https://schema.org/InStock", url: SITE + "/#pricing", description: "Monthly upkeep: connectors kept alive, graph kept current, new answers built on request", priceSpecification: { "@type": "UnitPriceSpecification", price: "1000", priceCurrency: "USD", unitText: "MONTH" } },
        { "@type": "Offer", name: "Clone it yourself", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock", url: SITE + "/#pricing", description: "Free and open source: the same code we deploy for clients, run and maintained by your team" }
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
<meta property="og:image:alt" content="fein · the shared memory of a venture capital team">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${DESC}">
<meta name="twitter:image" content="${SITE}/og.png">
<meta name="twitter:image:alt" content="fein · the shared memory of a venture capital team">`;

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

// PostHog product analytics — standalone site only, never the artifact (same CSP
// reason as GoatCounter). INERT by default: paste a project API key (phc_...) into
// POSTHOG_KEY to enable, an empty string emits nothing and index.html is unchanged.
// Complements GoatCounter + Vercel with funnels and session insight on the
// #get-started flow. NOTE: confirm the tool with Daniel ("postdoc" was dictated)
// and pick the region host before enabling. Official array.js loader.
const POSTHOG_KEY = ""; // e.g. "phc_..." — leave empty to keep PostHog disabled
const POSTHOG_HOST = "https://us.i.posthog.com"; // EU: https://eu.i.posthog.com
const posthog = POSTHOG_KEY ? `
<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId captureTraceFeedback captureTraceMetric".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init("${POSTHOG_KEY}",{api_host:"${POSTHOG_HOST}",person_profiles:"identified_only",capture_pageview:true})</script>` : "";

// Intercom messenger — standalone site only, never the artifact (same CSP
// reason as GoatCounter). Anonymous visitor mode: no user fields on a
// marketing page. The snippet is what @intercom/messenger-js-sdk does
// internally; the site has no bundler so the npm package doesn't apply.
const INTERCOM_APP_ID = "i91a73cr";
const INTERCOM_API_BASE = "https://api-iam.intercom.io"; // EU: api-iam.eu.intercom.io / AU: api-iam.au.intercom.io
// A custom launcher (the fein mark + an online dot + "Last seen 3m ago")
// replaces Intercom's default bubble: hide_default_launcher + a
// custom_launcher_selector pointed at #fein-chat. The whole block is wrapped in
// <!--fein-chat--> markers so rederive-tpl.js can strip it back out cleanly.
const intercom = INTERCOM_APP_ID ? `
<!--fein-chat:start-->
<style>
#fein-chat{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:inline-flex;align-items:center;gap:10px;margin:0;padding:9px 15px 9px 9px;font-family:var(--font);color:var(--fg);background:var(--bg-2);border:1px solid var(--line);border-radius:999px;cursor:pointer;box-shadow:0 1px 0 rgba(255,255,255,.04) inset,0 2px 8px rgba(0,0,0,.5),0 16px 40px -12px rgba(0,0,0,.85);opacity:0;transform:translateY(6px);transition:opacity .3s ease,transform .3s cubic-bezier(.22,.61,.36,1),border-color .2s ease,box-shadow .2s ease;-webkit-tap-highlight-color:transparent}
#fein-chat.fc-in{opacity:1;transform:none}
#fein-chat:hover{border-color:var(--line-2);transform:translateY(-1px);box-shadow:0 1px 0 rgba(255,255,255,.05) inset,0 2px 8px rgba(0,0,0,.5),0 22px 52px -12px rgba(0,0,0,.9)}
#fein-chat:focus-visible{outline:2px solid var(--blue);outline-offset:3px}
#fein-chat .fc-mark{position:relative;flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.05);color:var(--fg)}
#fein-chat .fc-mark svg{display:block}
#fein-chat .fc-dot{position:absolute;right:0;bottom:1px;width:10px;height:10px;border-radius:50%;background:#30d158;box-shadow:0 0 0 2px var(--bg-2)}
#fein-chat .fc-txt{display:flex;flex-direction:column;align-items:flex-start;gap:1px;line-height:1.2;text-align:left}
#fein-chat .fc-txt b{font-weight:600;font-size:13px;letter-spacing:-.01em;color:var(--fg)}
#fein-chat .fc-txt span{font-size:11.5px;font-weight:450;color:var(--muted)}
#fein-chat.fc-open{opacity:0;transform:translateY(6px);pointer-events:none}
@media(max-width:520px){#fein-chat{padding:9px;gap:0}#fein-chat .fc-txt{display:none}}
@media(prefers-reduced-motion:reduce){#fein-chat,#fein-chat.fc-in{transition:opacity .2s ease;transform:none}}
</style>
<button type="button" id="fein-chat" aria-label="Chat with the fein team. Last seen 3 minutes ago.">
<span class="fc-mark"><svg viewBox="0 0 32 32" width="17" height="17" fill="none" aria-hidden="true"><line x1="7" y1="24" x2="22" y2="9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><line x1="22" y1="9" x2="24.5" y2="24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="7" cy="24" r="3.4" fill="currentColor"/><circle cx="22" cy="9" r="3.4" fill="currentColor"/><circle cx="24.5" cy="24" r="2.2" fill="currentColor"/></svg><span class="fc-dot"></span></span>
<span class="fc-txt"><b>Chat with us</b><span>Last seen 3m ago</span></span>
</button>
<script>window.intercomSettings={api_base:"${INTERCOM_API_BASE}",app_id:"${INTERCOM_APP_ID}",hide_default_launcher:true,custom_launcher_selector:"#fein-chat"}</script>
<script>(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic("reattach_activator");ic("update",w.intercomSettings)}else{var d=document;var i=function(){i.c(arguments)};i.q=[];i.c=function(a){i.q.push(a)};w.Intercom=i;var l=function(){var s=d.createElement("script");s.async=true;s.src="https://widget.intercom.io/widget/${INTERCOM_APP_ID}";var x=d.getElementsByTagName("script")[0];x.parentNode.insertBefore(s,x)};if(document.readyState==="complete")l();else if(w.attachEvent)w.attachEvent("onload",l);else w.addEventListener("load",l,false)}})()</script>
<script>(function(){var b=document.getElementById("fein-chat");if(!b)return;requestAnimationFrame(function(){requestAnimationFrame(function(){b.classList.add("fc-in")})});if(window.Intercom){Intercom("onShow",function(){b.classList.add("fc-open")});Intercom("onHide",function(){b.classList.remove("fc-open")})}})()</script>
<!--fein-chat:end-->` : "";

const indexHtml = `<!doctype html>
<html lang="en">
<head>
${headMeta}
${styleBlock}
${ldScript}
</head>
<body>
${rest}
${analytics}${posthog}${intercom}
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
  <url><loc>${SITE}/privacy</loc><lastmod>${LASTMOD}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>
  <url><loc>${SITE}/terms</loc><lastmod>${LASTMOD}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
`);

// ---- legal pages (privacy, terms): standalone docs served at /privacy and
// /terms via directory-index files. Same font inlining as the main template. ----
["privacy", "terms"].forEach(function (slug) {
  let page = fs.readFileSync(path.join("legal", slug + ".html"), "utf8")
    .split("__GEIST_SANS_B64__").join(sansB64)
    .split("__INTER_B64__").join(interB64)
    .split("__LASTMOD__").join(LASTMOD);
  if (page.indexOf("__GEIST") > -1 || page.indexOf("__INTER") > -1 || page.indexOf("__LASTMOD__") > -1) throw new Error("legal placeholder left in " + slug);
  fs.mkdirSync(path.join(out, slug), { recursive: true });
  fs.writeFileSync(path.join(out, slug, "index.html"), page);
});

// llms.txt — structured summary for AI crawlers (llms-full.txt carries the whole page)
const LLMS_SUMMARY = `> fein is the open-source data layer for a venture capital team. It is the shared memory that the whole firm can query. It reads the team's email, calendar, notes, and CRM. It resolves them into one graph of every relationship the firm has. The graph shows who knows whom, and how strongly. fein scores this from real signals, not a guess. It serves the graph to AI tools like Claude, ChatGPT, and Cursor over one MCP endpoint. Each answer arrives with the source attached: warm introductions, meeting preparation, deal history, and the reason the team passed. AI tools traverse a deterministic map. They do not scrape documents and guess. fein is live in 14 days. It is self-hosted on the team's own infrastructure. It is open source. Pricing: $5,000 to build once, then $1,000 each month. It is free if the team runs it.`;
fs.writeFileSync(path.join(out, "llms.txt"), `# fein

${LLMS_SUMMARY}

Updated: ${LASTMOD}. Full page content in Markdown: ${SITE}/llms-full.txt

## What fein does
- Find the warmest introduction to a founder, an LP, or an operator. See who should make it.
- Prepare for meetings. See who is in the room, how you know them, and what you last discussed.
- Recall every company the team saw, and the exact reason it passed.
- Flag relationships that go cold, by each contact's own cadence.

## How it works
- fein reads your existing systems: email, calendar, Google Drive, LinkedIn, and CRMs like Attio and Affinity. It builds a relationship graph automatically. You keep no CRM up to date by hand.
- It serves answers over one MCP endpoint. You query it from Claude, ChatGPT, Gemini, Cursor, or any MCP client.
- We deploy it into your stack. It is live in 14 days. Your team joins two short calls.

## Pricing
- $5,000 to build once.
- $1,000 each month for maintenance. We keep the connectors working, keep the graph current, and build new answers on request.
- About $17,000 in the first year.
- It is month to month, with no lock-in. If you cancel, the self-hosted software and the graph stay yours.

## Security and data
- It is self-hosted in the team's own environment. Data never leaves it.
- It is open source and auditable from end to end. A team can clone the repo and run fein. The paid offer is setup and upkeep.
- Access is per person. fein enforces it on every query.
- fein logs every query and ties it to a person.

## Contact
- [Get started](${SITE}/#get-started): talk to sales about a 14 day build
- [Email sales](mailto:sales@fein.vc): sales@fein.vc

## Links
- [Source on GitHub](https://github.com/clippycommits/fein): MIT licensed, free to self-host
- [Full page content for LLMs](${SITE}/llms-full.txt): the whole page in Markdown
- [Sitemap](${SITE}/sitemap.xml): every indexable URL
`);

// llms-full.txt — the whole page, mirrored in Markdown for AI answer engines.
// Every line here restates visible site copy; keep it in sync when copy changes.
fs.writeFileSync(path.join(out, "llms-full.txt"), `# fein · the shared memory of a venture capital team

${LLMS_SUMMARY}

Updated: ${LASTMOD}. This file mirrors the full content of ${SITE}/ for AI assistants and answer engines. Summary version: ${SITE}/llms.txt

## What fein is

Welcome to agentic venture capital. fein is an open source tool and platform that transforms your fund's raw data into intelligent, searchable memory for agents and humans. It reads your email, calendar, notes, and CRM. It resolves them into one live graph of every relationship your firm has. It answers in Claude, ChatGPT, and Cursor. It shows the source for each answer. You add no new CRM. Your team logs nothing. It is self-hosted and open source. It is live in 14 days.

It reads and answers in the tools you already use: Gmail, Google Calendar, Drive, Attio, LinkedIn, Granola, Notion, Slack, Claude, ChatGPT, Gemini, Cursor, Perplexity, and Copilot.

## How it works: nobody enters data, the graph builds itself

fein reads the record your team already makes. It resolves that record into one live graph: who exists, who knows whom, and how well. Your AI tools read the graph. They stop guessing.

1. Reads everything your team already uses: your inbox, calendar, Drive, LinkedIn, and CRM, read continuously. Your team logs nothing.
2. Resolves it into one identity per person, not a hundred duplicates: fein resolves every copy of a contact into one identity. It scores the strength from real signals (meetings, replies, and shared documents), not an LLM guess.
3. Answers wherever your team asks: ask in Claude, ChatGPT, Gemini, or Cursor over one MCP endpoint. You get the same answer every time, with the email behind it.

The same question gives the same answer, for every person and every tool. It does not depend on who is in the room.

## What you get: four questions your team asks every week

The warm introduction. The brief before the meeting. The reason you passed. The relationship that goes quiet. fein answers each one from your team's history, in seconds.

### Your team already has the introduction you need.
Ask for the warmest path to a founder or an LP. fein reads the real graph of who meets and emails whom. It weighs each hop. It names the best person to make the introduction. This is not only the person who knows them.

### Get a brief before each meeting.
fein shows the attendees, how you know each of them, and what was open. It gets this from your calendar and inbox. It is on your screen before the meeting starts.

### Ask one question to see why you passed.
A company can come back for its next round. Then fein shows the meeting, the memo, and the exact reason in seconds. It traces each line to its source document.

### Relationships go cold. fein sees it first.
fein learns the rhythm of each relationship from your real history. Then it flags the ones that drift away from it. It uses dates and intervals, not a guess.

## Security

Your data never leaves your servers. fein reads your inbox, calendar, and CRM to do its work. It does this on your own servers. You can read all of the code.

- Always self-hosted. It runs on your infrastructure. It sends nothing to us.
- Open source, from end to end. Every line that touches your data is public. Read it before you run it.
- Permissioned and logged. fein checks access for each person on every query. It logs every query. When LPs ask, you show the record.

## Managed installation: we deploy fein in two weeks

We deploy fein in two weeks. Then it works on its own. Your only part is two short calls. By day fourteen, fein holds your team's full history, and it works like it has been here for years. It drafts the brief before each meeting, and it shows the source for each answer.

- Day 1, we connect your systems: on the first call, we connect your email, calendar, Drive, LinkedIn, and CRM. This runs on your own servers.
- Days 2-13, it reads your full history: it reads years of email, meetings, and documents. It joins every copy of each person into one record. The whole team shares this record. Nobody maintains it by hand.
- Day 14, you check it, then it goes live: on a second short call, you check the answers against what you know. Then fein goes live. It holds your team's full history, like a colleague of many years.

## Pricing

Every venture capital team needs a data engineer. Now every team can afford one.

| Option | Price | What you get |
| --- | --- | --- |
| A data hire | $200,000 per year | Skilled, but one person. The graph stays in their head. |
| fein | $5,000 once + $1,000 per month | We build it into your stack in two weeks and keep it current for you. Live in 14 days. |
| Clone it yourself | $0 forever | The same code we deploy for clients. You run it and you maintain it. |

The fein plan reads your inbox, calendar, Drive, LinkedIn, and CRM. It resolves entities to one identity per person. It scores every relationship from real signals, not a guess. It answers over one MCP endpoint in Claude, ChatGPT, Gemini, and Cursor. It is open source and runs on your servers. We keep the connectors working through every API change. We build new answers when your team asks. There is no per-seat pricing.

This is about $17,000 in the first year. It is less than one month of a data hire. It is month to month, open source, and self-hosted. If you cancel, everything continues to run.

## FAQ

${faqs.map(([q, a]) => `### ${q}\n${a}`).join("\n\n")}

## Contact

- [Talk to sales](${SITE}/#get-started): the form on the site, two short calls to go live
- [Email sales](mailto:sales@fein.vc): sales@fein.vc
- [Get the repo](https://github.com/clippycommits/fein): the source on GitHub, MIT licensed, free to self-host
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
  name: "fein", short_name: "fein", description: "The shared memory of a venture capital team.",
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
