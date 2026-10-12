// Read-only live catalog + fixture session/tiles. No geocoder, GPS or application DB writes.
// node tests/listing-address-catalog-browser-check.mjs <frontend> <playwright package> <evidence dir>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fixtureFrontend } from "./fixture-frontend.mjs";

const { chromium } = createRequire(import.meta.url)(process.argv[3] || "playwright");
const evidence = process.argv[4] || "../.tmp/address-catalog";
await mkdir(evidence, { recursive: true });
const api = "http://localhost:5000/api/v1/catalog/";
async function catalog(path) {
  const response = await fetch(api + path);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.success, true);
  return result;
}
const provinces = await catalog("provinces");
const codes = ["01", "79", "48", "68", "92"];
const wards = new Map();
for (const code of codes) wards.set(code, await catalog(`wards?provinceCode=${code}`));
const pairs = codes.map(code => ({ province: provinces.data.items.find(item => item.code === code), ward: wards.get(code).data.items[0] }));
assert.ok(pairs.every(pair => pair.province && pair.ward));
const user = { id: "00000000-0000-4000-8000-000000000001", fullName: "Chủ nhà kiểm thử", phone: "0990000000", role: "HOST", status: "ACTIVE" };
const app = await fixtureFrontend(process.argv[2], () => ({ success: true, data: [] }));
let browser; let assertions = 0;
try {
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", hasTouch: width === 375 });
    await context.route("**/api/auth/refresh", r => r.fulfill({ json: { success: true, data: { user, accessToken: "fixture-only" } } }));
    await context.route("**/api/auth/me", r => r.fulfill({ json: { success: true, data: user } }));
    await context.route("**/api/listings/catalog/provinces", r => r.fulfill({ json: provinces }));
    await context.route("**/api/listings/catalog/wards?*", r => r.fulfill({ json: wards.get(new URL(r.request().url()).searchParams.get("provinceCode")) }));
    await context.route("**/api/listings/amenities", r => r.fulfill({ json: { success: true, data: [] } }));
    await context.route("https://tile.openstreetmap.org/**", r => r.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef2ed"/></svg>' }));
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    await page.goto(app.baseUrl + "/host/properties/create");
    await page.getByRole("status").filter({ hasText: "Đang tải bản đồ…" }).waitFor({ state: "hidden" });
    const province = page.getByRole("combobox", { name: "Tỉnh/thành phố", exact: true });
    const ward = page.getByRole("combobox", { name: "Phường/xã", exact: true });
    await province.waitFor(); assert.equal(await ward.isDisabled(), true); assertions++;
    if (width === 1440) {
      const provinceBox = await province.boundingBox(); const wardBox = await ward.boundingBox();
      assert.ok(Math.abs(provinceBox.y - wardBox.y) < 1); assertions++;
    }
    await page.screenshot({ path: `${evidence}/aligned-unselected-${width}.png`, fullPage: true });
    await province.press("ArrowDown");
    const input = page.getByRole("combobox", { name: "Tìm tỉnh/thành phố", exact: true });
    await input.waitFor();
    assert.equal(await page.getByRole("listbox").getByRole("option").count(), provinces.data.items.length);
    const listId = await input.getAttribute("aria-controls");
    assert.equal(await province.getAttribute("aria-controls"), listId); assertions++;
    await input.fill("not-a-place-xyz"); await page.getByText("Không có kết quả. Thử gõ ngắn hơn.").waitFor(); assertions++;
    await input.fill("ha noi");
    await page.getByRole("option", { name: "Thành phố Hà Nội", exact: true }).waitFor();
    await input.press("ArrowDown"); await input.press("ArrowUp");
    try { await page.waitForFunction(() => Boolean(document.querySelector('[cmdk-input]')?.getAttribute("aria-activedescendant"))); }
    catch (error) { console.log(await input.evaluate(element => ({input:element.outerHTML,options:[...document.querySelectorAll('[cmdk-item]')].map(item=>item.outerHTML)}))); throw error; }
    const activeId = await input.getAttribute("aria-activedescendant");
    assert.ok(activeId && await page.locator(`[id="${activeId}"]`).count() === 1); assertions++;
    await page.screenshot({ path: `${evidence}/province-options-${width}.png`, fullPage: true });
    await input.press("Escape");
    await input.waitFor({ state: "hidden" });
    assert.equal(await province.evaluate(element => element === document.activeElement), true); assertions++;
    for (const pair of pairs) {
      await province.click();
      await input.fill(pair.province.name);
      await input.press("Enter");
      assert.equal(await page.locator('[name="provinceCode"]').inputValue(), pair.province.code);
      assert.equal(await page.locator('[name="wardCode"]').inputValue(), "");
      assert.equal(await page.locator('[name="latitude"]').inputValue(), "");
      assert.equal(await page.locator("#listing-location-confirm").isDisabled(), true); assertions++;
      await ward.click();
      const wardInput = page.getByRole("combobox", { name: "Tìm phường/xã", exact: true });
      const wardOptions = page.getByRole("listbox").getByRole("option");
      assert.equal(await wardOptions.count(), wards.get(pair.province.code).data.items.length);
      if (pair.province.code === "79") await page.screenshot({ path: `${evidence}/all-wards-${width}.png`, fullPage: true });
      const lastWard = wards.get(pair.province.code).data.items.at(-1);
      await wardOptions.last().scrollIntoViewIfNeeded(); await wardOptions.last().click();
      assert.equal(await page.locator('[name="wardCode"]').inputValue(), lastWard.code); assertions++;
      await ward.click();
      await wardInput.fill(pair.ward.name);
      await page.getByRole("option", { name: pair.ward.name, exact: true }).click();
      assert.equal(await page.locator('[name="wardCode"]').inputValue(), pair.ward.code);
      assert.equal(await page.locator('[name="latitude"]').inputValue(), ""); assertions++;
    }
    await ward.click(); await page.getByRole("combobox", { name: "Tìm phường/xã", exact: true }).press("Tab");
    await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "addressDetail"); assertions++;
    await ward.click(); await page.getByRole("combobox", { name: "Tìm phường/xã", exact: true }).press("Shift+Tab");
    await page.waitForFunction(() => document.activeElement?.id === "provinceCode"); assertions++;
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assertions++;
    await context.close();
  }
  console.log(JSON.stringify({ result: "PASS", assertions, catalogVersion: provinces.data.version, pairs, geographicAccuracy: "BLOCKED: catalog has no coordinates; provider not selected", manualHumanTest: "NOT RUN", dbWrites: 0 }, null, 2));
} finally { await browser?.close(); await app.close(); }
