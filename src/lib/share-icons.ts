/**
 * SNS 共有ボタン用のアイコン定義（ビルド時・Astro コンポーネント向け）。
 * アイコン：Font Awesome Free（Icons: CC BY 4.0）。Misskey は mi.svg（CC BY-SA 4.0）。
 */
import xSvg from "@fortawesome/fontawesome-free/svgs/brands/x-twitter.svg?raw";
import mastodonSvg from "@fortawesome/fontawesome-free/svgs/brands/mastodon.svg?raw";
import blueskySvg from "@fortawesome/fontawesome-free/svgs/brands/bluesky.svg?raw";
import threadsSvg from "@fortawesome/fontawesome-free/svgs/brands/threads.svg?raw";
import lineSvg from "@fortawesome/fontawesome-free/svgs/brands/line.svg?raw";
import linkSvg from "@fortawesome/fontawesome-free/svgs/solid/link.svg?raw";
import { SHARE_SERVICES, type ShareKey } from "./share";

export interface SvgIcon {
  viewBox: string;
  d: string;
}

const icon = (svg: string): SvgIcon => ({
  viewBox: svg.match(/viewBox="([^"]+)"/)![1],
  d: [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]).join(" "),
});

const SVGS: Partial<Record<ShareKey, SvgIcon>> = {
  x: icon(xSvg),
  mastodon: icon(mastodonSvg),
  bluesky: icon(blueskySvg),
  threads: icon(threadsSvg),
  line: icon(lineSvg),
};

export const SHARE_ICONS = SHARE_SERVICES.map((s) => ({
  ...s,
  svg: SVGS[s.key],
}));

export const SHARE_LINK_ICON = icon(linkSvg);
