/**
 * Wikimedia Commons の写真の撮影者（extmetadata の Artist。HTML）から、名前とリンクを取り出す。
 * 記事の写真（scripts/photos.mjs）と写真ギャラリー（scripts/gallery/commons.mjs）で同じものを使い、表記をそろえる。
 *
 *  - 「Own work」「投稿者自身による著作物」（自作の決まり文句）だけのときは null。呼ぶ側で、最初にアップロードした人にする
 *  - 「(talk)」「(トーク)」「User:」「ja:User:」「Original uploader was」は、利用者ページへのリンクの名残りなので取る
 *  - 利用者ページが無い人のリンク（編集画面の redlink）は、利用者ページの URL にする
 */
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (s = "") => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const OWN_WORK = /^(own work|投稿者自身による著作物|自分の作品|自作)$/i;

/** 名前から、利用者ページへのリンクの名残りを取る */
export const cleanName = (s) =>
  s
    .replace(/^(Original uploader was|オリジナルのアップロード者は)\s*/i, "")
    .replace(/^日本語版ウィキペディアの\s*(.+?)\s*さん$/, "$1 at Japanese Wikipedia")
    .replace(/\s+at\s+ja\.wikipedia$/i, " at Japanese Wikipedia")
    .replace(/\s*[(（]\s*(talk|トーク|会話)\s*[)）]/gi, "")
    .replace(/^([a-z]{2,3}:)?(user|利用者):/i, "")
    .replace(/。$/, "")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();

/** リンクの URL。相対の URL を直し、redlink（編集画面）は利用者ページにする */
export function cleanUrl(href = "") {
  let u = decode(href);
  if (u.startsWith("//")) u = `https:${u}`;
  else if (u.startsWith("/")) u = `https://commons.wikimedia.org${u}`;
  const red = u.match(/^(https:\/\/[^/]+)\/w\/index\.php\?title=([^&]+)&action=edit/);
  if (red) u = `${red[1]}/wiki/${red[2]}`;
  return u;
}

/**
 * @param {string} html extmetadata の Artist の値
 * @returns {{ name: string, url: string } | null} 自作の決まり文句だけのときは null
 */
export function commonsAuthor(html = "") {
  const text = strip(html);
  if (!text || OWN_WORK.test(text)) return null;
  // リンクが複数あるとき（「日本語版ウィキペディア」の言語リンクと利用者ページなど）は、利用者ページを選ぶ
  const links = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/g)];
  const a = links.find((l) => /(User|利用者):/i.test(decode(l[1]))) ?? links.find((l) => !/\/wiki\/[a-z]{2,3}:$/.test(l[1])) ?? links[0];
  let name = cleanName(text);
  if (name.length > 80) name = cleanName(strip(a?.[2] ?? name)).slice(0, 80);
  return { name, url: a ? cleanUrl(a[1]) : "" };
}

/**
 * 最初にアップロードした人（いまの版はボットが変換し直したものもあるので、最も古い版の人）
 * @param {string} file Commons のファイル名
 * @param {(url: string) => Promise<any>} getJson
 * @returns {Promise<{ name: string, url: string } | null>}
 */
export async function firstUploader(file, getJson) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=user&iilimit=50&titles=${encodeURIComponent(`File:${file}`)}`;
  const list = (await getJson(url)).query?.pages?.[0]?.imageinfo ?? [];
  const user = list[list.length - 1]?.user;
  return user ? { name: user, url: `https://commons.wikimedia.org/wiki/User:${encodeURIComponent(user.replace(/ /g, "_"))}` } : null;
}
