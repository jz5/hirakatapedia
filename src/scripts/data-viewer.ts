/**
 * データのページ（/data/<id>/）の表と地図。1 ページに 1 つのデータ。
 * public/opendata/<id>.json（scripts/opendata-data.py が作る）を読んで、検索・絞り込み・並べ替えをする。
 * 検索の言葉は URL（?q=…）に入れる。人に「これ見て」と送れるように。
 * 地図（Leaflet と地理院タイル）は「地図で見る」を押したときにだけ読み込む。
 * ごみ（data-layout="list"）は表ではなく、品名・出し方・注意を縦に並べる。
 */

type ColType = "text" | "num" | "flag" | "long" | "hidden" | "lat" | "lon";
interface DataSet {
  id: string;
  title: string;
  columns: [string, ColType][];
  filters: string[];
  /** 絞り込みの選び方を決めておくもの。[出す名前, 含む言葉]。含むかどうかで見る */
  filterOptions?: Record<string, [string, string][]>;
  search: string[];
  sort?: [string, "asc" | "desc"];
  rows: (string | number | null)[][];
}

const PAGE = 100;

const norm = (s: unknown) => String(s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, "");
// ひらがなとカタカナを同じに扱う（「アイス」でも「あいす」でも引ける）
const kana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** 注意書きの中の URL を押せるリンクにする（esc したあとの文字に使う） */
const linkify = (html: string) => html.replace(/https?:\/\/[^\s<>"）)、。]+/g, (u) => `<a href="${u}" rel="noopener">${u.replace(/^https?:\/\/(www\.)?/, "")}</a>`);
/** Google マップで、その緯度・経度にピンを立てて開く（Maps URLs。API キーは要らない） */
const gmap = (lat: unknown, lon: unknown) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

export async function startViewer() {
  const root = document.querySelector<HTMLElement>("[data-viewer]");
  if (!root) return;
  const id = root.dataset.viewer!;
  const list = root.dataset.layout === "list";
  const $q = root.querySelector<HTMLInputElement>("[data-q]")!;
  const $filters = root.querySelector<HTMLElement>("[data-filters]")!;
  const $count = root.querySelector<HTMLElement>("[data-count]")!;
  const $out = root.querySelector<HTMLElement>("[data-out]")!;
  const $more = root.querySelector<HTMLButtonElement>("[data-more]")!;
  const $mapBtn = root.querySelector<HTMLButtonElement>("[data-mapbtn]");
  const $map = root.querySelector<HTMLElement>("[data-map]");

  // 読み込みが終わる前に押されたボタンも受け付けて、読み込みのあとで反映する
  let mapOn = false;
  let wantSort: [string, "asc" | "desc"] | null = null;
  let refresh = () => {};
  let applySort = () => {};
  const setMapBtn = () => {
    if (!$mapBtn) return;
    $mapBtn.setAttribute("aria-pressed", String(mapOn));
    $mapBtn.textContent = mapOn ? "地図を閉じる" : "地図で見る";
  };
  $mapBtn?.addEventListener("click", () => {
    mapOn = !mapOn;
    setMapBtn();
    refresh();
  });
  // 例のボタン：その言葉で検索するか、その列で並べ替える
  for (const b of document.querySelectorAll<HTMLButtonElement>(".data-example")) {
    b.addEventListener("click", () => {
      if (b.dataset.exampleQ !== undefined) $q.value = b.dataset.exampleQ;
      if (b.dataset.exampleSort) {
        const [c, dir] = b.dataset.exampleSort.split(":");
        wantSort = [c, dir === "desc" ? "desc" : "asc"];
      }
      applySort();
      refresh();
    });
  }

  let ds: DataSet;
  try {
    const r = await fetch(`/opendata/${id}.json`);
    if (!r.ok) throw new Error(String(r.status));
    ds = await r.json();
  } catch {
    $count.textContent = "データを読み込めませんでした。";
    return;
  }
  const idx: Record<string, number> = Object.fromEntries(ds.columns.map((c, i) => [c[0], i]));
  // 行ごとの検索用の文字
  const searchKeys = ds.rows.map((r) => kana(norm(ds.search.map((c) => r[idx[c]]).join(" "))));
  let sortCol = ds.sort ? idx[ds.sort[0]] : -1;
  let sortDir: 1 | -1 = ds.sort?.[1] === "desc" ? -1 : 1;
  let shown = PAGE;
  const filterVals: Record<string, string> = {};
  let mapP: Promise<{ show: (rows: DataSet["rows"], ds: DataSet) => void }> | null = null;

  const la = ds.columns.findIndex((c) => c[1] === "lat");
  const lo = ds.columns.findIndex((c) => c[1] === "lon");
  const hasGeo = la >= 0 && lo >= 0;
  const visibleCols = ds.columns.map((c, i) => [c, i] as const).filter(([c]) => !["hidden", "lat", "lon"].includes(c[1]));

  const syncUrl = () => {
    const u = new URL(location.href);
    $q.value ? u.searchParams.set("q", $q.value) : u.searchParams.delete("q");
    history.replaceState(null, "", u);
  };

  /** 検索と絞り込みに合う行（並べ替え済み） */
  const matched = () => {
    const q = kana(norm($q.value));
    const words = q ? q.split(/[\s　]+/).filter(Boolean) : [];
    let rows = ds.rows.filter((r, i) => {
      for (const [col, v] of Object.entries(filterVals)) {
        if (!v) continue;
        const cellV = String(r[idx[col]] ?? "");
        if (ds.filterOptions?.[col] ? !cellV.includes(v) : cellV !== v) return false;
      }
      return words.every((w) => searchKeys[i].includes(w));
    });
    if (sortCol >= 0) {
      const t = ds.columns[sortCol][1];
      rows = [...rows].sort((a, b) => {
        const x = a[sortCol], y = b[sortCol];
        if (x === null || x === "") return 1;
        if (y === null || y === "") return -1;
        return (t === "num" ? Number(x) - Number(y) : String(x).localeCompare(String(y), "ja")) * sortDir;
      });
    }
    return rows;
  };

  const cell = (v: unknown, t: ColType) => {
    if (v === null || v === "") return "";
    if (t === "num") return Number(v).toLocaleString("ja-JP", { maximumFractionDigits: 2 });
    if (t === "flag") return v === "有" ? "○" : esc(v);
    return esc(v);
  };

  const renderTable = (rows: DataSet["rows"]) => {
    const head =
      `<thead><tr>` +
      visibleCols
        .map(([c, i]) => {
          const cur = i === sortCol ? (sortDir === 1 ? "ascending" : "descending") : "none";
          return `<th scope="col" aria-sort="${cur}" class="t-${c[1]}"><button type="button" data-sort="${i}">${esc(c[0])}<span class="sort-mark" aria-hidden="true">${cur === "ascending" ? "▲" : cur === "descending" ? "▼" : ""}</span></button></th>`;
        })
        .join("") +
      (hasGeo ? `<th scope="col">地図</th>` : "") +
      `</tr></thead>`;
    const body = rows
      .slice(0, shown)
      .map(
        (r) =>
          `<tr>` +
          visibleCols.map(([c, i]) => `<td class="t-${c[1]}">${cell(r[i], c[1])}</td>`).join("") +
          (hasGeo ? `<td>${r[la] ? `<a href="${gmap(r[la], r[lo])}" rel="noopener" target="_blank">地図</a>` : ""}</td>` : "") +
          `</tr>`,
      )
      .join("");
    $out.innerHTML = `<div class="table-wrap data-table-wrap"><table class="data-table">${head}<tbody>${body}</tbody></table></div>`;
  };

  /** ごみ：品名・出し方・注意を縦に並べる */
  const renderList = (rows: DataSet["rows"]) => {
    const [name, , kind, note] = [0, 1, 2, 3];
    $out.innerHTML =
      `<ul class="gomi-list">` +
      rows
        .slice(0, shown)
        .map(
          (r) =>
            `<li><p class="gomi-name">${esc(r[name])}</p><p class="gomi-kind">${String(r[kind] ?? "")
              .split("／")
              .map((k) => `<a href="#kinds" title="区分ごとの出し方を見る">${esc(k)}</a>`)
              .join("")}</p>${r[note] ? `<p class="gomi-note">${linkify(esc(r[note]))}</p>` : ""}</li>`,
        )
        .join("") +
      `</ul>`;
  };

  const render = () => {
    const rows = matched();
    list ? renderList(rows) : renderTable(rows);
    const total = ds.rows.length;
    $count.textContent = rows.length === total ? `${total.toLocaleString()} 件` : `${rows.length.toLocaleString()} 件（全 ${total.toLocaleString()} 件）`;
    if (rows.length === 0) $out.innerHTML = `<p class="data-empty">見つかりませんでした。${list ? "ほかの言い方（ひらがな・一般的な名前）でも探してみてください。" : ""}</p>`;
    const rest = rows.length - shown;
    $more.hidden = rest <= 0;
    $more.textContent = `もっと見る（あと ${rest.toLocaleString()} 件）`;
    if ($map) {
      $map.hidden = !mapOn;
      if (mapOn) showMap(rows);
    }
  };

  const showMap = async (rows: DataSet["rows"]) => {
    mapP ??= import("./data-map").then((m) => m.makeMap($map!));
    (await mapP).show(rows, ds);
  };

  // 絞り込み。flag の列は「〇〇あり」のボタン、filterOptions のある列は決まった区分、ほかは値の一覧
  $filters.innerHTML = ds.filters
    .map((col) => {
      if (ds.columns[idx[col]][1] === "flag") {
        return `<label class="chip-toggle"><input type="checkbox" data-filter-col="${esc(col)}" value="有"><span>${esc(col)}あり</span></label>`;
      }
      const opts = ds.filterOptions?.[col] ?? [...new Set(ds.rows.map((r) => String(r[idx[col]] ?? "")))].filter(Boolean).sort((a, b) => a.localeCompare(b, "ja")).map((v) => [v, v]);
      return `<label>${esc(col)}<select data-filter-col="${esc(col)}"><option value="">すべて</option>${opts.map(([label, v]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("")}</select></label>`;
    })
    .join("");

  // --- 操作 ---
  let timer = 0;
  const onQuery = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      shown = PAGE;
      render();
      syncUrl();
    }, 120);
  };
  $q.addEventListener("input", onQuery);
  $filters.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    const col = el.dataset.filterCol;
    if (!col) return;
    filterVals[col] = el instanceof HTMLInputElement ? (el.checked ? el.value : "") : el.value;
    shown = PAGE;
    render();
  });
  $out.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-sort]");
    if (!b) return;
    const i = Number(b.dataset.sort);
    if (sortCol === i) sortDir = sortDir === 1 ? -1 : 1;
    else {
      sortCol = i;
      // 数字の列は大きい順から
      sortDir = ds.columns[i][1] === "num" ? -1 : 1;
    }
    render();
    $out.querySelector<HTMLButtonElement>(`[data-sort="${i}"]`)?.focus();
  });
  $more.addEventListener("click", () => {
    shown += PAGE * 3;
    render();
  });
  applySort = () => {
    if (!wantSort || idx[wantSort[0]] === undefined) return;
    sortCol = idx[wantSort[0]];
    sortDir = wantSort[1] === "desc" ? -1 : 1;
    wantSort = null;
  };
  refresh = () => {
    shown = PAGE;
    render();
    syncUrl();
  };
  // URL の ?q= で検索した状態から始める（ボタンが先に押されていたら、その言葉を残す）
  if (!$q.value) $q.value = new URLSearchParams(location.search).get("q") ?? "";
  applySort();
  render();
}
