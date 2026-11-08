/**
 * 記事の「関連リンク」のカード用に、リンク先の題名・説明・サムネイルを取ってきてキャッシュする。
 *
 *   node scripts/link-cards.mjs            新しいリンクだけ取りにいく
 *   node scripts/link-cards.mjs --refresh  全部取り直す
 *
 * リンクは記事の frontmatter の links に書く（url か isbn と、なぜリンクするかの note）。
 *   links:
 *     - url: https://ja.wikipedia.org/wiki/香里団地
 *       note: 団地の歴史と、建物の写真がたくさんある
 *     - isbn: "9784778310073"
 *       note: 蔦屋重三郎と増田宗昭の2人を描いた本
 *     - url: /pomunoki/
 *       note: 1号店は近鉄百貨店枚方店。いまの T-SITE の場所
 *
 * 本の書影は openBD、なければ版元ドットコム。
 * 取ってきたものは content/data/link-cards.json に、サムネイルは public/link-thumbs/ に置く。
 * ビルド（src/lib/rehype-link-cards.mjs）はネットにつながず、このキャッシュだけを使う。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { parse } from "yaml";

const ROOT = process.cwd();
const ARTICLES = join(ROOT, "content/articles");
const CACHE = join(ROOT, "content/data/link-cards.json");
const THUMBS = join(ROOT, "public/link-thumbs");
const refresh = process.argv.includes("--refresh");
const UA = "hirakatapedia-linkcards/1.0 (+https://hirakata.pronama.jp)";

const frontmatter = (file) => parse(readFileSync(join(ARTICLES, file), "utf8").split(/^---$/m)[1]);
const articles = Object.fromEntries(
  readdirSync(ARTICLES)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f.replace(/\.md$/, ""), frontmatter(f)]),
);

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
mkdirSync(THUMBS, { recursive: true });

const decode = (s = "") =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
const cut = (s, n = 120) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** ISBN-13 → ISBN-10（Amazon の商品ページの番号） */
function isbn10(isbn13) {
  const core = isbn13.replace(/-/g, "").slice(3, 12);
  const sum = [...core].reduce((a, d, i) => a + Number(d) * (10 - i), 0);
  const c = (11 - (sum % 11)) % 11;
  return core + (c === 10 ? "X" : String(c));
}

/** サムネイルを取ってきて、長い辺を 480px 以下の webp にする。元の比率のまま */
async function thumb(src, key) {
  if (!src) return null;
  const res = await fetch(src, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`サムネイル ${res.status} ${src}`);
  const name = `${createHash("sha1").update(key).digest("hex").slice(0, 16)}.webp`;
  const out = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(join(THUMBS, name));
  return { src: `/link-thumbs/${name}`, width: out.width, height: out.height };
}

/** ウィキペディアは REST API の要約（題名・最初の段落・代表の画像） */
async function wikipedia(url) {
  await new Promise((r) => setTimeout(r, 1500)); // 続けて叩くと 429 になる
  const u = new URL(url);
  const title = decodeURIComponent(u.pathname.replace(/^\/wiki\//, ""));
  const res = await fetch(`${u.origin}/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ウィキペディア ${res.status} ${title}`);
  const j = await res.json();
  return {
    title: j.title,
    description: cut(j.extract),
    site: "ウィキペディア",
    image: await thumb(j.thumbnail?.source, url),
  };
}

/** 本は openBD（版元ドットコム）から。リンク先は Amazon */
async function book(isbn) {
  const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`);
  const [j] = await res.json();
  if (!j) throw new Error(`openBD に見つからない ${isbn}`);
  const s = j.summary;
  const text = j.onix?.CollateralDetail?.TextContent?.find((t) => t.TextType === "03" || t.TextType === "02")?.Text;
  return {
    url: `https://www.amazon.co.jp/dp/${isbn10(isbn)}`,
    title: s.title,
    description: text ? cut(decode(text)) : "",
    site: "Amazon",
    book: { author: s.author, publisher: s.publisher, pubdate: s.pubdate },
    // openBD に書影がないときは、版元ドットコムの書影
    image: await thumb(s.cover || `https://www.hanmoto.com/bd/img/${isbn}.jpg`, `isbn:${isbn}`).catch(() => null),
  };
}

/** ふつうのページは OGP と meta description */
async function page(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const head = buf.toString("latin1");
  const charset = /charset=["']?(shift_jis|sjis|euc-jp|x-sjis)/i.exec(head)?.[1];
  const html = new TextDecoder(charset ? (/euc/i.test(charset) ? "euc-jp" : "shift_jis") : "utf-8").decode(buf);
  const meta = (key) =>
    html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"))?.[1] ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"))?.[1];
  const img = meta("og:image");
  return {
    title: decode(meta("og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]),
    description: cut(decode(meta("og:description") ?? meta("description"))),
    site: decode(meta("og:site_name")) || new URL(url).hostname,
    // サイト共通の小さなロゴ（枚方市の og_image.png など）は、カードに出しても意味がないので使わない
    image: await thumb(img && new URL(img, url).href, url)
      .then((t) => (t && t.width < 240 ? null : t))
      .catch(() => null),
  };
}

/** ほかの記事へのリンクは、その記事の題名と説明 */
function internal(url) {
  const slug = url.replace(/^\/|\/$/g, "");
  const fm = articles[slug];
  if (!fm) throw new Error(`記事がない ${url}`);
  return { title: fm.title, description: cut(fm.description), site: "枚方pedia", image: null };
}

const errors = [];
const used = new Set();
for (const [slug, fm] of Object.entries(articles)) {
  for (const link of fm.links ?? []) {
    const key = link.isbn ? `isbn:${link.isbn}` : link.url;
    used.add(key);
    // ほかの記事は題名が変わるので毎回作り直す（ネットには行かない）
    // サムネイルは Git に入れていないので、手元に無ければ取り直す
    const thumbMissing = cache[key]?.image && !existsSync(join(ROOT, "public", cache[key].image.src));
    if (cache[key] && !refresh && !thumbMissing && !link.url?.startsWith("/")) continue;
    try {
      const card = link.isbn
        ? await book(link.isbn)
        : link.url.startsWith("/")
          ? internal(link.url)
          : /\/\/[a-z]+\.wikipedia\.org\/wiki\//.test(link.url)
            ? await wikipedia(link.url)
            : await page(link.url);
      cache[key] = { url: link.url, ...card, fetched: new Date().toISOString().slice(0, 10) };
      console.log(`${slug}: ${card.title}`);
    } catch (e) {
      errors.push(`${slug}: ${e.message}`);
    }
  }
}
// 記事から消したリンクはキャッシュからも消す。使わなくなったサムネイルも消す
for (const k of Object.keys(cache)) if (!used.has(k)) delete cache[k];
const keep = new Set(Object.values(cache).map((c) => c.image?.src.split("/").pop()));
for (const f of readdirSync(THUMBS)) if (!keep.has(f)) unlinkSync(join(THUMBS, f));

writeFileSync(CACHE, JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 1) + "\n");
if (errors.length) {
  console.error(`取れなかったもの:\n${errors.join("\n")}`);
  process.exitCode = 1;
}
