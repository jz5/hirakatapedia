/**
 * 写真ギャラリーの一覧のデータ（ブラウザが読む）。10 万枚でも読めるように、5,000 枚ずつのファイルに分ける。
 *   /gallery/index/meta.json  枚数・ファイルの数と、分類・場所・撮影者・出どころの名前の表（行は番号で指す）
 *   /gallery/index/<n>.json   写真の行。並びは既定の並び（撮った年の新しい順）。1 行：
 *     [番号, 説明, 年, 分類の番号[], 場所の番号[], 緯度, 経度, 撮影者の番号, ライセンスの種類（pd・by・sa・nd）, 出どころの番号, 横÷縦]
 */
import { CHUNK, SITE_NAMES, caption, licenseKind, photos, galleryFetched, type GallerySite } from "./gallery";

const table = (list: string[]) => {
  const names = [...new Set(list)].sort((a, b) => a.localeCompare(b, "ja"));
  return { names, index: new Map(names.map((n, i) => [n, i])) };
};
const groups = table(photos.flatMap((p) => p.groups));
const places = table(photos.flatMap((p) => p.places));
const authors = table(photos.map((p) => p.author.name));
const sites = Object.keys(SITE_NAMES) as GallerySite[];
const r5 = (x: number | null) => (x === null ? null : Math.round(x * 1e5) / 1e5);

export const indexMeta = () => ({
  total: photos.length,
  chunk: CHUNK,
  chunks: Math.ceil(photos.length / CHUNK),
  fetched: galleryFetched,
  groups: groups.names,
  places: places.names,
  authors: authors.names,
  sites,
});

export const indexChunk = (n: number) =>
  photos
    .slice(n * CHUNK, (n + 1) * CHUNK)
    .map((p) => [
      p.id,
      caption(p),
      p.year,
      p.groups.map((g) => groups.index.get(g)),
      p.places.map((g) => places.index.get(g)),
      r5(p.lat),
      r5(p.lon),
      authors.index.get(p.author.name),
      licenseKind(p.license),
      sites.indexOf(p.site),
      Math.round((p.width / p.height) * 1000) / 1000,
    ]);
