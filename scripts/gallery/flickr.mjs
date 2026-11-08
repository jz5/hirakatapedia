/**
 * Flickr：検索語（gallery-config.yaml の flickr.queries）と、市の範囲の位置で探す。API キー（Flickr Pro が要る）は .env の FLICKR_API_KEY。
 * 位置のある写真は、市の境界の中か、境界のすぐ外（対岸から撮った写真など）で文に「枚方」とあるものだけ。
 * 位置の無い写真は、題名・説明・タグに「枚方」「Hirakata」があるものだけ。Commons に移されている写真は Commons の方だけ
 */
import { BBOX, CONFIG, env, getJson, inside, photo, placesIn, readSite, strip, when } from "./common.mjs";

/** 使うライセンス（商用利用でき、改変もできるもの）。NC・ND・「著作権の制限は知られていない」は使わない */
const LICENSES = {
  4: ["CC BY 2.0", "https://creativecommons.org/licenses/by/2.0/"],
  5: ["CC BY-SA 2.0", "https://creativecommons.org/licenses/by-sa/2.0/"],
  9: ["CC0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  10: ["Public domain", "https://creativecommons.org/publicdomain/mark/1.0/"],
  11: ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  12: ["CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"],
};

export async function collect({ commonsFlickrIds = new Set() } = {}) {
  const key = env("FLICKR_API_KEY");
  if (!key) {
    const prev = readSite("flickr");
    console.log(`Flickr：FLICKR_API_KEY が無いので検索しない（前の ${prev?.photos.length ?? 0} 枚を残す）`);
    return null;
  }
  const call = async (params) => {
    const d = await getJson(`https://api.flickr.com/services/rest/?${new URLSearchParams({ ...params, api_key: key, format: "json", nojsoncallback: "1" })}`, { gap: 1000 });
    if (d.stat !== "ok") throw new Error(`Flickr API: ${d.message}`);
    return d;
  };
  const cfg = CONFIG.flickr ?? {};
  const ex = cfg.excludePhotos ?? {};
  const near = (lon, lat) => lon > BBOX[0] - 0.02 && lon < BBOX[2] + 0.02 && lat > BBOX[1] - 0.02 && lat < BBOX[3] + 0.02;
  const base = {
    method: "flickr.photos.search",
    license: Object.keys(LICENSES).join(","),
    content_types: "0",
    media: "photos",
    safe_search: "1",
    per_page: "500",
    extras: "license,owner_name,date_taken,geo,tags,description,url_h,url_l,url_c,url_z",
  };
  const searches = [...(cfg.queries ?? ["枚方", "Hirakata"]).map((t) => ({ text: t })), { bbox: BBOX.join(","), min_upload_date: "946684800" }];
  const found = new Map();
  for (const q of searches) {
    for (let page = 1; ; page++) {
      const d = await call({ ...base, ...q, page: String(page) });
      for (const p of d.photos.photo) found.set(p.id, p);
      process.stdout.write(`\rFlickr：${JSON.stringify(q).slice(0, 40)} ${page}/${d.photos.pages}`);
      if (page >= d.photos.pages) break;
    }
  }
  const out = [];
  const why = { commons: 0, exclude: 0, outside: 0, noword: 0, nosize: 0 };
  const word = /枚方|hirakata/i;
  for (const p of found.values()) {
    if (commonsFlickrIds.has(p.id)) { why.commons++; continue; }
    if (p.id in ex) { why.exclude++; continue; }
    const text = `${p.title} ${p.description?._content ?? ""} ${p.tags}`;
    const lat = Number(p.latitude), lon = Number(p.longitude);
    const geo = Boolean(lat && lon);
    if (geo && !inside(lon, lat) && !(near(lon, lat) && word.test(text))) { why.outside++; continue; }
    if (!geo && !word.test(text)) { why.noword++; continue; }
    const size = ["h", "l", "c", "z"].find((s) => p[`url_${s}`]);
    if (!size) { why.nosize++; continue; }
    const [license, licenseUrl] = LICENSES[p.license];
    const wh = String(p.datetakenunknown) === "1" ? { date: null, year: null } : when(p.datetaken);
    out.push(
      photo({
        site: "flickr",
        file: `flickr-${p.id}.jpg`,
        title: strip(p.title) || `flickr-${p.id}`,
        desc: strip(p.description?._content).slice(0, 400) || null,
        author: { name: p.ownername || p.owner, url: `https://www.flickr.com/people/${p.owner}/` },
        license,
        licenseUrl,
        source: `https://www.flickr.com/photos/${p.owner}/${p.id}/`,
        sourceName: "Flickr",
        date: wh.date,
        year: wh.year,
        lat: geo ? lat : null,
        lon: geo ? lon : null,
        ...placesIn(text),
        width: Number(p[`width_${size}`]),
        height: Number(p[`height_${size}`]),
        thumb: p[`url_${size}`],
      }),
    );
  }
  // Flickr の検索は、同じ条件でも毎回少しずつ結果が違う。前に集めた写真で、今回見つからなかったもの（外す一覧に無いもの）も残す
  const prev = readSite("flickr")?.photos ?? [];
  const now = new Set(out.map((p) => p.file));
  const kept = prev.filter((p) => !now.has(p.file) && !(p.file.replace(/^flickr-|\.jpg$/g, "") in ex) && !commonsFlickrIds.has(p.file.replace(/^flickr-|\.jpg$/g, "")));
  out.push(...kept);
  if (kept.length) console.log(`\nFlickr：今回の検索に出なかったが、前に集めた写真を残す ${kept.length} 枚`);
  // 前に集めたときに無かった写真（見て、外すものは excludePhotos に足す）
  const before = new Set(prev.map((p) => p.file));
  const added = out.filter((p) => !before.has(p.file));
  if (before.size && added.length) console.log(`\nFlickr：前回から増えた写真（見て確かめる）\n  ${added.map((p) => `${p.source}  ${p.title}`).join("\n  ")}`);
  console.log(`\nFlickr：${out.length} 枚（見つかった ${found.size}。Commons と重なる ${why.commons}、外す一覧 ${why.exclude}、市の外 ${why.outside}、「枚方」の語なし ${why.noword}）`);
  return { photos: out, source: "Flickr の検索（gallery-config.yaml の flickr）" };
}
