/**
 * 写真ギャラリー（/gallery/）の一覧。/gallery/index/meta.json と /gallery/index/<n>.json（5,000 枚ずつ）を読んで、
 * 検索・絞り込み・並べ替え・ページ送り・地図。10 万枚でも動くように：
 *  - 一覧のデータは分けて順に読む。最初のファイルが来たら、そこまでで表示する（残りは読みながら表示し直す）
 *  - 1 ページに PER 枚。ページは URL（?p=）に入れる
 *  - 地図は近い点をまとめる（gallery-map.ts）
 * 絞り込みは URL（?q=…&g=…&d=…&l=…&s=…&p=…）に入れる。人に送れるように、写真のページの「場所」「分類」のリンクから来られるように。
 * 写真を押したときは、いまの並び（絞り込んだ結果）を sessionStorage に置く。写真のページの「前・次」は、その並びでたどる
 */
type Row = [id: string, cap: string, year: number | null, groups: number[], places: number[], lat: number | null, lon: number | null, author: number, lic: "pd" | "by" | "sa" | "nd", site: number, ratio: number];
interface Meta {
  total: number;
  chunks: number;
  groups: string[];
  places: string[];
  authors: string[];
  sites: string[];
}

const PER = 120;
const norm = (s: unknown) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
const kana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const thumbOf = (id: string) => `/gallery/i/${id.slice(0, 2)}/${id}-s.avif`;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

export async function startGallery() {
  const root = document.querySelector<HTMLElement>("[data-gallery]");
  if (!root) return;
  const $ = <T extends Element>(s: string) => root.querySelector<T>(s)!;
  const $q = $<HTMLInputElement>("[data-q]"), $g = $<HTMLSelectElement>("[data-g]"), $d = $<HTMLSelectElement>("[data-d]");
  const $l = $<HTMLSelectElement>("[data-l]"), $s = $<HTMLSelectElement>("[data-s]");
  const $geo = $<HTMLInputElement>("[data-geo]"), $sort = $<HTMLSelectElement>("[data-sort]");
  const $count = $<HTMLElement>("[data-count]"), $grid = $<HTMLElement>("[data-grid]"), $pager = $<HTMLElement>("[data-pager]");
  const $mapBtn = $<HTMLButtonElement>("[data-mapbtn]"), $map = $<HTMLElement>("[data-map]");
  const $view = $<HTMLSelectElement>("[data-view]"), $size = $<HTMLSelectElement>("[data-tile]"), $years = $<HTMLInputElement>("[data-years]");

  // 見せ方（元の比率・正方形、大きさ、年の見出し）は、この人のブラウザに覚えておく
  const setView = () => {
    $grid.classList.toggle("is-ratio", $view.value === "ratio");
    $grid.dataset.size = $size.value;
  };
  $view.value = store.get("gallery-view") === "square" ? "square" : "ratio";
  $size.value = ["s", "m", "l", "xl"].includes(store.get("gallery-size") ?? "") ? store.get("gallery-size")! : "m";
  $years.checked = store.get("gallery-years") === "1";
  setView();

  // URL の絞り込みから始める
  const u = new URLSearchParams(location.search);
  $q.value = u.get("q") ?? "";
  $g.value = u.get("g") ?? "";
  $d.value = u.get("d") ?? "";
  $l.value = u.get("l") ?? "";
  $s.value = u.get("s") ?? "";
  let page = Math.max(1, Number(u.get("p")) || 1);

  let meta: Meta;
  const rows: Row[] = [];
  const keys: string[] = [];
  let loading = true;
  let mapOn = false;
  let mapP: Promise<{ show: (r: Row[]) => void }> | null = null;
  let list: Row[] = [];

  try {
    const r = await fetch("/gallery/index/meta.json");
    if (!r.ok) throw new Error(String(r.status));
    meta = await r.json();
  } catch {
    $count.textContent = "写真の一覧を読み込めませんでした。";
    return;
  }
  const groupIdx = new Map(meta.groups.map((g, i) => [g, i]));

  const matched = () => {
    const words = kana(norm($q.value)).split(/[\s　]+/).filter(Boolean);
    const g = groupIdx.get($g.value) ?? -1, d = $d.value === "none" ? -1 : Number($d.value), l = $l.value, site = meta.sites.indexOf($s.value), geo = $geo.checked;
    const out: Row[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if ($g.value && !r[3].includes(g)) continue;
      if (d === -1 ? r[2] !== null : d && !(r[2] !== null && r[2] >= d && r[2] < d + 10)) continue;
      if (l && !(l === "free" ? r[8] === "pd" || r[8] === "by" : r[8] === l)) continue;
      if ($s.value && r[9] !== site) continue;
      if (geo && r[5] === null) continue;
      if (words.length && !words.every((w) => keys[i].includes(w))) continue;
      out.push(r);
    }
    // 既定の並び（データの並び）が「撮影日の新しい順」
    if ($sort.value === "old") out.reverse();
    if ($sort.value === "name") out.sort((a, b) => a[1].localeCompare(b[1], "ja"));
    return out;
  };

  const pages = () => Math.max(1, Math.ceil(list.length / PER));
  const pagerHtml = () => {
    const n = pages();
    if (n <= 1) return "";
    const nums = new Set([1, n, page - 2, page - 1, page, page + 1, page + 2].filter((x) => x >= 1 && x <= n));
    const sorted = [...nums].sort((a, b) => a - b);
    let html = `<button type="button" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>← 前へ</button>`;
    sorted.forEach((x, i) => {
      if (i > 0 && x - sorted[i - 1] > 1) html += `<span class="gallery-pager-gap">…</span>`;
      html += `<button type="button" data-page="${x}" ${x === page ? 'aria-current="page"' : ""}>${x.toLocaleString()}</button>`;
    });
    return html + `<button type="button" data-page="${page + 1}" ${page >= n ? "disabled" : ""}>次へ →</button>`;
  };

  const render = () => {
    list = matched();
    page = Math.min(page, pages());
    const years = $years.checked && $sort.value !== "name";
    let last: number | null | undefined;
    $grid.innerHTML = list
      .slice((page - 1) * PER, page * PER)
      .map(
        (r) =>
          (years && r[2] !== last
            ? ((last = r[2]), `<li class="gallery-fill" aria-hidden="true"></li><li class="gallery-year"><h3>${r[2] ? `${r[2]}年` : "撮影年不明"}</h3></li>`)
            : "") +
          `<li style="--r:${r[10] || 1}"><a href="/gallery/${r[0]}/" title="${esc(r[1])}"><img src="${thumbOf(r[0])}" alt="${esc(r[1])}" loading="lazy" decoding="async" width="240" height="240"><span class="gallery-cap"><span class="gallery-cap-t">${esc(r[1])}</span>${r[2] ? `<small>${r[2]}年</small>` : ""}</span></a></li>`,
      )
      .join("");
    const total = loading ? meta.total : rows.length;
    const now = list.length === rows.length && !loading ? `${total.toLocaleString()} 枚` : `${list.length.toLocaleString()} 枚（全 ${total.toLocaleString()} 枚）`;
    $count.textContent = (pages() > 1 ? `${now}・${page.toLocaleString()} / ${pages().toLocaleString()} ページ` : now) + (loading ? `・読み込み中（${rows.length.toLocaleString()} 枚まで）` : "");
    $pager.innerHTML = pagerHtml();
    $map.hidden = !mapOn;
    if (mapOn) {
      mapP ??= import("./gallery-map").then((m) => m.makeGalleryMap($map));
      mapP.then((m) => m.show(list));
    }
  };
  const syncUrl = () => {
    const p = new URL(location.href);
    const set: [string, string][] = [["q", $q.value], ["g", $g.value], ["d", $d.value], ["l", $l.value], ["s", $s.value], ["p", page > 1 ? String(page) : ""]];
    for (const [k, v] of set) v ? p.searchParams.set(k, v) : p.searchParams.delete(k);
    history.replaceState(null, "", p);
  };
  const refresh = () => {
    page = 1;
    render();
    syncUrl();
  };

  $mapBtn.addEventListener("click", () => {
    mapOn = !mapOn;
    $mapBtn.setAttribute("aria-pressed", String(mapOn));
    $mapBtn.textContent = mapOn ? "地図を閉じる" : "地図で見る";
    render();
  });
  let timer = 0;
  $q.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(refresh, 200);
  });
  for (const el of [$g, $d, $l, $s, $geo, $sort]) el.addEventListener("change", refresh);
  $years.addEventListener("change", () => {
    store.set("gallery-years", $years.checked ? "1" : "0");
    render();
  });
  for (const el of [$view, $size])
    el.addEventListener("change", () => {
      store.set("gallery-view", $view.value);
      store.set("gallery-size", $size.value);
      setView();
    });
  $pager.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (!b || b.disabled) return;
    page = Number(b.dataset.page);
    render();
    syncUrl();
    $grid.scrollIntoView({ block: "start" });
  });
  // 写真を押したら、いまの並びを写真のページに渡す（前・次でたどれるように）
  $grid.addEventListener("click", (e) => {
    if (!(e.target as HTMLElement).closest("a")) return;
    try {
      sessionStorage.setItem("gallery-ctx", JSON.stringify({ back: location.pathname + location.search, ids: list.map((r) => r[0]) }));
    } catch {}
  });

  // 一覧のデータを順に読む。最初のファイルが来たら表示し、残りは読みながら表示し直す
  for (let n = 0; n < meta.chunks; n++) {
    let chunk: Row[];
    try {
      const r = await fetch(`/gallery/index/${n}.json`);
      if (!r.ok) throw new Error(String(r.status));
      chunk = await r.json();
    } catch {
      $count.textContent = "写真の一覧を読み込めませんでした。";
      return;
    }
    for (const r of chunk) {
      rows.push(r);
      keys.push(kana(norm([r[1], ...r[3].map((i) => meta.groups[i]), ...r[4].map((i) => meta.places[i]), meta.authors[r[7]]].join(" "))));
    }
    loading = n < meta.chunks - 1;
    render();
  }
}
