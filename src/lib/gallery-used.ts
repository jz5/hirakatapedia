/**
 * 写真ギャラリーの写真を、本文で使っている記事（content/articles/<記事>.md の <div data-photo="ファイル名">）。
 * 記事の写真一覧（content/galleries/<記事>.yaml）に入っているだけのものは数えない。
 * Commons のファイル名は「_」と空白のどちらでも書けるので、空白にそろえて比べる。
 * 写真のページごとに読み直さないように、ファイル名 → 記事の番号 の表を 1 回だけ作る
 */
const mds = import.meta.glob("../../content/articles/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const key = (file: string) => file.replace(/_/g, " ").trim();
const used = new Map<string, string[]>();
for (const [path, raw] of Object.entries(mds)) {
  const slug = path.split("/").pop()!.replace(/\.md$/, "");
  for (const m of raw.matchAll(/data-photo="([^"]+)"/g)) {
    const k = key(m[1]);
    const list = used.get(k) ?? [];
    if (!list.includes(slug)) used.set(k, [...list, slug]);
  }
}
export const articlesUsing = (file: string) => used.get(key(file)) ?? [];
