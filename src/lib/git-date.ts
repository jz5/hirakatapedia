/**
 * ファイルの最終更新日（Git の最後のコミットの日。`2026-11-09` の形）。記事でないページ（このサイトについて など）の「最終更新」に使う。
 * ビルドは手元（Git の作業ツリー）でするので、git log で取れる。まだコミットしていない変更があるときは、今日の日付
 */
import { execFileSync } from "node:child_process";

export function gitDate(file: string): string | undefined {
  try {
    const dirty = execFileSync("git", ["status", "--porcelain", "--", file], { encoding: "utf8" }).trim();
    if (dirty) return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    return execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export const jaYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};
