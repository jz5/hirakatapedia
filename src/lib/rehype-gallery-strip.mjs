/**
 * 記事の Markdown に `<div data-gallery="香里団地"></div>` と書くと、写真ギャラリー（/gallery/）の
 * その場所・被写体（places）の写真を 6 枚並べ、「もっと見る」（/gallery/?q=香里団地）を付ける。
 * 記事の関係のある節に置く。写真は写真ギャラリーの並び（撮った年の新しい順）の先頭から
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const N = 6;
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let all;
const photos = () => {
  if (!all) {
    const dir = join(process.cwd(), "content/data/gallery");
    all = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")).photos)
      .sort((a, b) => (b.year ?? -1) - (a.year ?? -1) || (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
  }
  return all;
};

function stripHtml(place) {
  const list = photos().filter((p) => p.places.includes(place));
  if (!list.length) throw new Error(`写真ギャラリーに「${place}」の写真がありません`);
  const items = list
    .slice(0, N)
    .map((p) => `<li><a href="/gallery/${p.id}/"><img src="/gallery/i/${p.id.slice(0, 2)}/${p.id}-s.avif" alt="${esc(p.title)}" width="160" height="160" loading="lazy" decoding="async"></a></li>`)
    .join("");
  return `<div class="gallery-strip">
<p class="gallery-strip-title">${esc(place)}の写真</p>
<ul>${items}</ul>
<p class="gallery-strip-more"><a href="/gallery/?q=${encodeURIComponent(place)}">${esc(place)}の写真をもっと見る（${list.length}枚）→</a></p>
</div>`;
}

function walk(node, fn) {
  if (!node.children) return;
  node.children = node.children.map((c) => fn(c) ?? c);
  for (const c of node.children) walk(c, fn);
}

export default function rehypeGalleryStrip() {
  return (tree, file) => {
    walk(tree, (node) => {
      const place =
        node.type === "element"
          ? node.properties?.dataGallery
          : node.type === "raw"
            ? node.value.match(/^\s*<div data-gallery="([^"]+)"><\/div>\s*$/)?.[1]
            : undefined;
      if (!place) return;
      try {
        return { type: "raw", value: stripHtml(place) };
      } catch (e) {
        file.fail(e.message);
      }
    });
  };
}
