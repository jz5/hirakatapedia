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
    /** 中身を足したり直したりした日。公開日と同じなら書かない */
    updated: z.coerce.date().optional(),
    /** 書きかけの記事。右の列に「書きかけです。写真・情報を募集しています」と出す */
    wip: z.boolean().default(false),
    /** true のものはビルドに含めない */
    draft: z.boolean().default(false),
  }),
});

export const collections = { articles };
