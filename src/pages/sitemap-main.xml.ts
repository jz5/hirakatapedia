import type { APIRoute } from "astro";
import { allArticles, articlePath, lastModified } from "../lib/articles";
import { publicGallery, galleryPath } from "../lib/photos.mjs";
import { datasets, dataPath } from "../lib/datasets";
import { urlset } from "../lib/sitemap";

/** 記事・データ・SNS などのページ（写真ギャラリーの写真のページは /sitemap-gallery-<n>.xml） */
export const GET: APIRoute = async () => {
  const list = await allArticles();
  return urlset([
    { loc: "/", lastmod: list[0] ? lastModified(list[0]) : undefined },
    { loc: "/gallery/" },
    { loc: "/data/" },
    ...datasets.map((d) => ({ loc: dataPath(d.id) })),
    { loc: "/data/city/" },
    { loc: "/data/links/" },
    { loc: "/sns/" },
    { loc: "/about/" },
    { loc: "/privacy/" },
    { loc: "/license/" },
    ...list.map((e) => ({ loc: articlePath(e.id), lastmod: lastModified(e) })),
    ...list.filter((e) => publicGallery(e.id).length > 0).map((e) => ({ loc: galleryPath(e.id) })),
  ]);
};
