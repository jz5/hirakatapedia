/**
 * 枚方の写真ギャラリー（/gallery/）。写真の情報は出どころごとに content/data/gallery/<出どころ>.json（node scripts/gallery.mjs collect）、
 * 画像は public/gallery/i/<番号の先頭 2 文字>/<番号>-s.avif（一覧用 480px）・-l.avif（大きい 1600px）（node scripts/gallery.mjs images。Git の外）。
 * 写真の並びは、撮った年の新しい順（同じ年の中は撮った日、番号の順）。一覧の既定の並びと、写真のページの「前・次」はこの順
 */
export type GallerySite = "commons" | "flickr" | "city" | "gsi" | "jpsearch" | "omlib" | "ndl" | "mapillary";
/** 出どころの名前（絞り込みの選択肢）。並びもこの順 */
export const SITE_NAMES: Record<GallerySite, string> = {
  commons: "Wikimedia Commons",
  flickr: "Flickr",
  city: "枚方市",
  gsi: "国土地理院（空中写真）",
  jpsearch: "Japan Search",
  omlib: "大阪市立図書館",
  ndl: "国立国会図書館",
  mapillary: "Mapillary",
};

export interface GalleryPhoto {
  id: string;
  site: GallerySite;
  file: string;
  title: string;
  desc: string | null;
  author: { name: string; url: string };
  license: string;
  licenseUrl: string;
  source: string;
  /** 出典のページの名前（「Wikimedia Commons」「枚方市「ひらかた市 オープンデータ画像集」」など） */
  sourceName?: string;
  /** 使うときの表記の例。出どころが決めた形があるとき（市の表示例、国土地理院の出典の書き方） */
  credit?: string;
  /** このサイトで手を加えたこと（地理院タイルのつなぎ合わせなど） */
  edited?: string;
  date: string | null;
  year: number | null;
  lat: number | null;
  lon: number | null;
  groups: string[];
  places: string[];
  width: number;
  height: number;
  /** 取ってきた画像の URL（JPEG など）。SNS で共有したときの画像（og:image）にも使う。空のこともある */
  thumb: string;
}

const files = import.meta.glob("../../content/data/gallery/*.json", { eager: true, import: "default" }) as Record<string, { fetched: string; photos: GalleryPhoto[] }>;
const all = Object.values(files);

/** いちばん新しく集めた日 */
export const galleryFetched: string = all.map((f) => f.fetched).sort().pop() ?? "";

/** 撮った年の新しい順（年の無いものは最後）。同じ年は撮った日の新しい順、そのあとは番号の順 */
export const photos: GalleryPhoto[] = all
  .flatMap((f) => f.photos)
  .sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));

export const galleryPath = (id: string) => `/gallery/${id}/`;
const imgDir = (id: string) => `/gallery/i/${id.slice(0, 2)}/${id}`;
export const thumbSrc = (id: string) => `${imgDir(id)}-s.avif`;
export const largeSrc = (id: string) => `${imgDir(id)}-l.avif`;

/** 一覧と見出しに出す説明。Commons の説明（日本語があれば日本語）、なければ題名 */
export const caption = (p: GalleryPhoto) => {
  if (p.site !== "commons") return p.title;
  const d = p.desc?.replace(/\s*-\s*panoramio$/i, "").trim();
  return d && d.length >= 2 ? d : p.title.replace(/\s*-\s*panoramio$/i, "");
};

/** 縮小したときの大きさ（縦横の比はそのまま） */
export const fit = (p: GalleryPhoto, max: number) => {
  const s = Math.min(1, max / Math.max(p.width, p.height));
  return { width: Math.round(p.width * s), height: Math.round(p.height * s) };
};

export const siteName = (p: GalleryPhoto) => p.sourceName ?? SITE_NAMES[p.site];

/** 使うときの表記の例（出どころが決めた形があればそれ、なければ 撮影者／ライセンス／出典のサイト） */
export const credit = (p: GalleryPhoto) => p.credit ?? `写真：${p.author.name}／${p.license}／${siteName(p)}`;

export const decade = (y: number | null) => (y ? `${Math.floor(y / 10) * 10}年代` : "撮影年不明");

/**
 * ライセンスを、使うときの条件で分ける。pd：表記不要（CC0・パブリックドメイン）、by：表記（CC BY・Attribution・国土地理院の利用規約）、
 * sa：表記＋改変したものは同じライセンスで（CC BY-SA）、nd：表記＋改変禁止（CC BY-ND）
 */
export type LicenseKind = "pd" | "by" | "sa" | "nd";
export const licenseKind = (license: string): LicenseKind =>
  /^CC BY-SA/.test(license) ? "sa" : /^CC BY-ND/.test(license) ? "nd" : /^(CC0|Public domain)/i.test(license) ? "pd" : "by";

/** 一覧のデータ（/gallery/index/<n>.json）の 1 つのファイルに入れる枚数 */
export const CHUNK = 5000;
