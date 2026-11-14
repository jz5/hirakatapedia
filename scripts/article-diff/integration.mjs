/**
 * 開発サーバー（pnpm dev）で、記事のページに「本番との差分」を出す。公開用のビルドには入らない。
 *
 * - 記事のページに overlay.js を差し込む。overlay.js は、本番（https://hirakata.pronama.jp）の同じページを
 *   /__diff/base/<path> で取ってきて、表示中のページと段落ごとに比べ、印を付ける
 * - /__diff/ は、本番から変わった記事の一覧。本番に出ているのは origin/main（公開のときに push する）なので、
 *   origin/main と作業ツリー（コミットしていない変更も含む）の content/articles を比べる
 *
 * 本番の HTML は開発サーバーが取ってくる（ブラウザから直接だと別のオリジンになるため）。1 分だけ覚えておく。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PROD = "https://hirakata.pronama.jp";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OVERLAY = fileURLToPath(new URL("./overlay.js", import.meta.url));
const BASE_REF = "origin/main";

const cache = new Map(); // path -> { at, status, body }

async function prodPage(path) {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  let status = 502;
  let body = "";
  try {
    const res = await fetch(PROD + path, { redirect: "follow" });
    status = res.status;
    body = res.ok ? await res.text() : "";
  } catch (e) {
    body = String(e);
  }
  const v = { at: Date.now(), status, body };
  cache.set(path, v);
  return v;
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });

/** 本番（origin/main）から変わった記事の一覧の HTML */
function listPage() {
  let rows = [];
  let note = "";
  try {
    const onBase = new Set(
      git("ls-tree", "--name-only", `${BASE_REF}:content/articles`).split("\n").filter(Boolean),
    );
    const stat = new Map();
    for (const line of git("diff", "--numstat", BASE_REF, "--", "content/articles").split("\n")) {
      const [plus, minus, file] = line.split("\t");
      if (file) stat.set(file.split("/").pop(), [plus, minus]);
    }
    const files = readdirSync(join(ROOT, "content/articles")).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const slug = f.replace(/\.md$/, "");
      const title = readFileSync(join(ROOT, "content/articles", f), "utf8").match(/^title:\s*"?(.*?)"?\s*$/m)?.[1] ?? slug;
      if (!onBase.has(f)) rows.push({ slug, title, kind: "本番にない（新しい記事）" });
      else if (stat.has(f)) rows.push({ slug, title, kind: `+${stat.get(f)[0]} −${stat.get(f)[1]} 行` });
    }
    const ahead = git("rev-list", "--count", `${BASE_REF}..HEAD`).trim();
    const dirty = git("status", "--porcelain", "--", "content/articles").trim() ? "、コミットしていない変更あり" : "";
    note = `${BASE_REF}（本番に出ている版）と、作業ツリー（${git("branch", "--show-current").trim()}、${BASE_REF} より ${ahead} コミット先${dirty}）の content/articles の比べ。`;
  } catch (e) {
    note = `git で比べられませんでした：${e.message}`;
  }
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>本番との差分</title>
<style>body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.8}.n{color:#777;font-size:.9rem}li span{color:#777;margin-left:.6em;font-size:.9rem}</style>
<h1>本番との差分</h1><p class="n">${esc(note)}<br>記事を開くと、本番（${PROD}）の同じページと比べた印が出ます。右下の欄・右端の印・キーの n / p で、変更した箇所へ移れます。</p>
${rows.length ? `<ul>${rows.map((r) => `<li><a href="/${esc(r.slug)}/">${esc(r.title)}</a><span>${esc(r.kind)}</span></li>`).join("")}</ul>` : "<p>本番から変わった記事はありません。</p>"}`;
}

/** @type {import("astro").AstroIntegration} */
export default {
  name: "hirakatapedia-article-diff",
  hooks: {
    "astro:config:setup": ({ command, injectScript, updateConfig }) => {
      if (command !== "dev") return;
      // 記事のページ（article.entry があるページ）だけで読み込む。import() で書くと Vite がパスを解決しようとして失敗するので、script 要素で
      injectScript(
        "page",
        `if (document.querySelector("article.entry .entry-body")) { const s = document.createElement("script"); s.type = "module"; s.src = "/__diff/overlay.js"; document.head.append(s); }`,
      );
      updateConfig({
        vite: {
          plugins: [
            {
              name: "hirakatapedia-article-diff",
              configureServer(server) {
                server.middlewares.use(async (req, res, next) => {
                  const url = new URL(req.url ?? "/", "http://x");
                  if (!url.pathname.startsWith("/__diff")) return next();
                  try {
                    if (url.pathname === "/__diff" || url.pathname === "/__diff/") {
                      res.setHeader("content-type", "text/html; charset=utf-8");
                      return res.end(listPage());
                    }
                    if (url.pathname === "/__diff/overlay.js") {
                      res.setHeader("content-type", "text/javascript; charset=utf-8");
                      res.setHeader("cache-control", "no-store");
                      return res.end(existsSync(OVERLAY) ? readFileSync(OVERLAY) : "");
                    }
                    if (url.pathname.startsWith("/__diff/base/")) {
                      const path = decodeURIComponent(url.pathname.slice("/__diff/base".length));
                      if (url.searchParams.has("refresh")) cache.delete(path);
                      const page = await prodPage(path);
                      res.statusCode = page.status === 200 ? 200 : page.status;
                      res.setHeader("content-type", "text/html; charset=utf-8");
                      res.setHeader("cache-control", "no-store");
                      return res.end(page.body);
                    }
                  } catch (e) {
                    res.statusCode = 500;
                    return res.end(String(e));
                  }
                  next();
                });
              },
            },
          ],
        },
      });
    },
  },
};
