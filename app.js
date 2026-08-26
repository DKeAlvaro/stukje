"use strict";

const KEY = "stukje.progress.v1";
const CAP = 14;

const $app = document.getElementById("app");

/* ── progress store ───────────────────────────────────────── */
function loadProgress() {
  try { return JSON.parse(localStorage.getItem(KEY)) || { done: {}, last: null }; }
  catch { return { done: {}, last: null }; }
}
function saveProgress() {
  localStorage.setItem(KEY, JSON.stringify(P));
}
let P = loadProgress();

/* ── book parsing ─────────────────────────────────────────── */
const NOISE = /^talkin' the talk$/i;
const REAL = /^(chapter|part|appendix|introduction|minidictionary)/i;

function buildBook(blocks) {
  // cut into raw segments at level<=2 headings
  const segs = [[]];
  for (const b of blocks) {
    if (b.type === "heading" && b.level <= 2) segs.push([]);
    segs[segs.length - 1].push(b);
  }
  const chapters = [];
  let pendingPart = null;
  for (const seg of segs) {
    if (!seg.length) continue;
    const h = seg[0];
    const title =
      h && h.type === "heading" && h.level <= 2 ? h.text : "Introduction";
    // part divider: remember the name, fold its intro blocks into the next chapter
    if (h && h.type === "heading" && h.level === 1) {
      pendingPart = title;
      if (chapters.length && seg.length > 1) {
        chapters[chapters.length - 1].blocks.push(...seg.slice(1));
      }
      continue;
    }
    const isNoise = NOISE.test(title.trim());
    const isRealHead = h && h.type === "heading" && h.level === 2;
    if (
      chapters.length &&
      ((isRealHead && isNoise) || (isRealHead && !REAL.test(title) && seg.length < 10))
    ) {
      chapters[chapters.length - 1].blocks.push(...seg);
      continue;
    }
    chapters.push({ title, part: pendingPart, blocks: [...seg] });
  }

  // strip each chapter's own boundary heading
  for (const ch of chapters) {
    ch.blocks = ch.blocks.filter(
      (b, i) => !(i === 0 && b.type === "heading" && b.level <= 2)
    );
    if (!ch.part) ch.part = "Front matter";
    if (/^(appendix|minidictionary)/i.test(ch.title)) ch.part = "Appendices";
  }

  // lessons inside each chapter
  chapters.forEach((ch, ci) => {
    ch.lessons = splitLessons(ch.blocks);
    ch.lessons.forEach((l, li) => {
      l.id = `c${ci}l${li}`;
      l.chapter = cleanTitle(ch.title);
      l.n = li + 1;
      l.of = ch.lessons.length;
      l.min = Math.max(1, Math.round(l.blocks.length / 6));
    });
    ch.id = `c${ci}`;
  });

  return chapters.filter((c) => c.lessons.length);
}

function cleanTitle(t) {
  return t.replace(/^Chapter \d+:\s*/i, "").replace(/^Chapter \d+\s+/i, "");
}

function deriveTitle(buf) {
  for (const b of buf) {
    if (b.type === "phrase_group" && b.label) return b.label.replace(/:$/, "");
    if (b.type === "phrase" && b.dutch) return b.dutch;
    if (b.type === "table" && b.caption) return b.caption;
    if (b.type === "dialogue" && b.title) return b.title;
    if (b.type === "paragraph" || b.type === "rule" || b.type === "list") {
      const t = (b.text || (b.items && b.items[0]) || "").trim();
      if (t) return t.split(/[.!?]/)[0].slice(0, 42);
    }
  }
  return "More pieces";
}

function splitLessons(blocks) {
  const out = [];
  let title = null;
  let buf = [];

  const flush = () => {
    if (buf.length) out.push({ title: title || deriveTitle(buf), blocks: buf });
    buf = [];
    title = null;
  };

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "heading" && b.level === 3) {
      flush();
      title = b.text;
      continue;
    }
    if (b.type === "heading" && b.level === 4 && !title) title = b.text;
    buf.push(b);
    const next = blocks[i + 1];
    const safeNext =
      next && next.type !== "table" && next.type !== "dialogue" && !next.continues;
    if (buf.length >= CAP + 8 && safeNext) flush();
    else if (buf.length >= CAP && safeNext && !title) flush();
  }
  flush();
  return out;
}

/* ── renderers ────────────────────────────────────────────── */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );

const pronHtml = (p) => (p ? `<div class="pron">(pron. ${esc(p)})</div>` : "");
const transHtml = (t) => (t ? `<div class="trans">${esc(t)}</div>` : "");

function articleClass(word) {
  return /^de\s/i.test(word) ? " article-de" : /^het\s/i.test(word) ? " article-het" : "";
}

function blockHtml(b) {
  switch (b.type) {
    case "heading":
      if (b.level >= 4) return `<section class="block"><h3 class="b-heading4">${esc(b.text)}</h3></section>`;
      return "";
    case "paragraph":
      return `<section class="block"><p class="b-paragraph">${esc(b.text)}</p></section>`;
    case "rule":
      return `<section class="block"><div class="b-rule"><span class="tick">✓</span><p>${esc(b.text)}</p></div></section>`;
    case "list":
      return `<section class="block"><ul class="b-list">${b.items
        .map((it) => `<li><span>${esc(it)}</span></li>`)
        .join("")}</ul></section>`;
    case "callout": {
      const cls = {
        Tip: "co-tip",
        "Grammatically Speaking": "co-grammar",
        "Cultural Wisdom": "co-culture",
        "Audio CD": "co-audio",
      }[b.icon] || "co-audio";
      const label = b.icon || "Note";
      return `<section class="block"><aside class="b-callout ${cls}"><span class="callout-tag">${esc(label)}</span><p>${esc(b.text)}</p></aside></section>`;
    }
    case "phrase":
      return `<section class="block"><div class="b-phrase"><div class="dutch${articleClass(b.dutch)}">${esc(b.dutch)}</div>${pronHtml(b.pronunciation)}${transHtml(b.translation)}</div></section>`;
    case "phrase_group":
    case "decl_list":
      return `<section class="block">${
        b.label ? `<span class="pg-label">${esc(b.label.replace(/:$/, ""))}</span>` : ""
      }<div class="vocab">${(b.phrases || b.items || [])
        .map(
          (p) => `<div class="vocab-row"><div class="dutch${articleClass(p.dutch)}">${esc(p.dutch)}</div>${pronHtml(p.pronunciation)}${transHtml(p.translation)}</div>`
        )
        .join("")}</div></section>`;
    case "dialogue":
      return `<section class="block"><div class="dialogue">${
        b.title ? `<div class="dlg-title">${esc(b.title)}</div>` : ""
      }${b.lines
        .map(
          (l) => `<div class="dlg-line"><div class="avatar">${esc((l.speaker || "?")[0])}</div><div class="dlg-body"><div class="speaker">${esc(l.speaker)}</div><div class="dutch">${esc(l.dutch)}</div>${pronHtml(l.pronunciation)}${transHtml(l.translation)}</div></div>`
        )
        .join("")}</div></section>`;
    case "table":
      return `<section class="block"><div class="tablewrap"><table><thead><tr>${b.columns
        .map((c) => `<th>${esc(c)}</th>`)
        .join("")}</tr></thead><tbody>${b.rows
        .map(
          (r) =>
            `<tr>${b.columns.map((c) => `<td>${esc(r[c])}</td>`).join("")}</tr>`
        )
        .join("")}</tbody></table></div>${
        b.caption ? `<div class="table-cap">${esc(b.caption)}</div>` : ""
      }</section>`;
    default:
      return "";
  }
}

/* ── routing ──────────────────────────────────────────────── */
function navigate(id) {
  const h = id ? `#/${id}` : "#/";
  if (location.hash === h) applyRoute();
  else {
    location.hash = h;
    applyRoute();
  }
}
function applyRoute() {
  const m = (location.hash || "").match(/^#\/(c\d+l\d+)$/);
  if (m && findLesson(m[1])) renderLesson(m[1]);
  else renderHome();
}
window.addEventListener("hashchange", applyRoute);

/* ── views ────────────────────────────────────────────────── */
let BOOK = [];
const MOSAIC_COLORS = ["f-red", "f-blue", "f-yellow", "f-ink"];

function allLessonIds() {
  return BOOK.flatMap((c) => c.lessons.map((l) => l.id));
}

function findLesson(id) {
  for (const c of BOOK) {
    const l = c.lessons.find((x) => x.id === id);
    if (l) return l;
  }
  return null;
}

function getPrevLesson(id) {
  for (let ci = 0; ci < BOOK.length; ci++) {
    const idx = BOOK[ci].lessons.findIndex((l) => l.id === id);
    if (idx !== -1) {
      if (idx > 0) return BOOK[ci].lessons[idx - 1].id;
      if (ci > 0) return BOOK[ci - 1].lessons[BOOK[ci - 1].lessons.length - 1].id;
      return null;
    }
  }
  return null;
}

function mosaicHtml() {
  const ids = allLessonIds();
  const doneCount = ids.filter((id) => P.done[id]).length;
  const cells = ids
    .map((id, i) =>
      `<b class="${P.done[id] ? MOSAIC_COLORS[i % 4] : ""}"></b>`
    )
    .join("");
  const pct = Math.round((doneCount / ids.length) * 100);
  return `<div class="mosaic-wrap"><div class="mosaic" role="img" aria-label="${doneCount} of ${ids.length} lessons read">${cells}</div><div class="mosaic-stat"><strong>${pct}%</strong><span class="eyebrow">read</span></div></div>`;
}

function findLast() {
  if (!P.last) return null;
  for (const c of BOOK) {
    const l = c.lessons.find((x) => x.id === P.last);
    if (l) return l;
  }
  return null;
}

function renderHome() {
  viewHome();
}
function viewHome() {
  document.querySelector('meta[name="theme-color"]').content = "#FAFAF7";
  const last = findLast();
  const total = BOOK.reduce((n, c) => n + c.lessons.length, 0);
  const doneCount = Object.keys(P.done).length;

  const partsMap = new Map();
  BOOK.forEach((ch) => {
    if (!partsMap.has(ch.part)) partsMap.set(ch.part, []);
    partsMap.get(ch.part).push(ch);
  });

  let toc = "";
  [...partsMap.entries()].forEach(([part, chs], pi) => {
    toc += `<section class="part"><h2 class="part-title">${esc(part)}</h2>`;
    chs.forEach((ch) => {
      const dn = ch.lessons.filter((l) => P.done[l.id]).length;
      const frac = ch.lessons.length ? dn / ch.lessons.length : 0;
      toc += `<button class="chapter ${dn === ch.lessons.length ? "done" : ""}" data-ch="${ch.id}">
        <span class="ch-body"><h3>${esc(cleanTitle(ch.title))}</h3>
        <span class="meta">${ch.lessons.length} pieces · ${dn} read</span></span>
        <span class="ch-bar"><i style="transform:scaleX(${frac})"></i></span>
      </button>`;
    });
    toc += `</section>`;
  });

  $app.innerHTML = `<main class="home">
    <header class="masthead">
      <div class="wordmark">Stuk<i>j</i>e</div>
      <span class="eyebrow">Nederlands</span>
    </header>
    <section class="hero">
      <h1>Dutch,<br>one piece<br>at a time<span>.</span></h1>
      <p>The whole book, chopped into ${total} bite-size pieces. Read one, tick it off, come back tomorrow.</p>
      ${mosaicHtml()}
      ${
        last
          ? `<button class="continue" data-go="${last.id}">
              <span class="go">→</span>
              <span class="eyebrow">Continue</span>
              <h2>${esc(last.title)}</h2>
              <span class="meta">${esc(last.chapter)} · piece ${last.n} of ${last.of} · ~${last.min} min</span>
            </button>`
          : `<button class="continue" data-go="${BOOK[0].lessons[0].id}">
              <span class="go">→</span>
              <span class="eyebrow">Start here</span>
              <h2>${esc(BOOK[0].lessons[0].title)}</h2>
              <span class="meta">${esc(BOOK[0].lessons[0].chapter)} · ~${BOOK[0].lessons[0].min} min</span>
            </button>`
      }
    </section>
    <nav class="toc">
      <span class="eyebrow">Contents · ${doneCount}/${total} pieces read</span>
      ${toc}
    </nav>
    <footer class="footer-note">
      <span>Progress lives on this device.</span>
      <button class="linklike" id="reset">Reset progress</button>
    </footer>
  </main>`;
}

function squaresHtml(l) {
  const ch = BOOK.find((c) => c.lessons.some((x) => x.id === l.id));
  const n = ch.lessons.length;
  if (n > 12) {
    const doneCount = ch.lessons.filter((x) => P.done[x.id]).length;
    const hereIdx = ch.lessons.findIndex((x) => x.id === l.id);
    const pct = Math.round(((hereIdx + 1) / n) * 100);
    const donePct = Math.round((doneCount / n) * 100);
    return `<div class="top-compact" aria-hidden="true"><span class="top-compact-label">${l.n} / ${n}</span><div class="top-compact-track" role="progressbar" aria-valuenow="${hereIdx + 1}" aria-valuemin="1" aria-valuemax="${n}"><i style="width:${donePct}%"></i><i class="here-marker" style="left:${pct}%"></i></div></div>`;
  }
  return `<div class="squares" aria-hidden="true">${ch.lessons
    .map(
      (x) =>
        `<b class="${P.done[x.id] ? "on" : ""}${x.id === l.id ? " here" : ""}"></b>`
    )
    .join("")}</div>`;
}

let currentLesson = null;

function renderLesson(id) {
  viewLesson(id);
}
function viewLesson(id) {
  let lesson = null;
  let ci = -1;
  BOOK.forEach((c, i) => {
    const l = c.lessons.find((x) => x.id === id);
    if (l) { lesson = l; ci = i; }
  });
  if (!lesson) return viewHome();

  currentLesson = lesson;
  P.last = id;
  saveProgress();

  const ch = BOOK[ci];
  const nextL = ch.lessons[lesson.n] || BOOK[ci + 1]?.lessons[0] || null;
  const alreadyDone = !!P.done[id];

  document.querySelector('meta[name="theme-color"]').content = "#16130F";
  window.scrollTo(0, 0);

  $app.innerHTML = `<main class="lesson">
    <header class="lesson-top">
      <div class="top-row">
        <button class="back" data-home aria-label="Back to contents">←</button>
        <div class="top-label">
          <div class="crumb">${esc(ch.part)} › ${esc(cleanTitle(ch.title))}</div>
          <div class="pos">Piece ${lesson.n} of ${lesson.of} · ~${lesson.min} min</div>
        </div>
        ${squaresHtml(lesson)}
      </div>
    </header>
    <div class="lesson-title">
      <span class="eyebrow kicker">Piece ${lesson.n}${alreadyDone ? " · already read" : ""}</span>
      <h1>${esc(lesson.title)}</h1>
    </div>
    <div class="blocks">${lesson.blocks.map(blockHtml).join("")}</div>
  </main>
  <div class="bottombar"><div class="bottombar-inner">
    <button class="btn-next ${alreadyDone ? "" : "btn-done"}" data-next="${
      nextL ? nextL.id : ""
    }" data-cur="${id}">
      <span>${nextL ? (alreadyDone ? "Next piece" : "Read it → next") : "Finish book"}</span>
      <span class="arrow">→</span>
    </button>
  </div></div>
  <div class="toast" id="toast"></div>`;

  bindSwipe();
}

function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1600);
}

function advance(curId, nextId) {
  const first = !P.done[curId];
  P.done[curId] = true;
  saveProgress();
  if (nextId) {
    navigate(nextId);
    if (first)
      setTimeout(
        () => toast(`Piece ticked off · ${allLessonIds().filter((i) => P.done[i]).length} done`),
        120
      );
  } else {
    navigate(null);
    setTimeout(() => toast("Book finished. Goed gedaan!"), 120);
  }
}

/* ── swipe ────────────────────────────────────────────────── */
function bindSwipe() {
  const main = $app.querySelector(".lesson");
  if (!main) return;
  let x0 = null, y0 = null;
  main.addEventListener("touchstart", (e) => {
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  main.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) {
      if (dx < 0) {
        // slide left → previous (as you reported)
        const prev = getPrevLesson(currentLesson.id);
        if (prev) navigate(prev);
        else navigate(null);
      } else {
        // slide right → next
        const btn = $app.querySelector("[data-next]");
        if (btn && btn.dataset.next) advance(btn.dataset.cur, btn.dataset.next);
      }
    }
  }, { passive: true });
}

/* ── events ───────────────────────────────────────────────── */
  $app.addEventListener("click", (e) => {
  const go = e.target.closest("[data-go], [data-next]");
  if (go) {
    if (go.hasAttribute("data-go")) return navigate(go.dataset.go);
    return advance(go.dataset.cur, go.dataset.next);
  }
  if (e.target.closest("[data-home]")) {
    navigate(null);
    return;
  }
  const chapBtn = e.target.closest(".chapter");
  if (chapBtn) {
    const ch = BOOK.find((c) => c.id === chapBtn.dataset.ch);
    if (!ch) return;
    const target = ch.lessons.find((l) => !P.done[l.id]) || ch.lessons[0];
    navigate(target.id);
  }
  if (e.target.closest("#reset")) {
    if (confirm("Erase all reading progress?")) {
      P = { done: {}, last: null };
      saveProgress();
      renderHome();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (!currentLesson || !$app.querySelector(".lesson")) return;
  const btn = $app.querySelector("[data-next]");
  if (e.key === "ArrowRight" && btn && btn.dataset.next) advance(btn.dataset.cur, btn.dataset.next);
  if (e.key === "ArrowLeft") {
    const prev = getPrevLesson(currentLesson.id);
    if (prev) navigate(prev);
    else navigate(null);
  }
});

/* ── boot ─────────────────────────────────────────────────── */
async function boot() {
  const res = await fetch("data.json");
  const blocks = await res.json();

  // chapter numbers for display
  BOOK = buildBook(blocks);
  let n = 0;
  BOOK.forEach((c) => {
    if (/^chapter/i.test(c.title)) { n++; c.num = String(n); }
    else if (/^appendix/i.test(c.title)) c.num = c.title.match(/appendix\s+(\w+)/i)?.[1] || "A";
    else if (/minidictionary/i.test(c.title)) c.num = "M";
    else if (/introduction/i.test(c.title)) c.num = "i";
  });

  // deep-linkable, respects Android back button
  applyRoute();
}
boot();
