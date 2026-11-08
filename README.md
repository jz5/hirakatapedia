# 枚方pedia（ひらかたペディア）

大阪府枚方市のことを、出典つきでくわしくまとめるサイトです。

- サイト：https://hirakata.pronama.jp/
- 運営：合同会社プロ生（記事は jz5）

## このリポジトリ

サイトの記事・データ・プログラムです。[Astro](https://astro.build/) で作った静的サイトです。

| 場所 | 中身 |
|---|---|
| `content/articles/` | 記事（Markdown） |
| `content/galleries/` | 記事ごとの写真の一覧 |
| `content/data/` | グラフ・データのページ・写真ギャラリーのデータ |
| `src/` | ページとレイアウト |
| `scripts/` | データや写真を集めるプログラム |

記事の変更の履歴は、GitHub のコミットの画面や、各記事のファイルの履歴（History）で見られます。

## 動かし方

```sh
pnpm install
pnpm dev        # http://localhost:4321/
pnpm build      # dist/ に出力
```

- 記事の写真は `public/photos/` に入っています。写真ギャラリーの画像は Git に入れていないので、`node scripts/gallery.mjs images` で取ってきます（数百 MB）
- 関連リンクのカードのサムネイルも Git に入れていません。`node scripts/link-cards.mjs` で作れます

## ライセンス

- **記事の文章**：[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.ja)（ウィキペディアと同じ）
- **写真**：それぞれの撮影者・機関のライセンスに従います（記事の写真のクレジット、写真ギャラリーの各写真のページに書いています）
- **データ**：それぞれの出典の利用条件に従います（`content/data/*.json` の `_source`、データのページの出典）
- **プログラム**：未定です

くわしくは [サイトのライセンスのページ](https://hirakata.pronama.jp/license/) をご覧ください。

## 直してほしいところ・手伝い

[CONTRIBUTING.md](CONTRIBUTING.md) をご覧ください。
