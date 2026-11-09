import { getCollection } from "astro:content";
import popular from "../../content/popular.json";

/** 下書きを除いた記事。更新日（なければ公開日）の新しい順 */
export async function allArticles() {
  const list = await getCollection("articles", (e) => !e.data.draft);
  return list.sort((a, b) => lastModified(b).getTime() - lastModified(a).getTime());
}

/**
 * よく読まれている記事（サイドバーは 3 件）。content/popular.json の slugs（GA の数字から）の順。
 * 足りないときは fill（手で選んだ順）で足す。載っていない記事やまだ無い slug は飛ばす
 */
export async function popularArticles(limit = 3) {
  const list = await allArticles();
  const byId = new Map(list.map((e) => [e.id, e]));
  const fill = (popular as { fill?: string[] }).fill ?? [];
  return [...new Set([...popular.slugs, ...fill])].flatMap((s) => byId.get(s) ?? []).slice(0, limit);
}

export const lastModified = (e: { data: { published: Date; updated?: Date } }) =>
  e.data.updated ?? e.data.published;

export const articlePath = (id: string) => `/${id}/`;

/**
 * 日付の表記。`2026年11月6日` の形。
 * frontmatter の `2026-11-06` は YAML の日付で、UTC の 0 時として読まれる。
 * 現地時刻の getter だと、UTC より西のマシンでビルドすると前の日になるので、UTC で組む。
 */
export const jaDate = (d: Date) => `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
