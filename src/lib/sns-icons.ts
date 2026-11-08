/**
 * SNS のアイコン。Font Awesome Free 6（@fortawesome/fontawesome-free、Icons: CC BY 4.0）の SVG から
 * viewBox と path だけを取り出す。ページには <symbol> で 1 回だけ置き、<use> で使い回す（SnsSprite.astro）。
 * 表示は /license/ に書いている。
 *
 * 色は各サービスのブランドの色。黒のもの（X・TikTok・Threads）は文字の色（ダークモードで白になる）
 */
import type { SnsType } from "./yaml-data";
import x from "@fortawesome/fontawesome-free/svgs/brands/x-twitter.svg?raw";
import instagram from "@fortawesome/fontawesome-free/svgs/brands/instagram.svg?raw";
import facebook from "@fortawesome/fontawesome-free/svgs/brands/facebook.svg?raw";
import youtube from "@fortawesome/fontawesome-free/svgs/brands/youtube.svg?raw";
import line from "@fortawesome/fontawesome-free/svgs/brands/line.svg?raw";
import tiktok from "@fortawesome/fontawesome-free/svgs/brands/tiktok.svg?raw";
import threads from "@fortawesome/fontawesome-free/svgs/brands/threads.svg?raw";
import bluesky from "@fortawesome/fontawesome-free/svgs/brands/bluesky.svg?raw";
import note from "@fortawesome/fontawesome-free/svgs/solid/note-sticky.svg?raw";
import blog from "@fortawesome/fontawesome-free/svgs/solid/pen-nib.svg?raw";
import site from "@fortawesome/fontawesome-free/svgs/solid/globe.svg?raw";
import app from "@fortawesome/fontawesome-free/svgs/solid/mobile-screen.svg?raw";
import mail from "@fortawesome/fontawesome-free/svgs/solid/envelope.svg?raw";

const raw: Record<SnsType, string> = { x, instagram, facebook, youtube, line, tiktok, threads, bluesky, note, blog, site, app, mail };

/** viewBox と path の d。ファイルの中のコメント（ライセンスの表記）は除く */
export const ICONS = Object.fromEntries(
  Object.entries(raw).map(([k, svg]) => [
    k,
    {
      viewBox: svg.match(/viewBox="([^"]+)"/)![1],
      d: [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]).join(" "),
    },
  ]),
) as Record<SnsType, { viewBox: string; d: string }>;
