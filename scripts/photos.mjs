/**
 * 記事の写真（Wikimedia Commons の自由ライセンスの写真）を取ってきて、サイトの中に置く。
 *
 *   node scripts/photos.mjs            新しい写真だけ取りにいく
 *   node scripts/photos.mjs --refresh  全部取り直す（ライセンスや作者が変わっていないかの確認にも）
 *
 * 写真の一覧は content/galleries/<記事>.yaml。1枚ずつ Commons のファイル名（file）と、説明（caption）を書く。
 *   - file: "HIRAKATA_T-SITE.jpg"
 *     caption: "枚方T-SITE（2018年）"
 *     pick: true      管理者ページで目立たせる（いちばん使えそうなもの）
 *     seen: true      画像を見て確かめた
 *     note: "…"       管理者ページだけに出すメモ（使う前に気をつけること）
 *     hide: true      写真ギャラリーに出さない（枚方ではない写真など）
 *     edit:           手を加えるとき（CC BY・BY-SA・CC0・PD は改変してよい。ND の写真には書かない）
 *       upright: 0.08   見上げて撮った建物を起こす（上の幅を 8% 広げる）
 *       brightness: 1.08  明るさ（1 がそのまま）
 *       saturation: 1.1   色の鮮やかさ
 *       contrast: 1.08    コントラスト（明るいところと暗いところの差）
 *       levels: true      明暗の幅を広げる（ヒストグラムの両端を伸ばす）
 *     手を加えた写真は、表記に「（加工あり）」と出る（何をしたかは管理者ページだけ）。CC BY-SA の写真は、手を加えたものも同じライセンス
 *
 * Commons 以外（Flickr など）の写真は、file に自分で付けた名前を書き、元のページ・画像・作者・ライセンスを自分で書く。
 * ライセンスは元のページで確かめる。使えるのは CC BY・CC BY-SA・CC0・パブリックドメインだけ（NC・ND は使わない）。
 *   - file: "flickr-12345.jpg"
 *     caption: "…"
 *     source:
 *       name: Flickr
 *       page: https://www.flickr.com/photos/…/12345/
 *       image: https://live.staticflickr.com/…_b.jpg     取ってくる画像（大きめのもの）
 *       author: …
 *       license: CC BY 2.0
 *       licenseUrl: https://creativecommons.org/licenses/by/2.0/
 *       date: "2015-11-28"
 *
 * 国土地理院の空中写真（地理院タイル）から作る画像は、file に自分で付けた名前、gsi に範囲を書く。
 * 地理院タイルの「写真」は、出典を書けば申請なしで使える（地理院タイル一覧の「2. 基本測量成果以外で出典の記載のみで利用可能なもの」）。
 *   - file: "gsi-sansen.jpg"
 *     caption: "…"
 *     gsi:
 *       layer: seamlessphoto        地理院タイルの種類（seamlessphoto＝全国最新写真、ort_old10＝1961〜69年 など）
 *       name: 全国最新写真（シームレス）  出典に書くタイルの名前
 *       ext: png                     タイルの拡張子（lndst＝ランドサットは png。省略は jpg）
 *       credit: "…"                  タイルによって要る、追加の出所の表示
 *       zoom: 14
 *       north: 34.93                 範囲（緯度・経度）
 *       south: 34.88
 *       west: 135.65
 *       east: 135.73
 *       labels:                      画像に書き込む地名（なくてもよい）
 *         - [34.905, 135.69, "三川合流"]
 *
 * 記事の本文では <div data-photo="ファイル名"></div>、アイキャッチは frontmatter の cover: ファイル名。
 * 写真ギャラリーは /<記事>/photos/。
 *
 * 写真は縮小して public/photos/ に置く（一覧用 480px の webp と、大きい 1200px の jpg）。
 * 作者・ライセンスなどは content/data/photos.json。ビルドはネットにつながず、これだけを使う。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { parse } from "yaml";

const ROOT = process.cwd();
const GALLERIES = join(ROOT, "content/galleries");
const OUT = join(ROOT, "content/data/photos.json");
const DIR = join(ROOT, "public/photos");
const refresh = process.argv.includes("--refresh");
const UA = "hirakatapedia/1.0 (https://hirakata.pronama.jp)";
// 元の画像（手を加える前）。リポジトリには入れない
const ORIG = join(ROOT, "node_modules/.cache/hirakatapedia-photos");

const strip = (s = "") => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const entries = readdirSync(GALLERIES)
  .filter((f) => f.endsWith(".yaml"))
  .flatMap((f) => (parse(readFileSync(join(GALLERIES, f), "utf8")) ?? []).map((p) => ({ ...p, gallery: f })));
const files = [...new Set(entries.map((p) => p.file))];
const gsiSpec = Object.fromEntries(entries.filter((p) => p.gsi).map((p) => [p.file, p.gsi]));
const manual = Object.fromEntries(entries.filter((p) => p.source).map((p) => [p.file, p.source]));
// 同じ写真を2つの記事で使うときは、手の加え方をそろえる
const edits = {};
for (const p of entries) {
  const e = JSON.stringify(p.edit ?? null);
  if (p.file in edits && edits[p.file] !== e) throw new Error(`「${p.file}」の edit が記事によって違う（${p.gallery}）`);
  edits[p.file] = e;
}

const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
mkdirSync(DIR, { recursive: true });
mkdirSync(ORIG, { recursive: true });
const todo = files.filter((f) => !gsiSpec[f] && !manual[f] && (refresh || !cache[f]));

// Commons の API から、元の画像の URL・作者・ライセンス・説明（50件ずつ）
const info = {};
for (let i = 0; i < todo.length; i += 50) {
  const titles = todo.slice(i, i + 50).map((f) => `File:${f}`).join("|");
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|user|size|extmetadata&iiurlwidth=1200&titles=${encodeURIComponent(titles)}`;
  const q = (await (await fetch(url, { headers: { "User-Agent": UA } })).json()).query;
  const norm = Object.fromEntries((q.normalized ?? []).map((n) => [n.to, n.from]));
  for (const p of Object.values(q.pages)) {
    const name = (norm[p.title] ?? p.title).replace(/^File:/, "");
    info[name] = p.imageinfo?.[0];
  }
}

async function firstUploader(file) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=user&iilimit=50&titles=${encodeURIComponent(`File:${file}`)}`;
  const q = (await (await fetch(url, { headers: { "User-Agent": UA } })).json()).query;
  const list = Object.values(q.pages)[0].imageinfo ?? [];
  return list[list.length - 1]?.user ?? "";
}

const errors = [];
for (const file of todo) {
  const ii = info[file];
  if (!ii) {
    errors.push(`Commons にない: ${file}`);
    continue;
  }
  const m = ii.extmetadata ?? {};
  // 作者の欄が「Own work」だけのことがある。そのときは最初にアップロードした人
  // （いまの版はボットが変換し直したものもあるので、いちばん古い版の人）
  let author = strip(m.Artist?.value);
  if (!author || /^own work$/i.test(author)) author = await firstUploader(file);
  // 「(talk)」「User:」は、Commons の利用者ページへのリンクの名残り
  author = author.replace(/\s*\(talk\)/gi, "").replace(/^User:/, "").trim();
  cache[file] = {
    source: ii.thumburl ?? ii.url,
    page: ii.descriptionurl,
    author,
    license: strip(m.LicenseShortName?.value),
    licenseUrl: m.LicenseUrl?.value ?? "",
    date: strip(m.DateTimeOriginal?.value).slice(0, 10),
    description: strip(m.ImageDescription?.value).slice(0, 300),
    original: { width: ii.width, height: ii.height },
    fetched: new Date().toISOString().slice(0, 10),
  };
  console.log(`${file}  ${author} / ${cache[file].license}`);
  await new Promise((r) => setTimeout(r, 300));
}

/** 見上げて撮った建物を起こす。上の行ほど横に広げる（下の行はそのまま）。はみ出た左右は切れる */
async function upright(buf, amount) {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const out = Buffer.alloc(data.length);
  const cx = (w - 1) / 2;
  for (let y = 0; y < h; y++) {
    const scale = 1 + amount * (1 - y / (h - 1));
    for (let x = 0; x < w; x++) {
      const sx = cx + (x - cx) / scale;
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, w - 1), t = sx - x0;
      for (let k = 0; k < c; k++) {
        out[(y * w + x) * c + k] = data[(y * w + x0) * c + k] * (1 - t) + data[(y * w + x1) * c + k] * t;
      }
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: c } }).png().toBuffer();
}

/** 手の加え方を、表記用の日本語に */
function editLabel(e) {
  const parts = [];
  if (e.upright) parts.push("傾き");
  if (e.brightness) parts.push("明るさ");
  if (e.saturation) parts.push("色の鮮やかさ");
  if (e.contrast || e.levels) parts.push("コントラスト");
  return parts.length ? `${parts.join("・")}を調整` : "";
}

// --- 地理院タイルから画像を作る ---
const GSI_LIST = "https://maps.gsi.go.jp/development/ichiran.html";
const px = (lat, lon, z) => {
  const n = 256 * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};
const escXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function gsiImage(spec) {
  const [x0, y0] = px(spec.north, spec.west, spec.zoom);
  const [x1, y1] = px(spec.south, spec.east, spec.zoom);
  const tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256), tx1 = Math.floor(x1 / 256), ty1 = Math.floor(y1 / 256);
  const tiles = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${spec.layer}/${spec.zoom}/${tx}/${ty}.${spec.ext ?? "jpg"}`, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`地理院タイル ${res.status} ${spec.layer}/${spec.zoom}/${tx}/${ty}`);
      tiles.push({ input: Buffer.from(await res.arrayBuffer()), left: (tx - tx0) * 256, top: (ty - ty0) * 256 });
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
  const left = Math.round(x0 - tx0 * 256), top = Math.round(y0 - ty0 * 256);
  const width = Math.round(x1 - x0), height = Math.round(y1 - y0);
  let buf = await sharp({ create: { width: W, height: H, channels: 3, background: "#fff" } })
    .composite(tiles)
    .png()
    .toBuffer();
  buf = await sharp(buf).extract({ left, top, width, height }).png().toBuffer();
  if (spec.labels?.length) {
    const size = Math.round(width / 40);
    const texts = spec.labels
      .map(([lat, lon, text]) => {
        const [x, y] = px(lat, lon, spec.zoom);
        const lx = Math.round(x - x0), ly = Math.round(y - y0);
        return `<text x="${lx}" y="${ly}" font-size="${size}" text-anchor="middle" dominant-baseline="middle" font-family="Hiragino Sans, sans-serif" font-weight="700" fill="#fff" stroke="#000" stroke-width="${size / 6}" paint-order="stroke">${escXml(text)}</text>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${texts}</svg>`;
    buf = await sharp(buf).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  }
  return buf;
}

for (const [file, spec] of Object.entries(gsiSpec)) {
  const key = JSON.stringify(spec);
  const id = createHash("sha1").update(file).digest("hex").slice(0, 12);
  if (!refresh && cache[file]?.gsiKey === key && existsSync(join(ORIG, id))) continue;
  writeFileSync(join(ORIG, id), await gsiImage(spec));
  const cLat = (spec.north + spec.south) / 2, cLon = (spec.west + spec.east) / 2;
  cache[file] = {
    page: `https://maps.gsi.go.jp/#${spec.zoom}/${cLat.toFixed(5)}/${cLon.toFixed(5)}/&base=std&ls=${spec.layer}&disp=1`,
    sourceName: "地理院地図",
    kind: "画像",
    author: "国土地理院",
    license: `出典：地理院タイル（${spec.name}）${spec.credit ? `、${spec.credit}` : ""}`,
    licenseUrl: GSI_LIST,
    date: new Date().toISOString().slice(0, 10),
    description: `地理院タイル ${spec.layer} ズームレベル ${spec.zoom}、北緯${spec.south}〜${spec.north}、東経${spec.west}〜${spec.east}`,
    original: { width: 0, height: 0 },
    fetched: new Date().toISOString().slice(0, 10),
    gsiKey: key,
    editKey: "",
  };
  console.log(`${file}  地理院タイル ${spec.layer} z${spec.zoom}`);
}

// --- Commons 以外（Flickr など）。作者・ライセンスは yaml に書いたもの ---
for (const [file, src] of Object.entries(manual)) {
  const key = JSON.stringify(src);
  if (!refresh && cache[file]?.sourceKey === key) continue;
  cache[file] = {
    source: src.image,
    sourceName: src.name,
    page: src.page,
    author: src.author,
    license: src.license,
    licenseUrl: src.licenseUrl ?? "",
    date: src.date ?? "",
    description: src.description ?? "",
    original: { width: 0, height: 0 },
    fetched: new Date().toISOString().slice(0, 10),
    sourceKey: key,
    editKey: "",
  };
  const id = createHash("sha1").update(file).digest("hex").slice(0, 12);
  if (existsSync(join(ORIG, id))) unlinkSync(join(ORIG, id));
  console.log(`${file}  ${src.name} ${src.author} / ${src.license}`);
}

// 画像を作る。元の画像はキャッシュから（なければ取りにいく）。手の加え方が変わったら作り直す
for (const file of files) {
  const c = cache[file];
  if (!c) continue;
  const edit = JSON.parse(edits[file]);
  const id = createHash("sha1").update(file).digest("hex").slice(0, 12);
  const editKey = edits[file];
  const outs = [join(DIR, `${id}-480.webp`), join(DIR, `${id}-1200.jpg`)];
  if (!refresh && c.editKey === editKey && c.small && outs.every((o) => existsSync(o))) continue;
  const origPath = join(ORIG, id);
  if (refresh || !existsSync(origPath)) {
    const res = await fetch(c.source, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      errors.push(`${res.status} ${file}`);
      continue;
    }
    writeFileSync(origPath, Buffer.from(await res.arrayBuffer()));
    await new Promise((r) => setTimeout(r, 300));
  }
  let buf = await sharp(readFileSync(origPath)).rotate().toBuffer();
  if (gsiSpec[file] || manual[file]) {
    const m = await sharp(buf).metadata();
    c.original = { width: m.width, height: m.height };
  }
  if (edit?.upright) buf = await upright(buf, edit.upright);
  let img = sharp(buf);
  if (edit?.levels) img = img.normalise({ lower: 1, upper: 99 });
  if (edit?.contrast) img = img.linear(edit.contrast, -(128 * edit.contrast) + 128);
  if (edit?.brightness || edit?.saturation) img = img.modulate({ brightness: edit.brightness ?? 1, saturation: edit.saturation ?? 1 });
  buf = await img.toBuffer();
  const small = await sharp(buf).resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(outs[0]);
  const large = await sharp(buf).resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(outs[1]);
  c.small = { src: `/photos/${id}-480.webp`, width: small.width, height: small.height };
  c.large = { src: `/photos/${id}-1200.jpg`, width: large.width, height: large.height };
  // 地理院タイルは、つなぎ合わせて切り抜いたものなので、いつも「加工あり」
  c.edited = [gsiSpec[file] ? "地理院タイルをつなぎ合わせて切り抜き" + (gsiSpec[file].labels?.length ? "、地名を書き込み" : "") : "", edit ? editLabel(edit) : ""].filter(Boolean).join("。");
  c.editKey = editKey;
  if (edit) console.log(`${file}  ${c.edited}`);
}

// 一覧から消した写真は、データとファイルも消す
const used = new Set(files);
for (const k of Object.keys(cache)) if (!used.has(k)) delete cache[k];
const keep = new Set(Object.values(cache).flatMap((c) => [c.small.src, c.large.src].map((s) => s.split("/").pop())));
for (const f of readdirSync(DIR)) if (!keep.has(f)) unlinkSync(join(DIR, f));

writeFileSync(OUT, JSON.stringify(Object.fromEntries(Object.entries(cache).sort()), null, 1) + "\n");
console.log(`${files.length} 枚`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
