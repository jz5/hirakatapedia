/**
 * 枚方市地図クイズ（/data/map-quiz/）の本体。
 * public/maps/quiz-districts.json（scripts/map-quiz-data.py が e-Stat・市のオープンデータ・標高・写真から作成）を
 * 読み、白地図 SVG 上で地区をクリックして当てるクイズと、211 地区の統計を調べるモードを動かす。
 * 地図と統計は自サーバーの JSON だけで完結するため、外部サーバーには通信しない。
 */

interface ArticleLink {
  slug: string;
  title: string;
}

interface District {
  id: string;
  name: string;
  yomi: string;
  chome: number;
  tier: 1 | 2 | 3;
  d: string;
  cx: number;
  cy: number;
  lat: number;
  lon: number;
  pop: number;
  popRank: number;
  hh: number;
  area: number;
  areaRank: number;
  dens: number;
  u15: number | null;
  o65: number | null;
  elev: [number, number, number];
  parks: number;
  sakura: number;
  hinanjo: number;
  kosodate: number;
  aed: number;
  toilet: number;
  shisetsu: number;
  st: [string, string, number];
  photos: [string, number | null][];
  articles: ArticleLink[];
  neighbors: string[];
}

interface DistrictNote {
  tag: string;
  text: string;
  source?: string;
}

interface QuizData {
  viewBox: [number, number, number, number];
  city: { pop: number; area: number; u15: number; o65: number; count: number };
  rivers: { name: string; pts: string }[];
  rails: { name: string; pts: string }[];
  stations: { name: string; line: string; x: number; y: number }[];
  districts: District[];
}

type Mode = "quiz" | "explore" | "notes";
type Level = "easy" | "normal" | "hard";

interface RecordItem {
  district: District;
  misses: number;
  gaveUp: boolean;
}

const ROUND_SIZE = 3;
const QUIZ_URL = "https://hirakata.pronama.jp/data/map-quiz/";
const SVG_NS = "http://www.w3.org/2000/svg";
const SOUND_KEY = "hirakatapedia-quiz-sound";
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fmt = (n: number) => n.toLocaleString("ja-JP");
const thumbOf = (id: string) => `/gallery/i/${id.slice(0, 2)}/${id}-s.avif`;
/** 地区名にふりがな（ルビ）を付けて返す */
const rubyOf = (d: Pick<District, "name" | "yomi">) =>
  d.yomi ? `<ruby class="mq-ruby">${esc(d.name)}<rp>（</rp><rt>${esc(d.yomi)}</rt><rp>）</rp></ruby>` : esc(d.name);

/** Web Audio API による軽量な効果音（外部音声ファイル不使用） */
function createSound() {
  let ctx: AudioContext | null = null;
  let enabled = true;
  try {
    const saved = localStorage.getItem(SOUND_KEY);
    if (saved === "0") enabled = false;
  } catch {}

  const ensure = () => {
    if (!enabled) return null;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx ??= new AC();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  };

  const tone = (freq: number, start: number, dur: number, vol = 0.12, type: OscillatorType = "sine") => {
    const c = ensure();
    if (!c) return;
    const now = c.currentTime + start;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  };

  return {
    get enabled() {
      return enabled;
    },
    setEnabled(v: boolean) {
      enabled = v;
      try {
        localStorage.setItem(SOUND_KEY, v ? "1" : "0");
      } catch {}
    },
    correct(firstTry: boolean) {
      if (firstTry) {
        tone(523.25, 0, 0.14, 0.12, "triangle");
        tone(659.25, 0.09, 0.14, 0.12, "triangle");
        tone(783.99, 0.18, 0.28, 0.13, "triangle");
      } else {
        tone(587.33, 0, 0.14, 0.11, "triangle");
        tone(880.0, 0.1, 0.24, 0.11, "triangle");
      }
    },
    miss(heat: number) {
      const base = [310, 260, 220, 185][heat] ?? 200;
      tone(base, 0, 0.11, 0.09, "sine");
      tone(base * 0.82, 0.08, 0.14, 0.08, "sine");
    },
    hint() {
      tone(660, 0, 0.09, 0.07, "sine");
      tone(880, 0.06, 0.12, 0.06, "sine");
    },
    giveUp() {
      tone(330, 0, 0.12, 0.08, "sine");
      tone(247, 0.1, 0.2, 0.08, "sine");
    },
    finish() {
      tone(523.25, 0, 0.13, 0.11, "triangle");
      tone(659.25, 0.1, 0.13, 0.11, "triangle");
      tone(783.99, 0.2, 0.13, 0.11, "triangle");
      tone(1046.5, 0.3, 0.34, 0.13, "triangle");
    },
  };
}

/** 2 地点間の直線距離（km）と 16 方位・角度（北が 0°、時計回り） */
function distAndDir(from: District, to: District) {
  const rad = Math.PI / 180;
  const dy = (to.lat - from.lat) * rad * 6371;
  const dx = (to.lon - from.lon) * rad * 6371 * Math.cos(((from.lat + to.lat) / 2) * rad);
  const km = Math.hypot(dx, dy);
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  const dirs = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
  const dir = dirs[Math.round(deg / 22.5) % 16];
  return { km, dir, deg };
}

function heatLevel(km: number): number {
  if (km < 1.2) return 0;
  if (km < 2.8) return 1;
  if (km < 5.0) return 2;
  return 3;
}

const HEAT_LABELS = ["すぐ近く", "わりと近い", "もう少し", "遠い"];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 地区の統計情報から段階的なヒント（最大 4 段階）を作る */
function buildHints(d: District, city: QuizData["city"], byName: Map<string, District>): { label: string; html: string }[] {
  const hints: { label: string; html: string }[] = [];

  if (d.pop === 0) {
    hints.push({
      label: "人口・面積の統計",
      html: `2020年国勢調査の人口は <strong>0人</strong>（公園・遊園地・工業団地・山林など）。面積は <strong>${d.area.toFixed(2)} km²</strong>（${city.count}地区中 ${d.areaRank}位）です。`,
    });
  } else {
    const perHh = d.hh > 0 ? (d.pop / d.hh).toFixed(2) : null;
    const chomeTxt = d.chome > 1 ? `1〜${d.chome}丁目あり、` : "";
    hints.push({
      label: "人口・面積の統計",
      html: `${chomeTxt}2020年国勢調査の人口は <strong>${fmt(d.pop)}人</strong>（${city.count}地区中 <strong>${d.popRank}位</strong>）、面積は <strong>${d.area.toFixed(2)} km²</strong>（人口密度 ${fmt(d.dens)}人/km²）${perHh ? `。1世帯あたり ${perHh}人` : ""}です。`,
    });
  }

  const ageParts: string[] = [];
  if (d.o65 !== null) {
    const diff = d.o65 - city.o65;
    const cmp = Math.abs(diff) < 1.5 ? "市平均とほぼ同じ" : diff > 0 ? `市平均 ${city.o65}% より高め` : `市平均 ${city.o65}% より低め`;
    ageParts.push(`65歳以上の割合は <strong>${d.o65}%</strong>（${cmp}）`);
  }
  if (d.u15 !== null) {
    ageParts.push(`15歳未満は <strong>${d.u15}%</strong>（市平均 ${city.u15}%）`);
  }
  const [eMin, eAvg, eMax] = d.elev;
  const elevText =
    eMax - eMin >= 20
      ? `標高は <strong>約${eMin}m〜${eMax}m</strong>（平均 ${eAvg}m、高低差が大きめ）`
      : `標高は <strong>約${eAvg}m</strong>（${eMin}m〜${eMax}m）`;
  hints.push({
    label: "年齢構成・地形",
    html: `${ageParts.length ? `${ageParts.join("、")}。` : ""}${elevText}です。`,
  });

  const fac: string[] = [];
  if (d.parks > 0) fac.push(`都市公園 ${d.parks}か所${d.sakura > 0 ? `（桜 ${fmt(d.sakura)}本）` : ""}`);
  if (d.hinanjo > 0) fac.push(`避難所 ${d.hinanjo}か所`);
  if (d.shisetsu > 0) fac.push(`公共施設 ${d.shisetsu}か所`);
  if (d.kosodate > 0) fac.push(`子育て施設 ${d.kosodate}か所`);
  if (d.aed > 0) fac.push(`AED ${d.aed}か所`);
  if (d.toilet > 0) fac.push(`公衆トイレ ${d.toilet}か所`);
  const [stName, stLine, stDist] = d.st;
  const stSpoils = d.name.includes(stName) || stName.includes(d.name.replace(/町$/, ""));
  const railText = stSpoils
    ? `最寄りは <strong>${esc(stLine)}</strong> の沿線（駅から約${stDist}km）`
    : `最寄り駅は <strong>${esc(stLine)}・${esc(stName)}駅</strong> から直線約${stDist}km`;
  hints.push({
    label: "施設・交通の統計",
    html: `${fac.length ? `地区内に <strong>${fac.join("・")}</strong> があります。` : "市のオープンデータ上の公園・避難所は地区内にありません。"}${railText}です。`,
  });

  const stem = d.name.slice(0, 2);
  const safeNbrs = d.neighbors.filter((n) => !n.includes(stem) && !d.name.includes(n.slice(0, 2))).slice(0, 5);
  const nbrsToShow = safeNbrs.length >= 2 ? safeNbrs : d.neighbors.slice(0, 4);
  const photoHtml =
    d.photos.length > 0
      ? `<div class="mq-hint-photos">${d.photos
          .slice(0, 2)
          .map(([id, yr]) => `<img src="${thumbOf(id)}" alt="ヒントの写真" width="120" height="90" loading="lazy" />${yr ? `<span class="visually-hidden">${yr}年撮影</span>` : ""}`)
          .join("")}</div>`
      : "";
  if (nbrsToShow.length > 0 || photoHtml) {
    const nbrHtml = nbrsToShow.map((n) => {
      const nd = byName.get(n);
      return nd ? rubyOf(nd) : esc(n);
    }).join("・");
    hints.push({
      label: photoHtml ? "隣接地区・現地の写真" : "隣接する地区",
      html: `${nbrHtml ? `<strong>${nbrHtml}</strong> などに接しています。` : ""}${photoHtml}`,
    });
  }

  return hints;
}

/** 先頭のキャッチーな一文（！・？まで）だけ太字にして読みやすくする */
function formatNoteText(text: string): string {
  const m = text.match(/^([^！？]+[！？])\s*([\s\S]*)$/);
  if (!m) return esc(text);
  return `<strong class="mq-note-lead">${esc(m[1])}</strong>${m[2] ? ` ${esc(m[2])}` : ""}`;
}

/** 出典文字列の Markdown リンク（[ラベル](URL)）を安全な <a> に変換する */
function renderSourceHtml(source: string): string {
  const re = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g;
  let out = "";
  let last = 0;
  for (const m of source.matchAll(re)) {
    const idx = m.index ?? 0;
    out += esc(source.slice(last, idx));
    const label = m[1];
    const url = m[2];
    const ext = url.startsWith("http") ? ` target="_blank" rel="noopener noreferrer"` : "";
    out += `<a href="${esc(url)}"${ext}>${esc(label)}</a>`;
    last = idx + m[0].length;
  }
  out += esc(source.slice(last));
  return out;
}

/** 地区のひとことネタ（content/data/map-quiz-notes.yaml）の HTML（公開画面は統一デザイン） */
function renderNoteHtml(note?: DistrictNote): string {
  if (!note) return "";
  return (
    `<div class="mq-note">` +
      `<p class="mq-note-text">${formatNoteText(note.text)}</p>` +
      (note.source ? `<p class="mq-note-src">出典：${renderSourceHtml(note.source)}</p>` : "") +
    `</div>`
  );
}

/** 地区の統計カルテ中身 HTML（地図上ダイアログ・調べるモード共通） */
function renderStatsBodyHtml(d: District, city: QuizData["city"], note?: DistrictNote): string {
  const ageTxt =
    d.o65 !== null && d.u15 !== null
      ? `65歳以上 ${d.o65}% ／ 15歳未満 ${d.u15}%（市平均 ${city.o65}% ／ ${city.u15}%）`
      : "少人数のため割合は非表示";
  const fac: string[] = [];
  if (d.parks > 0) fac.push(`公園 ${d.parks}${d.sakura > 0 ? `（桜 ${fmt(d.sakura)}本）` : ""}`);
  if (d.hinanjo > 0) fac.push(`避難所 ${d.hinanjo}`);
  if (d.shisetsu > 0) fac.push(`公共施設 ${d.shisetsu}`);
  if (d.kosodate > 0) fac.push(`子育て施設 ${d.kosodate}`);
  if (d.aed > 0) fac.push(`AED ${d.aed}`);
  if (d.toilet > 0) fac.push(`公衆トイレ ${d.toilet}`);
  const photosHtml = d.photos.length
    ? `<div class="mq-card-photos">${d.photos
        .map(
          ([id, yr]) =>
            `<a href="/gallery/${esc(id)}/"><img src="${thumbOf(id)}" alt="${esc(d.name)}の写真" width="112" height="84" loading="lazy" />${yr ? `<span>${yr}年</span>` : ""}</a>`,
        )
        .join("")}</div>`
    : "";
  const articlesHtml = d.articles.length
    ? `<div class="mq-card-articles"><p class="mq-card-sub">関連する記事</p><ul>${d.articles
        .map((a) => `<li><a href="/${esc(a.slug)}/">${esc(a.title)}</a></li>`)
        .join("")}</ul></div>`
    : "";

  return `
    ${renderNoteHtml(note)}
    <dl class="mq-stats">
      <div><dt>人口（2020年）</dt><dd>${fmt(d.pop)}人${d.pop > 0 ? `（${d.popRank}位 / ${city.count}地区）` : ""}・${fmt(d.hh)}世帯</dd></div>
      <div><dt>面積・密度</dt><dd>${d.area.toFixed(2)} km²（${d.areaRank}位）・${fmt(d.dens)}人/km²</dd></div>
      <div><dt>年齢構成</dt><dd>${esc(ageTxt)}</dd></div>
      <div><dt>標高・最寄り駅</dt><dd>約${d.elev[1]}m（${d.elev[0]}〜${d.elev[2]}m）／ ${esc(d.st[1])} ${esc(d.st[0])}駅 約${d.st[2]}km</dd></div>
      <div><dt>市オープンデータ</dt><dd>${fac.length ? esc(fac.join("・")) : "該当なし"}</dd></div>
    </dl>
    ${photosHtml}
    ${articlesHtml}
  `;
}

function renderCardHtml(d: District, city: QuizData["city"], note?: DistrictNote): string {
  const chomeTxt = d.chome > 1 ? `（1〜${d.chome}丁目を合算）` : "";
  return `
    <div class="mq-card-head">
      <h3>${rubyOf(d)}</h3>
      ${chomeTxt ? `<span class="mq-card-chome">${esc(chomeTxt)}</span>` : ""}
    </div>
    ${renderStatsBodyHtml(d, city, note)}
  `;
}

/** サイト共通の ShareButtons.astro と同じ 6 サービス分の共有 URL を組む */
function buildShareUrls(textOnly: string, url: string): Record<string, string> {
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const full = `${textOnly}\n${url}`;
  return {
    x: `https://x.com/intent/post?${q({ text: textOnly, url })}`,
    misskey: `https://misskey-hub.net/share/?${q({ text: full, visibility: "public", localOnly: "0" })}`,
    mastodon: `https://pronama.jp/share-to-mastodon.html?${q({ text: full })}`,
    bluesky: `https://bsky.app/intent/compose?${q({ text: full })}`,
    threads: `https://www.threads.net/intent/post?${q({ text: full })}`,
    line: `https://social-plugins.line.me/lineit/share?${q({ url, text: textOnly })}`,
  };
}

const arrowSvg = (deg: number) =>
  `<svg class="mq-arrow" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="transform:rotate(${Math.round(deg)}deg)"><path d="M12 3l6 8h-4v10h-4V11H6z" fill="currentColor"/></svg>`;

export async function startMapQuiz() {
  const root = document.querySelector<HTMLElement>("[data-map-quiz]");
  if (!root) return;

  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const $modeBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-mode]")];
  const $levelSel = $<HTMLSelectElement>("[data-level]");
  const $levelWrap = $<HTMLElement>("[data-level-wrap]");
  const $optGuides = $<HTMLInputElement>("[data-opt-guides]");
  const $optStations = $<HTMLInputElement>("[data-opt-stations]");
  const $optSound = $<HTMLInputElement>("[data-opt-sound]");
  const $exploreBox = $<HTMLElement>("[data-explore-box]");
  const $exploreQ = $<HTMLInputElement>("[data-explore-q]");
  const $exploreList = $<HTMLUListElement>("[data-explore-list]");
  const $promptBox = $<HTMLElement>("[data-prompt-box]");
  const $progress = $<HTMLElement>("[data-progress]");
  const $hintMeter = $<HTMLElement>("[data-hint-meter]");
  const $targetName = $<HTMLElement>("[data-target-name]");
  const $feedback = $<HTMLElement>("[data-feedback]");
  const $toast = $<HTMLElement>("[data-toast]");
  const $hintBtn = $<HTMLButtonElement>("[data-hint-btn]");
  const $giveUpBtn = $<HTMLButtonElement>("[data-giveup-btn]");
  const $nextBtn = $<HTMLButtonElement>("[data-next-btn]");
  const $reopenDialogBtn = $<HTMLButtonElement>("[data-reopen-dialog]");
  const $hintsList = $<HTMLOListElement>("[data-hints]");
  const $card = $<HTMLElement>("[data-card]");
  const $dialog = $<HTMLElement>("[data-dialog]");
  const $dialogTitle = $<HTMLElement>("[data-dialog-title]");
  const $dialogBody = $<HTMLElement>("[data-dialog-body]");
  const $dialogClose = $<HTMLButtonElement>("[data-dialog-close]");
  const $dialogHide = $<HTMLButtonElement>("[data-dialog-hide]");
  const $dialogNext = $<HTMLButtonElement>("[data-dialog-next]");
  const $summary = $<HTMLElement>("[data-summary]");
  const $summaryBody = $<HTMLElement>("[data-summary-body]");
  const $extendBtn = $<HTMLButtonElement>("[data-extend]");
  const $retryBtn = $<HTMLButtonElement>("[data-retry]");
  const $shareLinks = [...root.querySelectorAll<HTMLAnchorElement>("[data-share-link]")];
  const $shareCopy = $<HTMLButtonElement>("[data-share-copy]");
  const $shareCopied = $<HTMLElement>("[data-share-copied]");
  const $mapWrap = $<HTMLElement>("[data-map-wrap]");
  const $stage = $<HTMLElement>("[data-stage]");
  const $notesView = root.querySelector<HTMLElement>("[data-notes-view]");
  const $notesQ = root.querySelector<HTMLInputElement>("[data-notes-q]");
  const $notesFilter = root.querySelector<HTMLSelectElement>("[data-notes-filter]");
  const $notesCount = root.querySelector<HTMLElement>("[data-notes-count]");
  const $notesList = root.querySelector<HTMLUListElement>("[data-notes-list]");
  const $loading = $<HTMLElement>("[data-loading]");
  const $zoomIn = $<HTMLButtonElement>("[data-zoom-in]");
  const $zoomOut = $<HTMLButtonElement>("[data-zoom-out]");
  const $zoomReset = $<HTMLButtonElement>("[data-zoom-reset]");

  const sound = createSound();
  $optSound.checked = sound.enabled;
  $optSound.addEventListener("change", () => {
    sound.setEnabled($optSound.checked);
    if (sound.enabled) sound.hint();
  });

  // 地区ごとのひとことネタ（map-quiz.astro が YAML から埋め込む）
  let notes: Record<string, DistrictNote> = {};
  try {
    const el = document.getElementById("mq-notes");
    if (el?.textContent) notes = JSON.parse(el.textContent);
  } catch {}

  let data: QuizData;
  try {
    const r = await fetch("/maps/quiz-districts.json");
    if (!r.ok) throw new Error(String(r.status));
    data = await r.json();
  } catch {
    $loading.textContent = "地図データを読み込めませんでした。";
    return;
  }

  const byId = new Map(data.districts.map((d) => [d.id, d]));
  const byName = new Map(data.districts.map((d) => [d.name, d]));
  const [vbX, vbY, vbW, vbH] = data.viewBox;

  // --- SVG 地図の構築 ---
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "mq-svg");
  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.setAttribute("role", "application");
  svg.setAttribute("aria-label", "枚方市の地区地図");

  const gViewport = document.createElementNS(SVG_NS, "g");
  const gDistricts = document.createElementNS(SVG_NS, "g");
  gDistricts.setAttribute("class", "mq-districts");
  const gGuides = document.createElementNS(SVG_NS, "g");
  gGuides.setAttribute("class", "mq-guides");
  const gStations = document.createElementNS(SVG_NS, "g");
  gStations.setAttribute("class", "mq-stations");
  const gEffects = document.createElementNS(SVG_NS, "g");
  gEffects.setAttribute("class", "mq-effects");
  const gLabels = document.createElementNS(SVG_NS, "g");
  gLabels.setAttribute("class", "mq-labels");

  gViewport.append(gDistricts, gGuides, gStations, gEffects, gLabels);
  svg.append(gViewport);

  const pathById = new Map<string, SVGPathElement>();
  const bringToFront = (poly: SVGPathElement) => {
    gDistricts.append(poly);
  };

  for (const d of data.districts) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d.d);
    p.setAttribute("class", "mq-poly");
    p.dataset.id = d.id;
    p.setAttribute("tabindex", "0");
    p.setAttribute("role", "button");
    p.setAttribute("aria-label", "地区を選択");
    p.addEventListener("pointerenter", () => bringToFront(p));
    gDistricts.append(p);
    pathById.set(d.id, p);
  }

  for (const r of data.rivers) {
    const pl = document.createElementNS(SVG_NS, "polyline");
    pl.setAttribute("points", r.pts);
    pl.setAttribute("class", "mq-river");
    gGuides.append(pl);
  }
  for (const rl of data.rails) {
    const pl = document.createElementNS(SVG_NS, "polyline");
    pl.setAttribute("points", rl.pts);
    pl.setAttribute("class", "mq-rail");
    gGuides.append(pl);
  }
  for (const s of data.stations) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", String(s.x));
    c.setAttribute("cy", String(s.y));
    c.setAttribute("r", "4.5");
    c.setAttribute("class", "mq-station");
    gStations.append(c);
  }

  $mapWrap.prepend(svg);
  $loading.hidden = true;

  // --- ズーム＆パン（viewBox を操作） ---
  const cam = { x: vbX, y: vbY, w: vbW, h: vbH };
  const applyCam = () => {
    const minW = vbW / 6;
    cam.w = Math.min(vbW, Math.max(minW, cam.w));
    cam.h = (cam.w / vbW) * vbH;
    // 正解ダイアログ表示中は、北端・南端の地区でも地図の上 4 割に収まるよう上下に余白を許す
    const extraTop = $dialog.hidden ? 0 : cam.h * 0.2;
    const extraBottom = $dialog.hidden ? 0 : cam.h * 0.72;
    cam.x = Math.min(vbX + vbW - cam.w, Math.max(vbX, cam.x));
    cam.y = Math.min(vbY + vbH + extraBottom - cam.h, Math.max(vbY - extraTop, cam.y));
    svg.setAttribute("viewBox", `${cam.x.toFixed(1)} ${cam.y.toFixed(1)} ${cam.w.toFixed(1)} ${cam.h.toFixed(1)}`);
  };
  const zoomAt = (factor: number, fx = 0.5, fy = 0.5) => {
    const nw = Math.min(vbW, Math.max(vbW / 6, cam.w * factor));
    const nh = (nw / vbW) * vbH;
    cam.x += (cam.w - nw) * fx;
    cam.y += (cam.h - nh) * fy;
    cam.w = nw;
    cam.h = nh;
    applyCam();
  };
  const resetCam = () => {
    cam.x = vbX;
    cam.y = vbY;
    cam.w = vbW;
    cam.h = vbH;
    applyCam();
  };
  /** 地区に寄せる。yRatio=0.28 にすると地図の上寄りに見え、下側のダイアログと重なりにくい */
  const focusDistrict = (d: District, yRatio = 0.5) => {
    const targetW = Math.min(cam.w, vbW * 0.52);
    const targetH = (targetW / vbW) * vbH;
    cam.w = targetW;
    cam.h = targetH;
    cam.x = d.cx - targetW / 2;
    cam.y = d.cy - targetH * yRatio;
    applyCam();
  };

  $zoomIn.addEventListener("click", () => zoomAt(0.7));
  $zoomOut.addEventListener("click", () => zoomAt(1 / 0.7));
  $zoomReset.addEventListener("click", resetCam);

  let wheelActive = false;
  svg.addEventListener(
    "wheel",
    (e) => {
      if (!wheelActive && !e.ctrlKey) return;
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      zoomAt(e.deltaY > 0 ? 1.18 : 1 / 1.18, fx, fy);
    },
    { passive: false },
  );

  let dragStart: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    wheelActive = true;
    dragStart = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (!dragStart.moved && Math.hypot(dx, dy) > 6) dragStart.moved = true;
    if (!dragStart.moved) return;
    const r = svg.getBoundingClientRect();
    cam.x = dragStart.cx - (dx / r.width) * cam.w;
    cam.y = dragStart.cy - (dy / r.height) * cam.h;
    applyCam();
  });
  svg.addEventListener("pointerup", (e) => {
    if (!dragStart) return;
    const wasDrag = dragStart.moved;
    dragStart = null;
    if (wasDrag) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGPathElement>(".mq-poly");
    if (target?.dataset.id) onPickDistrict(target.dataset.id);
  });
  svg.addEventListener("pointerleave", () => {
    wheelActive = false;
  });
  svg.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const target = (e.target as Element).closest<SVGPathElement>(".mq-poly");
    if (!target?.dataset.id) return;
    e.preventDefault();
    onPickDistrict(target.dataset.id);
  });

  // --- 地図上のラベル・エフェクト・トースト・ダイアログ ---
  let toastTimer = 0;
  const showToast = (html: string, kind: "ok" | "miss" | "giveup") => {
    window.clearTimeout(toastTimer);
    $toast.className = `mq-toast is-${kind}`;
    $toast.innerHTML = html;
    $toast.hidden = false;
    $toast.classList.remove("is-pop");
    void $toast.offsetWidth;
    $toast.classList.add("is-pop");
    if (kind === "miss") {
      toastTimer = window.setTimeout(() => {
        $toast.hidden = true;
      }, 3200);
    }
  };
  const hideToast = () => {
    window.clearTimeout(toastTimer);
    $toast.hidden = true;
  };

  const closeDialog = () => {
    $dialog.hidden = true;
    if (mode === "quiz" && solved && $summary.hidden) $reopenDialogBtn.hidden = false;
  };
  const openDialog = () => {
    $dialog.hidden = false;
    $reopenDialogBtn.hidden = true;
  };
  $dialogClose.addEventListener("click", closeDialog);
  $dialogHide.addEventListener("click", closeDialog);
  $reopenDialogBtn.addEventListener("click", openDialog);

  const addPulse = (d: District, kind: "ok" | "miss") => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", String(d.cx));
    c.setAttribute("cy", String(d.cy));
    c.setAttribute("r", "8");
    c.setAttribute("class", `mq-pulse is-${kind}`);
    gEffects.append(c);
    window.setTimeout(() => c.remove(), 750);
  };

  const addLabel = (d: District, cls: string) => {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(d.cx));
    t.setAttribute("y", String(d.cy));
    t.setAttribute("class", `mq-label ${cls}`);
    t.textContent = d.name;
    gLabels.append(t);
  };

  const clearMapMarks = () => {
    for (const p of pathById.values()) {
      p.classList.remove("is-correct", "is-selected", "is-last-pick", "is-heat-0", "is-heat-1", "is-heat-2", "is-heat-3");
    }
    gLabels.innerHTML = "";
    gEffects.innerHTML = "";
    hideToast();
    $dialog.hidden = true;
  };

  const triggerFeedbackAnim = (cls: string) => {
    $feedback.className = `mq-feedback ${cls}`;
    void $feedback.offsetWidth;
    $feedback.classList.add("is-anim");
  };

  // --- 補助表示 ---
  const syncOverlays = () => {
    gGuides.style.display = $optGuides.checked ? "" : "none";
    gStations.style.display = $optStations.checked ? "" : "none";
  };
  $optGuides.addEventListener("change", syncOverlays);
  $optStations.addEventListener("change", syncOverlays);
  syncOverlays();

  // --- クイズ状態 ---
  let mode: Mode = "quiz";
  let level: Level = "easy";
  let deck: District[] = []; // シャッフル済み全体（延長時に重複なく取り出す）
  let queue: District[] = [];
  let qIndex = 0;
  let current: District | null = null;
  let currentHints: { label: string; html: string }[] = [];
  let shownHints = 0;
  let misses = 0;
  let solved = false;
  let triedIds = new Set<string>();
  let records: RecordItem[] = [];
  let lastShareText = "";

  const poolFor = (lv: Level) => {
    if (lv === "easy") return data.districts.filter((d) => d.tier === 1);
    if (lv === "normal") return data.districts.filter((d) => d.tier <= 2);
    return data.districts;
  };

  /** 新しいヒントが先頭に出るように降順で描画する */
  const renderHints = (highlightLatest = false) => {
    const total = currentHints.length;
    $hintMeter.textContent = `ヒント ${shownHints} / ${total}`;
    const items: string[] = [];
    for (let i = shownHints - 1; i >= 0; i--) {
      const h = currentHints[i];
      const isNewest = i === shownHints - 1;
      const cls = isNewest ? (highlightLatest ? "is-latest is-fresh" : "is-latest") : "";
      items.push(
        `<li class="${cls}">` +
          `<span class="mq-hint-tag">ヒント ${i + 1} / ${total}：${esc(h.label)}${isNewest ? `<em class="mq-hint-new">NEW</em>` : ""}</span>` +
          `<div class="mq-hint-body">${h.html}</div>` +
        `</li>`,
      );
    }
    $hintsList.innerHTML = items.join("");
    $hintsList.hidden = shownHints === 0;
    $hintBtn.disabled = solved || shownHints >= total;
    $hintBtn.textContent =
      shownHints < total ? `次のヒントを見る（あと ${total - shownHints} つ）` : "ヒントはすべて表示しました";
  };

  const startQuestion = () => {
    clearMapMarks();
    resetCam();
    current = queue[qIndex];
    currentHints = buildHints(current, data.city, byName);
    shownHints = 0;
    misses = 0;
    solved = false;
    triedIds = new Set();

    const extTag = queue.length > ROUND_SIZE ? "（延長）" : "";
    $progress.textContent = `第 ${qIndex + 1} / ${queue.length} 問${extTag}`;
    $targetName.innerHTML = rubyOf(current);
    $feedback.className = "mq-feedback";
    $feedback.textContent = "地図上の地区をクリック（またはタップ）して選んでください。";
    $card.hidden = true;
    $card.innerHTML = "";
    $nextBtn.hidden = true;
    $reopenDialogBtn.hidden = true;
    $giveUpBtn.hidden = false;
    $hintBtn.hidden = false;
    renderHints(false);
  };

  const startQuiz = () => {
    deck = shuffle(poolFor(level));
    queue = deck.slice(0, Math.min(ROUND_SIZE, deck.length));
    qIndex = 0;
    records = [];
    $summary.hidden = true;
    $promptBox.hidden = false;
    startQuestion();
  };

  const extendQuiz = () => {
    const rest = deck.slice(queue.length, queue.length + ROUND_SIZE);
    if (!rest.length) return;
    queue = [...queue, ...rest];
    qIndex = records.length;
    $summary.hidden = true;
    $promptBox.hidden = false;
    startQuestion();
  };

  const finishQuestion = (gaveUp: boolean) => {
    if (!current || solved) return;
    solved = true;
    records.push({ district: current, misses, gaveUp });
    for (const p of pathById.values()) p.classList.remove("is-last-pick");
    const poly = pathById.get(current.id)!;
    poly.classList.add("is-correct");
    bringToFront(poly);
    addLabel(current, "is-correct");
    addPulse(current, "ok");

    const nextLabel = qIndex + 1 < queue.length ? "次の問題へ" : "結果を見る";
    const chomeTxt = current.chome > 1 ? `（1〜${current.chome}丁目）` : "";
    let badge = "";
    let summaryLine = "";

    if (gaveUp) {
      sound.giveUp();
      badge = `<span class="mq-dlg-badge is-giveup">解答</span>`;
      summaryLine = `「${rubyOf(current)}」はここです`;
      $feedback.innerHTML = `<span class="mq-fb-badge">解答</span><div><strong>${summaryLine}</strong></div>`;
      triggerFeedbackAnim("is-giveup");
      showToast(`解答：<strong>${esc(current.name)}</strong>`, "giveup");
    } else if (misses === 0) {
      sound.correct(true);
      badge = `<span class="mq-dlg-badge is-ok">○ 一発正解</span>`;
      summaryLine = `一発正解！「${rubyOf(current)}」です`;
      $feedback.innerHTML = `<span class="mq-fb-badge">○</span><div><strong>一発正解！</strong>「${rubyOf(current)}」です</div>`;
      triggerFeedbackAnim("is-ok");
      showToast(`○ 一発正解！ <strong>${esc(current.name)}</strong>`, "ok");
    } else {
      sound.correct(false);
      badge = `<span class="mq-dlg-badge is-ok">○ 正解（${misses}回ミス）</span>`;
      summaryLine = `正解！ ${misses}回ミスで「${rubyOf(current)}」に到達`;
      $feedback.innerHTML = `<span class="mq-fb-badge">○</span><div><strong>正解！</strong> ${misses}回ミスで「${rubyOf(current)}」に到達</div>`;
      triggerFeedbackAnim("is-ok");
      showToast(`○ 正解！ <strong>${esc(current.name)}</strong>`, "ok");
    }

    // 地図に重ねて地区情報ダイアログを表示（先に開いてから寄せると南端の地区も上に収まる）
    $dialogTitle.innerHTML = `${badge}<strong>${rubyOf(current)}</strong>${chomeTxt ? `<span class="mq-card-chome">${esc(chomeTxt)}</span>` : ""}`;
    $dialogBody.innerHTML = renderStatsBodyHtml(current, data.city, notes[current.name]);
    $dialogNext.textContent = nextLabel;
    openDialog();
    focusDistrict(current, 0.22);

    $giveUpBtn.hidden = true;
    $hintBtn.hidden = true;
    $nextBtn.hidden = false;
    $nextBtn.textContent = nextLabel;
  };

/** 正答数・ミス回数・難易度・回答数からスコア（0〜100）とランク称号を算出する */
function evaluateResult(records: RecordItem[], level: Level) {
  const total = records.length;
  const cleared = records.filter((r) => !r.gaveUp).length;
  const firstTry = records.filter((r) => !r.gaveUp && r.misses === 0).length;
  const gaveUpCount = total - cleared;
  const totalMiss = records.reduce((s, r) => s + r.misses, 0);

  const pts = records.reduce((sum, r) => {
    if (r.gaveUp) return sum;
    if (r.misses === 0) return sum + 100;
    if (r.misses === 1) return sum + 75;
    if (r.misses === 2) return sum + 55;
    return sum + 35;
  }, 0);
  const accuracy = total > 0 ? Math.round(pts / total) : 0;
  const levelBonus = cleared > 0 ? (level === "hard" ? 10 : level === "normal" ? 5 : 0) : 0;
  const countBonus = cleared > 0 ? (total >= 15 ? 10 : total >= 9 ? 6 : total >= 6 ? 3 : 0) : 0;
  const score = Math.min(100, accuracy + levelBonus + countBonus);

  let grade: "SS" | "S" | "A" | "B" | "C" | "D";
  let title: string;
  let comment: string;

  if (gaveUpCount === 0 && firstTry === total && (level === "hard" || total >= 6)) {
    grade = "SS";
    title = "歩く枚方地図";
    comment = level === "hard" ? "上級で全問一発正解。文句なしの最高ランクです！" : `${total}問連続で一発正解！ 枚方の地理が頭に入っています。`;
  } else if ((gaveUpCount === 0 && firstTry === total) || (gaveUpCount === 0 && score >= 90)) {
    grade = "S";
    title = "枚方マスター";
    comment =
      firstTry === total
        ? "全問一発正解！ ＋3問延長や上級で最高ランク「SS」が狙えます。"
        : "ほとんど迷わず正解。枚方の土地勘は相当なものです！";
  } else if (score >= 75) {
    grade = "A";
    title = "枚方ツウ";
    comment = "細かいエリアまでよくご存じです。＋3問延長で S ランクも狙えます！";
  } else if (score >= 55) {
    grade = "B";
    title = "枚方ウォーカー";
    comment = "主要エリアはしっかり把握。ヒントを手がかりに着実にたどり着けました。";
  } else if (score >= 35) {
    grade = "C";
    title = "枚方ビギナー";
    comment = "少しずつ距離感がつかめてきました。「地図で調べる」で予習すると一気に伸びます。";
  } else {
    grade = "D";
    title = "枚方たんけん中";
    comment = "まずは「川と線路」「駅の位置」をオンにして再挑戦してみるのがおすすめです。";
  }

  return { total, cleared, firstTry, gaveUpCount, totalMiss, score, accuracy, bonus: levelBonus + countBonus, grade, title, comment };
}

  const renderSummary = () => {
    sound.finish();
    $promptBox.hidden = true;
    $card.hidden = true;
    clearMapMarks();
    resetCam();

    const ev = evaluateResult(records, level);
    const levelLabel = level === "easy" ? "入門" : level === "normal" ? "標準" : "上級";
    const badges = records
      .map((r) => (r.gaveUp ? "⬜" : r.misses === 0 ? "🟩" : r.misses <= 2 ? "🟨" : "🟧"))
      .join("");
    const shareTitle = `枚方市地図クイズ（${levelLabel}・${ev.total}問）【${ev.grade}ランク・${ev.title}】${ev.cleared}/${ev.total}問正解（一発正解 ${ev.firstTry}問・スコア ${ev.score}点）\n${badges} #枚方pedia`;
    lastShareText = `${shareTitle}\n${QUIZ_URL}`;

    const urls = buildShareUrls(shareTitle, QUIZ_URL);
    for (const a of $shareLinks) {
      const k = a.dataset.shareLink!;
      if (urls[k]) a.href = urls[k];
    }

    for (const r of records) {
      const p = pathById.get(r.district.id)!;
      p.classList.add(r.gaveUp ? "is-heat-3" : "is-correct");
      bringToFront(p);
      addLabel(r.district, "is-correct");
    }

    const rankClass = ev.grade === "SS" || ev.grade === "S" ? "is-top" : ev.grade === "A" || ev.grade === "B" ? "is-good" : "is-base";
    const bonusTxt = ev.bonus > 0 ? `（難易度・問題数ボーナス +${ev.bonus}）` : "";

    $summaryBody.innerHTML = `
      <h2>クイズ結果（${esc(levelLabel)}・${ev.total}問）</h2>
      <div class="mq-rank ${rankClass}">
        <div class="mq-rank-badge" aria-label="${ev.grade}ランク"><span>RANK</span><strong>${ev.grade}</strong></div>
        <div class="mq-rank-info">
          <p class="mq-rank-title">${esc(ev.title)}</p>
          <p class="mq-rank-pts">スコア <strong>${ev.score}</strong> / 100点${bonusTxt}</p>
          <p class="mq-rank-comment">${esc(ev.comment)}</p>
        </div>
      </div>
      <p class="mq-summary-score"><strong>${ev.cleared} / ${ev.total} 問</strong> 正解（一発正解 <strong>${ev.firstTry} 問</strong>・ミス合計 ${ev.totalMiss} 回）</p>
      <p class="mq-summary-badges" aria-label="正答パターン">${badges}</p>
      <ol class="mq-summary-list">
        ${records
          .map(
            (r) =>
              `<li><span class="mq-res-name">${rubyOf(r.district)}</span><span class="mq-res-stat">${r.gaveUp ? "答えを見る" : r.misses === 0 ? "一発正解" : `${r.misses}回ミス`}（人口 ${fmt(r.district.pop)}人）</span></li>`,
          )
          .join("")}
      </ol>
    `;

    const remaining = deck.length - queue.length;
    $extendBtn.hidden = remaining <= 0;
    if (remaining > 0) {
      const addN = Math.min(ROUND_SIZE, remaining);
      $extendBtn.textContent = `＋${addN}問 延長する（残り ${remaining} 地区）`;
    }
    $shareCopied.hidden = true;
    $summary.hidden = false;
  };

  $extendBtn.addEventListener("click", extendQuiz);
  $retryBtn.addEventListener("click", startQuiz);
  $shareCopy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(lastShareText);
      $shareCopied.textContent = "コピーしました";
    } catch {
      $shareCopied.textContent = "コピーできませんでした";
    }
    $shareCopied.hidden = false;
    setTimeout(() => ($shareCopied.hidden = true), 2500);
  });

  // --- 地図で調べる（予習・データ図鑑）モード ---
  const showExploreDistrict = (d: District) => {
    clearMapMarks();
    const poly = pathById.get(d.id)!;
    poly.classList.add("is-selected");
    bringToFront(poly);
    addLabel(d, "is-correct");
    focusDistrict(d, 0.5);
    $card.innerHTML = renderCardHtml(d, data.city, notes[d.name]);
    $card.hidden = false;
  };

  const renderExploreList = () => {
    const q = $exploreQ.value.trim();
    const matched = q ? data.districts.filter((d) => d.name.includes(q) || d.yomi.includes(q)) : data.districts.slice(0, 20);
    $exploreList.innerHTML = matched
      .slice(0, 24)
      .map((d) => `<li><button type="button" data-pick="${d.id}">${rubyOf(d)}</button></li>`)
      .join("");
  };
  $exploreQ.addEventListener("input", renderExploreList);
  $exploreList.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-pick]");
    if (!b?.dataset.pick) return;
    const d = byId.get(b.dataset.pick);
    if (d) showExploreDistrict(d);
  });

  // --- 地区クリック時の共通ハンドラ ---
  function onPickDistrict(id: string) {
    const picked = byId.get(id);
    if (!picked) return;

    if (mode === "explore") {
      showExploreDistrict(picked);
      return;
    }

    if (!current || solved) return;
    if (picked.id === current.id) {
      finishQuestion(false);
      return;
    }

    const { km, dir, deg } = distAndDir(picked, current);
    const heat = heatLevel(km);
    sound.miss(heat);
    addPulse(picked, "miss");

    for (const p of pathById.values()) p.classList.remove("is-last-pick");
    const poly = pathById.get(picked.id)!;
    poly.classList.add(`is-heat-${heat}`, "is-last-pick");
    bringToFront(poly);

    let addedHint = false;
    if (!triedIds.has(picked.id)) {
      triedIds.add(picked.id);
      misses++;
      addLabel(picked, "is-miss");
      if (shownHints < currentHints.length) {
        shownHints++;
        addedHint = true;
      }
    }

    $feedback.innerHTML =
      `<span class="mq-fb-badge">✕</span>` +
      `<div class="mq-fb-main">` +
        `<div><strong>「${rubyOf(picked)}」はハズレ</strong> <span class="mq-heat-tag is-heat-${heat}">${HEAT_LABELS[heat]}</span></div>` +
        `<div class="mq-fb-dir">${arrowSvg(deg)}<span>ここから <strong>${dir}へ 約 ${km.toFixed(1)} km</strong></span></div>` +
      `</div>`;
    triggerFeedbackAnim("is-miss");
    showToast(`✕ ${esc(picked.name)}　${arrowSvg(deg)} ${dir}へ 約${km.toFixed(1)}km`, "miss");
    renderHints(addedHint);
  }

  // --- ボタン操作 ---
  $hintBtn.addEventListener("click", () => {
    if (!current || solved || shownHints >= currentHints.length) return;
    shownHints++;
    sound.hint();
    renderHints(true);
  });
  $giveUpBtn.addEventListener("click", () => finishQuestion(true));
  const goNext = () => {
    if (qIndex + 1 < queue.length) {
      qIndex++;
      startQuestion();
    } else {
      renderSummary();
    }
  };
  $nextBtn.addEventListener("click", goNext);
  $dialogNext.addEventListener("click", goNext);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$dialog.hidden) {
      closeDialog();
      return;
    }
    if (mode !== "quiz" || !solved || !$summary.hidden) return;
    if (e.key === "Enter" && !(e.target as HTMLElement).closest("button, a, input, select")) {
      e.preventDefault();
      goNext();
    }
  });

  const renderNotesList = () => {
    if (!$notesView || !$notesQ || !$notesFilter || !$notesCount || !$notesList) return;
    const q = $notesQ.value.trim().normalize("NFKC").toLowerCase();
    const flt = $notesFilter.value;
    if (flt === "__empty__") {
      const missing = data.districts.filter((d) => !notes[d.name] && (!q || `${d.name} ${d.yomi}`.normalize("NFKC").toLowerCase().includes(q)));
      $notesCount.textContent = `未記入 ${missing.length} 地区`;
      $notesList.innerHTML = missing
        .map(
          (d) =>
            `<li class="mq-notes-item is-empty">` +
              `<div class="mq-notes-head"><strong>${rubyOf(d)}</strong><button type="button" class="copy-btn" data-show-on-map="${d.id}">地図で見る</button></div>` +
              `<p class="mq-note-src">人口 ${fmt(d.pop)}人（${d.popRank}位）・面積 ${d.area.toFixed(2)} km²</p>` +
            `</li>`,
        )
        .join("");
      return;
    }
    const entries = Object.entries(notes).filter(([name, n]) => {
      if (flt && n.tag !== flt) return false;
      if (!q) return true;
      const yomi = byName.get(name)?.yomi ?? "";
      return `${name} ${yomi} ${n.text} ${n.source ?? ""}`.normalize("NFKC").toLowerCase().includes(q);
    });
    const total = Object.keys(notes).length;
    $notesCount.textContent = entries.length === total ? `${total} 地区` : `${entries.length} 地区（全 ${total} 地区）`;
    $notesList.innerHTML = entries
      .map(([name, n]) => {
        const d = byName.get(name);
        const kind = n.tag === "伝承・噂" ? "rumor" : n.tag === "記事あり" ? "article" : "trivia";
        return (
          `<li class="mq-notes-item is-${kind}">` +
            `<div class="mq-notes-head">` +
              `<span class="mq-notes-title"><strong>${d ? rubyOf(d) : esc(name)}</strong><span class="mq-admin-tag is-${kind}">${esc(n.tag)}</span></span>` +
              (d ? `<button type="button" class="copy-btn" data-show-on-map="${d.id}">地図で見る</button>` : "") +
            `</div>` +
            `<p class="mq-note-text">${formatNoteText(n.text)}</p>` +
            (n.source ? `<p class="mq-note-src">出典：${renderSourceHtml(n.source)}</p>` : "") +
          `</li>`
        );
      })
      .join("");
  };
  $notesQ?.addEventListener("input", renderNotesList);
  $notesFilter?.addEventListener("change", renderNotesList);
  $notesList?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-show-on-map]");
    if (!b?.dataset.showOnMap) return;
    const d = byId.get(b.dataset.showOnMap);
    if (!d) return;
    setMode("explore");
    showExploreDistrict(d);
  });

  const setMode = (next: Mode) => {
    mode = next;
    for (const b of $modeBtns) b.setAttribute("aria-pressed", String(b.dataset.mode === next));
    $levelWrap.hidden = next !== "quiz";
    $stage.hidden = next === "notes";
    if ($notesView) $notesView.hidden = next !== "notes";
    $exploreBox.hidden = next !== "explore";
    $summary.hidden = true;
    if (next === "notes") {
      renderNotesList();
      return;
    }
    for (const [id, p] of pathById) {
      p.setAttribute("aria-label", next === "explore" ? byId.get(id)!.name : "地区を選択");
    }
    if (next === "quiz") {
      startQuiz();
    } else {
      $promptBox.hidden = true;
      $card.hidden = true;
      clearMapMarks();
      resetCam();
      renderExploreList();
    }
  };
  for (const b of $modeBtns) b.addEventListener("click", () => setMode(b.dataset.mode as Mode));
  $levelSel.addEventListener("change", () => {
    level = $levelSel.value as Level;
    if (mode === "quiz") startQuiz();
  });

  // 初期起動
  setMode("quiz");
}
