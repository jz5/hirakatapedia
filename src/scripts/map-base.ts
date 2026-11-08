/**
 * データのページと写真ギャラリーで使う地図の土台（Leaflet と地理院タイル）。
 * 市の境界に線を引き、市の外を薄くする（点が市のどこにあるか分かりやすいように）。
 * 点は、地図の川（青）・道路（緑）とまぎれないオレンジ（--chart-2）で、白いふちを付ける。
 * 境界は OpenStreetMap（content/data/hirakata-boundary.json、ODbL）
 */
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import boundary from "../../content/data/hirakata-boundary.json";

const ring = boundary.coordinates.map(([lon, lat]) => [lat, lon] as L.LatLngTuple);
const cityBounds = L.latLngBounds(ring);

/** canvas：点が多い地図（写真ギャラリー）は canvas で描く。少ないもの（データのページ）は SVG のまま */
export function baseMap(el: HTMLElement, { canvas = false } = {}) {
  const map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.5, preferCanvas: canvas });
  L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>｜境界 © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  // 市の外を白く覆う（世界全体の四角から、市の形をくりぬく）
  const world: L.LatLngTuple[] = [[85, -180], [85, 180], [-85, 180], [-85, -180]];
  L.polygon([world, ring], { stroke: false, fillColor: "#fff", fillOpacity: 0.55, interactive: false }).addTo(map);
  L.polygon(ring, { color: "#3d4a52", weight: 1.5, opacity: 0.7, fill: false, interactive: false }).addTo(map);
  map.fitBounds(cityBounds, { padding: [8, 8] });

  // 枠の大きさが変わったとき（隠れていたのが出た・画面を回した・幅が変わった）と、
  // 「戻る」でページがそのまま戻ってきたときに、地図の大きさを取り直す。取り直さないと灰色のままになる
  new ResizeObserver(() => map.invalidateSize()).observe(el);
  addEventListener("pageshow", (e) => {
    if (e.persisted) map.invalidateSize();
  });

  const color = getComputedStyle(document.documentElement).getPropertyValue("--chart-2").trim() || "#c9541a";
  const layer = L.layerGroup().addTo(map);
  return {
    map,
    layer,
    /** 点。数が多い（同じ場所に何枚もある）ときは少し大きく */
    dot: (ll: L.LatLngTuple, n = 1) => L.circleMarker(ll, { radius: n > 1 ? 8 : 6.5, weight: 2, color: "#fff", fillColor: color, fillOpacity: 1 }),
    /** 点が全部入るように寄せる。点が無いときは市の全体 */
    fit(pts: L.LatLngTuple[]) {
      map.invalidateSize();
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
      else map.fitBounds(cityBounds, { padding: [8, 8] });
      setTimeout(() => map.invalidateSize(), 0);
    },
  };
}
