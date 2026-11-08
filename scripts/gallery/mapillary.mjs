/**
 * Mapillary（CC BY-SA 4.0）：見て選んだ写真だけを載せる（gallery-config.yaml の mapillary.images。写真の番号: 場所の名前）。
 * アクセストークンは .env の MAPILLARY_TOKEN（https://www.mapillary.com/dashboard/developers の Client Token）。
 * 候補探し：mapillary.points の場所ごとに近くの写真を探し、まだ選んでも外してもいない写真を「候補」として番号を出すだけ（自動では載せない）。
 *   全天球（パノラマ）と、長い辺が 1600px より小さいものは候補にしない。同じ撮影の続き（シーケンス）からは 1 枚だけ、新しい順に場所ごとに candidates 枚まで。
 *   電車の窓から撮ったぶれた写真・広告が主役の写真が多いので、1 枚ずつ見て、使うものを images に、使わないものを excludeImages に理由つきで足す。
 *   人の顔・車のナンバーが読める写真は使わない（Mapillary のぼかしが外れていることがある）
 */
import { CONFIG, env, getJson, photo, placesIn, readSite } from "./common.mjs";

const FIELDS = "id,captured_at,geometry,thumb_2048_url,width,height,creator,is_pano,sequence";
const graph = (path, token, params = {}) =>
  getJson(`https://graph.mapillary.com/${path}?${new URLSearchParams({ access_token: token, ...params })}`, { gap: 300 });

export async function collect() {
  const token = env("MAPILLARY_TOKEN");
  if (!token) {
    const prev = readSite("mapillary");
    console.log(`Mapillary：MAPILLARY_TOKEN が無いので探さない（前の ${prev?.photos.length ?? 0} 枚を残す）`);
    return null;
  }
  const cfg = CONFIG.mapillary ?? {};
  const chosen = cfg.images ?? {};
  const ex = cfg.excludeImages ?? {};
  const group = Object.fromEntries((cfg.points ?? []).map((p) => [p.name, p.group ?? "街なみ"]));

  // 選んだ写真
  const out = [];
  for (const [id, name] of Object.entries(chosen)) {
    const x = await graph(id, token, { fields: FIELDS });
    if (!x?.id) {
      console.log(`Mapillary：${id}（${name}）が見つからない（消された？）`);
      continue;
    }
    const [lon, lat] = x.geometry.coordinates;
    const dt = new Date(x.captured_at);
    const user = x.creator?.username ?? "Mapillary の投稿者";
    out.push(
      photo({
        site: "mapillary",
        file: `mapillary-${x.id}.jpg`,
        title: `${name}（${dt.getFullYear()}年${dt.getMonth() + 1}月）`,
        desc: `Mapillary の、${name}の近くで撮られた写真`,
        author: { name: user, url: x.creator?.username ? `https://www.mapillary.com/app/user/${encodeURIComponent(user)}` : "" },
        license: "CC BY-SA 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.ja",
        source: `https://www.mapillary.com/app/?pKey=${x.id}&focus=photo`,
        sourceName: "Mapillary",
        date: dt.toLocaleDateString("sv-SE"),
        year: dt.getFullYear(),
        lat,
        lon,
        groups: [group[name] ?? "街なみ"],
        places: [...new Set([name.replace(/(付近|周辺|前)$/, ""), ...placesIn(name).places])],
        width: x.width,
        height: x.height,
        thumb: x.thumb_2048_url,
      }),
    );
  }
  console.log(`Mapillary：選んだ写真 ${out.length} 枚`);

  // 候補探し（載せない。番号を出すだけ）
  const seenSeq = new Set();
  for (const pt of cfg.points ?? []) {
    const [lat, lon] = pt.center;
    const r = (pt.radiusM ?? cfg.radiusM ?? 80) / 111000;
    const rx = r / Math.cos((lat * Math.PI) / 180);
    const bbox = [lon - rx, lat - r, lon + rx, lat + r].map((v) => v.toFixed(6)).join(",");
    const d = await graph("images", token, { fields: FIELDS, bbox, limit: "500" });
    const cands = [];
    for (const x of (d.data ?? []).sort((a, b) => b.captured_at - a.captured_at)) {
      if (cands.length >= (pt.candidates ?? cfg.candidates ?? 3)) break;
      if (x.is_pano || !x.thumb_2048_url || Math.max(x.width, x.height) < 1600 || x.id in chosen || x.id in ex || seenSeq.has(x.sequence)) continue;
      seenSeq.add(x.sequence);
      cands.push(`${x.id}（${new Date(x.captured_at).toLocaleDateString("sv-SE")}）https://www.mapillary.com/app/?pKey=${x.id}&focus=photo`);
    }
    if (cands.length) console.log(`  候補：${pt.name}\n    ${cands.join("\n    ")}`);
  }
  return { photos: out, source: "Mapillary（gallery-config.yaml の mapillary.images で選んだもの）" };
}
