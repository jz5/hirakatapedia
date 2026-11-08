/**
 * 写真ギャラリーの地図。「地図で見る」を押したときにだけ読み込む（Leaflet と地理院タイル。土台は map-base.ts）。
 * 10 万枚でも動くように、画面に見えている範囲の点だけを、画面の上で近いもの（CELL px 四方）ごとにまとめて描く。
 * まとめた印には枚数を出し、押すとそこへ寄る。同じ場所の写真は 1 つの点にまとめ、押すと小さい写真が並ぶ（MAX 枚まで）。
 * 地図を動かしたり拡大したりするたびに描き直す
 */
import L from "leaflet";
import { baseMap } from "./map-base";

type Row = [string, string, number | null, number[], number[], number | null, number | null, ...unknown[]];
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const thumb = (id: string) => `/gallery/i/${id.slice(0, 2)}/${id}-s.avif`;
const MAX = 6;
const CELL = 46;
const NEAR = 48;

export function makeGalleryMap(el: HTMLElement) {
  const m = baseMap(el, { canvas: true });
  let pts: Row[] = [];

  const popup = (list: Row[]) => {
    const one = (r: Row, w: number) => `<a class="gallery-pop" href="/gallery/${r[0]}/"><img src="${thumb(r[0])}" alt="" width="${w}"><span>${esc(r[1])}</span></a>`;
    return list.length === 1
      ? one(list[0], 200)
      : `<div class="gallery-pop-many">${list.slice(0, MAX).map((r) => one(r, 96)).join("")}</div>${list.length > MAX ? `<p class="gallery-pop-more">ほか ${(list.length - MAX).toLocaleString()} 枚</p>` : ""}`;
  };

  const draw = () => {
    m.layer.clearLayers();
    const z = m.map.getZoom();
    const view = m.map.getBounds().pad(0.25);
    const cells = new Map<string, Row[]>();
    for (const r of pts) {
      const ll = L.latLng(r[5]!, r[6]!);
      if (!view.contains(ll)) continue;
      const p = m.map.project(ll, z);
      const k = `${Math.floor(p.x / CELL)},${Math.floor(p.y / CELL)}`;
      const c = cells.get(k);
      c ? c.push(r) : cells.set(k, [r]);
    }
    // 枡の境目をはさんで近い組は、印が重なって押せなくなるので、さらにまとめる（多い組から順に、中心が NEAR px 以内なら足す）
    const groups: { x: number; y: number; list: Row[] }[] = [];
    const center = (list: Row[]) => m.map.project(L.latLng(list.reduce((s, r) => s + r[5]!, 0) / list.length, list.reduce((s, r) => s + r[6]!, 0) / list.length), z);
    for (const list of [...cells.values()].sort((a, b) => b.length - a.length)) {
      const c = center(list);
      const g = groups.find((g) => Math.hypot(g.x - c.x, g.y - c.y) < NEAR);
      if (g) g.list.push(...list);
      else groups.push({ x: c.x, y: c.y, list });
    }
    for (const { list } of groups) {
      // 同じ場所（約 10m 四方）だけなら 1 つの点、そうでなければ枚数の印
      const same = list.every((r) => r[5]!.toFixed(4) === list[0][5]!.toFixed(4) && r[6]!.toFixed(4) === list[0][6]!.toFixed(4));
      if (same || z >= m.map.getMaxZoom()) {
        m.dot([list[0][5]!, list[0][6]!], list.length).bindPopup(popup(list), { maxWidth: list.length === 1 ? 220 : 230 }).addTo(m.layer);
        continue;
      }
      const lat = list.reduce((s, r) => s + r[5]!, 0) / list.length, lon = list.reduce((s, r) => s + r[6]!, 0) / list.length;
      const size = list.length < 10 ? 28 : list.length < 100 ? 34 : list.length < 1000 ? 40 : 46;
      L.marker([lat, lon], {
        icon: L.divIcon({ className: "gmap-cluster", html: `<span>${list.length.toLocaleString()}</span>`, iconSize: [size, size] }),
        title: `${list.length.toLocaleString()} 枚`,
        keyboard: true,
      })
        .on("click", () => m.map.fitBounds(L.latLngBounds(list.map((r) => [r[5]!, r[6]!] as L.LatLngTuple)), { padding: [40, 40], maxZoom: m.map.getMaxZoom() }))
        .addTo(m.layer);
    }
  };
  m.map.on("moveend", draw);

  return {
    show(rows: Row[]) {
      pts = rows.filter((r) => r[5] !== null && r[6] !== null);
      m.fit(pts.map((r) => [r[5]!, r[6]!] as L.LatLngTuple));
      draw();
    },
  };
}
