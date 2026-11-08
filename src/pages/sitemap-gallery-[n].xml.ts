import type { APIRoute, GetStaticPaths } from "astro";
import { photos, galleryPath } from "../lib/gallery";
import { GALLERY_PER, urlset } from "../lib/sitemap";

/** 写真ギャラリーの写真のページ（GALLERY_PER 件ずつ） */
export const getStaticPaths = (() => Array.from({ length: Math.max(1, Math.ceil(photos.length / GALLERY_PER)) }, (_, n) => ({ params: { n: String(n) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => {
  const n = Number(params.n);
  return urlset(photos.slice(n * GALLERY_PER, (n + 1) * GALLERY_PER).map((p) => ({ loc: galleryPath(p.id) })));
};
