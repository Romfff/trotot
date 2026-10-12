// Run against a fresh local build: node tests/listing-browser-check.mjs <built frontend directory or base URL> <Playwright package path>.
// Listing/catalog and tile responses are fixtures; no DB writes or repeated live tile downloads.
import assert from "node:assert/strict";
import { fixtureFrontend } from "./fixture-frontend.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[3] || "playwright");
const queries = [];
const malicious = '<img src=x onerror="window.__listingXss=1">';
const room = JSON.parse(await readFile(new URL("./fixtures/public-listing.json", import.meta.url), "utf8"));
const fixtureApp = await fixtureFrontend(process.argv[2], query => {
  queries.push(query);
  return { success: true, message: "SSR listing fixture", data: [{ ...room, title: malicious, addressDetail: malicious, ward: null,
    images: [{ url: "javascript:window.__listingXss=1", position: 0, sortOrder: 0 }] }],
    meta: { page: Number(query.get("page") || 1), limit: 20, total: 40, totalPages: 2 } };
});
const baseUrl = fixtureApp.baseUrl;
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let tileRequests = 0;
  let failTiles = false;
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    tileRequests++;
    if (failTiles) return route.abort("failed");
    return route.fulfill({ contentType: "image/png", body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") });
  });
  await page.route("https://*.basemaps.cartocdn.com/**", () => { throw new Error("Unconfigured CARTO tiles must not return"); });
  await page.route("**/api/listings/amenities", (route) => route.fulfill({ json: { success: true, data: [
    { id: "wifi", name: "Wi-Fi" }, { id: "air_cond", name: "Máy lạnh" },
  ] } }));
  await page.route("**/api/listings/properties/long-term/search?*", (route) => {
    assert.equal(new URL(route.request().url()).origin, new URL(baseUrl).origin);
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: {
      success: true, data: [{ ...room, title: malicious, addressDetail: malicious, ward: null,
        images: [{ url: "javascript:window.__listingXss=1", position: 0, sortOrder: 0 }] }],
      meta: { page: Number(new URL(route.request().url()).searchParams.get("page") || 1), limit: 20, total: 40, totalPages: 2 },
    } });
  });
  await page.goto(`${baseUrl}/thue-phong-tro?location=bk&minPrice=2000000&maxPrice=4000000&minArea=25&radius=3000&sortBy=price_asc&page=2`);
  await page.locator("h3").filter({ hasText: malicious }).waitFor();
  assert.equal(await page.locator("#desktop-filter-price").inputValue(), "4000000");
  assert.ok(queries.some((q) => q.get("minPrice") === "2000000" && q.get("page") === "2"));
  await page.waitForFunction(() => [...document.querySelectorAll(".leaflet-tile")]
    .some((tile) => tile.src.startsWith("https://tile.openstreetmap.org/") && tile.complete && tile.naturalWidth > 0));
  assert.ok(tileRequests > 0);
  assert.equal(await page.locator(".leaflet-attribution-control a, .leaflet-control-attribution a")
    .filter({ hasText: "CARTO" }).count(), 0);
  assert.equal(await page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]').count(), 1);
  // One native button per marker, without a nested second keyboard target.
  assert.equal(await page.locator(".listing-map-pin").first().getAttribute("role"), null);
  assert.equal(await page.locator(".listing-map-pin").first().getAttribute("tabindex"), null);
  assert.ok((await page.locator(".map-price-pin").first().getAttribute("aria-label")).includes(malicious));
  await page.locator(".map-price-pin").first().focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".leaflet-popup-content").length === 1);
  await page.locator(".leaflet-popup-content").waitFor();
  assert.ok((await page.locator(".leaflet-popup-content").textContent()).includes(malicious));
  assert.equal(await page.locator(".leaflet-popup-content img, .leaflet-popup-content script").count(), 0);
  assert.equal(await page.evaluate(() => window.__listingXss), undefined);
  assert.equal(await page.locator(".leaflet-popup-content a").getAttribute("href"), `/thue-phong-tro/${room.slug}`);
  assert.equal(await page.locator(".leaflet-popup-content a").evaluate((link) => getComputedStyle(link).color), "rgb(255, 255, 255)");

  // Hover must preserve an existing marker and the zoom chosen by the user.
  await page.mouse.move(0, 0);
  await page.locator(".leaflet-control-zoom-out").click();
  await page.waitForTimeout(700); // Leaflet zoom animation + outgoing tile retirement.
  const readZoom = () => page.evaluate(() => {
    const level = [...document.querySelectorAll(".leaflet-tile-container")]
      .sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex))[0];
    return Number(level?.querySelector("img")?.src.match(/openstreetmap\.org\/(\d+)\//)?.[1]);
  });
  const zoomBeforeHover = await readZoom();
  assert.ok(Number.isFinite(zoomBeforeHover));
  await page.evaluate(() => { window.__originalPin = document.querySelector(".map-price-pin"); });
  await page.locator("h3").filter({ hasText: malicious }).hover();
  await page.locator(".map-price-pin.selected").waitFor();
  await page.waitForTimeout(700);
  assert.equal(await readZoom(), zoomBeforeHover);
  assert.ok(await page.evaluate(() => window.__originalPin === document.querySelector(".map-price-pin")));

  // Even with slow RSC navigation, rapid choices must be merged from the latest URL.
  await page.route("**/thue-phong-tro?*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("_rsc")) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });
  await page.getByRole("button", { name: /^Tiện ích/ }).click();
  await page.getByRole("button", { name: "Wi-Fi", exact: true }).click();
  await page.getByRole("button", { name: "Máy lạnh", exact: true }).click();
  await page.waitForFunction(() => new URL(location.href).searchParams.get("amenities") === "wifi,air_cond");
  assert.equal(await page.getByRole("button", { name: "Wi-Fi", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("button", { name: "Máy lạnh", exact: true }).getAttribute("aria-pressed"), "true");
  const combinedSearch = page.waitForResponse((r) => r.url().includes("/long-term/search") && r.url().includes("minArea=18"));
  await page.locator("#desktop-filter-price").selectOption("2500000");
  await page.locator("#desktop-filter-area").selectOption("18");
  await page.waitForFunction(() => {
    const q = new URL(location.href).searchParams;
    return q.get("maxPrice") === "2500000" && q.get("minArea") === "18" && q.get("amenities") === "wifi,air_cond";
  });
  await combinedSearch;
  assert.ok(queries.some((q) => q.get("amenities") === "wifi,air_cond" && q.get("maxPrice") === "2500000" && q.get("minArea") === "18"));
  await page.getByRole("button", { name: /^Tiện ích/ }).click();

  // Restore the initial entry before the existing Back/Forward checks.
  await page.evaluate(() => window.history.replaceState(null, "", "/thue-phong-tro?location=bk&minPrice=2000000&maxPrice=4000000&minArea=25&radius=3000&sortBy=price_asc&page=2"));
  await page.waitForFunction(() => document.querySelector("#desktop-filter-price").value === "4000000");

  // Next's native history integration changes searchParams without remounting this page.
  const nextSearch = page.waitForResponse((r) => r.url().includes("maxPrice=6000000") && r.url().includes("/long-term/search"));
  await page.evaluate(() => window.history.pushState(null, "", "/thue-phong-tro?location=q1&maxPrice=6000000&minArea=30&radius=1000&sortBy=price_desc&page=1"));
  await page.waitForFunction(() => document.querySelector("#desktop-filter-price").value === "6000000");
  assert.equal(await page.locator("#desktop-filter-location").inputValue(), "q1");
  assert.equal(await page.locator("#desktop-filter-area").inputValue(), "30");
  assert.equal(await page.locator("#select-sort-by").inputValue(), "price_desc");
  await nextSearch;
  assert.ok(queries.some((q) => q.get("maxPrice") === "6000000" && q.get("lat") === "10.7769" && q.get("radius") === "1000"));
  await page.goBack();
  await page.waitForFunction(() => document.querySelector("#desktop-filter-price").value === "4000000");
  assert.equal(await page.locator("#select-sort-by").inputValue(), "price_asc");
  await page.goForward();
  await page.waitForFunction(() => document.querySelector("#desktop-filter-price").value === "6000000");

  await page.locator("#desktop-filter-price").selectOption("2500000");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("maxPrice") === "2500000");
  assert.equal(await page.locator("#desktop-filter-price").inputValue(), "2500000");
  await page.getByTitle("Đặt lại toàn bộ bộ lọc").click();
  await page.waitForFunction(() => location.search === "");
  assert.equal(await page.locator("#desktop-filter-price").inputValue(), "");
  assert.equal(await page.locator("#desktop-filter-location").inputValue(), "all");

  // Home and results share location IDs; radius shown in km is sent in meters.
  await page.goto(baseUrl);
  await page.getByLabel("Gần trường, bệnh viện, khu công nghiệp", {exact:true}).selectOption("q1");
  await page.getByLabel("Bán kính tìm kiếm", {exact:true}).selectOption("3");
  // A new search page is rendered on the server; observe navigation and its SSR query.
  const queryCountBeforeHomeSearch = queries.length;
  const homeSearch = page.waitForURL(url => url.pathname === "/thue-phong-tro" && url.searchParams.get("radius") === "3000");
  await page.getByRole("button", { name: "Tìm phòng", exact: true }).click();
  await homeSearch;
  await page.locator("h3").filter({ hasText: malicious }).waitFor();
  assert.ok(queries.length > queryCountBeforeHomeSearch);
  assert.equal(new URL(page.url()).searchParams.get("location"), "q1");
  assert.equal(await page.locator("#desktop-filter-location").inputValue(), "q1");
  assert.ok(queries.some((q) => q.get("lat") === "10.7769" && q.get("lng") === "106.7009" && q.get("radius") === "3000"));
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("button", { name: "Bộ lọc", exact: true }).click();
  assert.equal(await page.locator("#mobile-filter-loc").inputValue(), "q1");
  await page.locator("#mobile-filter-price").selectOption("6000000");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("maxPrice") === "6000000");
  assert.equal(await page.locator("#mobile-filter-price").inputValue(), "6000000");
  await page.getByRole("button", { name: "Đóng bộ lọc", exact: true }).click();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // Fresh mobile navigation: the map is initially CSS-hidden, then revealed.
  await page.goto(`${baseUrl}/thue-phong-tro?location=bk&maxPrice=3000000&minArea=20`);
  await page.locator("h3").filter({ hasText: malicious }).waitFor();
  await page.getByRole("button", { name: "Bộ lọc", exact: true }).click();
  assert.equal(await page.locator("#mobile-filter-price").inputValue(), "3000000");
  assert.equal(await page.locator("#mobile-filter-area").inputValue(), "20");
  assert.equal(await page.locator('#mobile-filter-price option:checked').textContent(), "Tối đa 3.000.000 đ");
  await page.getByRole("button", { name: "Đóng bộ lọc", exact: true }).click();
  assert.equal(await page.locator(".leaflet-container").count(), 0);
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page.locator(".leaflet-center-pin").waitFor();
  await page.waitForTimeout(700);
  const assertCentered = async () => {
    const position = await page.evaluate(() => {
      const map = document.querySelector(".leaflet-container").getBoundingClientRect();
      const pin = document.querySelector(".leaflet-center-pin").getBoundingClientRect();
      return { x: pin.x + pin.width / 2 - map.x - map.width / 2,
        y: pin.y + pin.height / 2 - map.y - map.height / 2 };
    });
    assert.ok(Math.abs(position.x) <= 2 && Math.abs(position.y) <= 2, JSON.stringify(position));
  };
  await assertCentered();
  // Leaflet's high internal z-index must stay below the mobile filter sheet.
  await page.getByRole("button", { name: "Bộ lọc", exact: true }).click();
  assert.ok(await page.evaluate(() => {
    const sheet = document.querySelector("#mobile-filter-price").closest(".fixed");
    return [...document.querySelectorAll(".leaflet-control-zoom a, .map-price-pin")].every((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return top && !top.closest(".leaflet-container") && (sheet.contains(top) || top.closest(".fixed"));
    });
  }));
  await page.getByRole("button", { name: "Đóng bộ lọc", exact: true }).click();
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(350);
  await assertCentered();
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  await page.getByRole("button", { name: "Bộ lọc", exact: true }).click();
  await page.locator("#mobile-filter-loc").selectOption("q1");
  await page.waitForFunction(() => new URL(location.href).searchParams.get("location") === "q1");
  await page.getByRole("button", { name: "Đóng bộ lọc", exact: true }).click();
  await page.waitForTimeout(350); // Data/bounds changed while the map was hidden.
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page.waitForTimeout(350);
  assert.ok(await page.evaluate(() => {
    const map = document.querySelector(".leaflet-container").getBoundingClientRect();
    const pin = document.querySelector(".leaflet-center-pin").getBoundingClientRect();
    return pin.x >= map.x && pin.x < map.right && pin.y >= map.y && pin.y < map.bottom;
  }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator("#desktop-filter-price").inputValue(), "3000000");
  assert.equal(await page.locator("#desktop-filter-area").inputValue(), "20");

  // Failed tiles must have an actionable error; retry reloads only tiles.
  failTiles = true;
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "Không tải được nền bản đồ" }).waitFor();
  await page.screenshot({ path: "../.tmp/listing-map-error-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 900 });
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Không tải được nền bản đồ" }).waitFor();
  await page.waitForTimeout(200); // Capture the settled toggle styles, not their transition.
  await page.screenshot({ path: "../.tmp/listing-map-error-mobile.png", fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const queryCountBeforeRetry = queries.length;
  const urlBeforeRetry = page.url();
  const zoomBeforeRetry = await readZoom();
  const failedRequestCount = tileRequests;
  await page.getByRole("button", { name: "Thử tải lại bản đồ", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent.includes("Không tải được nền bản đồ"));
  assert.ok(tileRequests > failedRequestCount, "A failed retry should show the error again, without looping");
  failTiles = false;
  await page.getByRole("button", { name: "Thử tải lại bản đồ", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".leaflet-tile")].some((t) => t.complete && t.naturalWidth > 0));
  assert.equal(await page.getByRole("alert").filter({ hasText: "Không tải được nền bản đồ" }).count(), 0);
  assert.equal(page.url(), urlBeforeRetry);
  assert.equal(queries.length, queryCountBeforeRetry);
  assert.equal(await readZoom(), zoomBeforeRetry);
  console.log("PASS browser: existing tile/popup/URL/query/back/forward/home regression; rapid multi-filter merge; hover preserves zoom and marker DOM; custom URL options desktop/mobile; hidden-mobile reveal, resize and hide/reveal centered; tile error + keyboard retry without search/URL/zoom reset; 375px overflow. API and tiles are fixtures, not DB/live-provider integration.");
} finally {
  await browser?.close();
  await fixtureApp.close();
}
