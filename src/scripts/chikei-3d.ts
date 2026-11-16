/**
 * 地形を 3D で見るページ（/data/chikei/）の本体。ページを開いたあとで読み込む。
 * three.js は自分のサーバーから配り、標高・空中写真・地図の画像も自分のサーバー（public/maps/chikei/）から読む。
 * 標高は 768×768 のマス（約 31m ごと）。画像の赤と緑の 2 バイトに (標高 + 100) × 50 が入っている（scripts/chikei-data.py）。
 * 市の境界と市の外の薄い影は、地表に貼る画像に描き込む。地名は HTML を重ねて、重なったら後の地名を隠す。
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import meta from "../../content/data/chikei.json";

type Layer = "photo" | "pale" | "elev";
type Label = { n: string; k: string; u: number; v: number; e?: number };

const N = meta.n;
const S = meta.sizeM / 100; // 100m を 1 とする
const BASE = "/maps/chikei/";
const MAX_EXAG = 20;

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((ok, ng) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => ng(new Error(src));
    im.src = src;
  });
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** 標高の色分け（低い土地を細かく分ける）。[標高 m, R, G, B] */
const RAMP: [number, number, number, number][] = (
  [[0, "#5f9d8c"], [10, "#8fbf8f"], [25, "#c3d99a"], [50, "#e9e0a0"], [90, "#e6c184"], [150, "#cf9d68"], [230, "#ae7a56"], [330, "#8d6658"], [480, "#a8958c"], [680, "#f1ece6"]] as [number, string][]
).map(([h, c]) => [h, parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]);
function rampColor(h: number, out: number[]) {
  let i = 1;
  while (i < RAMP.length - 1 && h > RAMP[i][0]) i++;
  const a = RAMP[i - 1], b = RAMP[i];
  const t = Math.min(1, Math.max(0, (h - a[0]) / (b[0] - a[0])));
  out[0] = a[1] + (b[1] - a[1]) * t;
  out[1] = a[2] + (b[2] - a[2]) * t;
  out[2] = a[3] + (b[3] - a[3]) * t;
}

export async function makeChikei(root: HTMLElement) {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const view = q<HTMLElement>(".chikei-view");
  const labelsEl = q<HTMLElement>(".chikei-labels");
  const readout = q<HTMLElement>(".chikei-readout");
  const loading = q<HTMLElement>(".chikei-loading");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = { layer: "photo" as Layer, exag: 2, border: true, labels: true };

  const [imgH, imgPhoto] = await Promise.all([loadImg(`${BASE}heights.png`), loadImg(`${BASE}photo.jpg`)]);
  let imgPale: HTMLImageElement | null = null;

  // 標高のマスを画像から取り出す
  const hc = document.createElement("canvas");
  hc.width = hc.height = N;
  const hx = hc.getContext("2d", { willReadFrequently: true })!;
  hx.drawImage(imgH, 0, 0);
  const px = hx.getImageData(0, 0, N, N).data;
  const H = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) H[i] = (px[i * 4] * 256 + px[i * 4 + 1]) / 50 - 100;
  const hGrid = (ix: number, iy: number) => H[Math.min(N - 1, Math.max(0, iy)) * N + Math.min(N - 1, Math.max(0, ix))];
  /** 位置（0〜1）の標高 m。まわりの 4 マスからなめらかに求める */
  function hAt(u: number, v: number) {
    const x = u * N - 0.5, y = v * N - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    return (hGrid(x0, y0) * (1 - fx) + hGrid(x0 + 1, y0) * fx) * (1 - fy) + (hGrid(x0, y0 + 1) * (1 - fx) + hGrid(x0 + 1, y0 + 1) * fx) * fy;
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  view.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 12;
  controls.maxDistance = 700;
  controls.autoRotateSpeed = 0.6;
  controls.screenSpacePanning = false;
  // ページをスクロールするホイールで拡大しないように、3D の上を押してからだけホイールで拡大する
  controls.enableZoom = false;
  // スマートフォンは、1 本の指ではページをスクロールし、2 本の指で回す・ピンチで拡大する
  controls.touches = { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
  renderer.domElement.style.touchAction = "pan-y";

  // 光は北西から（地図の陰影の慣例）
  scene.add(new THREE.AmbientLight(0xffffff, 0.62 * Math.PI));
  const sun = new THREE.DirectionalLight(0xffffff, 0.62 * Math.PI);
  sun.position.set(-1, 1.1, -1);
  scene.add(sun);
  const world = new THREE.Group();
  scene.add(world);

  // 地表
  const pos = new Float32Array(N * N * 3), uvs = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i, u = (i + 0.5) / N, v = (j + 0.5) / N;
      pos[k * 3] = (u - 0.5) * S;
      pos[k * 3 + 1] = H[k] / 100;
      pos[k * 3 + 2] = (v - 0.5) * S;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = 1 - v;
    }
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let p = 0;
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const maxTex = Math.min(renderer.capabilities.maxTextureSize, 4096);
  const texCanvas = document.createElement("canvas");
  const tex = new THREE.CanvasTexture(texCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  world.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex })));

  // 模型の側面
  const FLOOR = -4;
  const sidePos: number[] = [], sideIdx: number[] = [];
  function wall(cells: [number, number][]) {
    const o = sidePos.length / 3;
    for (const [i, j] of cells) {
      const k = (j * N + i) * 3;
      sidePos.push(pos[k], pos[k + 1], pos[k + 2], pos[k], FLOOR, pos[k + 2]);
    }
    for (let n = 0; n < cells.length - 1; n++) {
      const a = o + n * 2;
      sideIdx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const rng = [...Array(N).keys()], rev = rng.slice().reverse();
  wall(rng.map((i) => [i, N - 1]));
  wall(rev.map((j) => [N - 1, j]));
  wall(rev.map((i) => [i, 0]));
  wall(rng.map((j) => [0, j]));
  const sideGeo = new THREE.BufferGeometry();
  sideGeo.setAttribute("position", new THREE.Float32BufferAttribute(sidePos, 3));
  sideGeo.setIndex(sideIdx);
  sideGeo.computeVertexNormals();
  const sideMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  world.add(new THREE.Mesh(sideGeo, sideMat));

  let dirty = true;

  // 地表に貼る画像。標高の色分けは、選んだときに 1 度だけ作る（等高線は 10m ごと、50m ごとに濃く）
  let elevCanvas: HTMLCanvasElement | null = null;
  function buildElev() {
    const M = Math.min(2048, maxTex), c = document.createElement("canvas");
    c.width = c.height = M;
    const x = c.getContext("2d")!, im = x.createImageData(M, M), d = im.data, col = [0, 0, 0];
    const row = new Float32Array(M), prev = new Float32Array(M);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) row[i] = hAt((i + 0.5) / M, (j + 0.5) / M);
      for (let i = 0; i < M; i++) {
        const h = row[i];
        rampColor(h, col);
        const hl = i ? row[i - 1] : h, hu = j ? prev[i] : h;
        let k = 1;
        if (Math.floor(h / 50) !== Math.floor(hl / 50) || Math.floor(h / 50) !== Math.floor(hu / 50)) k = 0.55;
        else if (Math.floor(h / 10) !== Math.floor(hl / 10) || Math.floor(h / 10) !== Math.floor(hu / 10)) k = 0.8;
        const o = (j * M + i) * 4;
        d[o] = col[0] * k; d[o + 1] = col[1] * k * 0.97; d[o + 2] = col[2] * k * 0.9; d[o + 3] = 255;
      }
      prev.set(row);
    }
    x.putImageData(im, 0, 0);
    return c;
  }
  async function paint() {
    const layer = state.layer;
    let src: CanvasImageSource;
    if (layer === "photo") src = imgPhoto;
    else if (layer === "pale") src = imgPale ?? (imgPale = await loadImg(`${BASE}pale.jpg`));
    else src = elevCanvas ?? (elevCanvas = buildElev());
    if (layer !== state.layer) return; // 読み込む間に切り替わった
    // 画像の大きさは表示を切り替えても変えない（three.js は、貼った画像の大きさをあとから変えられない）
    const size = Math.min(3072, maxTex);
    if (texCanvas.width !== size) texCanvas.width = texCanvas.height = size;
    const x = texCanvas.getContext("2d")!;
    x.drawImage(src, 0, 0, size, size);
    if (state.border) {
      const path = new Path2D();
      for (const r of meta.rings) {
        r.forEach(([u, v], n) => (n ? path.lineTo(u * size, v * size) : path.moveTo(u * size, v * size)));
        path.closePath();
      }
      // 市の外を少し暗くする
      const veil = new Path2D();
      veil.rect(0, 0, size, size);
      veil.addPath(path);
      x.fillStyle = layer === "photo" ? "rgba(10,20,25,.16)" : "rgba(40,55,60,.16)";
      x.fill(veil, "evenodd");
      x.lineJoin = "round";
      x.strokeStyle = "rgba(0,0,0,.55)";
      x.lineWidth = size / 340;
      x.stroke(path);
      x.strokeStyle = layer === "photo" ? "#ffe9a8" : "#c9541a";
      x.lineWidth = size / 680;
      x.stroke(path);
    }
    tex.needsUpdate = true;
    dirty = true;
  }

  // 地名。山・駅など・川・まわりの市と町の順に置き、重なる地名は出さない
  const rank: Record<string, number> = { peak: 0, spot: 1, river: 2, town: 3 };
  const labels = (meta.labels as Label[])
    .slice()
    .sort((a, b) => rank[a.k] - rank[b.k])
    .map((l) => {
      const el = document.createElement("div");
      el.className = `chikei-lb chikei-lb-${l.k}`;
      const s = document.createElement("span");
      s.textContent = l.k === "peak" ? `▲ ${l.n} ${l.e}m` : l.n;
      el.append(s, document.createElement("i"));
      labelsEl.append(el);
      return { el, x: (l.u - 0.5) * S, z: (l.v - 0.5) * S, h: hAt(l.u, l.v) / 100, w: 0, hgt: 0 };
    });
  const v3 = new THREE.Vector3();
  function placeLabels() {
    const w = view.clientWidth, h = view.clientHeight, placed: number[][] = [];
    for (const l of labels) {
      v3.set(l.x, l.h * state.exag + 0.3, l.z).project(camera);
      const vis = state.labels && v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05;
      l.el.hidden = !vis;
      if (!vis) continue;
      if (!l.w) { l.w = l.el.offsetWidth; l.hgt = l.el.offsetHeight; }
      const sx = (v3.x * 0.5 + 0.5) * w, sy = (-v3.y * 0.5 + 0.5) * h;
      const x0 = sx - l.w / 2, y0 = sy - l.hgt, x1 = x0 + l.w, y1 = y0 + l.hgt;
      if (placed.some((r) => x0 < r[2] + 4 && x1 > r[0] - 4 && y0 < r[3] + 2 && y1 > r[1] - 2)) { l.el.hidden = true; continue; }
      placed.push([x0, y0, x1, y1]);
      l.el.style.transform = `translate(${Math.round(x0)}px,${Math.round(y0)}px)`;
    }
    if (pin) {
      v3.set(pin.x, pin.h * state.exag, pin.z).project(camera);
      pinEl.hidden = v3.z >= 1;
      pinEl.style.transform = `translate(${Math.round((v3.x * 0.5 + 0.5) * w)}px,${Math.round((-v3.y * 0.5 + 0.5) * h)}px)`;
    }
  }

  // 視点
  const ring0 = meta.rings[0];
  const cityC = [(ring0.reduce((s, r) => s + r[0], 0) / ring0.length - 0.5) * S, (ring0.reduce((s, r) => s + r[1], 0) / ring0.length - 0.5) * S];
  let fly: { t: number; p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3 } | null = null;
  function goTo(target: THREE.Vector3, offset: THREE.Vector3, instant: boolean) {
    const aspect = view.clientWidth / Math.max(1, view.clientHeight);
    const k = aspect < 1 ? Math.min(2.2, 1 / aspect) : 1;
    const to = target.clone().addScaledVector(offset, k);
    if (instant || reduceMotion) {
      controls.target.copy(target);
      camera.position.copy(to);
      controls.update();
      dirty = true;
      return;
    }
    fly = { t: 0, p0: camera.position.clone(), p1: to, t0: controls.target.clone(), t1: target };
  }
  const viewAll = (instant = false) => goTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-70, 150, 270), instant);
  const viewCity = (instant = false) => goTo(new THREE.Vector3(cityC[0], 0, cityC[1]), new THREE.Vector3(-55, 70, 115), instant);

  // 色はサイトのテーマに合わせる
  function applyTheme() {
    renderer.setClearColor(new THREE.Color(css("--bg-sub", "#f1f6f6")));
    sideMat.color.set(css("--mut-soft", "#79838b"));
    dirty = true;
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // 指した所の標高。視線を少しずつ進めて、地表より下になった所を探す
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function probe(cx: number, cy: number) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const gap = (t: number) => {
      const u = (o.x + d.x * t) / S + 0.5, v = (o.z + d.z * t) / S + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      return o.y + d.y * t - (hAt(u, v) / 100) * state.exag;
    };
    let a = 0, b = -1;
    for (let t = 0; t < 1600; t += 0.5) {
      const g = gap(t);
      if (g !== null && g <= 0) { b = t; break; }
      a = t;
    }
    if (b < 0) return null;
    for (let n = 0; n < 12; n++) {
      const m = (a + b) / 2, g = gap(m);
      if (g !== null && g <= 0) b = m;
      else a = m;
    }
    const u = (o.x + d.x * b) / S + 0.5, v = (o.z + d.z * b) / S + 0.5;
    const my = (lat: number) => Math.asinh(Math.tan((lat * Math.PI) / 180));
    const lon = meta.nw[1] + (meta.se[1] - meta.nw[1]) * u;
    const lat = (Math.atan(Math.sinh(my(meta.nw[0]) + (my(meta.se[0]) - my(meta.nw[0])) * v)) * 180) / Math.PI;
    return { h: hAt(u, v), lat, lon, u, v };
  }
  let probeXY: [number, number] | null = null;
  // 指している地点の印（標高の数字はこの地点の値）
  let pin: { x: number; z: number; h: number } | null = null;
  const pinEl = document.createElement("div");
  pinEl.className = "chikei-pin";
  pinEl.hidden = true;
  labelsEl.append(pinEl);
  function showProbe() {
    if (!probeXY) return;
    const r = probe(probeXY[0], probeXY[1]);
    probeXY = null;
    if (!r) return;
    // 数字の幅が変わっても枠が伸び縮みしないように、数字ごとに幅を決めた枠に入れる
    // 数字と単位を左に寄せ、余りは単位のあとに回す（項目名と数字の間はいつも同じ）
    readout.innerHTML = `標高 <span class="chikei-num chikei-num-h"><b>${r.h.toFixed(1)}</b>m</span> <span class="chikei-ll">北緯 <span class="chikei-num">${r.lat.toFixed(4)}°</span> 東経 <span class="chikei-num chikei-num-lon">${r.lon.toFixed(4)}°</span></span>`;
    readout.hidden = false;
    pin = { x: (r.u - 0.5) * S, z: (r.v - 0.5) * S, h: r.h / 100 };
    dirty = true;
  }
  function clearProbe() {
    pin = null;
    pinEl.hidden = true;
    readout.hidden = true;
  }
  const cv = renderer.domElement;
  let downAt: [number, number] | null = null;
  cv.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse" && e.buttons === 0) probeXY = [e.clientX, e.clientY];
  });
  cv.addEventListener("pointerdown", (e) => {
    downAt = [e.clientX, e.clientY];
    fly = null;
    controls.enableZoom = true;
  });
  cv.addEventListener("pointerup", (e) => {
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 6) probeXY = [e.clientX, e.clientY];
    downAt = null;
  });
  cv.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    if (!full) controls.enableZoom = false;
    probeXY = null;
    clearProbe();
  });
  // 2 本の指のときだけ、ページのスクロールやブラウザの拡大を止めて 3D を動かす。1 本の指で動かしたら、使い方を出す
  const touchHint = q<HTMLElement>(".chikei-touchhint");
  let hintTimer = 0;
  cv.addEventListener("touchstart", (e) => { if (full || e.touches.length > 1) e.preventDefault(); }, { passive: false });
  cv.addEventListener("touchmove", (e) => {
    if (full || e.touches.length > 1) {
      e.preventDefault();
      touchHint.hidden = true;
      return;
    }
    touchHint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(() => (touchHint.hidden = true), 1500);
  }, { passive: false });

  // 操作
  const layerBtns = [...root.querySelectorAll<HTMLButtonElement>("[data-layer]")];
  const legend = q<HTMLElement>(".chikei-legend");
  for (const b of layerBtns) {
    b.addEventListener("click", () => {
      state.layer = b.dataset.layer as Layer;
      for (const o of layerBtns) o.setAttribute("aria-pressed", String(o === b));
      legend.hidden = state.layer !== "elev";
      paint();
    });
  }
  const range = q<HTMLInputElement>("#chikei-exag"), num = q<HTMLInputElement>("#chikei-exag-n");
  function setExag(n: number, from?: "range" | "num") {
    if (!isFinite(n)) return;
    state.exag = Math.min(MAX_EXAG, Math.max(1, n));
    if (from !== "range") range.value = String(Math.min(Number(range.max), state.exag));
    if (from !== "num") num.value = String(+state.exag.toFixed(1));
    world.scale.y = state.exag;
    dirty = true;
  }
  range.addEventListener("input", () => setExag(Number(range.value), "range"));
  num.addEventListener("input", () => { if (num.value !== "") setExag(Number(num.value), "num"); });
  num.addEventListener("change", () => setExag(Number(num.value) || state.exag));
  q<HTMLInputElement>("#chikei-border").addEventListener("change", (e) => { state.border = (e.target as HTMLInputElement).checked; paint(); });
  q<HTMLInputElement>("#chikei-names").addEventListener("change", (e) => { state.labels = (e.target as HTMLInputElement).checked; dirty = true; });
  q<HTMLInputElement>("#chikei-spin").addEventListener("change", (e) => { controls.autoRotate = (e.target as HTMLInputElement).checked; });
  q<HTMLButtonElement>("#chikei-all").addEventListener("click", () => viewAll());
  q<HTMLButtonElement>("#chikei-city").addEventListener("click", () => viewCity());
  const zoomBy = (f: number) => {
    const off = camera.position.clone().sub(controls.target);
    off.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * f)));
    camera.position.copy(controls.target).add(off);
    dirty = true;
  };
  // 全画面。スマートフォンでも 1 本の指で回せる。「閉じる」・Esc・ブラウザの「戻る」で元に戻る
  const fullBtn = q<HTMLButtonElement>("#chikei-full"), closeBtn = q<HTMLButtonElement>(".chikei-close");
  let full = false;
  function setFull(on: boolean) {
    if (full === on) return;
    full = on;
    view.classList.toggle("chikei-full", on);
    document.documentElement.classList.toggle("chikei-noscroll", on);
    closeBtn.hidden = !on;
    fullBtn.hidden = on;
    controls.touches = on
      ? { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
      : { ONE: null as unknown as THREE.TOUCH, TWO: THREE.TOUCH.DOLLY_ROTATE };
    cv.style.touchAction = on ? "none" : "pan-y";
    controls.enableZoom = on;
    touchHint.hidden = true;
  }
  fullBtn.addEventListener("click", () => {
    history.pushState({ chikeiFull: true }, "");
    setFull(true);
  });
  const leave = () => (history.state?.chikeiFull ? history.back() : setFull(false));
  closeBtn.addEventListener("click", leave);
  addEventListener("keydown", (e) => { if (full && e.key === "Escape") leave(); });
  addEventListener("popstate", () => setFull(!!history.state?.chikeiFull));
  q<HTMLButtonElement>("#chikei-in").addEventListener("click", () => zoomBy(0.75));
  q<HTMLButtonElement>("#chikei-out").addEventListener("click", () => zoomBy(1 / 0.75));

  // 凡例の帯（低い土地が広く見えるように、目盛りは平方根）
  const ramp = q<HTMLCanvasElement>(".chikei-ramp"), rx = ramp.getContext("2d")!, col = [0, 0, 0];
  for (let i = 0; i < ramp.width; i++) {
    rampColor(Math.pow(i / (ramp.width - 1), 2) * 680, col);
    rx.fillStyle = `rgb(${col[0] | 0},${col[1] | 0},${col[2] | 0})`;
    rx.fillRect(i, 0, 1, ramp.height);
  }
  root.querySelectorAll<HTMLElement>(".chikei-ticks span").forEach((t) => {
    t.style.left = `${Math.sqrt(Number(t.dataset.h) / 680) * 100}%`;
  });

  controls.addEventListener("change", () => { dirty = true; });
  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  new ResizeObserver(resize).observe(view);
  const needle = q<HTMLElement>(".chikei-needle");
  function frame() {
    requestAnimationFrame(frame);
    if (fly) {
      fly.t = Math.min(1, fly.t + 1 / 45);
      const e = 1 - Math.pow(1 - fly.t, 3);
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (fly.t >= 1) fly = null;
      dirty = true;
    }
    controls.update();
    if (dirty) {
      dirty = false;
      renderer.render(scene, camera);
      placeLabels();
      needle.setAttribute("transform", `rotate(${((controls.getAzimuthalAngle() * 180) / Math.PI).toFixed(1)})`);
    }
    showProbe();
  }

  world.scale.y = state.exag;
  applyTheme();
  resize();
  await paint();
  viewAll(true);
  loading.hidden = true;
  frame();
}
