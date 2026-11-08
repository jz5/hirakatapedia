/**
 * 国土地理院の空中写真（地理院タイル）：年代ごと・地区ごとに、タイルをつなぎ合わせて切り抜いた画像（gallery-config.yaml の gsi）。
 * 地理院タイルの写真は、出典を書けば申請なしで使える（国土地理院コンテンツ利用規約。地理院タイル一覧の「出典の記載のみで利用可能なもの」）。
 * その年代の写真が地区の一部にしか無いとき（端のタイルが無いとき）は作らない。画像は images のときに作る
 */
import { CONFIG, UA, photo } from "./common.mjs";
import { GSI_LIST, gsiSize, px } from "../lib/gsi-image.mjs";

const TERMS = "https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html";

/** 中心と幅（km）から範囲 */
function box([lat, lon], wKm, hKm) {
  const dLat = hKm / 2 / 111.0, dLon = wKm / 2 / (111.0 * Math.cos((lat * Math.PI) / 180));
  return { north: +(lat + dLat).toFixed(5), south: +(lat - dLat).toFixed(5), west: +(lon - dLon).toFixed(5), east: +(lon + dLon).toFixed(5) };
}

/** 範囲の四隅と真ん中のタイルがあるか */
async function covered(layer, ext, zoom, b) {
  const pts = [[b.north, b.west], [b.north, b.east], [b.south, b.west], [b.south, b.east], [(b.north + b.south) / 2, (b.west + b.east) / 2]];
  for (const [lat, lon] of pts) {
    const [x, y] = px(lat, lon, zoom);
    const r = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${layer}/${zoom}/${Math.floor(x / 256)}/${Math.floor(y / 256)}.${ext}`, { headers: { "User-Agent": UA }, method: "GET" });
    if (!r.ok) return false;
    await new Promise((s) => setTimeout(s, 50));
  }
  return true;
}

export async function collect() {
  const cfg = CONFIG.gsi;
  const out = [];
  const areas = [...cfg.areas.map((a) => ({ ...a, zoom: cfg.zoom, ...box(a.center, cfg.widthKm, cfg.heightKm) })), { ...cfg.whole, center: [(cfg.whole.north + cfg.whole.south) / 2, (cfg.whole.west + cfg.whole.east) / 2] }];
  for (const era of cfg.eras) {
    for (const a of areas) {
      const spec = { layer: era.layer, ext: era.ext ?? "jpg", zoom: a.zoom, north: a.north, south: a.south, west: a.west, east: a.east };
      if (!(await covered(spec.layer, spec.ext, spec.zoom, spec))) {
        console.log(`国土地理院：${era.name} ${a.name} は写真が足りないので作らない`);
        continue;
      }
      const size = gsiSize(spec);
      const [lat, lon] = a.center;
      out.push(
        photo({
          site: "gsi",
          file: `gsi-${era.layer}-${a.id}.png`,
          title: `${a.name}の空中写真（${era.years}）`,
          desc: `国土地理院の${era.name}。地理院タイルをつなぎ合わせて、${a.name}の範囲（北緯${spec.south}〜${spec.north}度、東経${spec.west}〜${spec.east}度）を切り抜いた画像`,
          author: { name: "国土地理院", url: GSI_LIST },
          license: "国土地理院コンテンツ利用規約",
          licenseUrl: TERMS,
          source: `https://maps.gsi.go.jp/#${Math.min(spec.zoom, 17)}/${lat.toFixed(5)}/${lon.toFixed(5)}/&base=std&ls=${era.layer}&disp=1`,
          sourceName: "国土地理院（地理院地図）",
          credit: `出典：国土地理院ウェブサイト（地理院タイル「${era.name}」を加工して作成）`,
          edited: "地理院タイルをつなぎ合わせて切り抜き",
          year: era.from ?? null,
          lat: a.id === "whole" ? null : lat,
          lon: a.id === "whole" ? null : lon,
          groups: ["空中写真"],
          places: a.id === "whole" ? ["枚方市の全体"] : [a.name.replace(/周辺$/, "")],
          width: size.width,
          height: size.height,
          gsi: spec,
        }),
      );
    }
  }
  return { photos: out, source: "国土地理院の空中写真（地理院タイル）を年代・地区ごとにつなぎ合わせたもの（gallery-config.yaml の gsi）" };
}
