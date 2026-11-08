/**
 * Japan Search（https://jpsearch.go.jp/）：gallery-config.yaml の jpsearch に書いた資料だけ（1 件ずつ選ぶ）。
 * 題名・作成者・年代・所蔵館・利用条件は Japan Search の API から。画像は所蔵館のサイトから（設定の image）
 */
import sharp from "sharp";
import { CONFIG, UA, getJson, photo, placesIn, sleep, strip, when } from "./common.mjs";

const RIGHTS = {
  pdm: ["Public domain", "https://creativecommons.org/publicdomain/mark/1.0/deed.ja"],
  cc0: ["CC0", "https://creativecommons.org/publicdomain/zero/1.0/deed.ja"],
  ccby: ["CC BY", ""],
  ccbysa: ["CC BY-SA", ""],
};
const OWNERS = { tnm: "東京国立博物館（ColBase）", ndl: "国立国会図書館", libkyoto: "京都府立京都学・歴彩館", libosaka: "大阪市立図書館" };

export async function collect() {
  const out = [];
  for (const it of CONFIG.jpsearch ?? []) {
    const d = await getJson(`https://jpsearch.go.jp/api/item/${it.id}`, { gap: 500 });
    const c = d.common ?? {};
    const rights = RIGHTS[c.contentsRightsType];
    if (!rights) {
      console.log(`Japan Search：${it.id} は使えない条件（${c.contentsRightsType}）`);
      continue;
    }
    const owner = OWNERS[c.provider] ?? c.provider;
    const r = await fetch(it.image, { headers: { "User-Agent": UA } });
    if (!r.ok) { console.log(`Japan Search：${it.id} の画像が取れない ${r.status}`); continue; }
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    await sleep(500);
    const who = (c.contributor ?? []).filter((x) => !/寄贈|^東京国立博物館$|Tokyo National Museum/.test(x));
    const temporal = (c.temporal ?? []).find((t) => /\d/.test(t)) ?? (c.temporal ?? [])[0] ?? "";
    const w = when(temporal);
    const title = strip(c.title);
    out.push(
      photo({
        site: "jpsearch",
        file: `jps-${it.id}`,
        title,
        desc: [it.note, temporal && `年代：${temporal}`, (c.location ?? []).length ? `場所：${c.location.join("、")}` : ""].filter(Boolean).join("。"),
        author: { name: who.length ? `${who.join("、")}（${owner}所蔵）` : owner, url: c.linkUrl ?? "" },
        license: rights[0],
        licenseUrl: rights[1] || c.linkUrl || "",
        source: `https://jpsearch.go.jp/item/${it.id}`,
        sourceName: `Japan Search（${owner}）`,
        credit: `${title}、${owner}所蔵（Japan Search）／${rights[0]}`,
        date: null,
        year: w.year && w.year >= 1800 ? w.year : null,
        lat: it.lat ?? null,
        lon: it.lon ?? null,
        groups: ["歴史"],
        ...((pl) => ({ places: pl.places }))(placesIn(`${title} ${(c.location ?? []).join(" ")} ${it.note ?? ""}`)),
        width: meta.width,
        height: meta.height,
        thumb: it.image,
      }),
    );
    console.log(`Japan Search：${title}（${owner}、${rights[0]}）`);
  }
  return { photos: out, source: "Japan Search で選んだ資料（gallery-config.yaml の jpsearch）" };
}
