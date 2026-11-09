/**
 * 記事のグラフ。ビルドのときに SVG の文字列を作る（JavaScript のライブラリは使わない）。
 *
 * - 色は CSS の変数（--chart-1 など）で塗るので、ダークモードでも変わる
 * - 線は 2px、点は半径 4px、罫線は 1px の実線
 * - 2 本以上の線には凡例を付ける。数値の表（<details>）も一緒に出す
 * - マウスを乗せたときの縦線と吹き出しは ArticleBody.astro の script が作る（data-chart の JSON を使う）
 */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => n.toLocaleString("ja-JP");

/**
 * 折れ線グラフ
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.title       図の題（figcaption）
 * @param {string} o.desc        読み上げ用の説明
 * @param {{min:number,max:number,ticks:number[]}} o.x
 * @param {{min:number,max:number,ticks:number[],format:(n:number)=>string}} o.y
 * @param {{name:string,color:1|2|"mut",points:[number,number][],dashed?:boolean,dots?:boolean,line?:boolean,end?:string}[]} o.series
 * @param {{y:number,label:string}[]} [o.refLines]
 * @param {{x:number,y:number,text:string,dx?:number,dy?:number,anchor?:"start"|"middle"|"end"}[]} [o.notes]
 * @param {{head:string[],rows:(string|number)[][]}} o.table   数字の表
 * @param {string} [o.unit]      吹き出しの数字の後ろ（「人」など）
 * @param {(n:number)=>string} [o.valueText]  吹き出しの数字の書き方（順位のグラフなど）
 * @param {{name:string,color:1|2|"mut"}[]} [o.legend]  凡例を自分で決めるとき（線が多いグラフ）
 *
 * series の muted: true は、目立たせない線（細い灰色）。1 本だけ色を付けて、ほかを背景にするときに使う
 */
export function lineChart(o) {
  const W = 640, H = 340;
  const m = { top: 16, right: 24, bottom: 32, left: 52 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const sx = (v) => m.left + ((v - o.x.min) / (o.x.max - o.x.min)) * iw;
  const sy = (v) => m.top + ih - ((v - o.y.min) / (o.y.max - o.y.min)) * ih;
  const r = (n) => Math.round(n * 10) / 10;

  const parts = [];
  // 罫線と目盛り
  for (const t of o.y.ticks) {
    parts.push(`<line class="chart-grid" x1="${m.left}" x2="${W - m.right}" y1="${r(sy(t))}" y2="${r(sy(t))}"/>`);
    parts.push(`<text class="chart-tick" x="${m.left - 8}" y="${r(sy(t))}" text-anchor="end" dominant-baseline="middle">${esc(o.y.format(t))}</text>`);
  }
  for (const t of o.x.ticks) {
    parts.push(`<text class="chart-tick" x="${r(sx(t))}" y="${H - m.bottom + 20}" text-anchor="middle">${t}</text>`);
  }
  parts.push(`<line class="chart-axis" x1="${m.left}" x2="${W - m.right}" y1="${m.top + ih}" y2="${m.top + ih}"/>`);

  // 基準の線（40万人など）
  for (const l of o.refLines ?? []) {
    parts.push(`<line class="chart-ref" x1="${m.left}" x2="${W - m.right}" y1="${r(sy(l.y))}" y2="${r(sy(l.y))}"/>`);
    if (l.label) parts.push(`<text class="chart-note" x="${W - m.right}" y="${r(sy(l.y)) - 6}" text-anchor="end">${esc(l.label)}</text>`);
  }

  // 線と点
  // 目立たせない線を先に描いて、色の付いた線を上に重ねる
  const order = [...o.series].sort((a, b) => Number(!!b.muted) - Number(!!a.muted));
  for (const s of order) {
    const cls = `chart-s${s.color}${s.muted ? " chart-muted" : ""}`;
    if (s.line !== false && s.points.length > 1) {
      const d = s.points.map(([x, y], i) => `${i ? "L" : "M"}${r(sx(x))} ${r(sy(y))}`).join("");
      parts.push(`<path class="chart-line ${cls}${s.dashed ? " chart-dashed" : ""}" d="${d}"/>`);
    }
    if (s.dots) {
      for (const [x, y] of s.points) parts.push(`<circle class="chart-dot ${cls}" cx="${r(sx(x))}" cy="${r(sy(y))}" r="4"/>`);
    }
    if (s.end) {
      const [x, y] = s.points[s.points.length - 1];
      parts.push(`<text class="chart-label" x="${r(sx(x)) + 8}" y="${r(sy(y))}" dominant-baseline="middle">${esc(s.end)}</text>`);
    }
  }

  // 書き込み（節目）
  for (const n of o.notes ?? []) {
    const x = r(sx(n.x)), y = r(sy(n.y));
    const tx = x + (n.dx ?? 0), ty = y + (n.dy ?? -14);
    parts.push(`<line class="chart-leader" x1="${x}" y1="${y}" x2="${tx}" y2="${ty + (ty < y ? 4 : -12)}"/>`);
    parts.push(`<circle class="chart-mark" cx="${x}" cy="${y}" r="3"/>`);
    n.text.split("\n").forEach((line, i, all) => {
      const yy = ty - (all.length - 1 - i) * 15;
      parts.push(`<text class="chart-note" x="${tx}" y="${yy}" text-anchor="${n.anchor ?? "middle"}">${esc(line)}</text>`);
    });
  }

  // 吹き出し用のデータ（x ごとの値）
  const xs = [...new Set(o.series.flatMap((s) => s.points.map((p) => p[0])))].sort((a, b) => a - b);
  const hover = {
    unit: o.unit ?? "",
    plot: { left: m.left, right: W - m.right, top: m.top, bottom: m.top + ih, width: W, height: H },
    x: { min: o.x.min, max: o.x.max },
    rows: xs.map((x) => ({
      x,
      px: r(sx(x)),
      v: o.series
        .map((s) => {
          const p = s.points.find((q) => q[0] === x);
          return p ? { n: s.name, c: s.color, y: p[1], ...(o.valueText ? { t: o.valueText(p[1]) } : {}) } : null;
        })
        .filter(Boolean),
    })),
  };

  const legendItems = o.legend ?? o.series;
  const legend =
    legendItems.length > 1
      ? `<ul class="chart-legend">${legendItems
          .map(
            (s) =>
              `<li><span class="chart-key chart-s${s.color}${s.dashed ? " chart-key-dashed" : ""}${s.line === false ? " chart-key-dot" : ""}" aria-hidden="true"></span>${esc(s.name)}</li>`,
          )
          .join("")}</ul>`
      : "";

  const table = `<details class="chart-table"><summary>数値の表</summary><div class="table-scroll"><table><thead><tr>${o.table.head
    .map((h) => `<th>${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${o.table.rows
    .map((row) => `<tr>${row.map((c) => `<td>${typeof c === "number" ? fmt(c) : esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div></details>`;

  return `<figure class="chart" id="${esc(o.id)}">
<figcaption class="chart-title">${esc(o.title)}</figcaption>
${legend}
<div class="chart-scroll"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${esc(o.id)}-desc" data-chart="${esc(JSON.stringify(hover))}"><desc id="${esc(o.id)}-desc">${esc(o.desc)}</desc>${parts.join("")}</svg></div>
${table}
</figure>`;
}

/**
 * 横棒グラフ（割合の比べっこなど）。色を付けるのは強調する 1 本だけ、基準（全国など）は濃い灰色、ほかは薄い灰色
 * @param {object} o
 * @param {string} o.id
 * @param {string} o.title
 * @param {string} o.desc
 * @param {{label:string,value:number,kind?:"hl"|"ref"}[]} o.rows
 * @param {(n:number)=>string} o.format
 * @param {{head:string[],rows:(string|number)[][]}} o.table
 * @param {{name:string,color:1|2|"mut"}[]} [o.legend]
 */
export function barChart(o) {
  const W = 640, rowH = 28, barH = 16;
  // left：左の名前の欄の幅（名前が長いときに広げる）
  const m = { top: 8, right: 64, bottom: 8, left: o.left ?? 92 };
  const H = m.top + m.bottom + o.rows.length * rowH;
  const max = Math.max(...o.rows.map((r) => r.value));
  const sx = (v) => (v / max) * (W - m.left - m.right);
  const r1 = (n) => Math.round(n * 10) / 10;
  const parts = [];
  o.rows.forEach((row, i) => {
    const y = m.top + i * rowH + (rowH - barH) / 2;
    const w = r1(sx(row.value));
    const cls = row.kind === "hl" ? "chart-bar chart-bar-hl" : row.kind === "ref" ? "chart-bar chart-bar-ref" : "chart-bar";
    // 先端だけ角を丸める（4px）。根元は四角のまま
    const rr = Math.min(4, w / 2);
    const d = `M${m.left} ${r1(y)}H${r1(m.left + w - rr)}Q${r1(m.left + w)} ${r1(y)} ${r1(m.left + w)} ${r1(y + rr)}V${r1(y + barH - rr)}Q${r1(m.left + w)} ${r1(y + barH)} ${r1(m.left + w - rr)} ${r1(y + barH)}H${m.left}Z`;
    parts.push(`<path class="${cls}" d="${d}"><title>${esc(row.label)} ${esc(o.format(row.value))}</title></path>`);
    parts.push(`<text class="chart-tick${row.kind === "hl" ? " chart-tick-hl" : ""}" x="${m.left - 8}" y="${r1(y + barH / 2)}" text-anchor="end" dominant-baseline="middle">${esc(row.label)}</text>`);
    parts.push(`<text class="chart-label" x="${r1(m.left + w + 6)}" y="${r1(y + barH / 2)}" dominant-baseline="middle">${esc(o.format(row.value))}</text>`);
  });
  parts.push(`<line class="chart-axis" x1="${m.left}" x2="${m.left}" y1="${m.top}" y2="${H - m.bottom}"/>`);
  const legend = o.legend
    ? `<ul class="chart-legend">${o.legend
        .map((s) => `<li><span class="chart-key chart-key-dot chart-s${s.color}" aria-hidden="true"></span>${esc(s.name)}</li>`)
        .join("")}</ul>`
    : "";
  const table = `<details class="chart-table"><summary>数値の表</summary><div class="table-scroll"><table><thead><tr>${o.table.head
    .map((h) => `<th>${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${o.table.rows
    .map((row) => `<tr>${row.map((c) => `<td>${typeof c === "number" ? fmt(c) : esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div></details>`;
  return `<figure class="chart" id="${esc(o.id)}">
<figcaption class="chart-title">${esc(o.title)}</figcaption>
${legend}
<div class="chart-scroll"><svg class="chart-svg chart-svg-bar" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${esc(o.id)}-desc"><desc id="${esc(o.id)}-desc">${esc(o.desc)}</desc>${parts.join("")}</svg></div>
${table}
</figure>`;
}

/**
 * 人口ピラミッド。左に男性（--chart-1）、右に女性（--chart-2）、真ん中に年齢。
 * rows は上から 若い順に渡す（描くときは上を高い年齢にする）
 */
export function pyramidChart(o) {
  const W = 640, rowH = 18, barH = 13, mid = 76;
  const m = { top: 8, right: 8, bottom: 24, left: 8 };
  const rows = [...o.rows].reverse();
  const H = m.top + m.bottom + rows.length * rowH;
  const half = (W - m.left - m.right - mid) / 2;
  const max = o.max ?? Math.max(...rows.flatMap((r) => [r.left, r.right]));
  const sx = (v) => (v / max) * half;
  const cx = m.left + half; // 左の棒の根元（右端）
  const r1 = (n) => Math.round(n * 10) / 10;
  const parts = [];
  // 目盛り（左右とも 0 から外へ）
  for (const t of o.ticks) {
    for (const x of [cx - sx(t), cx + mid + sx(t)]) {
      parts.push(`<line class="chart-grid" x1="${r1(x)}" x2="${r1(x)}" y1="${m.top}" y2="${H - m.bottom}"/>`);
      parts.push(`<text class="chart-tick" x="${r1(x)}" y="${H - 6}" text-anchor="middle">${esc(o.format(t))}</text>`);
    }
  }
  rows.forEach((row, i) => {
    const y = r1(m.top + i * rowH + (rowH - barH) / 2);
    const wl = r1(sx(row.left)), wr = r1(sx(row.right));
    parts.push(`<rect class="chart-bar-s1" x="${r1(cx - wl)}" y="${y}" width="${wl}" height="${barH}" rx="1.5"><title>${esc(row.label)} ${esc(o.leftName)} ${fmt(row.left)}${esc(o.unit)}</title></rect>`);
    parts.push(`<rect class="chart-bar-s2" x="${r1(cx + mid)}" y="${y}" width="${wr}" height="${barH}" rx="1.5"><title>${esc(row.label)} ${esc(o.rightName)} ${fmt(row.right)}${esc(o.unit)}</title></rect>`);
    parts.push(`<text class="chart-tick${row.hl ? " chart-tick-hl" : ""}" x="${r1(cx + mid / 2)}" y="${r1(y + barH / 2)}" text-anchor="middle" dominant-baseline="middle">${esc(row.label)}</text>`);
  });
  const legend = `<ul class="chart-legend"><li><span class="chart-key chart-key-dot chart-s1" aria-hidden="true"></span>${esc(o.leftName)}</li><li><span class="chart-key chart-key-dot chart-s2" aria-hidden="true"></span>${esc(o.rightName)}</li></ul>`;
  const table = `<details class="chart-table"><summary>数値の表</summary><div class="table-scroll"><table><thead><tr>${o.table.head
    .map((h) => `<th>${esc(h)}</th>`)
    .join("")}</tr></thead><tbody>${o.table.rows
    .map((row) => `<tr>${row.map((c) => `<td>${typeof c === "number" ? fmt(c) : esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div></details>`;
  return `<figure class="chart" id="${esc(o.id)}">
<figcaption class="chart-title">${esc(o.title)}</figcaption>
${legend}
<div class="chart-scroll"><svg class="chart-svg chart-svg-bar" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${esc(o.id)}-desc"><desc id="${esc(o.id)}-desc">${esc(o.desc)}</desc>${parts.join("")}</svg></div>
${table}
</figure>`;
}

export { fmt };
