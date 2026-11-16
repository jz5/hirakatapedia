import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * 記事の実体はリポジトリ直下の content/articles/ に置く。
 *
 * **ファイル名がそのまま URL になる**（tsutaya.md → /tsutaya/）。
 * 公開したあとはファイル名を変えない。
 */
const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./content/articles" }),
  schema: z.object({
    title: z.string(),
    /** 一覧と検索結果に出す説明。1〜2 文で */
    description: z.string(),
    published: z.coerce.date(),
    /** 最終更新は Git の最後のコミットの日から自動で出す（src/lib/article-date.mjs）。それより新しい日にしたいときだけ書く */
    updated: z.coerce.date().optional(),
    /**
     * 「出典・注釈」の前に並べるリンクのカード。url（ほかの記事は /slug/）か isbn と、なぜリンクするかの note。
     * カードの中身は node scripts/link-cards.mjs で取ってくる
     */
    links: z
      .array(z.object({ url: z.string().optional(), isbn: z.string().optional(), note: z.string() }))
      .default([]),
    /**
     * SNS で共有したときの画像と、ホームの一覧のサムネイル。content/galleries/<記事>.yaml の file。
     * 本文には出さない（本文の写真は、関係のある節に data-photo で入れる）。省略すると一覧は本文の最初の写真
     */
    cover: z.string().optional(),
    /** true のものはビルドに含めない */
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
