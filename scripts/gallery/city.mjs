/**
 * 枚方市のオープンデータの画像（gallery-config.yaml の city）。
 * 「ひらかた市 オープンデータ画像集」（CC BY 2.1 JP）。「枚方市の文化財画像データ」は CC BY-ND（改変禁止）なので使わない。
 * ページの画像ごとに、題名と撮影日が書いてある。公園の写真は、市の公園のデータ（public/opendata/park.json）の位置を使う。
 * 表示は市の表示例の形：「[データのタイトル]、枚方市、クリエイティブ・コモンズ・ライセンス 表示 2.1」
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { CONFIG, ROOT, UA, getText, photo, placesIn, sleep, strip, when } from "./common.mjs";

const BASE = "https://www.city.hirakata.osaka.jp/";

/** 公園名 → 位置 */
function parks() {
  const f = join(ROOT, "public/opendata/park.json");
  if (!existsSync(f)) return new Map();
  const d = JSON.parse(readFileSync(f, "utf8"));
  const col = (n) => d.columns.findIndex((c) => c[0] === n);
  const [n, la, lo] = [col("公園名"), col("緯度"), col("経度")];
  return new Map(d.rows.filter((r) => r[la] && r[lo]).map((r) => [String(r[n]).replace(/\s/g, ""), [r[la], r[lo]]]));
}

/** 題名から、番号（「1」「（2）」「(3)」）と添え書きを取った名前 */
const baseName = (t) => t.replace(/[（(]\d+[）)].*$/, "").replace(/\d+$/, "").replace(/（花しょうぶ）/, "").trim();

export async function collect() {
  const parkPos = parks();
  const out = [];
  for (const pg of CONFIG.city ?? []) {
    const html = await getText(`${BASE}${pg.page}.html`);
    let section = "";
    // 見出し（h2・【】）と、画像のリンク・その下の説明を、出てくる順に読む
    const re = /<h2[^>]*>([\s\S]*?)<\/h2>|【([^】]+)】([^<]*)|<a href="([^"]+\.(?:jpe?g|png))"[^>]*>[\s\S]*?<\/a>(?:<\/div>)?\s*(?:<p>([\s\S]*?)<\/p>)?/gi;
    for (const m of html.matchAll(re)) {
      if (m[1]) { section = strip(m[1]); continue; }
      if (m[2]) { section = strip(m[3]) || section; continue; }
      const href = m[4].replace(/^\s+|&#9;/g, "").trim();
      const info = strip((m[5] ?? "").replace(/<br ?\/?>/g, "\n"));
      // 画像集：「タイトル：牧野車塚古墳1 撮影日：20150610」、文化財：リンクの後の「特別史跡百済寺跡（1）（2021年7月5日撮影）」
      let title = info.match(/タイトル：(.+?)(?:\s*撮影日|$)/)?.[1]?.trim();
      let date = info.match(/撮影日：(.+)$/)?.[1];
      if (!title) {
        const t = info || strip(html.slice(m.index + m[0].length, m.index + m[0].length + 300)).replace(/^別ウィンドウで開く\s*/, "");
        const mm = t.match(/^(.+?)（(\d{4}年[^）]*?)撮影\s*[）)]/);
        if (!mm) continue;
        title = mm[1].trim();
        date = mm[2];
      }
      const url = new URL(href, `${BASE}${pg.page}.html`).href;
      const fileName = url.split("/").pop();
      const w = when((date ?? "").replace(/末/, ""));
      const name = baseName(title);
      const pos = parkPos.get(name.replace(/\s/g, ""));
      const r = await fetch(url, { headers: { "User-Agent": UA } });
      if (!r.ok) { console.log(`  取れなかった ${url}`); continue; }
      const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      const rotated = (meta.orientation ?? 1) >= 5;
      await sleep(300);
      const pl = placesIn(`${title} ${section}`);
      out.push(
        photo({
          site: "city",
          file: `city-${pg.page}-${fileName}`,
          title,
          desc: section && section !== title ? `${pg.name}「${section}」の画像` : `${pg.name}の画像`,
          author: { name: "枚方市", url: `${BASE}${pg.page}.html` },
          license: pg.license,
          licenseUrl: pg.licenseUrl,
          source: `${BASE}${pg.page}.html`,
          sourceName: `枚方市「${pg.name}」`,
          credit: `${title}（${pg.name}）、枚方市、${pg.creditLicense}`,
          date: w.date,
          year: w.year,
          lat: pos?.[0] ?? null,
          lon: pos?.[1] ?? null,
          groups: [...new Set([pg.groups?.[section] ?? pg.group, ...pl.groups].filter(Boolean))],
          places: [...new Set([name, ...pl.places])],
          width: rotated ? meta.height : meta.width,
          height: rotated ? meta.width : meta.height,
          thumb: url,
        }),
      );
      process.stdout.write(`\r市：${pg.name} ${out.length}`);
    }
    console.log("");
  }
  return { photos: out, source: "枚方市のオープンデータの画像（gallery-config.yaml の city）" };
}
