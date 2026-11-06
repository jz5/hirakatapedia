/**
 * 記事の Markdown に `<div data-photo="Commons のファイル名"></div>` と書くと、ビルドのときに写真（figure）に置き換える。
 * 写真は、その記事の content/galleries/<記事>.yaml に載っているものだけ。説明（caption）もそこから取る。
 * frontmatter の cover は本文には出さない（SNS で共有したときの画像と、ホームの一覧のサムネイルだけ）
 */
import { basename } from "node:path";
import { photo, licenseLabel, sourceName } from "./photos.mjs";

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 写真の figure。本文の写真とアイキャッチで同じ形 */
export function figureHtml(p, { className = "photo", eager = false } = {}) {
  const license = p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" rel="license noopener">${esc(licenseLabel(p))}</a>` : esc(licenseLabel(p));
  return `<figure class="${className}">
<a class="photo-link" href="${esc(p.large.src)}"><img src="${esc(p.large.src)}" srcset="${esc(p.small.src)} ${p.small.width}w, ${esc(p.large.src)} ${p.large.width}w" sizes="(max-width: 720px) 100vw, 720px" width="${p.large.width}" height="${p.large.height}" alt="${esc(p.caption)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></a>
<figcaption><span class="photo-caption">${esc(p.caption)}</span><span class="photo-credit">${esc(p.kind ?? "写真")}：${esc(p.author)} / ${license} / <a href="${esc(p.page)}" rel="noopener">${esc(sourceName(p))}</a>${p.edited ? "（加工あり）" : ""}</span></figcaption>
</figure>`;
}

function walk(node, fn) {
  if (!node.children) return;
  node.children = node.children.map((c) => fn(c) ?? c);
  for (const c of node.children) walk(c, fn);
}

export default function rehypePhotos() {
  return (tree, file) => {
    const slug = basename(file.path ?? "", ".md");
    walk(tree, (node) => {
      // Markdown の中の HTML は、Astro では raw のまま届く
      const name =
        node.type === "element"
          ? node.properties?.dataPhoto
          : node.type === "raw"
            ? node.value.match(/^\s*<div data-photo="([^"]+)"><\/div>\s*$/)?.[1]
            : undefined;
      if (!name) return;
      try {
        return { type: "raw", value: figureHtml(photo(slug, name)) };
      } catch (e) {
        file.fail(e.message);
      }
    });
  };
}
