import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

/** public/opendata/<id>.json の、地図に出る（座標のある）行の数 */
const geoRows = (id: string) => {
  const d = JSON.parse(readFileSync(`public/opendata/${id}.json`, "utf8"));
  const la = d.columns.findIndex((c: string[]) => c[1] === "lat");
  return { total: d.rows.length as number, geo: d.rows.filter((r: unknown[]) => r[la] !== null && r[la] !== "").length as number };
};

const MAP_SETS = ["aed", "park", "toilet", "hinanjo", "kosodate"];

/** 件数の表示が出る（＝データを読み込んだ）まで待つ */
const loaded = (page: Page) => expect(page.locator("[data-count]")).toHaveText(/件/);

/** 地図が見えていて、地図の画像が 1 枚以上読み込まれ、点の数が n */
async function expectMap(page: Page, n: number) {
  const map = page.locator("[data-map]");
  await expect(map).toBeVisible();
  const box = await map.boundingBox();
  expect(box!.height).toBeGreaterThan(200);
  await expect(map.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 15_000 });
  await expect(map.locator("path.leaflet-interactive")).toHaveCount(n);
  // 灰色のまま（地図の大きさを取り違えた）ではないこと：見えている範囲に画像がある
  const inView = await map.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.querySelectorAll<HTMLImageElement>(".leaflet-tile-loaded")].some((t) => {
      const b = t.getBoundingClientRect();
      return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
    });
  });
  expect(inView).toBe(true);
}

for (const id of MAP_SETS) {
  test(`${id}：地図で見る → 全部の点が出る`, async ({ page }) => {
    await page.goto(`/data/${id}/`);
    await loaded(page);
    await page.getByRole("button", { name: "地図で見る" }).click();
    await expectMap(page, geoRows(id).geo);
  });
}

test("読み込みが終わる前に「地図で見る」を押しても出る", async ({ page }) => {
  // データの読み込みを遅らせる
  await page.route("**/opendata/aed.json", async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.goto("/data/aed/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "地図で見る" }).click();
  await loaded(page);
  await expectMap(page, geoRows("aed").geo);
});

test("地図を閉じて、また開く", async ({ page }) => {
  await page.goto("/data/park/");
  await loaded(page);
  const btn = page.locator("[data-mapbtn]");
  await btn.click();
  await expectMap(page, geoRows("park").geo);
  await btn.click();
  await expect(page.locator("[data-map]")).toBeHidden();
  await btn.click();
  await expectMap(page, geoRows("park").geo);
});

test("地図を開いたまま絞り込むと、点が減る", async ({ page }) => {
  await page.goto("/data/toilet/");
  await loaded(page);
  await page.locator("[data-mapbtn]").click();
  await expectMap(page, geoRows("toilet").geo);
  await page.getByRole("checkbox", { name: "オストメイトあり" }).check();
  const n = Number((await page.locator("[data-count]").innerText()).match(/^([\d,]+)/)![1].replace(/,/g, ""));
  expect(n).toBeLessThan(geoRows("toilet").total);
  await expect(page.locator("[data-map] path.leaflet-interactive")).toHaveCount(n);
});

test("地図を開いてほかのページへ行き、「戻る」で戻っても地図が出る", async ({ page }) => {
  await page.goto("/data/aed/");
  await loaded(page);
  await page.locator("[data-mapbtn]").click();
  await expectMap(page, geoRows("aed").geo);
  await page.getByRole("link", { name: "← 枚方のデータ" }).click();
  await expect(page).toHaveURL(/\/data\/$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/data\/aed\/$/);
  await loaded(page);
  // ページがそのまま戻ってきたなら地図は開いたまま、読み込み直したなら閉じている。どちらでも、開けば出る
  const btn = page.locator("[data-mapbtn]");
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expectMap(page, geoRows("aed").geo);
});

test("別のデータのページへ移って地図を開き、戻ってまた開く", async ({ page }) => {
  await page.goto("/data/aed/");
  await loaded(page);
  await page.locator("[data-mapbtn]").click();
  await expectMap(page, geoRows("aed").geo);
  await page.goto("/data/hinanjo/");
  await loaded(page);
  await page.locator("[data-mapbtn]").click();
  await expectMap(page, geoRows("hinanjo").geo);
  await page.goBack();
  await loaded(page);
  const btn = page.locator("[data-mapbtn]");
  if ((await btn.getAttribute("aria-pressed")) !== "true") await btn.click();
  await expectMap(page, geoRows("aed").geo);
});

test("ページを読み込み直しても地図が出る", async ({ page }) => {
  await page.goto("/data/kosodate/");
  await loaded(page);
  await page.locator("[data-mapbtn]").click();
  await expectMap(page, geoRows("kosodate").geo);
  await page.reload();
  await loaded(page);
  await page.locator("[data-mapbtn]").click();
  await expectMap(page, geoRows("kosodate").geo);
});

test("公園：「桜の多い順」で、いちばん上が桜のいちばん多い公園", async ({ page }) => {
  const d = JSON.parse(readFileSync("public/opendata/park.json", "utf8"));
  const si = d.columns.findIndex((c: string[]) => c[0] === "桜の本数");
  const top = [...d.rows].sort((a, b) => b[si] - a[si])[0];
  await page.goto("/data/park/");
  await loaded(page);
  await page.getByRole("button", { name: "桜の多い順" }).click();
  await expect(page.locator(".data-table tbody tr").first().locator("td").first()).toHaveText(top[0]);
  await expect(page.locator('.data-table th[aria-sort="descending"]')).toContainText("桜");
});

test("URL の ?q= で検索した状態から始まる", async ({ page }) => {
  await page.goto("/data/aed/?q=" + encodeURIComponent("24時間"));
  await loaded(page);
  await expect(page.locator("[data-q]")).toHaveValue("24時間");
  await expect(page.locator("[data-count]")).toHaveText(/全 /);
});

test("表の「地図」は Google マップを緯度・経度で開く", async ({ page }) => {
  await page.goto("/data/aed/");
  await loaded(page);
  const href = await page.locator(".data-table tbody tr td a").first().getAttribute("href");
  expect(href).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=34\.\d+,135\.\d+$/);
});

test.describe("ごみ", () => {
  test("ひらがなで探せて、区分で絞り込める", async ({ page }) => {
    await page.goto("/data/gomi/");
    await loaded(page);
    await expect(page.locator("[data-mapbtn]")).toHaveCount(0);
    await page.locator("[data-q]").fill("でんち");
    await expect(page.locator(".gomi-name").filter({ hasText: /^乾電池$/ })).toHaveCount(1);
    await page.locator("[data-q]").fill("");
    await page.locator("select[data-filter-col]").selectOption({ label: "大型ごみ" });
    await expect(page.locator("[data-count]")).toHaveText(/全 /);
    const kinds = await page.locator(".gomi-kind").allInnerTexts();
    expect(kinds.every((k) => k.includes("大型"))).toBe(true);
  });

  test("例のボタンで検索して、URL に入る", async ({ page }) => {
    await page.goto("/data/gomi/");
    await loaded(page);
    await page.getByRole("button", { name: "ふとん" }).click();
    await expect(page).toHaveURL(/q=%E3%81%B5%E3%81%A8%E3%82%93/);
    await expect(page.locator(".gomi-list li").first()).toBeVisible();
  });
});

test.describe("SNS", () => {
  test("絞り込みで、当てはまらない章と節が隠れる", async ({ page }) => {
    await page.goto("/sns/");
    await page.locator('input[name="q"]').fill("公明");
    await expect(page.locator("#seiji")).toBeVisible();
    await expect(page.locator("#gyosei")).toBeHidden();
    await expect(page.locator("#minkan")).toBeHidden();
    await page.locator('input[name="q"]').fill("");
    await expect(page.locator("#gyosei")).toBeVisible();
  });

  test("会派で絞り込む", async ({ page }) => {
    await page.goto("/sns/");
    await page.locator("select[data-kaiha]").selectOption("日本共産党議員団");
    await expect(page.locator(".giin-table tbody tr:visible")).toHaveCount(4);
  });
});

test("データの入口：検索できるデータ・グラフのある記事・ほかのデータのカード", async ({ page }) => {
  await page.goto("/data/");
  await expect(page.locator("#view .data-cards a")).toHaveCount(7);
  await expect(page.locator('#graphs .data-cards a[href="/jinko/"]')).toBeVisible();
  await expect(page.locator('#more a[href="/data/city/"]')).toBeVisible();
  await expect(page.locator('#more a[href="/data/links/"]')).toBeVisible();
});

test("公園と公共施設のページに、グラフと出典がある", async ({ page }) => {
  for (const id of ["park", "shisetsu"]) {
    await page.goto(`/data/${id}/`);
    await expect(page.locator(".data-graph svg.chart-svg")).toBeVisible();
    await expect(page.locator(".data-graph .data-src")).toContainText("出典");
  }
});

test("市のデータの一覧：絞り込みと、ファイルの一覧", async ({ page }) => {
  await page.goto("/data/city/");
  const items = page.locator("[data-cat-item]");
  const total = await items.count();
  expect(total).toBeGreaterThan(40);
  await expect(page.locator("[data-cat-count]")).toHaveText(`${total} 件`);
  await page.locator('[data-cat-filter] select[name="cat"]').selectOption("統計");
  await expect(page.locator("[data-cat-count]")).toHaveText(new RegExp(`件（全 ${total} 件）`));
  const first = page.locator("[data-cat-item]:visible").first();
  await first.locator(".od-files summary").click();
  await expect(first.locator(".od-files li a").first()).toHaveAttribute("href", /^https:\/\/www\.city\.hirakata\.osaka\.jp\/cmsfiles\//);
});

test.describe("写真ギャラリー", () => {
  /** 一覧のデータを全部読み終わるまで待つ */
  const loaded = async (page: import("@playwright/test").Page) => {
    await expect(page.locator("[data-count]")).toHaveText(/枚/);
    await expect(page.locator("[data-count]")).not.toHaveText(/読み込み中/);
  };

  test("一覧：絞り込みと、URL から始める", async ({ page }) => {
    await page.goto("/gallery/");
    await loaded(page);
    const all = Number((await page.locator("[data-count]").innerText()).match(/^[\d,]+/)![0].replace(/,/g, ""));
    expect(all).toBeGreaterThan(1000);
    await page.locator("[data-q]").fill("くずはモール");
    await expect(page.locator("[data-count]")).toHaveText(/全 /);
    await expect(page.locator("[data-grid] li").first()).toBeVisible();
    await page.goto("/gallery/?g=" + encodeURIComponent("駅"));
    await expect(page.locator("[data-g]")).toHaveValue("駅");
    await expect(page.locator("[data-count]")).toHaveText(/全 /);
  });

  test("一覧：ページ送り（URL にも入る）と、画像の大きさ", async ({ page }) => {
    await page.goto("/gallery/");
    await loaded(page);
    const first = await page.locator("[data-grid] li a").first().getAttribute("href");
    await page.locator('[data-pager] button[data-page="2"]').first().click();
    await expect(page).toHaveURL(/p=2/);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveText("2");
    expect(await page.locator("[data-grid] li a").first().getAttribute("href")).not.toBe(first);
    await expect(page.locator("[data-count]")).toHaveText(/2 \/ \d+ ページ/);
    // 絞り込むと 1 ページ目に戻る
    await page.locator("[data-l]").selectOption("pd");
    await expect(page).not.toHaveURL(/p=2/);
    // 大きさ
    await page.locator("[data-tile]").selectOption("l");
    await expect(page.locator("[data-grid]")).toHaveAttribute("data-size", "l");
    await page.goto("/gallery/?p=3");
    await loaded(page);
    await expect(page.locator('[data-pager] [aria-current="page"]')).toHaveText("3");
  });

  test("一覧：ライセンスで絞り込む（URL にも入る）", async ({ page }) => {
    await page.goto("/gallery/");
    await loaded(page);
    await page.locator("[data-l]").selectOption("sa");
    await expect(page.locator("[data-count]")).toHaveText(/全 /);
    await expect(page).toHaveURL(/l=sa/);
    await page.locator("[data-grid] li a").first().click();
    await expect(page.locator(".gphoto-meta")).toContainText("CC BY-SA");
    await page.goto("/gallery/?l=free");
    await expect(page.locator("[data-l]")).toHaveValue("free");
    await loaded(page);
    // 改変禁止（ND）は載せない
    await expect(page.locator('[data-l] option[value="nd"]')).toHaveCount(0);
  });

  test("地図：近い写真をまとめた印が出て、押すと寄る", async ({ page }) => {
    await page.goto("/gallery/");
    await loaded(page);
    await page.locator("[data-mapbtn]").click();
    const map = page.locator("[data-map]");
    await expect(map.locator(".leaflet-tile-loaded").first()).toBeVisible({ timeout: 15_000 });
    const cluster = map.locator(".gmap-cluster").first();
    await expect(cluster).toBeVisible();
    const before = await page.evaluate(() => document.querySelectorAll(".gmap-cluster").length);
    expect(before).toBeGreaterThan(0);
    // いちばん大きい印を押すと寄る（印が分かれる）
    const nums = await map.locator(".gmap-cluster").allInnerTexts();
    const big = nums.map((t) => Number(t.replace(/,/g, ""))).reduce((m, x, i, a) => (x > a[m] ? i : m), 0);
    await map.locator(".gmap-cluster").nth(big).click();
    await expect.poll(async () => (await map.locator(".gmap-cluster").allInnerTexts()).map((t) => Number(t.replace(/,/g, ""))).reduce((a, b) => Math.max(a, b), 0)).toBeLessThan(Number(nums[big].replace(/,/g, "")));
  });

  test("写真のページ：撮影者・ライセンス・出典と、表記の例", async ({ page }) => {
    await page.goto("/gallery/");
    await expect(page.locator("[data-grid] li").first()).toBeVisible();
    await page.locator("[data-grid] li a").first().click();
    await expect(page.locator(".gphoto-figure img")).toBeVisible();
    await expect(page.locator(".gphoto-meta")).toContainText("撮影者");
    await expect(page.locator(".gphoto-meta")).toContainText("ライセンス");
    await expect(page.locator(".gphoto-meta")).toContainText("出典");
    await expect(page.locator("[data-credit]")).not.toBeEmpty();
  });

  test("写真のページ：← → キーで前後の写真へ", async ({ page }) => {
    await page.goto("/gallery/");
    await page.locator("[data-grid] li a").nth(3).click();
    await expect(page).toHaveURL(/\/gallery\/[0-9a-f]{10}\/$/);
    await expect(page.locator(".gphoto-figure img")).toBeVisible();
    const first = page.url();
    // キーを受けるスクリプトが動き出してから押す
    await page.waitForLoadState("load");
    await page.keyboard.press("ArrowRight");
    await expect(page).not.toHaveURL(first);
    await page.waitForLoadState("load");
    await page.keyboard.press("ArrowLeft");
    await expect(page).toHaveURL(first);
  });

  test("写真のページ：一覧から来たら、その一覧の並びで前後をたどり、その一覧へ戻る", async ({ page }) => {
    await page.goto("/gallery/?s=city");
    await loaded(page);
    await page.locator("[data-grid] li a").nth(1).click();
    await expect(page.locator(".gphoto-meta")).toContainText("枚方市");
    await page.waitForLoadState("load");
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForLoadState("load");
      await expect(page.locator(".gphoto-meta")).toContainText("枚方市");
    }
    await expect(page.locator("[data-back]")).toHaveAttribute("href", "/gallery/?s=city");
  });

  test("一覧：年の見出しと、表示（元の比率・正方形）の切り替え", async ({ page }) => {
    await page.goto("/gallery/");
    await expect(page.locator("[data-grid] li a").first()).toBeVisible();
    await expect(page.locator("[data-grid]")).toHaveClass(/is-ratio/);
    await expect(page.locator(".gallery-year")).toHaveCount(0);
    await page.locator("[data-years]").check();
    await expect(page.locator(".gallery-year h3").first()).toHaveText(/\d{4}年/);
    await page.locator("[data-sort]").selectOption("name");
    await expect(page.locator(".gallery-year")).toHaveCount(0);
    await page.locator("[data-view]").selectOption("square");
    await expect(page.locator("[data-grid]")).not.toHaveClass(/is-ratio/);
    // 説明は、オンにしたときだけ出る
    await expect(page.locator("[data-grid] .gallery-cap").first()).toBeHidden();
    await page.locator("[data-caps]").check();
    await expect(page.locator("[data-grid] .gallery-cap").first()).toBeVisible();
    // 切り替えはブラウザに覚えておく
    await page.reload();
    await expect(page.locator("[data-view]")).toHaveValue("square");
    await expect(page.locator("[data-years]")).toBeChecked();
    await expect(page.locator("[data-caps]")).toBeChecked();
  });

  test("一覧：撮影年不明で絞り込む", async ({ page }) => {
    await page.goto("/gallery/?d=none");
    await expect(page.locator("[data-d]")).toHaveValue("none");
    await loaded(page);
    await expect(page.locator("[data-count]")).toHaveText(/全 /);
    // 一覧の説明に年が出ない（年の無い写真だけ）
    await expect(page.locator("[data-grid] .gallery-cap small")).toHaveCount(0);
  });

  test("一覧：出典で絞り込む", async ({ page }) => {
    for (const [s, text] of [["commons", "Wikimedia Commons"], ["flickr", "Flickr"], ["city", "枚方市"], ["gsi", "国土地理院"], ["jpsearch", "Japan Search"], ["omlib", "大阪市立図書館"], ["ndl", "国立国会図書館"], ["mapillary", "Mapillary"]]) {
      await page.goto(`/gallery/?s=${s}`);
      await expect(page.locator("[data-s]")).toHaveValue(s);
      await loaded(page);
      await page.locator("[data-grid] li a").first().click();
      await expect(page.locator(".gphoto-meta")).toContainText(text);
    }
  });

  test("サイトマップ：目次から写真のページのサイトマップへ", async ({ request }) => {
    const index = await (await request.get("/sitemap.xml")).text();
    expect(index).toContain("sitemap-main.xml");
    expect(index).toContain("sitemap-gallery-0.xml");
    const g = await (await request.get("/sitemap-gallery-0.xml")).text();
    expect((g.match(/<url>/g) ?? []).length).toBeGreaterThan(1000);
  });
});
