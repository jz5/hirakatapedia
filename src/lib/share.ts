/** SNS 共有サービスの定義と URL 生成（ShareButtons.astro・map-quiz.astro・map-quiz.ts 共通） */
export type ShareKey = "x" | "misskey" | "mastodon" | "bluesky" | "threads" | "line";

export interface ShareService {
  key: ShareKey;
  name: string;
  mi?: boolean;
  big?: boolean;
  buildUrl: (title: string, url: string) => string;
}

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

export const SHARE_SERVICES: readonly ShareService[] = [
  {
    key: "x",
    name: "X",
    buildUrl: (title, url) => `https://x.com/intent/post?${q({ text: title, url })}`,
  },
  {
    key: "misskey",
    name: "Misskey",
    mi: true,
    buildUrl: (title, url) => `https://misskey-hub.net/share/?${q({ text: `${title}\n${url}`, visibility: "public", localOnly: "0" })}`,
  },
  {
    key: "mastodon",
    name: "Mastodon",
    buildUrl: (title, url) => `https://pronama.jp/share-to-mastodon.html?${q({ text: `${title}\n${url}` })}`,
  },
  {
    key: "bluesky",
    name: "Bluesky",
    buildUrl: (title, url) => `https://bsky.app/intent/compose?${q({ text: `${title}\n${url}` })}`,
  },
  {
    key: "threads",
    name: "Threads",
    buildUrl: (title, url) => `https://www.threads.net/intent/post?${q({ text: `${title}\n${url}` })}`,
  },
  {
    key: "line",
    name: "LINE",
    big: true,
    buildUrl: (title, url) => `https://social-plugins.line.me/lineit/share?${q({ url, text: title })}`,
  },
];

export function buildShareUrls(title: string, url: string): Record<ShareKey, string> {
  return Object.fromEntries(SHARE_SERVICES.map((s) => [s.key, s.buildUrl(title, url)])) as Record<ShareKey, string>;
}
