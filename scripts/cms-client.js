// fein cms editor — injected into the preview by scripts/cms.mjs.
// Click copy to edit it in place; Publish maps each edited element back to its
// exact source string in index.html/fein.tpl.html. An element is editable only
// if its (normalized) serialization matches the source exactly once, so a bad
// write is impossible: anything the page's scripts have rewritten simply
// reports as not editable here.
(function () {
  "use strict";
  if (window.__feincms) return;

  // classes/attrs the page's own scripts add at runtime; stripped before
  // matching DOM serializations against the source file
  var RUNTIME_CLASSES = { in: 1, on: 1, typing: 1, typed: 1, moving: 1, live: 1, hit: 1, anim: 1, show: 1, scrolled: 1, done: 1, invalid: 1, open: 1 };
  var MAX_ANCHOR = 8000;

  var raw = null, state = null;
  var entries = new Map();   // candidate element -> {el, anchor, before, level}
  var unmappable = [];
  var dirty = new Map();     // anchor element -> entry
  var mode = "edit";
  var suppressGuard = false;
  var plainOk = (function () {
    var d = document.createElement("div");
    try { d.contentEditable = "plaintext-only"; } catch (e) { return false; }
    return d.contentEditable === "plaintext-only";
  })();

  function count(hay, needle) {
    var n = 0, i = 0;
    while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
    return n;
  }

  // Serialize with each top-level <svg> replaced by a  marker: engines
  // disagree on how to reserialize inline SVG (self-closing vs not), and svg
  // is never editable copy, so it is matched opaquely and the original source
  // bytes are spliced back in on publish.
  var SVG_NS = "http://www.w3.org/2000/svg";
  function cleanSerialize(origEl, level) {
    var clone = origEl.cloneNode(true);
    var origs = [origEl].concat([].slice.call(origEl.querySelectorAll("*")));
    var clones = [clone].concat([].slice.call(clone.querySelectorAll("*")));
    var svgRoots = [];
    for (var i = 0; i < clones.length; i++) {
      var n = clones[i], o = origs[i];
      if (n.namespaceURI === SVG_NS) {
        if (n.parentNode && n.parentNode.namespaceURI !== SVG_NS) svgRoots.push(n);
        continue;
      }
      n.removeAttribute("contenteditable");
      n.removeAttribute("spellcheck");
      for (var j = n.attributes.length - 1; j >= 0; j--) {
        if (n.attributes[j].name.indexOf("data-feincms") === 0) n.removeAttribute(n.attributes[j].name);
      }
      var cls = n.getAttribute("class");
      if (cls) {
        var kept = cls.split(/\s+/).filter(function (t) { return t && !RUNTIME_CLASSES[t]; });
        if (kept.join(" ") !== cls) {
          if (kept.length) n.setAttribute("class", kept.join(" "));
          else n.removeAttribute("class");
        }
      }
      if (n.style && n.style.transitionDelay) n.style.removeProperty("transition-delay");
      if (n.getAttribute("style") === "") n.removeAttribute("style");
      if (o && o.tagName === "DETAILS" && o.__feinForced) n.removeAttribute("open");
      if (level >= 2) {
        n.removeAttribute("aria-expanded");
        n.removeAttribute("aria-current");
        n.removeAttribute("aria-invalid");
        if (n.tagName === "DETAILS") n.removeAttribute("open");
      }
    }
    for (var s = 0; s < svgRoots.length; s++) {
      svgRoots[s].parentNode.replaceChild(clone.ownerDocument.createTextNode(""), svgRoots[s]);
    }
    return clone.outerHTML;
  }

  var escRe = function (s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
  // find a marker key in the source; returns {count, before, chunks}
  // where `before` is the exact source substring and chunks the source svgs
  function findInRaw(key) {
    if (key.indexOf("") === -1) {
      return { count: count(raw, key), before: key, chunks: [] };
    }
    var parts = key.split("");
    var re = new RegExp(parts.map(escRe).join("(<svg[\\s\\S]*?</svg>)"), "g");
    var ms = [], m;
    while ((m = re.exec(raw)) !== null && ms.length < 3) { ms.push(m); re.lastIndex = m.index + 1; }
    if (!ms.length) return { count: 0 };
    return { count: ms.length, before: ms[0][0], chunks: ms[0].slice(1) };
  }

  // rebuild real markup from a marker key + the source svg chunks
  function fillChunks(key, chunks) {
    var parts = key.split("");
    if (parts.length !== chunks.length + 1) return null; // svg structure changed
    var out = parts[0];
    for (var i = 0; i < chunks.length; i++) out += chunks[i] + parts[i + 1];
    return out;
  }

  function labelFor(el) {
    var t = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 42);
    return el.tagName.toLowerCase() + " “" + t + "”";
  }

  // ---- discovery: outermost elements with a direct text child, mapped to source
  function resolve(el) {
    for (var node = el; node && node !== document.body; node = node.parentElement) {
      var k1 = cleanSerialize(node, 1);
      if (k1.length > MAX_ANCHOR) break;
      var r1 = findInRaw(k1);
      if (r1.count === 1) { entries.set(el, { el: el, anchor: node, before: r1.before, chunks: r1.chunks, level: 1 }); return; }
      if (r1.count === 0) {
        var r2 = findInRaw(cleanSerialize(node, 2));
        if (r2.count === 1) { entries.set(el, { el: el, anchor: node, before: r2.before, chunks: r2.chunks, level: 2 }); return; }
        if (r2.count === 0) break; // content diverges from source (script-driven)
      }
      // ambiguous — climb for context
    }
    unmappable.push(el);
  }

  function discover() {
    var all = document.body.querySelectorAll("*");
    var cand = [], seen = new Set();
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
      var tn = el.tagName;
      if (tn === "SCRIPT" || tn === "STYLE") continue;
      if (el.closest("#feincms,#feincms-toast")) continue;
      for (var c = el.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3 && /\S/.test(c.nodeValue)) { cand.push(el); seen.add(el); break; }
      }
    }
    cand.forEach(function (el) {
      for (var a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (seen.has(a)) return; // an ancestor is the editing surface
      }
      resolve(el);
    });
  }

  function findEntry(t) {
    while (t && t !== document.body) {
      if (entries.has(t)) return entries.get(t);
      t = t.parentElement;
    }
    return null;
  }
  function isUnmappable(t) {
    while (t && t !== document.body) {
      if (unmappable.indexOf(t) !== -1) return true;
      t = t.parentElement;
    }
    return false;
  }

  // ---- edit state
  function recompute(entry) {
    var after = fillChunks(cleanSerialize(entry.anchor, entry.level), entry.chunks);
    if (after === null) {
      toast("that edit removed an icon — undo (⌘Z) or discard", true);
      dirty.set(entry.anchor, entry);
      entry.anchor.setAttribute("data-feincms-dirty", "");
      updateBar();
      return;
    }
    if (after === entry.before) {
      dirty.delete(entry.anchor);
      entry.anchor.removeAttribute("data-feincms-dirty");
    } else {
      dirty.set(entry.anchor, entry);
      entry.anchor.setAttribute("data-feincms-dirty", "");
    }
    updateBar();
  }

  function buildPayload() {
    var list = [];
    dirty.forEach(function (entry) { list.push(entry); });
    // an edit nested inside another dirty anchor rides along with the outer one
    var keep = list.filter(function (en) {
      return !list.some(function (other) {
        return other !== en && other.anchor !== en.anchor && other.anchor.contains(en.anchor);
      });
    });
    var out = [];
    keep.forEach(function (en) {
      var after = fillChunks(cleanSerialize(en.anchor, en.level), en.chunks);
      if (after === null || after === en.before) return;
      out.push({ before: en.before, after: after, label: labelFor(en.anchor) });
    });
    return out;
  }

  // ---- details: keep everything visible while editing
  function setDetails(open) {
    var ds = document.querySelectorAll("details");
    for (var i = 0; i < ds.length; i++) {
      var d = ds[i];
      if (open) {
        if (!d.open) { d.__feinForced = true; d.open = true; }
      } else if (d.__feinForced) { d.__feinForced = false; d.open = false; }
    }
  }

  // ---- chrome
  var bar, statusEl, noteEl, modeBtn, discardBtn, publishBtn, toastEl, toastT;

  function injectChrome() {
    var css = document.createElement("style");
    css.textContent =
      "html.feincms-on body{padding-bottom:64px}" +
      "#feincms{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;gap:14px;height:46px;padding:0 18px;background:rgba(0,0,0,.88);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid var(--line,rgba(255,255,255,.09));font-size:12px;color:var(--muted,#8a8f98);font-family:inherit}" +
      "#feincms .fc-brand{color:var(--fg,#ededed);letter-spacing:.08em}" +
      "#feincms .fc-note{color:var(--dim,#63666d);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:34ch}" +
      "#feincms .fc-spacer{flex:1}" +
      "#feincms button{-webkit-appearance:none;appearance:none;background:transparent;border:1px solid var(--line,rgba(255,255,255,.14));color:var(--fg,#ededed);padding:5px 12px;border-radius:6px;cursor:pointer;font:inherit}" +
      "#feincms button[disabled]{opacity:.35;cursor:default}" +
      "#feincms .fc-primary{background:var(--blue,#0070F3);border-color:var(--blue,#0070F3);color:#fff}" +
      "html.feincms-edit [data-feincms-dirty]{outline:1px dotted var(--blue-l,#52A8FF);outline-offset:5px}" +
      "html.feincms-edit [contenteditable]{outline:1.5px solid var(--blue,#0070F3);outline-offset:5px;border-radius:2px}" +
      "html.feincms-edit .fc-hover{outline:1px dashed rgba(255,255,255,.3);outline-offset:5px;cursor:text}" +
      "#feincms-toast{position:fixed;bottom:58px;left:50%;transform:translateX(-50%);z-index:2147483001;background:#111;border:1px solid var(--line,rgba(255,255,255,.14));color:var(--fg,#ededed);padding:8px 14px;border-radius:8px;font-size:12px;max-width:72ch;opacity:0;pointer-events:none;transition:opacity .25s}";
    document.head.appendChild(css);

    bar = document.createElement("div");
    bar.id = "feincms";
    bar.innerHTML =
      '<span class="fc-brand">fein cms</span>' +
      '<span class="fc-status"></span>' +
      '<span class="fc-note"></span>' +
      '<span class="fc-spacer"></span>' +
      '<button id="fc-mode" type="button">browse</button>' +
      '<button id="fc-discard" type="button" disabled>discard</button>' +
      '<button id="fc-publish" type="button" class="fc-primary" disabled>publish</button>' +
      '<button id="fc-hide" type="button" title="Hide the editor for this tab (reload in a new tab to get it back)">hide</button>';
    document.body.appendChild(bar);
    statusEl = bar.querySelector(".fc-status");
    noteEl = bar.querySelector(".fc-note");
    modeBtn = bar.querySelector("#fc-mode");
    discardBtn = bar.querySelector("#fc-discard");
    publishBtn = bar.querySelector("#fc-publish");

    toastEl = document.createElement("div");
    toastEl.id = "feincms-toast";
    document.body.appendChild(toastEl);

    bar.querySelector("#fc-hide").addEventListener("click", function () {
      try { sessionStorage.setItem("feincms-hidden", "1"); } catch (e) {}
      bar.remove(); toastEl.remove();
      document.documentElement.classList.remove("feincms-on", "feincms-edit");
    });

    document.documentElement.classList.add("feincms-on", "feincms-edit");

    modeBtn.addEventListener("click", function () {
      mode = mode === "edit" ? "browse" : "edit";
      modeBtn.textContent = mode === "edit" ? "browse" : "edit";
      document.documentElement.classList.toggle("feincms-edit", mode === "edit");
      setDetails(mode === "edit");
      if (mode === "browse") clearHover();
      updateBar();
    });
    discardBtn.addEventListener("click", function () {
      suppressGuard = true;
      location.reload();
    });
    publishBtn.addEventListener("click", doPublish);
  }

  function updateBar() {
    var n = dirty.size;
    statusEl.textContent = mode === "browse" ? "browsing — switch back to edit" :
      n ? n + " unsaved edit" + (n === 1 ? "" : "s") : "click any text to edit";
    var pend = (state && state.pending) || [];
    noteEl.textContent = pend.length ? "publish also commits pending changes: " + pend.join(", ") : "";
    noteEl.title = noteEl.textContent;
    discardBtn.disabled = !n;
    publishBtn.disabled = !n;
    publishBtn.textContent = state && state.push ? "publish + push" : "publish";
  }

  function toast(msg, sticky) {
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.style.opacity = "0"; }, sticky ? 9000 : 3500);
  }

  var hoverEl = null;
  function clearHover() { if (hoverEl) { hoverEl.classList.remove("fc-hover"); hoverEl = null; } }

  // ---- publish
  function doPublish() {
    var edits = buildPayload();
    if (!edits.length) return;
    publishBtn.disabled = true;
    publishBtn.textContent = "publishing…";
    fetch("/__cms/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits: edits }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) {
        suppressGuard = true;
        try {
          sessionStorage.setItem("feincms-note",
            "published " + (j.commit || "") + (j.pushed ? " · pushed" : j.pushError ? " · push failed: " + j.pushError : ""));
        } catch (e) {}
        location.reload();
      } else {
        updateBar();
        toast(j.issues ? j.issues.map(function (i) { return i.label + ": " + i.issue; }).join(" · ") : (j.error || "publish failed"), true);
      }
    }).catch(function (e) {
      updateBar();
      toast("publish failed: " + e, true);
    });
  }

  // ---- events
  function wireEvents() {
    document.addEventListener("mousedown", function (e) {
      if (mode !== "edit" || bar.contains(e.target)) return;
      var entry = findEntry(e.target);
      if (entry) entry.el.setAttribute("contenteditable", plainOk ? "plaintext-only" : "true");
    }, true);

    document.addEventListener("click", function (e) {
      if (bar.contains(e.target)) return;
      if (mode !== "edit") return;
      var entry = findEntry(e.target);
      if (entry) {
        var link = e.target.closest("a");
        if (link) e.preventDefault();
      } else {
        if (e.target.closest("a[href]")) e.preventDefault();
        if (isUnmappable(e.target)) toast("this text is script-driven — edit it in src/fein.tpl.html");
      }
    }, true);

    document.addEventListener("input", function (e) {
      var entry = findEntry(e.target);
      if (entry) recompute(entry);
    }, true);

    document.addEventListener("focusout", function (e) {
      if (e.target && e.target.removeAttribute && e.target.hasAttribute && e.target.hasAttribute("contenteditable")) {
        e.target.removeAttribute("contenteditable");
        var entry = findEntry(e.target);
        if (entry) recompute(entry);
      }
    }, true);

    document.addEventListener("mouseover", function (e) {
      if (mode !== "edit" || bar.contains(e.target)) return;
      var entry = findEntry(e.target);
      clearHover();
      if (entry && !entry.el.hasAttribute("contenteditable")) {
        hoverEl = entry.el;
        hoverEl.classList.add("fc-hover");
      }
    }, true);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.activeElement && document.activeElement.hasAttribute("contenteditable")) {
        document.activeElement.blur();
      }
    });

    document.addEventListener("submit", function (e) {
      e.preventDefault();
      toast("forms are disabled in the cms preview");
    }, true);

    window.addEventListener("beforeunload", function (e) {
      if (dirty.size && !suppressGuard) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  // ---- boot
  function boot() {
    Promise.all([
      fetch("/__cms/raw").then(function (r) { return r.text(); }),
      fetch("/__cms/state").then(function (r) { return r.json(); }),
    ]).then(function (rs) {
      raw = rs[0];
      state = rs[1];
      discover();
      injectChrome();
      wireEvents();
      setDetails(true);
      updateBar();
      try {
        var note = sessionStorage.getItem("feincms-note");
        if (note) { sessionStorage.removeItem("feincms-note"); toast("✓ " + note); }
      } catch (e) {}
      window.__feincms = {
        entries: entries, unmappable: unmappable, dirty: dirty,
        buildPayload: buildPayload, cleanSerialize: cleanSerialize, labelFor: labelFor,
        findInRaw: findInRaw, fillChunks: fillChunks, recompute: recompute,
      };
    }).catch(function (e) {
      console.error("fein cms failed to boot:", e);
    });
  }

  var hidden = false;
  try { hidden = sessionStorage.getItem("feincms-hidden") === "1"; } catch (e) {}
  if (!hidden) {
    if (document.readyState === "complete") boot();
    else window.addEventListener("load", function () { setTimeout(boot, 50); });
  }
})();
