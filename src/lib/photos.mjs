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
 *   file: string, caption: string, pick?: boolean, seen?: boolean, hide?: boolean, note?: string,
 *   page: string, author: string, license: string, licenseUrl: string, date: string, description: string,
 *   original: { width: number, height: number }, small: Img, large: Img, fetched: string, edited?: string, sourceName?: string, kind?: string
 * }} Photo
 */

const root = process.cwd();
const data = () => JSON.parse(readFileSync(join(root, "content/data/photos.json"), "utf8"));

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
    return { ...p, ...info };
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
