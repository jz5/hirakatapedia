import type { APIRoute } from "astro";
import { allArticles, articlePath, lastModified } from "../lib/articles";
import { publicGallery, galleryPath } from "../lib/photos.mjs";
import { datasets, dataPath } from "../lib/datasets";
import { galleryFetched } from "../lib/gallery";
import { readSns, type SnsData } from "../lib/yaml-data";
import { gitDate } from "../lib/git-date";
import { urlset } from "../lib/sitemap";
import catalog from "../../content/data/opendata-catalog.json";

const toDate = (s?: string) => {
  if (!s) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** 記事・データ・SNS などのページ（写真ギャラリーの写真のページは /sitemap-gallery-<n>.xml） */
export const GET: APIRoute = async () => {
  const list = await allArticles();
  const sns = readSns<SnsData>();
  return urlset([
    { loc: "/", lastmod: list[0] ? lastModified(list[0]) : undefined },
    { loc: "/gallery/", lastmod: toDate(galleryFetched) },
    { loc: "/gallery/contribute/", lastmod: toDate(gitDate("src/pages/gallery/contribute.astro")) },
    { loc: "/data/", lastmod: toDate(catalog.generated) },
    ...datasets.map((d) => ({ loc: dataPath(d.id), lastmod: toDate(d.fetched) })),
    { loc: "/data/city/", lastmod: toDate(catalog.generated) },
    { loc: "/data/links/", lastmod: toDate(catalog.generated) },
    { loc: "/data/chikei/", lastmod: toDate(gitDate("src/pages/data/chikei.astro")) },
    { loc: "/data/map-quiz/", lastmod: toDate(gitDate("src/pages/data/map-quiz.astro")) },
    { loc: "/sns/", lastmod: toDate(sns.checked) },
    { loc: "/about/", lastmod: toDate(gitDate("src/pages/about.astro")) },
    { loc: "/privacy/", lastmod: toDate(gitDate("src/pages/privacy.astro")) },
    { loc: "/license/", lastmod: toDate(gitDate("src/pages/license.astro")) },
    ...list.map((e) => ({ loc: articlePath(e.id), lastmod: lastModified(e) })),
    ...list.filter((e) => publicGallery(e.id).length > 0).map((e) => ({ loc: galleryPath(e.id) })),
  ]);
};
