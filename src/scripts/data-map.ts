/**
 * データのページの地図。「地図で見る」を押したときにだけ読み込む（Leaflet と地理院タイル）。
 * Leaflet は自分のサーバーから配る（CDN から読まない）。地図の画像だけ国土地理院から読む。
 * 地図の土台（タイル・市の境界・点の見た目）は map-base.ts。
 */
import type L from "leaflet";
import { baseMap } from "./map-base";

type Rows = (string | number | null)[][];
interface DS {
  columns: [string, string][];
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function makeMap(el: HTMLElement) {
  const m = baseMap(el);

  return {
    /** 地図の点を、いまの行で描き直す。データを切り替えても同じ地図を使う */
    show(rows: Rows, ds: DS) {
      const la = ds.columns.findIndex((c) => c[1] === "lat");
      const lo = ds.columns.findIndex((c) => c[1] === "lon");
      // ふきだしに出す列（読み・長い注意書きは出さない）
      const cols = ds.columns.map((c, i) => [c, i] as const).filter(([c]) => ["text", "num", "flag"].includes(c[1]));
      m.layer.clearLayers();
      const pts: L.LatLngTuple[] = [];
      for (const r of rows) {
        const lat = Number(r[la]), lon = Number(r[lo]);
        if (!lat || !lon) continue;
        pts.push([lat, lon]);
        const html = cols
          .filter(([, i]) => r[i] !== "" && r[i] !== null)
          .map(([c, i], n) => (n === 0 ? `<b>${esc(r[i])}</b>` : `${esc(c[0])}：${c[1] === "flag" && r[i] === "有" ? "あり" : esc(r[i])}`))
          .join("<br>");
        m.dot([lat, lon]).bindPopup(html).addTo(m.layer);
      }
      m.fit(pts);
    },
  };
}
