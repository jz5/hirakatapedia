export const SITE = {
  title: "枚方pedia",
  reading: "ひらかたペディア",
  description: "枚方市のことを、昔の雑誌や新聞までさかのぼって、出典つきでくわしくまとめるサイトです。",
  url: "https://hirakata.pronama.jp",
  lang: "ja",
} as const;

/**
 * 運営者。きちんと書くところ（このサイトについて・プライバシーポリシー・構造化データ）は「合同会社プロ生」、
 * コピーライトの表記は「Pronama LLC」
 */
export const OPERATOR = {
  name: "合同会社プロ生",
  nameEn: "Pronama LLC",
  url: "https://pronama.jp/",
} as const;

/** 記事を書いている人 */
export const AUTHOR = {
  name: "jz5",
  url: "https://jz5.jp/",
} as const;

/** 記事のライセンス。Wikipedia と同じ CC BY-SA 4.0 */
export const LICENSE = {
  name: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/deed.ja",
} as const;

/**
 * アクセス解析（GA4）。測定 ID が空なら何も出さない。
 * ID はページのソースに出るので秘密ではない。GA の「pronama」アカウントの、プロパティ「枚方pedia」（563218344）。
 * 本番のホストで開いたときだけ読み込む（src/components/Analytics.astro）。
 *
 *   PUBLIC_GA_ID=G-XXXXXXXXXX pnpm build   別の ID で試すとき
 */
export const ANALYTICS = {
  gaId: import.meta.env.PUBLIC_GA_ID ?? "G-3BC49ZS80R",
  /** true のとき計測しない（手元で見るときなど） */
  disabled: import.meta.env.PUBLIC_NO_TRACKING === "1",
} as const;
