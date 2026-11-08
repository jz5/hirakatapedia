/**
 * 写真ギャラリーの集め方で共通に使うもの（設定・問い合わせ・日付・市の境界など）。
 * 出どころごとの集め方は scripts/gallery/<出どころ>.mjs、まとめて動かすのは scripts/gallery.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const ROOT = process.cwd();
export const CONFIG = parse(readFileSync(join(ROOT, "content/data/gallery-config.yaml"), "utf8"));
export const DATA_DIR = join(ROOT, "content/data/gallery");
export const UA = "hirakatapedia/1.0 (https://hirakata.pronama.jp)";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const strip = (s = "") =>
  String(s ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** 写真の番号。ファイル名（出どころの中で重ならない名前）から作る */
export const galleryId = (file) => createHash("sha1").update(file).digest("hex").slice(0, 10);

/** .env の値（無ければ環境変数） */
export function env(key) {
  if (process.env[key]) return process.env[key];
  const f = join(ROOT, ".env");
  if (!existsSync(f)) return "";
  const m = readFileSync(f, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

/** 撮った日。「2008-04-12 10:00:00」「2008年4月12日」「20080412」「1960s」などから、年と日付 */
export function when(s = "") {
  const t = strip(s).replace(/[‎‏‪-‮]/g, "");
  const d = t.match(/((?:18|19|20)\d{2})[-:/年.]?\s*(\d{1,2})[-:/月.]?\s*(\d{1,2})(?!\d)/);
  if (d && Number(d[2]) >= 1 && Number(d[2]) <= 12 && Number(d[3]) >= 1 && Number(d[3]) <= 31)
    return { date: `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`, year: Number(d[1]) };
  const y = t.match(/((?:18|19|20)\d{2})/);
  return y ? { date: null, year: Number(y[1]) } : { date: null, year: null };
}

/** JSON を取ってくる。うまくいかなければ少し待って 3 回まで */
export async function getJson(url, { gap = 300, headers = {} } = {}) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA, ...headers } });
    if (r.ok) {
      await sleep(gap);
      return r.json();
    }
    if (r.status === 404) throw new Error(`404 ${url}`);
    await sleep(2000 * (i + 1));
  }
  throw new Error(`取れなかった ${url}`);
}

export async function getText(url, { gap = 300 } = {}) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.ok) {
      await sleep(gap);
      return r.text();
    }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`取れなかった ${url}`);
}

/** 枚方市の境界（OpenStreetMap）。経度・緯度の組 */
export const BOUNDARY = JSON.parse(readFileSync(join(ROOT, "content/data/hirakata-boundary.json"), "utf8")).coordinates;
const lons = BOUNDARY.map((p) => p[0]), lats = BOUNDARY.map((p) => p[1]);
/** 市の範囲（西・南・東・北） */
export const BBOX = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];

/** 点が市の中か（経度・緯度） */
export function inside(lon, lat, poly = BOUNDARY) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 文に出てくる場所の名前（設定の labels の日本語・英語）から、場所と分類 */
export function placesIn(text) {
  const lower = text.toLowerCase();
  const hit = Object.entries(CONFIG.labels ?? {}).filter(([cat, ja]) => ja.length >= 2 && (text.includes(ja) || lower.includes(cat.toLowerCase())));
  return {
    places: [...new Set(hit.map(([, ja]) => ja))].filter((l) => !Object.values(CONFIG.groups).includes(l) && l !== "枚方市"),
    groups: [...new Set(hit.map(([cat]) => CONFIG.groups[cat]).filter(Boolean))],
  };
}

/** 出どころごとのファイル（content/data/gallery/<出どころ>.json） */
export const siteFile = (site) => join(DATA_DIR, `${site}.json`);
export function readSite(site) {
  const f = siteFile(site);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
export function writeSite(site, source, photos, extra = {}) {
  mkdirSync(DATA_DIR, { recursive: true });
  photos.sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(
    siteFile(site),
    JSON.stringify({ _source: source, fetched: new Date().toLocaleDateString("sv-SE"), ...extra, photos }, null, 1) + "\n",
  );
  console.log(`${site}: ${photos.length} 枚を書き出した`);
}

/** 写真 1 枚の記録の形をそろえる（足りない項目を埋める） */
export const photo = (p) => ({
  id: galleryId(p.file),
  desc: null,
  date: null,
  year: null,
  lat: null,
  lon: null,
  groups: [],
  places: [],
  thumb: "",
  ...p,
  lat: p.lat == null ? null : Math.round(p.lat * 1e6) / 1e6,
  lon: p.lon == null ? null : Math.round(p.lon * 1e6) / 1e6,
});
