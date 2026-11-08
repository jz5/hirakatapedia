/**
 * 国立国会図書館デジタルコレクション：gallery-config.yaml の ndl に書いた写真だけ（本のページから 1 枚ずつ選ぶ）。
 * 使うのは「インターネット公開（保護期間満了）」の本で、1956 年までに発行されたもの（写真の著作権が切れている）。
 * 画像は IIIF でページから写真の部分（crop：左・上・幅・高さ、% ）を切り抜いて取る
 */
import sharp from "sharp";
import { CONFIG, UA, photo, placesIn, sleep } from "./common.mjs";

export async function collect() {
  const out = [];
  for (const it of CONFIG.ndl ?? []) {
    if (!(it.year && it.year <= 1956)) {
      console.log(`国立国会図書館：${it.title} は 1956 年より後の本なので使わない`);
      continue;
    }
    const url = `https://www.dl.ndl.go.jp/api/iiif/${it.pid}/R${String(it.koma).padStart(7, "0")}/pct:${it.crop.join(",")}/full/0/default.jpg`;
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) { console.log(`国立国会図書館：${it.title} の画像が取れない ${r.status}`); continue; }
    const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
    await sleep(800);
    out.push(
      photo({
        site: "ndl",
        file: `ndl-${it.pid}-${it.koma}${it.part ?? ""}`,
        title: it.title,
        desc: `『${it.book}』（${it.year}年）に載っている写真。${it.note ?? ""}`.trim(),
        author: { name: `${it.publisher}（国立国会図書館所蔵）`, url: `https://dl.ndl.go.jp/pid/${it.pid}` },
        license: "Public domain",
        licenseUrl: `https://dl.ndl.go.jp/pid/${it.pid}/1/${it.koma}`,
        source: `https://dl.ndl.go.jp/pid/${it.pid}/1/${it.koma}`,
        sourceName: "国立国会図書館デジタルコレクション",
        credit: `『${it.book}』（${it.year}年）より（国立国会図書館デジタルコレクション）`,
        edited: "本のページから写真の部分を切り抜き",
        year: it.shotYear ?? null,
        groups: [it.group ?? "歴史"],
        places: [...new Set([...(it.places ?? []), ...placesIn(`${it.title} ${it.note ?? ""}`).places])],
        width: meta.width,
        height: meta.height,
        thumb: url,
      }),
    );
    console.log(`国立国会図書館：${it.title}`);
  }
  return { photos: out, source: "国立国会図書館デジタルコレクションの本から選んだ写真（gallery-config.yaml の ndl）" };
}
