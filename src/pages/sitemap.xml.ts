import type { APIRoute } from "astro";
import { SITE } from "../lib/site";
import { photos } from "../lib/gallery";
import { GALLERY_PER } from "../lib/sitemap";

/** サイトマップの目次（src/lib/sitemap.ts） */
export const GET: APIRoute = () => {
  const files = ["/sitemap-main.xml", ...Array.from({ length: Math.max(1, Math.ceil(photos.length / GALLERY_PER)) }, (_, n) => `/sitemap-gallery-${n}.xml`)];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      files.map((f) => `  <sitemap><loc>${new URL(f, SITE.url).href}</loc></sitemap>`).join("\n") +
      `\n</sitemapindex>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
