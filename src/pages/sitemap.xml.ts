import type { APIRoute } from "astro";
import { allArticles, articlePath, lastModified } from "../lib/articles";
import { SITE } from "../lib/site";

export const GET: APIRoute = async () => {
  const list = await allArticles();
  const urls = [
    { loc: "/", lastmod: list[0] ? lastModified(list[0]) : undefined },
    { loc: "/about/", lastmod: undefined },
    { loc: "/privacy/", lastmod: undefined },
    { loc: "/license/", lastmod: undefined },
    ...list.map((e) => ({ loc: articlePath(e.id), lastmod: lastModified(e) })),
  ];
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${new URL(u.loc, SITE.url).href}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString().slice(0, 10)}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
