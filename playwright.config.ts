import { defineConfig, devices } from "@playwright/test";

/**
 * 画面の動きのテスト（SNS の絞り込み、データの検索・並べ替え・地図）。
 *
 *   pnpm build && pnpm test:e2e
 *
 * ブラウザは手元の Google Chrome を使う（channel: "chrome"。ブラウザを別に落とさない）。
 * 地図の画像は国土地理院から読むので、ネットにつながっている必要がある。
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  // 手元の Chrome をたくさん同時に立ち上げると止まることがあるので、4 つまで
  workers: 4,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4336",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "phone", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
  webServer: {
    command: "pnpm preview",
    url: "http://localhost:4336/",
    reuseExistingServer: true,
  },
});
