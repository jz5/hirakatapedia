/**
 * SNS で共有したときの、サイト共通の画像（public/og.png、1200×630）を作る。
 * 記事の cover や写真のように、ページ自身の画像が無いページ（ホーム・データ・SNS など）で使う（src/layouts/Base.astro）。
 *
 *   node scripts/og-image.mjs
 *
 * 書体はサイトと同じ LINE Seed JP（node_modules の @fontsource）。描くのは手元の Google Chrome（e2e テストと同じ）。
 * 色は淀川の青緑（--accent #126e82）、形は favicon（枚方市の形）、下に波の線。デザインを変えたら作り直す
 */
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const font = (w) => pathToFileURL(join(ROOT, `node_modules/@fontsource/line-seed-jp/${w}.css`)).href;
const shape = readFileSync(join(ROOT, "public/favicon.svg"), "utf8");
const ACCENT = "#126e82";

// 波の線（ヘッダーの下と同じ、ゆるい波）
const wave = Array.from({ length: 49 }, (_, i) => {
  const x = i * 25;
  const y = 20 + Math.sin((i / 48) * Math.PI * 6) * 10;
  return `${i ? "L" : "M"}${x} ${y.toFixed(1)}`;
}).join(" ");

const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="${font(400)}"><link rel="stylesheet" href="${font(700)}">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; background: #fff; font-family: "LINE Seed JP", sans-serif; color: #1b2a2e; position: relative; overflow: hidden; }
  .shape { position: absolute; left: 96px; top: 150px; width: 260px; height: 260px; }
  .shape svg { width: 100%; height: 100%; }
  .text { position: absolute; left: 420px; top: 168px; }
  .name { font-size: 120px; font-weight: 700; letter-spacing: .01em; line-height: 1; }
  .name .ja { color: ${ACCENT}; }
  .name .en { color: #1b2a2e; font-weight: 400; }
  .reading { margin-top: 22px; font-size: 34px; color: #5b6b70; letter-spacing: .2em; }
  .lead { margin-top: 44px; font-size: 38px; font-weight: 700; }
  .wave { position: absolute; left: 0; bottom: 92px; width: 1200px; height: 40px; }
  .url { position: absolute; right: 96px; bottom: 40px; font-size: 26px; color: #5b6b70; }
</style></head><body>
  <div class="shape">${shape}</div>
  <div class="text">
    <div class="name"><span class="ja">枚方</span><span class="en">pedia</span></div>
    <div class="reading">ひらかたペディア</div>
    <div class="lead">枚方のことを、出典つきでくわしく</div>
  </div>
  <svg class="wave" viewBox="0 0 1200 40" preserveAspectRatio="none"><path d="${wave}" fill="none" stroke="${ACCENT}" stroke-width="4" stroke-linecap="round"/></svg>
  <div class="url">hirakata.pronama.jp</div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), "hirakatapedia-og-"));
const file = join(dir, "og.html");
writeFileSync(file, html);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(file).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(ROOT, "public/og.png") });
await browser.close();
console.log("public/og.png を作った");
