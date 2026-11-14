/**
 * Amazon アソシエイトのトラッキング ID（例 "xxxx-22"）。空なら付けない。
 * 入れると、関連リンクの本のカード（frontmatter の links の isbn）の Amazon へのリンクに ?tag= と rel="sponsored" が付き、
 * /privacy/ の「広告について」に規約で必要な一文が出る。
 * rehype のプラグイン（.mjs）からも読むので、site.ts ではなくここに置く。
 */
export const AMAZON_TAG = "";

/** Amazon の URL に、トラッキング ID があれば付ける */
export function amazonUrl(url) {
  if (!AMAZON_TAG || !/^https:\/\/www\.amazon\.co\.jp\//.test(url)) return url;
  const u = new URL(url);
  u.searchParams.set("tag", AMAZON_TAG);
  return u.toString();
}
