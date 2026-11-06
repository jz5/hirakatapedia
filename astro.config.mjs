// @ts-check
import { defineConfig } from "astro/config";
import rehypeSummary from "./src/lib/rehype-summary.mjs";
import rehypeCharts from "./src/lib/rehype-charts.mjs";

export default defineConfig({
  site: "https://hirakata.pronama.jp",

  // 記事の URL は /slug/ で末尾スラッシュあり。一度出したら変えない（CLAUDE.md）
  trailingSlash: "always",
  build: {
    // 末尾スラッシュの URL に合わせて、各ページを <path>/index.html として出す
    format: "directory",
  },

  markdown: {
    // 「## まとめ」の節を枠で囲む。<div data-chart="…"> をグラフにする
    rehypePlugins: [rehypeSummary, rehypeCharts],
    shikiConfig: { theme: "github-light", wrap: true },
    // 脚注は出典と注釈に使う。見出しは隠さずに「出典・注釈」と出す
    remarkRehype: {
      footnoteLabel: "出典・注釈",
      footnoteLabelProperties: {},
      footnoteBackLabel: "本文に戻る",
    },
  },
});
