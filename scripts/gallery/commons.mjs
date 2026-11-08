/**
 * Wikimedia Commons：「Hirakata, Osaka」の分類とその下の分類をたどって集める。
 * 外す分類・写真、分類の日本語の名前は gallery-config.yaml（root・excludeCategories・excludeFiles・groups・labels）
 */
import { BBOX, CONFIG, getJson, inside, photo, placesIn, strip, when } from "./common.mjs";

const API = "https://commons.wikimedia.org/w/api.php";
const api = (params) => getJson(`${API}?${new URLSearchParams({ ...params, format: "json", formatversion: "2" })}`, { gap: 200 });

async function members(cat) {
  const out = [];
  let cont = {};
  for (;;) {
    const d = await api({ action: "query", list: "categorymembers", cmtitle: `Category:${cat}`, cmlimit: "500", cmtype: "subcat|file", ...cont });
    out.push(...d.query.categorymembers);
    if (!d.continue) return out;
    cont = d.continue;
  }
}

/** 分類をたどって、写真ごとに入っている分類（たどった道すじの分類）を集める */
async function walk() {
  const ex = new Set(CONFIG.excludeCategories ?? []);
  const files = new Map();
  const seen = new Set();
  const visit = async (cat, path) => {
    if (seen.has(cat) || ex.has(cat) || path.length > 6) return;
    seen.add(cat);
    for (const m of await members(cat)) {
      const name = m.title.replace(/^(File|Category):/, "");
      if (m.ns === 6) {
        if (!/\.(jpe?g|png|tiff?|webp)$/i.test(name)) continue; // 写真だけ（地図の SVG や PDF は外す）
        if (!files.has(name)) files.set(name, new Set());
        for (const c of [...path, cat]) files.get(name).add(c);
      } else if (m.ns === 14) await visit(name, [...path, cat]);
    }
  };
  await visit(CONFIG.root, []);
  console.log(`Commons：分類 ${seen.size}、写真 ${files.size}`);
  return files;
}

function author(html = "") {
  const a = html.match(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/);
  const name = strip(html) || "不明";
  const url = a ? (a[1].startsWith("//") ? `https:${a[1]}` : a[1].startsWith("/") ? `https://commons.wikimedia.org${a[1]}` : a[1]) : "";
  return { name: name.length > 80 ? strip(a?.[2] ?? name).slice(0, 80) : name, url };
}

/** 商用利用でき、改変もできるもの：CC BY・CC BY-SA（バージョン問わず）・CC0・パブリックドメイン・Attribution。NC・ND は使わない */
const okLicense = (s = "") => (/^(CC BY(-SA)? [\d.]+|CC0|Public domain|PD)/i.test(s.trim()) || s.trim() === "Attribution") && !/NC|ND/.test(s);

/**
 * 分類の外の写真も探す（gallery-config.yaml の commonsExtra）。
 *  - 位置：市の範囲を 1.2km おきの点で、半径 900m の位置検索
 *  - 文字：検索語の全文検索
 * どちらも、あとで「市内の位置がある」か「位置が無く、文に枚方の語があり、市の外の分類に入っていない」ものだけ残す
 */
async function extraNames(known) {
  const cfg = CONFIG.commonsExtra ?? {};
  const found = new Set();
  for (let lat = BBOX[1]; lat <= BBOX[3]; lat += 0.011)
    for (let lon = BBOX[0]; lon <= BBOX[2]; lon += 0.013) {
      if (![[lon, lat], [lon + 0.006, lat], [lon, lat + 0.005]].some(([x, y]) => inside(x, y))) continue;
      const d = await api({ action: "query", list: "geosearch", gscoord: `${lat}|${lon}`, gsradius: "900", gslimit: "500", gsnamespace: "6" });
      for (const g of d.query?.geosearch ?? []) if (inside(g.lon, g.lat)) found.add(g.title.replace(/^File:/, ""));
    }
  for (const q of cfg.queries ?? []) {
    for (let off = 0; off < 10000; ) {
      const d = await api({ action: "query", list: "search", srsearch: q, srnamespace: "6", srlimit: "500", sroffset: String(off) });
      for (const x of d.query?.search ?? []) found.add(x.title.replace(/^File:/, ""));
      if (!d.continue) break;
      off = d.continue.sroffset;
    }
  }
  return [...found].filter((f) => !known.has(f) && /\.(jpe?g|png|tiff?|webp)$/i.test(f));
}

/** Commons の写真。Flickr から移した写真は、Flickr の番号も返す（Flickr の分と重ねないため） */
export async function collect() {
  const files = await walk();
  const exFiles = CONFIG.excludeFiles ?? {};
  const extra = new Set(await extraNames(new Set(files.keys())));
  console.log(`Commons：分類の外の候補 ${extra.size}`);
  const word = new RegExp(CONFIG.commonsExtra?.word ?? "枚方|Hirakata|樟葉|楠葉|Kuzuha");
  const exCat = new RegExp((CONFIG.commonsExtra?.excludeCategoryWords ?? []).join("|") || "$^");
  const names = [...files.keys(), ...extra].filter((f) => !(f in exFiles));
  const out = [];
  const skipped = [];
  const flickrIds = [];
  for (let i = 0; i < names.length; i += 20) {
    const d = await api({
      action: "query",
      prop: "imageinfo|categories",
      cllimit: "max",
      clshow: "!hidden",
      iiprop: "url|size|extmetadata",
      iiurlwidth: "1600",
      iiextmetadatalanguage: "ja",
      titles: names.slice(i, i + 20).map((f) => `File:${f}`).join("|"),
    });
    for (const p of d.query.pages) {
      const file = p.title.replace(/^File:/, "");
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const m = ii.extmetadata ?? {};
      const lic = strip(m.LicenseShortName?.value);
      if (!okLicense(lic)) {
        skipped.push(`${file}（${lic || "ライセンス不明"}）`);
        continue;
      }
      for (const f of `${m.Credit?.value ?? ""} ${m.ImageDescription?.value ?? ""}`.matchAll(/flickr\.com\/photos\/[^/"\s]+\/(\d+)/g)) flickrIds.push(f[1]);
      const lat0 = Number(m.GPSLatitude?.value), lon0 = Number(m.GPSLongitude?.value);
      const pageCats = (p.categories ?? []).map((c) => c.title.replace(/^Category:/, ""));
      if (extra.has(file)) {
        // 分類の外の写真：市内の位置があるか、位置が無く枚方の語があって市の外の分類に入っていないものだけ
        const text = `${file} ${pageCats.join(" ")} ${strip(m.ImageDescription?.value)}`;
        const geo = Number.isFinite(lat0) && lat0 && Number.isFinite(lon0) && lon0;
        if (exCat.test(pageCats.join(" ")) || (geo ? !inside(lon0, lat0) : !word.test(text))) continue;
      }
      // 分類の木でたどった分類に、ページに付いている分類のうち対応表（groups・labels）にあるもの（イズミヤ・淀川など、枚方の木の外の分類）を足す
      const known = pageCats.filter((c) => c in CONFIG.groups || c in CONFIG.labels);
      const cats = extra.has(file) ? known : [...new Set([...(files.get(file) ?? []), ...known])];
      const groups = [...new Set([...cats.map((c) => CONFIG.groups[c]), ...(extra.has(file) ? placesIn(`${file} ${pageCats.join(" ")}`).groups : [])].filter(Boolean))];
      const extraPl = extra.has(file) ? placesIn(`${file} ${strip(m.ImageDescription?.value)} ${pageCats.join(" ")}`) : { places: [], groups: [] };
      const places = [...new Set([...cats.map((c) => CONFIG.labels[c] ?? c), ...extraPl.places])].filter((l) => !Object.values(CONFIG.groups).includes(l) && l !== "枚方市");
      const lat = Number(m.GPSLatitude?.value), lon = Number(m.GPSLongitude?.value);
      const w = when(m.DateTimeOriginal?.value);
      out.push(
        photo({
          site: "commons",
          file,
          title: file.replace(/\.[^.]+$/, "").replace(/_/g, " "),
          desc: strip(m.ImageDescription?.value).slice(0, 400) || null,
          author: author(m.Artist?.value),
          license: lic,
          licenseUrl: m.LicenseUrl?.value ?? "",
          source: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`,
          sourceName: "Wikimedia Commons",
          date: w.date,
          year: w.year,
          lat: Number.isFinite(lat) && lat ? lat : null,
          lon: Number.isFinite(lon) && lon ? lon : null,
          groups,
          places,
          width: ii.width,
          height: ii.height,
          thumb: ii.thumburl, // 取ってくる画像（1600px の JPEG）。SNS で共有したときの画像にも使う
        }),
      );
    }
    process.stdout.write(`\rCommons：情報 ${Math.min(i + 20, names.length)}/${names.length}`);
  }
  console.log(`\nCommons：使えない条件で外した ${skipped.length}`);
  if (skipped.length) console.log("  " + skipped.slice(0, 30).join("\n  "));
  return { photos: out, source: `Wikimedia Commons「Category:${CONFIG.root}」とその下の分類`, flickrIds };
}
