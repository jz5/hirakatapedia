// @ts-check
import { defineConfig } from "astro/config";
import rehypeSummary from "./src/lib/rehype-summary.mjs";
import rehypeCharts from "./src/lib/rehype-charts.mjs";
import rehypeLinkCards from "./src/lib/rehype-link-cards.mjs";
import rehypePhotos from "./src/lib/rehype-photos.mjs";

/**
 * 管理者ページ（/admin/）。調べもののメモと確認リスト、写真の候補を見る。
 * 開発サーバー（pnpm dev）のときだけ足すので、公開用のビルドには入らない
 */
/** @type {import("astro").AstroIntegration} */
const admin = {
  name: "hirakatapedia-admin",
  hooks: {
    "astro:config:setup": ({ command, injectRoute }) => {
      if (command !== "dev") return;
      injectRoute({ pattern: "/admin", entrypoint: "./src/admin/index.astro" });
      injectRoute({ pattern: "/admin/notes/[note]", entrypoint: "./src/admin/note.astro" });
      injectRoute({ pattern: "/admin/photos", entrypoint: "./src/admin/photos.astro" });
    },
  },
};

export default defineConfig({
  integrations: [admin],
  site: "https://hirakata.pronama.jp",

  // 記事の URL は /slug/ で末尾スラッシュあり。一度出したら変えない（CLAUDE.md）
  trailingSlash: "always",
  build: {
    // 末尾スラッシュの URL に合わせて、各ページを <path>/index.html として出す
    format: "directory",
  },

  markdown: {
    // 「## まとめ」の節を枠で囲む。<div data-chart="…"> をグラフに、<div data-photo="…"> を写真にする。
    // frontmatter の links を「関連リンク」のカードにする
    rehypePlugins: [rehypeSummary, rehypeCharts, rehypePhotos, rehypeLinkCards],
    shikiConfig: { theme: "github-light", wrap: true },
    // 脚注は出典と注釈に使う。見出しは隠さずに「出典・注釈」と出す
    remarkRehype: {
      footnoteLabel: "出典・注釈",
      footnoteLabelProperties: {},
      footnoteBackLabel: "本文に戻る",
    },
  },
});
