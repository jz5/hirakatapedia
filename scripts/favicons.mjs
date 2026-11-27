#!/usr/bin/env node
/**
 * public/favicon.svg から PNG アイコン（48x48）と apple-touch-icon（180x180）を生成する。
 *
 *   node scripts/favicons.mjs
 */
import fs from "node:fs";
import sharp from "sharp";

const svg = fs.readFileSync("public/favicon.svg", "utf8");

await sharp(Buffer.from(svg), { density: 300 })
  .resize(48, 48)
  .png({ compressionLevel: 9 })
  .toFile("public/favicon-48x48.png");

// iOS のホーム画面アイコンは OS 側で角丸に切り抜かれるため、透明の角を残さず背景全面塗りにする
const appleSvg = svg.replace('rx="6"', 'rx="0"');
await sharp(Buffer.from(appleSvg), { density: 600 })
  .resize(180, 180)
  .png({ compressionLevel: 9 })
  .toFile("public/apple-touch-icon.png");

console.log("generated public/favicon-48x48.png and public/apple-touch-icon.png");
