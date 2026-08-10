#!/usr/bin/env node
// fein cms — local copy editor for the landing page.
//
//   node scripts/cms.mjs              serve http://127.0.0.1:4870 and open it
//   node scripts/cms.mjs --push       also `git push` after each publish commit
//   node scripts/cms.mjs --port 4871  custom port
//   node scripts/cms.mjs --no-open    don't open the browser
//
// Serves the built index.html with an inline editor (cms-client.js). Publish
// applies the edits to src/fein.tpl.html (the canonical template — see
// src/README.md), reruns src/build.js, verifies the output, and commits the
// pipeline files. Copy rules are enforced before anything is written:
// no em dashes.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const TPL = path.join(SRC, "fein.tpl.html");
const INDEX = path.join(ROOT, "index.html");
const CLIENT = path.join(ROOT, "scripts", "cms-client.js");

const argv = process.argv.slice(2);
const PUSH = argv.includes("--push");
const OPEN = !argv.includes("--no-open");
const PORT = Number(argv[argv.indexOf("--port") + 1]) || 4870;

// files the publish commit stages (src/fein-landing.html is gitignored)
const PIPELINE = [
  "index.html", "robots.txt", "sitemap.xml", "llms.txt", "favicon.svg",
  "site.webmanifest", "CNAME", ".nojekyll",
  "src/fein.tpl.html", "src/build.js", "src/og.svg", "src/rederive-tpl.js",
];

// same pair rederive-tpl.js strips: analytics must not run in preview
const GOAT_RE = /\s*<script data-goatcounter[\s\S]*?<\/script>\s*<script>[^<]*goatcounter[\s\S]*?<\/script>/g;

const STATIC_OK = { "/favicon.svg": "image/svg+xml", "/og.png": "image/png", "/site.webmanifest": "application/manifest+json", "/robots.txt": "text/plain", "/llms.txt": "text/plain", "/404.html": "text/html" };

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function count(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

function lint(edits) {
  const issues = [];
  for (const e of edits) {
    const text = e.after.replace(/<[^>]*>/g, " ");
    if (/—|&mdash;/.test(text)) issues.push({ label: e.label, issue: "em dash — copy rule: no em dashes" });
    if (/<\s*script/i.test(e.after)) issues.push({ label: e.label, issue: "script tag in edit" });
  }
  return issues;
}

function pipelineState() {
  const existing = PIPELINE.filter((f) => fs.existsSync(path.join(ROOT, f)));
  const out = git("status", "--porcelain", "--", ...existing);
  return out.split("\n").filter(Boolean).map((l) => l.slice(3).trim());
}

let busy = false;

function publish(body, res) {
  const edits = (body.edits || []).filter(
    (e) => e && typeof e.before === "string" && typeof e.after === "string" &&
      e.before !== e.after && e.before.length < 20000 && e.after.length < 20000
  );
  if (!edits.length) return send(res, 400, { ok: false, error: "no edits" });

  const issues = lint(edits);
  if (issues.length) return send(res, 422, { ok: false, error: "copy rules", issues });

  const orig = fs.readFileSync(TPL, "utf8");
  let tpl = orig;
  for (const e of edits) {
    const n = count(tpl, e.before);
    if (n !== 1) {
      return send(res, 409, {
        ok: false,
        error: n === 0
          ? `"${e.label}" not found in fein.tpl.html — index.html and the template may have drifted (run src/rederive-tpl.js), or two edits overlap`
          : `"${e.label}" matches ${n} places in the template — edit not applied`,
      });
    }
    const i = tpl.indexOf(e.before);
    tpl = tpl.slice(0, i) + e.after + tpl.slice(i + e.before.length);
  }

  fs.writeFileSync(TPL, tpl);
  try {
    execFileSync(process.execPath, ["build.js"], { cwd: SRC, encoding: "utf8" });
  } catch (err) {
    fs.writeFileSync(TPL, orig);
    try { execFileSync(process.execPath, ["build.js"], { cwd: SRC }); } catch {}
    return send(res, 500, { ok: false, error: "build.js failed, template restored: " + (err.stderr || err.message) });
  }

  const built = fs.readFileSync(INDEX, "utf8");
  const missing = edits.filter((e) => !built.includes(e.after));
  if (missing.length) {
    fs.writeFileSync(TPL, orig);
    try { execFileSync(process.execPath, ["build.js"], { cwd: SRC }); } catch {}
    return send(res, 500, { ok: false, error: "edit missing from built output, template restored: " + missing[0].label });
  }

  const alsoCommitted = pipelineState();
  const existing = PIPELINE.filter((f) => fs.existsSync(path.join(ROOT, f)));
  git("add", "--", ...existing);
  let staged = true;
  try { git("diff", "--cached", "--quiet"); staged = false; } catch {}
  if (!staged) return send(res, 200, { ok: true, commit: null, note: "nothing changed" });

  const labels = edits.map((e) => String(e.label || "copy").replace(/["\n\r]/g, "").slice(0, 48));
  const subject = ("copy: " + labels.join("; ")).slice(0, 64) + " [cms]";
  git("commit", "-m", subject, "-m", "edited via scripts/cms.mjs:\n" + labels.map((l) => "- " + l).join("\n"));
  const commit = git("rev-parse", "--short", "HEAD").trim();

  let pushed = false, pushError = null;
  if (PUSH) {
    try { git("push"); pushed = true; } catch (err) { pushError = String(err.stderr || err.message).trim(); }
  }
  send(res, 200, { ok: true, commit, subject, files: alsoCommitted, pushed, pushError });
}

function send(res, status, json) {
  const b = JSON.stringify(json);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) });
  res.end(b);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (req.method === "GET" && u.pathname === "/") {
      let html = fs.readFileSync(INDEX, "utf8").replace(GOAT_RE, "");
      html = html.replace("</body>", '<script src="/__cms.js"></script>\n</body>');
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    if (req.method === "GET" && u.pathname === "/__cms.js") {
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
      return res.end(fs.readFileSync(CLIENT));
    }
    if (req.method === "GET" && u.pathname === "/__cms/raw") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(fs.readFileSync(INDEX));
    }
    if (req.method === "GET" && u.pathname === "/__cms/state") {
      return send(res, 200, {
        branch: git("rev-parse", "--abbrev-ref", "HEAD").trim(),
        head: git("log", "-1", "--format=%h %s").trim(),
        pending: pipelineState(),
        push: PUSH,
      });
    }
    if (req.method === "POST" && u.pathname === "/__cms/publish") {
      if (busy) return send(res, 429, { ok: false, error: "publish already in progress" });
      busy = true;
      let data = "";
      req.on("data", (c) => { data += c; if (data.length > 5e6) req.destroy(); });
      req.on("end", () => {
        try { publish(JSON.parse(data), res); }
        catch (err) { send(res, 500, { ok: false, error: String(err.stderr || err.message || err) }); }
        finally { busy = false; }
      });
      return;
    }
    if (req.method === "GET" && STATIC_OK[u.pathname]) {
      res.writeHead(200, { "Content-Type": STATIC_OK[u.pathname] });
      return res.end(fs.readFileSync(path.join(ROOT, u.pathname)));
    }
    res.writeHead(404); res.end("not found");
  } catch (err) {
    send(res, 500, { ok: false, error: String(err.message || err) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`fein cms → ${url}${PUSH ? "  (publish will also push)" : ""}`);
  if (OPEN && process.platform === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
});
server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `port ${PORT} in use — try --port ${PORT + 1}` : err.message);
  process.exit(1);
});
