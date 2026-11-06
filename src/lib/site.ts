export const SITE = {
  title: "枚方pedia",
  reading: "ひらかたペディア",
  description: "枚方市のことを、昔の雑誌や新聞までさかのぼって、出典つきでくわしくまとめるサイトです。",
  url: "https://hirakata.pronama.jp",
  lang: "ja",
} as const;

/** 記事のライセンス。Wikipedia と同じ CC BY-SA 4.0 */
export const LICENSE = {
  name: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/deed.ja",
} as const;

/**
 * アクセス解析（GA4）。測定 ID が空なら何も出さない。
 * ID はページのソースに出るので秘密ではない。決まったら既定値に書く。
 *
 *   PUBLIC_GA_ID=G-XXXXXXXXXX pnpm build
 */
export const ANALYTICS = {
  gaId: import.meta.env.PUBLIC_GA_ID ?? "",
  /** true のとき計測しない（手元で見るときなど） */
  disabled: import.meta.env.PUBLIC_NO_TRACKING === "1",
} as const;
