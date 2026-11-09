/**
 * 記事の frontmatter の links を、「出典・注釈」の前に「関連リンク」のカードとして並べる。
 * カードの中身（題名・説明・サムネイル）は content/data/link-cards.json（node scripts/link-cards.mjs で作る）。
 * 関連リンクはサイトの外へのリンクだけ（と写真ギャラリー）。links に書いたこのサイトの記事（url が「/」で始まる）は、
 * そのあとの「関連記事」に、なぜリンクするか（note）つきで出す。3 件に足りないときは
 *   1. この記事にリンクしている記事（ほかの記事の links にこの記事がある） 2. よく読まれている記事（content/popular.json） 3. 最近更新した記事
 * の順に足す。見出しは要素で入れるので、目次にも出る。
 */
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { publicGallery, galleryPath, photo } from "./photos.mjs";

const MORE = 3;

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
          // どこのサイトか（このサイトの中へのリンクには出さない）
          ...(host ? [el("span", { className: ["link-card-site"] }, [text(host)])] : []),
          // なぜリンクしたか（リンク先に何があるか）。カードの中のいちばん下に
          ...(link.note ? [el("span", { className: ["link-card-note"] }, [text(link.note)])] : []),
        ]),
      ],
    ),
  ]);
}

/** 公開している記事の frontmatter（下書きは除く） */
function articles() {
  const dir = join(process.cwd(), "content/articles");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const fm = readFileSync(join(dir, f), "utf8").match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      return { slug: f.replace(/\.md$/, ""), ...parse(fm) };
    })
    .filter((a) => !a.draft);
}

const internalSlug = (l) => l.url?.match(/^\/([^/]+)\/$/)?.[1];

/** 「関連記事」に出す記事。links に書いた記事（note つき）と、足りない分（MORE 件まで） */
function moreArticles(slug, links) {
  const all = articles();
  const notes = new Map(links.filter(internalSlug).map((l) => [internalSlug(l), l.note]));
  const popular = JSON.parse(readFileSync(join(process.cwd(), "content/popular.json"), "utf8"));
  const date = (a) => new Date(a.updated ?? a.published).getTime();
  const order = [
    ...notes.keys(),
    ...all.filter((a) => (a.links ?? []).some((l) => l.url === `/${slug}/`)).map((a) => a.slug),
    ...popular.slugs,
    ...(popular.fill ?? []),
    ...[...all].sort((a, b) => date(b) - date(a)).map((a) => a.slug),
  ];
  const bySlug = new Map(all.map((a) => [a.slug, a]));
  return [...new Set(order)]
    .filter((s) => bySlug.has(s) && s !== slug)
    .slice(0, Math.max(MORE, notes.size))
    .map((s) => ({ ...bySlug.get(s), note: notes.get(s) }));
}

function moreSection(slug, links) {
  const list = moreArticles(slug, links);
  if (!list.length) return null;
  const items = list.map((a) => {
    let image;
    try {
      image = a.cover ? photo(a.slug, a.cover).small : undefined;
    } catch {}
    return card({ url: `/${a.slug}/`, note: a.note }, { title: a.title, description: a.description, image });
  });
  return el("section", { className: ["link-cards", "more-articles"], ariaLabelledby: "関連記事", dataPagefindIgnore: "" }, [
    el("h2", { id: "関連記事" }, [text("関連記事")]),
    el("ul", { className: ["link-card-list"] }, items),
  ]);
}

export default function rehypeLinkCards() {
  return (tree, file) => {
    const allLinks = file.data.astro?.frontmatter?.links ?? [];
    // 関連リンクはサイトの外へのリンクだけ。このサイトの記事は「関連記事」へ
    const links = allLinks.filter((l) => !internalSlug(l));
    // この記事の写真（/<記事>/photos/）があれば、いちばん最後にそのカード
    const slug = basename(file.path ?? "", ".md");
    const photos = publicGallery(slug);
    const galleryCard = photos.length
      ? [
          card(
            { url: galleryPath(slug), note: "自由なライセンスの写真。作者とライセンスを書けば、だれでも使えます" },
            {
              title: `この記事の写真（${photos.length}枚）`,
              description: photos.slice(0, 4).map((p) => p.caption.replace(/（.*$/, "")).join("、"),
              image: photos[0].small,
            },
          ),
        ]
      : [];
    const more = moreSection(slug, allLinks);
    const insert = (sections) => {
      // 「出典・注釈」（脚注の section）の前に入れる。脚注がなければいちばん最後
      const i = tree.children.findIndex((n) => n.type === "element" && n.tagName === "section" && n.properties?.dataFootnotes !== undefined);
      // サイトの検索（Pagefind）には、関連リンク・関連記事・出典を入れない（本文だけ）
      if (i >= 0) tree.children[i].properties.dataPagefindIgnore = "";
      if (i < 0) tree.children.push(...sections);
      else tree.children.splice(i, 0, ...sections);
    };
    if (!links.length && !galleryCard.length) {
      if (more) insert([more]);
      return;
    }
    const cache = JSON.parse(readFileSync(join(process.cwd(), "content/data/link-cards.json"), "utf8"));
    const items = links.map((link) => {
      const key = link.isbn ? `isbn:${link.isbn}` : link.url;
      const c = cache[key];
      if (!c) file.fail(`リンク「${key}」のカードがありません。node scripts/link-cards.mjs を回してください`);
      return card(link, c);
    });
    const section = el("section", { className: ["link-cards"], ariaLabelledby: "関連リンク", dataPagefindIgnore: "" }, [
      el("h2", { id: "関連リンク" }, [text("関連リンク")]),
      el("ul", { className: ["link-card-list"] }, [...items, ...galleryCard]),
    ]);
    insert(more ? [section, more] : [section]);
  };
}
