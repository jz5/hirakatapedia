/**
 * サイドバーの「よく読まれている記事」（content/popular.json）を、GA4 の数字から作り直す。
 * scripts/deploy.sh がビルドの前に呼ぶ。手で呼ぶときは node scripts/popular.mjs
 *
 * 直近 30 日（昨日まで）の、記事ページ（/<slug>/）ごとの表示回数（screenPageViews）の多い順。
 * 記事でないページ（ホーム・写真・データなど）は数えない。
 *
 * .env に次の 2 つを書く（Git に入れない）。無ければ何もせず、いまの popular.json を使う。
 *   GA_PROPERTY_ID=123456789                         GA4 のプロパティ ID（数字。測定 ID の G-… ではない）
 *   GA_CREDENTIALS=/Users/…/hirakatapedia-ga.json    サービスアカウントの鍵（JSON）。リポジトリの外に置く
 * サービスアカウントには、GA のプロパティで「閲覧者」の権限を付ける。
 * 使う API は Google Analytics Data API（Google Cloud のプロジェクトで有効にする）。
 */
import { createSign } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "content/popular.json");
const HOST = "hirakata.pronama.jp";
const KEEP = 10; // popular.json に残す数（サイドバーに出すのは src/lib/articles.ts の limit）

const env = (k) =>
  process.env[k] ??
  (existsSync(join(ROOT, ".env"))
    ? readFileSync(join(ROOT, ".env"), "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim()
    : undefined);

const propertyId = env("GA_PROPERTY_ID");
const keyFile = env("GA_CREDENTIALS");
if (!propertyId || !keyFile) {
  console.log("人気記事：GA_PROPERTY_ID か GA_CREDENTIALS が無いので、いまの popular.json のまま");
  process.exit(0);
}
if (!existsSync(keyFile)) {
  console.error(`人気記事：鍵のファイルが無い：${keyFile}`);
  process.exit(1);
}

/** サービスアカウントの鍵で、アクセストークンをもらう（JWT を自分で署名する。ライブラリを足さない） */
async function accessToken() {
  const key = JSON.parse(readFileSync(keyFile, "utf8"));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`トークン ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

const slugs = new Set(
  readdirSync(join(ROOT, "content/articles"))
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, "")),
);

const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
  method: "POST",
  headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    dateRanges: [{ startDate: "30daysAgo", endDate: "yesterday" }],
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }],
    dimensionFilter: { filter: { fieldName: "hostName", stringFilter: { matchType: "EXACT", value: HOST } } },
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: 1000,
  }),
});
if (!res.ok) {
  console.error(`人気記事：GA ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { rows = [] } = await res.json();

// /tsutaya/ と /tsutaya/photos/ は別のページ。記事の本文（/<slug>/）だけを数える
const views = new Map();
for (const r of rows) {
  const slug = r.dimensionValues[0].value.match(/^\/([^/]+)\/$/)?.[1];
  if (slug && slugs.has(slug)) views.set(slug, (views.get(slug) ?? 0) + Number(r.metricValues[0].value));
}
const ranked = [...views].sort((a, b) => b[1] - a[1]).slice(0, KEEP);
if (ranked.length === 0) {
  console.log("人気記事：記事の表示がまだ無いので、いまの popular.json のまま");
  process.exit(0);
}

const prev = JSON.parse(readFileSync(OUT, "utf8"));
writeFileSync(
  OUT,
  JSON.stringify(
    {
      _note: prev._note,
      updated: new Date().toISOString().slice(0, 10),
      slugs: ranked.map(([s]) => s),
      // 足りないときに足す記事（手で書く）。作り直しても消さない
      ...(prev.fill ? { fill: prev.fill } : {}),
    },
    null,
    2,
  ) + "\n",
);
console.log(`人気記事：${ranked.map(([s, v]) => `${s}(${v})`).join(" ")}`);
if (JSON.stringify(prev.slugs) !== JSON.stringify(ranked.map(([s]) => s))) console.log("人気記事：順番が変わった");
