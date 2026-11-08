/**
 * サイトマップ。/sitemap.xml は目次（sitemapindex）で、中身は
 *   /sitemap-main.xml          記事・データ・SNS など
 *   /sitemap-gallery-<n>.xml   写真ギャラリーの写真のページ（PER 件ずつ。1 つのサイトマップは 5 万件まで）
 */
import { SITE } from "./site";

export const GALLERY_PER = 40000;
export interface Url {
  loc: string;
  lastmod?: Date;
}
export const urlset = (urls: Url[]) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((u) => `  <url><loc>${new URL(u.loc, SITE.url).href}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`).join("\n") +
      `\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
