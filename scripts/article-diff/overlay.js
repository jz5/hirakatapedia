/**
 * 開発サーバーの記事のページに差し込む、本番との差分の表示（scripts/article-diff/integration.mjs が配る）。
 * 本番の同じページ（/__diff/base/<path>）を読み込み、題名・本文・脚注を段落（ブロック）ごとに比べて、表示の上に印を付ける。
 *   足したブロック：緑の枠 / 消したブロック：赤の点線（本番の表示のまま差し込む） / 書き換えたブロック：黄の線と、字の単位の印
 *   別の場所へ動かしたブロック：青の枠（中身も変えていれば、字の単位の印）
 * まとめ・箇条書き・表・関連リンク・脚注は、項目（li・tr）ごとに比べる。
 * 脚注は番号でなく名前（#user-content-fn-<名前>）で照らし合わせる（脚注が増えて番号がずれても、変更とみなさない）。
 * fonts-lab の scripts/article-diff-overlay.js をもとにした。diff は外のライブラリを使わず、ここで LCS を取る。
 */

const OFF_KEY = "adiff-off";

const CSS = `
.adiff-add { outline: 3px solid #2a8a44; outline-offset: 4px; background: color-mix(in srgb, #2a8a44 10%, transparent); }
.adiff-mod { box-shadow: -10px 0 0 -4px #d19a00; }
.adiff-del { outline: 3px dashed #c33; outline-offset: 4px; background: color-mix(in srgb, #c33 10%, transparent); opacity: .75; }
.adiff-move { outline: 3px solid #2a6fd1; outline-offset: 4px; background: color-mix(in srgb, #2a6fd1 8%, transparent); }
.adiff-hide-del .adiff-del { display: none !important; }
ins.adiff { background: color-mix(in srgb, #2a8a44 35%, transparent); text-decoration: none; }
del.adiff { background: color-mix(in srgb, #c33 30%, transparent); }
.adiff-add, .adiff-mod, .adiff-del, .adiff-move { scroll-margin-top: 20vh; }
.adiff-meta { margin: .5rem 0 1rem; padding: .5rem .75rem; border-left: 4px solid #d19a00; background: #d19a0014; font-size: .875rem; }
.adiff-meta b { display: block; font-size: .8rem; color: #8a6700; }
#adiff-panel { position: fixed; z-index: 10000; right: 18px; bottom: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  max-width: min(32rem, calc(100vw - 36px)); padding: 8px 12px; border-radius: 8px; font: 13px/1.4 system-ui, sans-serif;
  background: #222; color: #eee; box-shadow: 0 4px 16px #0006; }
#adiff-panel button { font: inherit; padding: 2px 10px; border-radius: 4px; border: 1px solid #666; background: #333; color: #eee; cursor: pointer; }
#adiff-panel a { color: #9cf; } #adiff-panel label { color: #eee; }
#adiff-panel ol { flex-basis: 100%; max-height: 40vh; overflow: auto; margin: 0 0 4px; padding: 0 0 0 2.4em; color: #eee; font-size: 12px; }
#adiff-panel li { cursor: pointer; padding: 1px 4px; border-radius: 3px; }
#adiff-panel li:hover, #adiff-panel li.on { background: #444; }
#adiff-panel .a { color: #7d7; } #adiff-panel .m { color: #fc6; } #adiff-panel .d { color: #f88; } #adiff-panel .v { color: #8bf; }
#adiff-rail { position: fixed; z-index: 9999; top: 0; right: 0; width: 10px; height: 100vh; background: #8882; }
#adiff-rail button { position: absolute; left: 0; width: 10px; padding: 0; border: 0; cursor: pointer; }
#adiff-rail .a { background: #2a8a44; } #adiff-rail .m { background: #d19a00; } #adiff-rail .d { background: #c33; } #adiff-rail .v { background: #2a6fd1; }
.adiff-current { animation: adiff-flash 1.2s ease-out; }
@keyframes adiff-flash { from { box-shadow: 0 0 0 8px #d19a0099; } }
.adiff-dot { display: inline-block; width: 7px; height: 7px; margin-left: 6px; border-radius: 50%; background: #d19a00; vertical-align: middle; }
`;

// ---- diff（LCS） ----

/** a と b の LCS をとり、jsdiff と同じ形 [{ value: [...], added?, removed? }] で返す。大きすぎるときは全部入れ替えとする */
function diffArrays(a, b, eq = (x, y) => x === y) {
  // 前後の一致を先に外す
  let s = 0;
  while (s < a.length && s < b.length && eq(a[s], b[s])) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && eq(a[ea - 1], b[eb - 1])) (ea--, eb--);
  const out = [];
  const push = (value, kind) => {
    if (!value.length) return;
    const last = out.at(-1);
    if (last && !!last.added === (kind === "add") && !!last.removed === (kind === "del")) last.value.push(...value);
    else out.push({ value: [...value], added: kind === "add", removed: kind === "del" });
  };
  push(a.slice(0, s), "same");
  const A = a.slice(s, ea);
  const B = b.slice(s, eb);
  const n = A.length;
  const m = B.length;
  if (n && m && n * m <= 6_000_000) {
    const w = m + 1;
    const L = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i * w + j] = eq(A[i], B[j]) ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (eq(A[i], B[j])) (push([A[i]], "same"), i++, j++);
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) (push([A[i]], "del"), i++);
      else (push([B[j]], "add"), j++);
    }
    push(A.slice(i), "del");
    push(B.slice(j), "add");
  } else {
    push(A, "del");
    push(B, "add");
  }
  push(a.slice(ea), "same");
  return out.map((p) => ({ ...p, count: p.value.length }));
}

/** 似ている度合い（2 字ずつの組の重なり。0〜1） */
function similarity(a, b) {
  if (a === b) return 1;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let common = 0;
  for (const [g, c] of ga) common += Math.min(c, gb.get(g) ?? 0);
  return (2 * common) / (Math.max(a.length - 1, 0) + Math.max(b.length - 1, 0) || 1);
}

// ---- ブロック ----

/** 比べる単位のブロックを並べる */
function blocks(doc) {
  const out = [];
  const h1 = doc.querySelector("article.entry .entry-header h1");
  if (h1) out.push(h1);
  const body = doc.querySelector("article.entry .entry-body");
  if (!body) return out;
  const walk = (el) => {
    if (el.matches("script, style, template")) return;
    if (el.matches("section.summary, section.link-cards, section.footnotes")) {
      for (const c of el.children) walk(c);
    } else if (el.matches("ul, ol")) {
      for (const li of el.children) out.push(li);
    } else if (el.matches("table") || el.querySelector(":scope > table")) {
      const t = el.matches("table") ? el : el.querySelector(":scope > table");
      for (const tr of t.querySelectorAll("tr")) out.push(tr);
    } else out.push(el);
  };
  for (const el of body.children) walk(el);
  return out;
}

/** ブロックを比べるための文字列。脚注の参照の番号・戻るリンク・画像のファイル名のハッシュは除く */
function key(el) {
  const c = el.cloneNode(true);
  for (const a of c.querySelectorAll("a[data-footnote-ref]"))
    a.textContent = `[^${decodeURIComponent(a.getAttribute("href") ?? "").replace("#user-content-fn-", "")}]`;
  for (const a of c.querySelectorAll("a[data-footnote-backref]")) a.remove();
  for (const img of c.querySelectorAll("img"))
    img.replaceWith(`[img ${img.getAttribute("alt") ?? ""} ${(img.getAttribute("src") ?? "").split("/").pop()?.split(/[-.]/)[0]}]`);
  return `${el.tagName}|${el.id || ""}|${c.textContent.replace(/\s+/g, " ").trim()}`;
}

// ---- 段落の中の字の差分 ----

/** HTML を、脚注の参照（まとめて 1 つ）・タグ・英数字の語・1 字に分ける */
function tokens(html) {
  const re = /<sup[^>]*>\s*<a[^>]*data-footnote-ref[^>]*>[\s\S]*?<\/a>\s*<\/sup>|<[^>]+>|&[#\w]+;|[A-Za-z0-9_]+|\s+|[\s\S]/g;
  return html.match(re) ?? [];
}
const isTag = (t) => t.startsWith("<");
/** 比べるときの形。脚注の参照は名前だけ、タグは開発サーバーが付ける data-astro-* を外す */
const tokKey = (t) =>
  t.startsWith("<sup")
    ? `FN:${/href="([^"]+)"/.exec(t)?.[1]}`
    : isTag(t)
      ? t.replace(/\s+data-astro-[\w-]+="[^"]*"/g, "")
      : t;

/** 変更後の HTML に、足した字 <ins> と消した字 <del> を書き込む（タグは変更後のものだけを使う） */
function inlineDiff(oldHtml, newHtml) {
  const parts = diffArrays(tokens(oldHtml), tokens(newHtml), (a, b) => tokKey(a) === tokKey(b));
  // 変更の間に挟まった短い一致（タグを除いて 2 字以下）は、変更に含める
  for (let i = 1; i < parts.length - 1; i++) {
    const p = parts[i];
    if (p.added || p.removed) continue;
    const text = p.value.filter((t) => !isTag(t)).join("");
    if (text.length <= 2 && !p.value.some((t) => t.startsWith("<sup"))) p.both = true;
  }
  let out = "";
  let del = "";
  let ins = [];
  const flush = () => {
    if (del.trim()) out += `<del class="adiff">${del}</del>`;
    // 続いた字は 1 つの <ins> にまとめる（タグはそのまま出す）
    let run = "";
    for (const t of ins) {
      if (isTag(t) && !t.startsWith("<sup")) {
        if (run) out += `<ins class="adiff">${run}</ins>`;
        run = "";
        out += t;
      } else run += t;
    }
    if (run) out += `<ins class="adiff">${run}</ins>`;
    del = "";
    ins = [];
  };
  for (const p of parts) {
    if (p.removed) del += p.value.filter((t) => !isTag(t)).join("");
    else if (p.added) ins.push(...p.value);
    else if (p.both) {
      del += p.value.filter((t) => !isTag(t)).join("");
      ins.push(...p.value);
    } else {
      flush();
      out += p.value.join("");
    }
  }
  flush();
  return out;
}

const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- 本体 ----

async function main() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);

  const panel = document.createElement("div");
  panel.id = "adiff-panel";
  document.body.append(panel);

  // 「隠す」を押したページでは、印を付けずにボタンだけ出す（タブを閉じるまで）
  if (sessionStorage.getItem(OFF_KEY)) {
    panel.innerHTML = `<button>本番との差分を出す</button>`;
    panel.querySelector("button").addEventListener("click", () => {
      sessionStorage.removeItem(OFF_KEY);
      location.reload();
    });
    return;
  }
  panel.innerHTML = `<span>本番と比べています…</span>`;

  const res = await fetch(`/__diff/base${location.pathname}`);
  if (!res.ok) {
    panel.innerHTML = `<span>${res.status === 404 ? "本番にないページ（新しい記事）" : `本番のページを読めませんでした（${res.status}）`}</span><a href="/__diff/">変わった記事の一覧</a>`;
    return;
  }
  const baseDoc = new DOMParser().parseFromString(await res.text(), "text/html");
  const before = blocks(baseDoc);
  // 変更後も、サイトのスクリプトが手を入れる前の HTML で比べる。印は表示中のページに付ける
  const headDoc = new DOMParser().parseFromString(await (await fetch(location.href)).text(), "text/html");
  const live = blocks(document);
  let after = blocks(headDoc);
  if (after.length !== live.length) after = live;
  const L = (el) => live[after.indexOf(el)] ?? el;
  const marks = [];
  let nAdd = 0;
  let nMod = 0;
  let nDel = 0;
  let nMove = 0;
  const ghosts = []; // [本番のブロック, 差し込んだ削除の印]
  const added = []; // [変更後のブロック, 表示中のブロック]

  // description（ホームの一覧と検索結果に出る文）の変更は、題名の下に出す
  const desc = (d) => d.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  const dBase = desc(baseDoc);
  const dHead = desc(headDoc);
  if (dBase !== dHead) {
    const box = document.createElement("div");
    box.className = "adiff-meta adiff-mod";
    box.innerHTML = `<b>description（ホームの一覧・検索結果に出る文）</b>${inlineDiff(escHtml(dBase), escHtml(dHead))}`;
    document.querySelector("article.entry .entry-header")?.append(box);
    marks.push(box);
    nMod++;
  }

  const changes = diffArrays(before.map(key), after.map(key));
  let bi = 0;
  let ai = 0;
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    if (!c.added && !c.removed) {
      bi += c.count;
      ai += c.count;
      continue;
    }
    const dels = c.removed ? before.slice(bi, bi + c.count) : [];
    if (c.removed) bi += c.count;
    let adds = [];
    if (c.added) {
      adds = after.slice(ai, ai + c.count);
      ai += c.count;
    } else if (changes[i + 1]?.added) {
      const nx = changes[++i];
      adds = after.slice(ai, ai + nx.count);
      ai += nx.count;
    }
    // 消したブロックを、最も似ている足したブロックと組にする（順序を保つ）
    let j = 0;
    const anchorAfter = adds[0] ?? after[ai];
    for (const d of dels) {
      let best = -1;
      let score = 0.5;
      for (let k = j; k < adds.length; k++) {
        const s = similarity(key(d), key(adds[k]));
        if (s >= score) [best, score] = [k, s];
      }
      if (best >= 0) {
        for (; j < best; j++) (L(adds[j]).classList.add("adiff-add"), marks.push(L(adds[j])), added.push([adds[j], L(adds[j])]), nAdd++);
        const a = L(adds[best]);
        a.innerHTML = inlineDiff(d.innerHTML, adds[best].innerHTML);
        a.classList.add("adiff-mod");
        marks.push(a);
        nMod++;
        j = best + 1;
      } else {
        const ghost = document.importNode(d, true);
        ghost.removeAttribute("id");
        for (const x of ghost.querySelectorAll("[id]")) x.id = `adiff-${x.id}`;
        ghost.classList.add("adiff-del");
        ghost.title = "本番にあって、手元にないブロック";
        const at = adds[j] ?? anchorAfter;
        if (at) L(at).before(ghost);
        else (live.at(-1) ?? document.querySelector("article.entry .entry-body"))?.after(ghost);
        marks.push(ghost);
        ghosts.push([d, ghost]);
        nDel++;
      }
    }
    for (; j < adds.length; j++) (L(adds[j]).classList.add("adiff-add"), marks.push(L(adds[j])), added.push([adds[j], L(adds[j])]), nAdd++);
  }

  // 別の場所へ動かしたブロック（削除と追加で、中身がほとんど同じもの）は「移動」にまとめる
  for (const [d, ghost] of ghosts) {
    const kd = key(d).replace(/^[^|]*\|[^|]*\|/, "");
    let best = -1;
    let score = 0.8;
    added.forEach(([a, el], k) => {
      if (!el.classList.contains("adiff-add")) return;
      const s = similarity(kd, key(a).replace(/^[^|]*\|[^|]*\|/, ""));
      if (s >= score) [best, score] = [k, s];
    });
    if (best < 0) continue;
    const [a, el] = added[best];
    el.classList.replace("adiff-add", "adiff-move");
    el.title = "本番では別の場所にあったブロック";
    if (score < 1) el.innerHTML = inlineDiff(d.innerHTML, a.innerHTML);
    ghost.remove();
    marks.splice(marks.indexOf(ghost), 1);
    nAdd--;
    nDel--;
    nMove++;
  }

  // 表示の順に並べ直す
  marks.sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const kindOf = (el) =>
    el.classList.contains("adiff-add") ? "a" : el.classList.contains("adiff-del") ? "d" : el.classList.contains("adiff-move") ? "v" : "m";
  const KIND = { a: "追加", m: "変更", d: "削除", v: "移動" };
  const snippet = (el) => el.textContent.replace(/\s+/g, " ").trim().slice(0, 40) || "（画像など）";

  if (!marks.length) {
    panel.innerHTML = `<span>本番と同じ</span><a href="/__diff/">変わった記事の一覧</a><button title="このタブでは差分を出さない">隠す</button>`;
    panel.querySelector("button").addEventListener("click", () => (sessionStorage.setItem(OFF_KEY, "1"), location.reload()));
    return;
  }

  // 変更のある場所へ移動する（前後のボタン・一覧・右端の印・キー n / j と p / k）
  let cur = -1;
  const jump = (n) => {
    marks[cur]?.classList.remove("adiff-current");
    cur = (n + marks.length) % marks.length;
    const el = marks[cur];
    if (el.classList.contains("adiff-del") && document.body.classList.contains("adiff-hide-del")) {
      document.body.classList.remove("adiff-hide-del");
      panel.querySelector("input[type=checkbox]").checked = true;
      drawRail();
    }
    void el.offsetWidth; // 同じ箇所でも、光らせ直す
    el.classList.add("adiff-current");
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    counter.textContent = `${cur + 1}/${marks.length}`;
    items.forEach((li, k) => li.classList.toggle("on", k === cur));
  };

  panel.innerHTML = `<ol hidden></ol><button class="t" title="変更の一覧">本番との差分 <span class="a">追加 ${nAdd}</span> <span class="m">変更 ${nMod}</span> <span class="d">削除 ${nDel}</span>${nMove ? ` <span class="v">移動 ${nMove}</span>` : ""} ▴</button>
    <button data-d="-1" title="前の変更（p / k）">↑</button><span class="n">–/${marks.length}</span><button data-d="1" title="次の変更（n / j）">↓</button>
    <label><input type="checkbox" checked> 削除を表示</label><a href="/__diff/">一覧</a><button class="x" title="このタブでは差分を出さない">隠す</button>`;
  const counter = panel.querySelector(".n");
  const list = panel.querySelector("ol");
  const items = marks.map((el, k) => {
    const li = document.createElement("li");
    const t = kindOf(el);
    const tag = document.createElement("span");
    tag.className = t;
    tag.textContent = `${KIND[t]} `;
    li.append(tag, snippet(el));
    li.addEventListener("click", () => jump(k));
    list.append(li);
    return li;
  });
  const next = () => jump(cur + 1);
  const prev = () => jump(cur < 0 ? -1 : cur - 1);
  panel.querySelector("button.t").addEventListener("click", () => {
    list.hidden = !list.hidden;
    items[cur]?.scrollIntoView({ block: "nearest" });
  });
  panel.querySelector("button.x").addEventListener("click", () => (sessionStorage.setItem(OFF_KEY, "1"), location.reload()));
  for (const b of panel.querySelectorAll("button[data-d]")) b.addEventListener("click", b.dataset.d === "1" ? next : prev);
  panel.querySelector("input[type=checkbox]").addEventListener("change", (e) => {
    document.body.classList.toggle("adiff-hide-del", !e.target.checked);
    drawRail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
    if (e.key === "n" || e.key === "j") next();
    else if (e.key === "p" || e.key === "k") prev();
  });

  // 画面の右端に、変更の位置の印を並べる（押すとそこへ移動）
  const rail = document.createElement("div");
  rail.id = "adiff-rail";
  document.body.append(rail);
  function drawRail() {
    rail.replaceChildren();
    const h = document.documentElement.scrollHeight;
    marks.forEach((el, k) => {
      if (!el.offsetParent && getComputedStyle(el).position !== "fixed") return; // 隠した削除
      const r = el.getBoundingClientRect();
      const tick = document.createElement("button");
      tick.className = kindOf(el);
      tick.style.top = `${((r.top + scrollY) / h) * 100}%`;
      tick.style.height = `max(4px, ${(r.height / h) * 100}%)`;
      tick.title = `${KIND[kindOf(el)]}：${snippet(el)}`;
      tick.addEventListener("click", () => jump(k));
      rail.append(tick);
    });
  }
  drawRail();
  addEventListener("resize", drawRail);
  addEventListener("load", drawRail);
  setTimeout(drawRail, 1500); // 画像やフォントの読み込みで高さが変わる

  // 目次で、変更を含む節に印を付ける
  const heads = [...document.querySelectorAll("article.entry .entry-body :is(h2, h3)[id]")];
  const changed = new Set();
  for (const el of marks) {
    const h = heads.filter((x) => x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1);
    if (h) changed.add(h.id);
  }
  for (const a of document.querySelectorAll(".toc a[href^='#']")) {
    if (!changed.has(decodeURIComponent(a.getAttribute("href").slice(1)))) continue;
    const dot = document.createElement("span");
    dot.className = "adiff-dot";
    dot.title = "この節に変更がある";
    a.append(dot);
  }

  // 脚注の吹き出し（src/components/ArticleBody.astro）は、書き換えた段落と削除の段落では消えるので、ここで出す。
  // 削除の段落の脚注は本番のページから引く
  const tip = document.querySelector(".footnote-tip");
  if (tip) {
    let timer;
    const hide = () => (timer = setTimeout(() => (tip.hidden = true), 200));
    const show = (ref) => {
      clearTimeout(timer);
      const id = decodeURIComponent(ref.hash.slice(1));
      const li = (ref.closest(".adiff-del") && baseDoc.getElementById(id)) || document.getElementById(id);
      if (!li) return;
      const body = li.cloneNode(true);
      body.querySelectorAll("[data-footnote-backref]").forEach((a) => a.remove());
      tip.innerHTML = body.innerHTML;
      tip.hidden = false;
      const r = ref.getBoundingClientRect();
      const w = tip.offsetWidth;
      tip.style.left = `${Math.max(8, Math.min(r.left + scrollX - w / 2, scrollX + document.documentElement.clientWidth - w - 8))}px`;
      const below = r.bottom + 6 + tip.offsetHeight <= innerHeight;
      tip.style.top = `${below ? r.bottom + scrollY + 6 : r.top + scrollY - tip.offsetHeight - 6}px`;
    };
    document.addEventListener("mouseover", (e) => {
      const ref = e.target.closest?.(":is(.adiff-mod, .adiff-del, .adiff-move) a[data-footnote-ref]");
      if (ref) show(ref);
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest?.(":is(.adiff-mod, .adiff-del, .adiff-move) a[data-footnote-ref]")) hide();
    });
  }
}

main();
