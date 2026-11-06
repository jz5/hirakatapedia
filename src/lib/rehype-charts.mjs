/**
 * 記事の Markdown に `<div data-chart="名前"></div>` と書くと、ビルドのときにグラフ（SVG）に置き換える。
 * グラフの中身は src/lib/chart-defs.mjs に名前ごとに書く。
 */
import { charts } from "./chart-defs.mjs";

function walk(node, fn) {
  if (!node.children) return;
  node.children = node.children.map((c) => fn(c) ?? c);
  for (const c of node.children) walk(c, fn);
}

export default function rehypeCharts() {
  return (tree, file) => {
    walk(tree, (node) => {
      // Markdown の中の HTML は、Astro では raw のまま届く
      const name =
        node.type === "element"
          ? node.properties?.dataChart
          : node.type === "raw"
            ? node.value.match(/^\s*<div data-chart="([^"]+)"><\/div>\s*$/)?.[1]
            : undefined;
      if (!name) return;
      const make = charts[name];
      if (!make) {
        file.fail(`グラフ「${name}」は src/lib/chart-defs.mjs にありません`);
      }
      return { type: "raw", value: make() };
    });
  };
}
