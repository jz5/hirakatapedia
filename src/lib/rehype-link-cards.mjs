/**
 * 記事の frontmatter の links を、「出典・注釈」の前に「関連リンク」のカードとして並べる。
 * カードの中身（題名・説明・サムネイル）は content/data/link-cards.json（node scripts/link-cards.mjs で作る）。
 * 見出しは要素で入れるので、目次にも出る。
 */
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { publicGallery, galleryPath } from "./photos.mjs";

const el = (tagName, properties = {}, children = []) => ({ type: "element", tagName, properties, children });
const text = (value) => ({ type: "text", value });

function card(link, c) {
  const external = !link.url?.startsWith("/");
  const img = c.image
    ? [
        el("img", {
          src: c.image.src,
          width: c.image.width,
          height: c.image.height,
          alt: "",
          loading: "lazy",
          decoding: "async",
          className: [c.image.height > c.image.width ? "link-card-img link-card-img-tall" : "link-card-img"],
        }),
      ]
    : [];
  const host = c.book ? [c.book.author, c.book.publisher, "Amazon"].filter(Boolean).join(" / ") : c.site;
  return el("li", { className: ["link-card"] }, [
    el(
      "a",
      { href: c.url ?? link.url, className: ["link-card-main"], ...(external ? { rel: ["noopener"] } : {}) },
      [
        ...img,
        el("span", { className: ["link-card-text"] }, [
          el("span", { className: ["link-card-title"] }, [text(c.title)]),
          ...(c.description ? [el("span", { className: ["link-card-desc"] }, [text(c.description)])] : []),
          el("span", { className: ["link-card-site"] }, [text(host)]),
          // なぜリンクしたか（リンク先に何があるか）。カードの中のいちばん下に
          el("span", { className: ["link-card-note"] }, [text(link.note)]),
        ]),
      ],
    ),
  ]);
}

export default function rehypeLinkCards() {
  return (tree, file) => {
    const links = file.data.astro?.frontmatter?.links ?? [];
    // 写真ギャラリーがあれば、いちばん最後にそのカード
    const slug = basename(file.path ?? "", ".md");
    const photos = publicGallery(slug);
    const galleryCard = photos.length
      ? [
          card(
            { url: galleryPath(slug), note: "自由なライセンスの写真。作者とライセンスを書けば、だれでも使えます" },
            {
              title: `写真ギャラリー（${photos.length}枚）`,
              description: photos.slice(0, 4).map((p) => p.caption.replace(/（.*$/, "")).join("、"),
              site: "枚方pedia",
              image: photos[0].small,
            },
          ),
        ]
      : [];
    if (!links.length && !galleryCard.length) return;
    const cache = JSON.parse(readFileSync(join(process.cwd(), "content/data/link-cards.json"), "utf8"));
    const items = links.map((link) => {
      const key = link.isbn ? `isbn:${link.isbn}` : link.url;
      const c = cache[key];
      if (!c) file.fail(`リンク「${key}」のカードがありません。node scripts/link-cards.mjs を回してください`);
      return card(link, c);
    });
    const section = el("section", { className: ["link-cards"], ariaLabelledby: "関連リンク" }, [
      el("h2", { id: "関連リンク" }, [text("関連リンク")]),
      el("ul", { className: ["link-card-list"] }, [...items, ...galleryCard]),
    ]);
    // 「出典・注釈」（脚注の section）の前に入れる。脚注がなければいちばん最後
    const i = tree.children.findIndex((n) => n.type === "element" && n.tagName === "section" && n.properties?.dataFootnotes !== undefined);
    if (i < 0) tree.children.push(section);
    else tree.children.splice(i, 0, section);
  };
}
