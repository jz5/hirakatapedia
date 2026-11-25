import type { APIRoute } from "astro";
import { allArticles, articlePath } from "../lib/articles";
import { SITE } from "../lib/site";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 記事の RSS 2.0 フィード（/feed.xml）。誤字修正のコミットで再浮上しないよう、frontmatter の updated／published を使う */
export const GET: APIRoute = async () => {
  const pubOf = (e: { data: { published: Date; updated?: Date } }) => e.data.updated ?? e.data.published;
  const list = (await allArticles()).sort((a, b) => pubOf(b).getTime() - pubOf(a).getTime());
  const base = `${SITE.url.replace(/\/$/, "")}/`;
  const self = `${SITE.url.replace(/\/$/, "")}/feed.xml`;
  const items = list
    .map((e) => {
      const link = new URL(articlePath(e.id), SITE.url).href;
      const date = pubOf(e).toUTCString();
      return (
        `    <item>\n` +
        `      <title>${esc(e.data.title)}</title>\n` +
        `      <link>${esc(link)}</link>\n` +
        `      <guid isPermaLink="true">${esc(link)}</guid>\n` +
        `      <pubDate>${date}</pubDate>\n` +
        `      <description>${esc(e.data.description)}</description>\n` +
        `    </item>`
      );
    })
    .join("\n");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n` +
    `  <channel>\n` +
    `    <title>${esc(SITE.title)}</title>\n` +
    `    <link>${esc(base)}</link>\n` +
    `    <atom:link href="${esc(self)}" rel="self" type="application/rss+xml" />\n` +
    `    <description>${esc(SITE.description)}</description>\n` +
    `    <language>${SITE.lang}</language>\n` +
    `${items}\n` +
    `  </channel>\n` +
    `</rss>\n`;

  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
