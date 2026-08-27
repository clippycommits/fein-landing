/* fein.vc — the homepage is one Claude Code session: replayed, then live.
 *
 * Replay: two questions are typed at the prompt and answered. Then the prompt
 * is live, and 1/2/3 run one short conversation each against the lead
 * functions in /api:
 *   1  Book a call         name, email, fund, the problem, then a time from
 *                          Daniel's calendar (/api/slots) booked straight into
 *                          cal.com (/api/book). If the calendar cannot be read
 *                          or the visitor wants another time, the same answers
 *                          go to /api/enquiry and the booking link arrives by
 *                          email, the way the old form worked.
 *   2  Information pack    email -> /api/subscribe
 *   3  Ask a question      question, email -> /api/message
 * Every POST carries `t` (ms since the page opened) and an empty `website`,
 * which the functions' time gate and honeypot expect from a real visitor.
 * Any key or click during the replay skips to the end; reduced-motion skips
 * it too. Without JavaScript the static transcript in index.html stands. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Touch devices get the visible prompt row and tap-first boxes. The head
  // script sets the class from (pointer: coarse); ?coarse forces it for tests.
  const coarse = document.documentElement.classList.contains("coarse");
  const T0 = Date.now();
  let fast = reduce, ready = false;
  const sleep = (ms) => (fast ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

  const T = $("#transcript"), typed = $("#typed"), cur = $("#cur"), input = $("#input");
  if (!T || !input) return;
  const names = JSON.parse($("#clients-data").textContent);
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  const COPY = {
    q1: "what does fein do?",
    a1: [
      "fein is a small group of software engineers for hire. We work on the problems in venture capital that nobody has solved yet, across the US, Europe and the Middle East.",
      "We build the infrastructure, analytics and agents behind how a fund sources deals, runs diligence, tracks its portfolio, raises capital and reports to LPs.",
    ],
    q2: "who have you worked with?",
    hi: "Ask about fein, or tap a question below.",
    ask: "Have a problem in your fund that nobody has solved yet?",
    options: ["Book a call", "Receive an information pack", "Ask a question"],
  };
  const CALL_STEPS = [
    { key: "name", ask: "Your name?" },
    { key: "email", ask: "Work email?", email: true },
    { key: "fund", ask: "Fund or firm?" },
    { key: "note", ask: "What's the problem? (all that apply)", optional: true, multi: true,
      choices: [
        "Deal sourcing and pipeline",
        "Diligence",
        "Portfolio data and monitoring",
        "LP reporting and fundraising",
        "AI agents on the fund's own data",
      ],
      other: "Something else" },
  ];
  const PACK_STEPS = [{ key: "email", ask: "Work email?", email: true }];
  const QUESTION_STEPS = [
    { key: "note", ask: "Your question?" },
    { key: "email", ask: "Where should the answer go? (work email)", email: true },
  ];

  /* ---- rendering ----------------------------------------------------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const scroll = () => { T.scrollTop = T.scrollHeight; };
  const reveal = (d) => {
    if (d.offsetHeight > T.clientHeight - 8) T.scrollTop = d.getBoundingClientRect().top - T.getBoundingClientRect().top + T.scrollTop - 4;
    else scroll();
  };
  const el = (cls, html) => { const d = document.createElement("div"); d.className = "turn " + cls; d.innerHTML = html; T.appendChild(d); reveal(d); return d; };
  const userTurn = (t) => el("user", `<span class="chev">›</span><div class="body">${esc(t)}</div>`);
  const aiTurn = (html) => el("ai", `<span class="dot">●</span><div class="body">${html}</div>`);
  const toolTurn = (fn, arg) => el("ai tool", `<span class="dot">●</span><div class="body"><span class="fn">${esc(fn)}</span><span class="muted">(${esc(arg)})</span></div>`);
  const resultTurn = (html) => el("result", `<span class="elbow">⎿</span><div class="body">${html}</div>`);
  const linkText = (u) => esc(String(u).replace(/^https?:\/\//, ""));
  const mailto = (subject) => `<a href="mailto:sales@fein.vc${subject ? `?subject=${encodeURIComponent(subject)}` : ""}">sales@fein.vc</a>`;

  function spinner(label) {
    const d = el("spin", `<span class="dot">·</span><div class="body muted">${esc(label)}</div>`);
    const g = ["·", "✢", "✶", "✻", "✽"];
    let i = 0;
    const iv = setInterval(() => { d.firstChild.textContent = g[++i % g.length]; }, 90);
    return () => { clearInterval(iv); d.remove(); };
  }
  async function think(ms, label = "Thinking…") {
    if (fast) return;
    const stop = spinner(label);
    await sleep(ms);
    stop();
  }
  // The assistant's own words arrive typed, two characters a tick.
  async function typeInto(el, text, ms = 8) {
    if (fast) { el.textContent = text; return; }
    el.classList.add("typing");
    for (let i = 2; i <= text.length && !fast; i += 2) { el.textContent = text.slice(0, i); scroll(); await sleep(ms); }
    el.textContent = text;
    el.classList.remove("typing");
  }
  async function typePrompt(text, ms = 30) {
    const show = (t) => { typed.textContent = t; if (coarse) input.value = t; };
    for (let i = 1; i <= text.length && !fast; i++) { show(text.slice(0, i)); await sleep(ms); }
    show(text);
    await sleep(180);
    show("");
  }

  // `ls`-style columns: fill down, then across, as many columns as fit.
  function lsGrid(items) {
    const probe = document.createElement("span");
    probe.textContent = "x".repeat(20);
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
    T.appendChild(probe);
    const chW = probe.getBoundingClientRect().width / 20 || 8;
    probe.remove();
    const width = Math.floor(T.clientWidth / chW) - 3;
    const longest = Math.max(...items.map((s) => s.length));
    const cols = Math.max(1, Math.floor((width + 2) / (longest + 2)));
    // One column would be a wall; a narrow terminal gets `ls -m`, comma-wrapped.
    if (cols === 1) return `<div class="lsm">${items.map((it) => `<span class="pending">${esc(it)}</span>`).join(", ")}</div>`;
    const rows = Math.ceil(items.length / cols);
    const cells = [];
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++) {
        const it = items[c * rows + r];
        cells.push(it === undefined ? "<span></span>" : `<span class="pending">${esc(it)}</span>`);
      }
    return `<div class="ls" style="grid-template-rows: repeat(${rows}, auto)">${cells.join("")}</div>`;
  }

  /* ---- the prompt: menus and short forms ------------------------------ */
  let state = "intro"; // intro | idle | menu | form | busy
  const chips = $("#chips");
  const setState = (v) => { state = v; if (chips) chips.hidden = !(coarse && v === "idle"); };
  let menu = null, mainMenu = null, form = null, sel = 0;
  const sync = () => {
    if (state === "menu" && menu?.multi) {
      if (input.value && sel !== menu.otherIndex) select(menu.otherIndex);
      const row = rowsOf(menu)[menu.otherIndex];
      row.querySelector(".free").textContent = input.value;
      row.classList.toggle("on", !!input.value);
      typed.textContent = "";
      return;
    }
    typed.textContent = input.value;
  };
  const clear = () => { input.value = ""; sync(); };
  const focus = () => { if (!coarse) input.focus({ preventScroll: true }); };
  const focusHard = () => input.focus({ preventScroll: true });
  const hintFor = (h) => (coarse ? h.replace(/enter to select · ↑↓ to move( · 1–3 to jump)?/, "tap to choose").replace(/space or a number to tick · type for something else · enter when done/, "tap to tick · type for something else · Done when finished") : h);
  const placeholder = (t) => { input.placeholder = t; };

  // A select box. Single: enter or a number picks one (onPick). Multi: space
  // or a number toggles, the last label is "something else" and takes typed
  // text on its own line, a "Done" row (or enter) confirms (onDone).
  function openMenu(question, labels, hint, onPick, opts = {}) {
    const multi = !!opts.multi;
    const rows = labels.map((l, i) => {
      const other = multi && i === labels.length - 1;
      return `<div class="opt" data-i="${i}"><span class="chev">❯</span><span class="lbl">${multi ? '<span class="box"></span>' : ""}${i + 1}. ${esc(l)}${other ? '<span class="free"></span>' : ""}</span></div>`;
    });
    if (multi) rows.push(`<div class="opt go" data-i="${labels.length}"><span class="chev">❯</span><span class="lbl">↵ Done</span></div>`);
    const box = aiTurn(`<div class="ask"><div class="q">${esc(question)}</div><div class="opts">${rows.join("")}</div><div class="hint">${esc(hintFor(hint))}</div></div>`).querySelector(".ask");
    menu = { box, labels, onPick, multi, otherIndex: multi ? labels.length - 1 : -1, doneIndex: multi ? labels.length : -1, checked: new Set(), onDone: opts.onDone };
    setState("menu");
    select(0);
    placeholder(multi ? "Something else…" : "tap an option, or type here");
    if (coarse && !multi) input.blur(); // put the keyboard away while choosing
    return menu;
  }
  function arm(m) { menu = m; setState("menu"); select(0); }
  const rowsOf = (m) => $$(".opt", m.box);
  function select(n) {
    if (!menu) return;
    const rows = rowsOf(menu);
    sel = (n + rows.length) % rows.length;
    rows.forEach((e, i) => e.classList.toggle("sel", i === sel));
  }
  function toggle(i) {
    if (!menu?.multi || i === menu.doneIndex) return;
    if (i === menu.otherIndex) { select(i); focusHard(); return; }
    if (menu.checked.has(i)) menu.checked.delete(i); else menu.checked.add(i);
    rowsOf(menu)[i].classList.toggle("on", menu.checked.has(i));
    select(i);
  }
  function confirmMulti() {
    const m = menu;
    const picks = [...m.checked].sort((a, b) => a - b).map((i) => m.labels[i]);
    const text = input.value.trim();
    if (text) picks.push(text);
    clear();
    m.box.classList.add("done");
    menu = null; setState("busy");
    resultTurn(picks.length ? esc(picks.join(" · ")) : "(skipped)");
    m.onDone(picks.length ? picks.join("; ") : null);
  }
  function pick(i) {
    const m = menu;
    select(i);
    resultTurn(esc(m.labels[i]));
    m.box.classList.add("done");
    menu = null;
    setState("busy");
    m.onPick(i);
  }

  function startForm(steps, onDone) { form = { steps, i: 0, answers: {}, onDone }; setState("form"); askStep(); }
  function askStep() {
    const s = form.steps[form.i];
    input.inputMode = s.email ? "email" : "text";
    if (!s.choices) { placeholder(s.ask.replace(/\s*\(.*\)$/, "")); return aiTurn(esc(s.ask)); }
    // A step with choices is a select box; the last choice, or just typing,
    // gives a free answer.
    const f = form;
    if (s.multi) {
      openMenu(s.ask, [...s.choices, s.other], "space or a number to tick · type for something else · enter when done", null,
        { multi: true, onDone: (v) => { form = f; accept(v); } });
      return;
    }
    const m = openMenu(s.ask, s.choices, "enter to select · ↑↓ to move · or type your own", (i) => {
      form = f;
      if (s.other && i === s.choices.length - 1) { setState("form"); aiTurn(esc(s.other)); return; }
      accept(s.choices[i]);
    });
    m.free = (v) => { form = f; m.box.classList.add("done"); userTurn(v); accept(v); };
  }
  // Free text at the prompt, for the current step.
  function answer(v) {
    const s = form.steps[form.i];
    if (!v && !s.optional) return resultTurn("required");
    if (v && s.email && !EMAIL_RE.test(v)) { userTurn(v); return resultTurn("that doesn't look like an email, try again"); }
    userTurn(v || "(skipped)");
    accept(v || null);
  }
  function accept(v) {
    form.answers[form.steps[form.i].key] = v;
    form.i += 1;
    if (form.i < form.steps.length) return askStep();
    const f = form;
    form = null; setState("busy"); input.inputMode = "text";
    f.onDone(f.answers);
  }
  function cancel() {
    // esc: out of a form, or out of a sub-menu (the time picker), back to 1/2/3
    if (state !== "form" && !(state === "menu" && menu && menu !== mainMenu)) return;
    resultTurn("cancelled");
    form = null; input.inputMode = "text";
    if (menu && menu !== mainMenu) menu.box.classList.add("done");
    idle();
  }
  function idle() {
    if (mainMenu) { arm(mainMenu); placeholder("tap an option, or type here"); return; }
    setState("idle");
    placeholder("ask fein…");
    if (coarse) input.blur();
  }
  function done() {
    aiTurn(`Anything else? <span class="muted">${mainMenu ? "1 · 2 · 3" : "tap below"}</span>`);
    idle();
  }

  async function api(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ ...body, website: "", t: Date.now() - T0 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.error || `error ${r.status}`);
      e.retry = !!j.retry; e.fallback = j.fallback ?? null;
      throw e;
    }
    return j;
  }

  /* ---- 1  book a call --------------------------------------------------- */
  function bookCall() {
    startForm(CALL_STEPS, async (a) => {
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
      let rounds = 0;
      const offerTimes = async () => {
        const stop = spinner("Reading Daniel's calendar…");
        let data = { slots: [], fallback: null };
        try { data = await fetch(`/api/slots?tz=${encodeURIComponent(tz)}`).then((r) => r.json()); } catch { /* fall through */ }
        stop();
        if (!data.slots?.length) return emailTheLink(a, data.fallback);
        toolTurn("Read", "calendar");
        resultTurn(`${data.slots.length} open times · ${esc(data.tz || tz)}`);
        openMenu("Pick a time.", [...data.slots.map((s) => s.label), "Another time"], "enter to select · ↑↓ to move", async (i) => {
          if (i >= data.slots.length) return emailTheLink(a, data.fallback);
          const s = data.slots[i];
          const stop2 = spinner("Booking…");
          try {
            const r = await api("/api/book", { name: a.name, email: a.email, fund: a.fund, note: a.note, start: s.start, token: s.token, tz });
            stop2();
            aiTurn(`Booked: <b>${esc(r.when)}</b> (${esc(r.tz)}), twenty minutes${r.meetingUrl ? " on Google Meet" : ""}. The invite is on its way to ${esc(a.email)}.`);
            resultTurn(`cal.com · ${esc(r.uid || "booked")}`);
            done();
          } catch (e) {
            stop2();
            resultTurn(esc(e.message));
            if (e.retry && rounds++ < 2) return offerTimes();
            return emailTheLink(a, e.fallback || data.fallback);
          }
        });
      };
      await offerTimes();
    });
  }
  // The calendar could not be read, or they want a time we did not offer:
  // the answers go the way the old form went, and the booking link arrives
  // by email within a minute.
  async function emailTheLink(a, link) {
    const stop = spinner("Sending…");
    const [first, ...rest] = String(a.name || "").trim().split(/\s+/);
    try {
      await api("/api/enquiry", { first, last: rest.join(" ") || null, email: a.email, fund: a.fund, ask: a.note, source: "terminal" });
      stop();
      aiTurn(`Sent. Daniel's calendar link is on its way to ${esc(a.email)}, pick any time that suits.`);
      resultTurn(link ? `or book now: <a href="${esc(link)}" target="_blank" rel="noopener">${linkText(link)}</a>` : "POST /api/enquiry · 200");
    } catch (e) {
      stop();
      aiTurn(`That didn't send (${esc(e.message)}). Write to ${mailto("A call with Daniel")}${link ? ` or book at <a href="${esc(link)}" target="_blank" rel="noopener">${linkText(link)}</a>` : ""}.`);
    }
    done();
  }

  /* ---- 2  information pack ---------------------------------------------- */
  function infoPack() {
    startForm(PACK_STEPS, async (a) => {
      const stop = spinner("Sending…");
      try {
        await api("/api/subscribe", { email: a.email, intent: "info-pack" });
        stop();
        aiTurn(`Sent. The pack is on its way to ${esc(a.email)}.`);
        resultTurn("POST /api/subscribe · 200");
      } catch (e) {
        stop();
        aiTurn(`That didn't send (${esc(e.message)}). Write to ${mailto("Information pack")}.`);
      }
      done();
    });
  }

  /* ---- 3  ask a question ------------------------------------------------ */
  function askQuestion() {
    startForm(QUESTION_STEPS, async (a) => {
      const stop = spinner("Sending…");
      try {
        await api("/api/message", { email: a.email, message: a.note, page: "terminal" });
        stop();
        aiTurn(`Noted. Daniel will answer at ${esc(a.email)}.`);
        resultTurn("POST /api/message · 200");
      } catch (e) {
        stop();
        aiTurn(`That didn't send (${esc(e.message)}). Write to ${mailto()}.`);
      }
      done();
    });
  }

  /* ---- slash commands ----------------------------------------------------- */
  const MENU_HINT = "enter to select · ↑↓ to move · 1–3 to jump";
  const contactMenu = () => openMenu(COPY.ask, COPY.options, MENU_HINT, (i) => [bookCall, infoPack, askQuestion][i]());
  const COMMANDS = {
    // /contact: the address, and the 1/2/3 menu again
    contact() {
      aiTurn(`Write to ${mailto()}, or pick one below.`);
      if (coarse) { contactMenu(); return; }
      if (mainMenu) mainMenu.box.classList.add("done");
      mainMenu = contactMenu();
    },
  };
  // A line starting with "/" is a command. Returns true when it was handled.
  function command(text) {
    const m = /^\/(\w+)/.exec(text);
    if (!m) return false;
    const run = COMMANDS[m[1].toLowerCase()];
    userTurn(text);
    if (!run) { aiTurn(`No such command. Try <b>/contact</b>.`); return true; }
    if (menu) menu.box.classList.add("done");
    menu = null; setState("busy");
    run();
    return true;
  }

  /* ---- input -------------------------------------------------------------- */
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (!ready) { fast = true; return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const v = input.value;
    if (e.key === "Escape") { clear(); cancel(); return; }
    if (state === "menu" && menu.multi) {
      const onOther = sel === menu.otherIndex;
      if (e.key === "ArrowDown" || e.key === "Tab") { select(sel + 1); e.preventDefault(); return; }
      if (e.key === "ArrowUp") { select(sel - 1); e.preventDefault(); return; }
      if (e.key === "Enter") { e.preventDefault(); confirmMulti(); return; }
      if (!onOther || !v) {
        if (e.key === " ") { e.preventDefault(); if (sel === menu.doneIndex) confirmMulti(); else toggle(sel); return; }
        if (!v && /^[1-9]$/.test(e.key) && +e.key <= menu.labels.length) { e.preventDefault(); toggle(+e.key - 1); return; }
      }
      if (e.key.length === 1 && !onOther) select(menu.otherIndex); // typing is "something else"
      return;
    }
    if (state === "menu") {
      const n = menu.labels.length;
      if (e.key === "ArrowDown" || (e.key === "j" && !v)) { select(sel + 1); e.preventDefault(); return; }
      if (e.key === "ArrowUp" || (e.key === "k" && !v)) { select(sel - 1); e.preventDefault(); return; }
      if (!v && /^[1-9]$/.test(e.key) && +e.key <= n) { e.preventDefault(); pick(+e.key - 1); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        if (!v.trim()) return pick(sel);
        const text = v.trim();
        clear();
        if (menu.free) { const m = menu; menu = null; setState("busy"); return m.free(text); }
        if (command(text)) return;
        userTurn(text);
        aiTurn(`Best answered on a call: press <b>1</b>, or write to ${mailto()}.`);
      }
      return;
    }
    if (state === "idle" && e.key === "Enter") {
      e.preventDefault();
      const text = v.trim();
      if (!text) return;
      clear();
      if (command(text)) return;
      userTurn(text);
      aiTurn(`Best answered on a call: tap <b>book a call</b> below, or write to ${mailto()}.`);
      return;
    }
    if (state === "form" && e.key === "Enter") { e.preventDefault(); const val = v.trim(); clear(); answer(val); return; }
    if (state === "busy" && e.key === "Enter") e.preventDefault();
  });
  document.addEventListener("pointerdown", (e) => {
    if (!ready) { fast = true; return; }
    const opt = e.target.closest(".opt");
    if (opt && state === "menu" && menu && menu.box.contains(opt)) {
      e.preventDefault();
      const i = +opt.dataset.i;
      if (!menu.multi) { pick(i); if (state === "form") focusHard(); else focus(); return; }
      if (i === menu.doneIndex) confirmMulti(); else toggle(i);
      return;
    }
    if (e.target.closest("#send")) { e.preventDefault(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); return; }
    if (e.target.closest(".prompt")) { focusHard(); return; }  // a tap on the prompt opens the keyboard
    if (!e.target.closest("a")) focus();
  });
  T.addEventListener("mouseover", (e) => {
    const opt = e.target.closest(".opt");
    if (opt && state === "menu" && menu && menu.box.contains(opt)) select(+opt.dataset.i);
  });
  document.addEventListener("keydown", (e) => {
    if (ready && document.activeElement !== input && !e.metaKey && !e.ctrlKey && !e.target.closest("a")) focus();
  });

  // On a phone the keyboard covers the bottom of the layout viewport; size the
  // terminal to what is actually visible so the prompt stays in view.
  if (window.visualViewport) {
    const term = $(".term");
    const fit = () => { term.style.height = `${Math.round(visualViewport.height)}px`; window.scrollTo(0, 0); scroll(); };
    visualViewport.addEventListener("resize", fit);
    visualViewport.addEventListener("scroll", () => window.scrollTo(0, 0));
  }

  /* ---- the two answers ----------------------------------------------------- */
  async function sayWhat() {
    await typePrompt(COPY.q1); userTurn(COPY.q1);
    await think(700);
    const first = aiTurn("<p></p><p></p>");
    for (const [i, p] of $$("p", first).entries()) await typeInto(p, COPY.a1[i]);
  }
  async function sayWho() {
    await typePrompt(COPY.q2); userTurn(COPY.q2);
    await think(550);
    toolTurn("Bash", "ls clients/");
    const r = resultTurn(lsGrid(names));
    for (const cell of $$(".pending", r)) { cell.classList.remove("pending"); await sleep(12); }
  }

  // On a phone the questions are chips above the prompt: each sends itself.
  const ACTIONS = {
    what: async () => { await sayWhat(); idle(); },
    who: async () => { await sayWho(); idle(); },
    call: () => { userTurn("book a call"); bookCall(); focusHard(); },
    pack: () => { userTurn("information pack"); infoPack(); focusHard(); },
    ask: () => { userTurn("ask a question"); askQuestion(); focusHard(); },
  };
  $$(".chip").forEach((ch) => ch.addEventListener("click", () => {
    if (state !== "idle") return;
    ch.classList.add("used");
    setState("busy");
    ACTIONS[ch.dataset.act]?.();
  }));

  /* ---- the replay ----------------------------------------------------------- */
  async function run() {
    $$(".static", T).forEach((n) => n.remove());
    if (coarse) {
      await sleep(300);
      await typeInto($("p", aiTurn("<p></p>")), COPY.hi, 10);
    } else {
      await sleep(400);
      await sayWhat();
      await sleep(600);
      await sayWho();
      await sleep(500);
      await think(550);
      mainMenu = contactMenu();
    }
    ready = true;
    fast = reduce; // a tap that skipped the intro should not skip everything after it
    clear(); cur.classList.add("blink"); focus();
    idle();
  }
  run();
})();
