/**
 * 地理院タイルをつなぎ合わせて、範囲（緯度・経度）を切り抜いた画像を作る（PNG）。
 * scripts/photos.mjs（記事の写真）と scripts/gallery/gsi.mjs（写真ギャラリーの空中写真）で使う。
 * spec：layer（タイルの種類）・ext（拡張子。省略は jpg）・zoom・north・south・west・east・labels（書き込む地名。なくてよい）
 */
import sharp from "sharp";

export const GSI_LIST = "https://maps.gsi.go.jp/development/ichiran.html";
export const px = (lat, lon, z) => {
  const n = 256 * 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n];
};
const escXml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function gsiImage(spec, ua) {
  const [x0, y0] = px(spec.north, spec.west, spec.zoom);
  const [x1, y1] = px(spec.south, spec.east, spec.zoom);
  const tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256), tx1 = Math.floor(x1 / 256), ty1 = Math.floor(y1 / 256);
  const tiles = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const res = await fetch(`https://cyberjapandata.gsi.go.jp/xyz/${spec.layer}/${spec.zoom}/${tx}/${ty}.${spec.ext ?? "jpg"}`, { headers: { "User-Agent": ua } });
      if (res.status === 404) continue; // その年代の写真が無いところ（白のまま）
      if (!res.ok) throw new Error(`地理院タイル ${res.status} ${spec.layer}/${spec.zoom}/${tx}/${ty}`);
      tiles.push({ input: Buffer.from(await res.arrayBuffer()), left: (tx - tx0) * 256, top: (ty - ty0) * 256 });
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!tiles.length) throw new Error(`地理院タイルが 1 枚も無い ${spec.layer}`);
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

/** 範囲の画像の大きさ（px） */
export function gsiSize(spec) {
  const [x0, y0] = px(spec.north, spec.west, spec.zoom);
  const [x1, y1] = px(spec.south, spec.east, spec.zoom);
  return { width: Math.round(x1 - x0), height: Math.round(y1 - y0) };
}
