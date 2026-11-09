/**
 * 記事の写真。一覧は content/galleries/<記事>.yaml、作者・ライセンス・縮小した画像は content/data/photos.json
 * （node scripts/photos.mjs で作る）。本文の写真、アイキャッチ、写真ギャラリーのページがここを使う。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * @typedef {{ src: string, width: number, height: number }} Img
 * @typedef {{
 *   galleryId?: string, authorUrl?: string,
 *   file: string, caption: string, pick?: boolean, seen?: boolean, hide?: boolean, note?: string,
 *   page: string, author: string, license: string, licenseUrl: string, date: string, description: string,
 *   original: { width: number, height: number }, small: Img, large: Img, fetched: string, edited?: string, sourceName?: string, kind?: string
 * }} Photo
 */

const root = process.cwd();
const data = () => JSON.parse(readFileSync(join(root, "content/data/photos.json"), "utf8"));

/**
 * 写真ギャラリー（content/data/gallery/*.json）に入っている写真。ファイル名（Commons の「_」と空白はそろえる）→ 写真
 * 撮影者・ライセンス・出典は、写真ギャラリーにある写真はそちらを使う（記事と写真ギャラリーで表記をそろえる）。
 * 画像は記事用のもの（public/photos/。SNS で出る JPEG と、傾きなどを直したもの）を使う
 */
const key = (file) => file.replace(/_/g, " ").trim();
let galleryIndex;
const inGallery = (file) => {
  if (!galleryIndex) {
    galleryIndex = new Map();
    const dir = join(root, "content/data/gallery");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")))
      for (const g of JSON.parse(readFileSync(join(dir, f), "utf8")).photos) galleryIndex.set(key(g.file), g);
  }
  return galleryIndex.get(key(file));
};

/** 写真ギャラリーで外している写真（gallery-config.yaml の excludeFiles）。記事で使っていたら知らせる */
let excluded;
const isExcluded = (file) => {
  excluded ??= new Set(Object.keys(parse(readFileSync(join(root, "content/data/gallery-config.yaml"), "utf8")).excludeFiles ?? {}).map(key));
  return excluded.has(key(file));
};
const warned = new Set();
const warnOnce = (msg) => {
  if (!warned.has(msg)) console.warn(`[写真] ${msg}`);
  warned.add(msg);
};

/**
 * 写真の一覧がある記事（content/galleries/*.yaml）
 * @returns {string[]}
 */
export const gallerySlugs = () =>
  readdirSync(join(root, "content/galleries"))
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => f.replace(/\.yaml$/, ""));

/**
 * 記事の写真の一覧（hide を含む）。作者などをくっつけて返す。一覧がない記事は []
 * @param {string} slug
 * @returns {Photo[]}
 */
export function gallery(slug) {
  const path = join(root, "content/galleries", `${slug}.yaml`);
  if (!existsSync(path)) return [];
  const d = data();
  return (parse(readFileSync(path, "utf8")) ?? []).map((p) => {
    const info = d[p.file];
    if (!info) throw new Error(`写真「${p.file}」のデータがありません。node scripts/photos.mjs を回してください`);
    if (!p.hide && !p.seen) warnOnce(`${slug}.yaml の「${p.file}」は seen: true が無い（画像を見て説明を確かめる）`);
    if (!p.hide && isExcluded(p.file)) warnOnce(`${slug}.yaml の「${p.file}」は、写真ギャラリーで外している写真（gallery-config.yaml の excludeFiles）`);
    const g = inGallery(p.file);
    if (!g) return { ...p, ...info };
    // 写真ギャラリーにある写真は、撮影者・ライセンス・出典をそちらから。写真のページ（/gallery/<番号>/）へもつなぐ
    return { ...p, ...info, galleryId: g.id, author: g.author.name, authorUrl: g.author.url, license: g.license, licenseUrl: g.licenseUrl, page: g.source, sourceName: g.sourceName };
  });
}

/**
 * 写真ギャラリーのページに出す写真
 * @param {string} slug
 * @returns {Photo[]}
 */
export const publicGallery = (slug) => gallery(slug).filter((p) => !p.hide);

/**
 * 記事の一覧の中から1枚。記事の一覧にないファイルはエラー
 * @param {string} slug
 * @param {string} file
 * @returns {Photo}
 */
export function photo(slug, file) {
  const p = gallery(slug).find((x) => x.file === file);
  if (!p) throw new Error(`写真「${file}」は content/galleries/${slug}.yaml にありません`);
  if (p.hide) throw new Error(`写真「${file}」は ${slug}.yaml で hide なのに、本文かアイキャッチで使っている`);
  return p;
}

/** ライセンスの表記。「Public domain」は日本語に */
export const licenseLabel = (p) =>
  /^public domain$/i.test(p.license) ? "パブリックドメイン" : p.license === "Attribution" ? "出典を表示して利用可" : p.license;

/** どこで公開されている写真か（Wikimedia Commons、Flickr、地理院地図 など） */
export const sourceName = (p) => p.sourceName ?? "Wikimedia Commons";

/** クレジットの文（そのままコピーして使える形） */
export const creditText = (p) => `${p.kind ?? "写真"}：${p.author} / ${licenseLabel(p)} / ${sourceName(p)}${p.edited ? "（加工あり）" : ""}`;

export const galleryPath = (slug) => `/${slug}/photos/`;
