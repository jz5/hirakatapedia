/**
 * 記事の最終更新日。Git でその記事のファイル（content/articles/<slug>.md）を最後にコミットした日。
 * frontmatter の updated・published のほうが新しければそちら（公開の日より前に書いた下書きのコミットなど）。
 * まだコミットしていない変更があるときは今日（開発サーバーで見るとき）。
 * 記事のページ・ホームの一覧・サイトマップ（src/lib/articles.ts）と、関連記事の並び（rehype-link-cards.mjs）で使う。
 * ビルドは手元（Git の作業ツリー）でするので、git log で取れる
 */
import { execFileSync } from "node:child_process";

const cache = new Map();

function gitDay(file) {
  try {
    const dirty = execFileSync("git", ["status", "--porcelain", "--", file], { encoding: "utf8" }).trim();
    if (dirty) return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    return execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** `2026-11-16` の形の日付は UTC の 0 時として読む（frontmatter の日付と同じ） */
export function articleLastModified(slug, published, updated) {
  if (!cache.has(slug)) {
    const git = gitDay(`content/articles/${slug}.md`);
    const days = [published, updated, git].filter(Boolean).map((d) => new Date(d).getTime());
    cache.set(slug, new Date(Math.max(...days)));
  }
  return cache.get(slug);
}
