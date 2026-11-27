/** 記事本文の Markdown から出典・注釈の数とグラフの数を数える */
export function articleStats(body?: string): { sources: number; charts: number } {
  if (!body) return { sources: 0, charts: 0 };
  const sources = (body.match(/^\[\^[^\]]+\]:/gm) ?? []).length;
  const charts = (body.match(/<div\b[^>]*\bdata-chart="[^"]+"/g) ?? []).length;
  return { sources, charts };
}
