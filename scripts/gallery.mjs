/**
 * 枚方の写真ギャラリー（/gallery/）の写真を集める。
 *
 *   node scripts/gallery.mjs collect [出どころ…]   写真の情報を集めて content/data/gallery/<出どころ>.json に書く
 *   node scripts/gallery.mjs images [出どころ…]    まだ無い画像を取ってきて、縮小して public/gallery/i/ に置く
 *   node scripts/gallery.mjs [出どころ…]           両方
 *
 * 出どころ：commons（Wikimedia Commons）・flickr・city（枚方市のオープンデータの画像）・gsi（国土地理院の空中写真）・
 * jpsearch（Japan Search で選んだ資料）・omlib（大阪市立図書館デジタルアーカイブで選んだ資料）・ndl（国立国会図書館デジタルコレクションの本から選んだ写真）・mapillary。集め方はそれぞれ scripts/gallery/<出どころ>.mjs、設定は content/data/gallery-config.yaml。
 * 使うのは商用利用でき、改変もできるもの（CC BY・CC BY-SA・CC0・パブリックドメイン、国土地理院の利用規約）。NC・ND は使わない
 * （一覧のサムネイルは縮小・切り抜きなので、改変禁止の写真には使えないとみる）。
 * Flickr と Mapillary はキーが要る（.env の FLICKR_API_KEY・MAPILLARY_TOKEN。Git に入れない）。キーが無いときは前に集めた分を残す。
 *
 * 画像は AVIF（一覧用 480px と、大きい 1600px）。public/gallery/i/<番号の先頭 2 文字>/<番号>-s.avif・-l.avif。
 * 10 万枚になっても 1 つのフォルダに入りすぎないように、番号の先頭 2 文字で分ける。
 * public/gallery/ は Git に入れない（.gitignore）。公開するときは、ビルドの前にこのスクリプトで取ってくる。
 * 取ってくるのはサイトごとに 1 枚ずつ、間を空けて（Commons は 1 秒）。
 */
import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ROOT, UA, env, getJson, readSite, sleep, writeSite } from "./gallery/common.mjs";
import { gsiImage } from "./lib/gsi-image.mjs";

const SITES = ["commons", "flickr", "city", "gsi", "jpsearch", "omlib", "ndl", "mapillary"];
const DIR = join(ROOT, "public/gallery/i");
const SIZES = { s: 480, l: 1600 };
/** サイトごとの、次に取るまでの間（ミリ秒） */
const GAP = { "upload.wikimedia.org": 1000, "cyberjapandata.gsi.go.jp": 100, default: 400 };

export const imagePath = (id, size) => join(DIR, id.slice(0, 2), `${id}-${size}.avif`);

async function collect(sites) {
  let commonsFlickrIds = new Set(readSite("commons")?.flickrIds ?? []);
  for (const site of sites) {
    const mod = await import(`./gallery/${site}.mjs`);
    const r = await mod.collect({ commonsFlickrIds });
    if (!r) continue; // キーが無いなど。前の分を残す
    if (site === "commons") commonsFlickrIds = new Set(r.flickrIds);
    // Commons は、Flickr と重ならないように、Commons に移されている Flickr の写真の番号も残す
    writeSite(site, r.source, r.photos, site === "commons" ? { flickrIds: [...new Set(r.flickrIds)].sort() } : {});
  }
}

/** 取ってくる。「多すぎる」（429・503）と言われたら、言われた時間（なければ 30 秒）待って取り直す */
async function download(url) {
  let r;
  for (let k = 0; k < 6; k++) {
    r = await fetch(url, { headers: { "User-Agent": UA } });
    if (r.status !== 429 && r.status !== 503) break;
    const wait = Number(r.headers.get("retry-after")) || 30;
    process.stdout.write(`\n${new URL(url).host} ${r.status}。${wait} 秒待つ`);
    await sleep(wait * 1000);
  }
  if (!r.ok) throw new Error(String(r.status));
  return Buffer.from(await r.arrayBuffer());
}

/** Mapillary の画像の URL は時間がたつと使えなくなるので、取る直前に聞き直す */
async function freshUrl(p) {
  if (p.site !== "mapillary") return p.thumb;
  const token = env("MAPILLARY_TOKEN");
  if (!token) return p.thumb;
  const id = p.file.replace(/^mapillary-|\.jpg$/g, "");
  const d = await getJson(`https://graph.mapillary.com/${id}?${new URLSearchParams({ access_token: token, fields: "thumb_2048_url" })}`, { gap: 200 });
  return d.thumb_2048_url ?? p.thumb;
}

async function images(sites) {
  const all = SITES.flatMap((s) => readSite(s)?.photos ?? []);
  mkdirSync(DIR, { recursive: true });
  // 一覧から外した写真の画像は消す（全部の出どころを見て）
  const ids = new Set(all.map((p) => p.id));
  let stale = 0;
  for (const sub of readdirSync(DIR)) {
    const d = join(DIR, sub);
    for (const f of readdirSync(d)) if (/^[0-9a-f]{10}-[sl]\.avif$/.test(f) && !ids.has(f.slice(0, 10))) (unlinkSync(join(d, f)), stale++);
    if (!readdirSync(d).length) rmdirSync(d);
  }
  if (stale) console.log(`一覧にない画像を消した ${stale}`);
  const todo = all.filter((p) => sites.includes(p.site) && (!existsSync(imagePath(p.id, "l")) || !existsSync(imagePath(p.id, "s"))));
  console.log(`取ってくる画像 ${todo.length}/${all.length}`);
  // サイトごとに 1 枚ずつ取る（サイトどうしは同時に）。AVIF への変換は 4 つまで同時に
  const byHost = new Map();
  for (const p of todo) {
    const host = p.gsi ? "cyberjapandata.gsi.go.jp" : new URL(p.thumb).host;
    byHost.set(host, [...(byHost.get(host) ?? []), p]);
  }
  let n = 0;
  const errors = [];
  const running = new Set();
  const encode = async (p, buf) => {
    mkdirSync(join(DIR, p.id.slice(0, 2)), { recursive: true });
    const img = sharp(buf, { failOn: "none" }).rotate();
    for (const [k, q] of [["l", 50], ["s", 45]]) {
      await img.clone().resize({ width: SIZES[k], height: SIZES[k], fit: "inside", withoutEnlargement: true }).avif({ quality: q, effort: 4 }).toFile(imagePath(p.id, k));
    }
  };
  const slot = async () => {
    while (running.size >= 4) await Promise.race(running);
  };
  await Promise.all(
    [...byHost].map(async ([host, list]) => {
      for (const p of list) {
        try {
          const buf = p.gsi ? await gsiImage(p.gsi, UA) : await download(await freshUrl(p));
          await slot();
          const job = encode(p, buf)
            .catch((e) => errors.push(`${p.file}: ${e.message}`))
            .finally(() => {
              running.delete(job);
              if (++n % 20 === 0) process.stdout.write(`\r画像 ${n}/${todo.length}`);
            });
          running.add(job);
        } catch (e) {
          errors.push(`${p.file}: ${e.message}`);
          n++;
        }
        await sleep(GAP[host] ?? GAP.default);
      }
    }),
  );
  await Promise.all(running);
  console.log(`\n終わり。うまくいかなかったもの ${errors.length}`);
  if (errors.length) console.log("  " + errors.join("\n  "));
}

const [cmd, ...rest] = process.argv.slice(2);
const isCmd = cmd === "collect" || cmd === "images";
const sites = (isCmd ? rest : [cmd, ...rest]).filter(Boolean);
const chosen = sites.length ? sites : SITES;
for (const s of chosen) if (!SITES.includes(s)) throw new Error(`出どころの名前が違う：${s}（${SITES.join("・")}）`);
if (!isCmd || cmd === "collect") await collect(chosen);
if (!isCmd || cmd === "images") await images(chosen);
