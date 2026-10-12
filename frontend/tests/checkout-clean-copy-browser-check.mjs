// Real local quote reads; intercepted Auth/hold error. No booking or payment writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { bankFixture } from './host-bank-browser-check.mjs';

const base = process.argv[2] || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local UI only');
const { chromium } = createRequire(import.meta.url)(process.argv[3] || 'playwright');
const evidence = process.env.BROWSER_EVIDENCE_DIR || '../.tmp/ui-clean-20261008-checkout';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    await bankFixture(context, 'TENANT');
    let attempts = 0;
    await context.route('**/api/management/bookings/hold', route => {
      attempts++;
      return route.fulfill({ status: 503, json: { success: false, errorCode: 'PAYMENT_NOT_CONFIGURED', message: 'Chưa kết nối thanh toán; chỉ cho phép giữ phòng thử trong local/dev.' } });
    });
    const page = await context.newPage();
    await page.goto(`${base}/checkout?unitId=5e799776-f288-4a9b-ba1b-ecf84e6d9b0d&checkIn=2026-10-09&checkOut=2026-10-11&adults=1&children=0`);
    await page.getByLabel('Họ tên người nhận phòng', { exact: true }).waitFor();
    await page.getByText('2 đêm · 1 người lớn', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('main').innerText(), /local\/dev|Chưa kết nối cổng|\[DEMO\]/i);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `${evidence}/checkout-${width}.png`, fullPage: true });
    await page.locator('form button[type="submit"]').click();
    await page.getByRole('alert').filter({ hasText: 'Hiện chưa thể tạo đơn đặt phòng.' }).waitFor();
    assert.equal(attempts, 1);
    assert.doesNotMatch(await page.locator('main').innerText(), /local\/dev|đã được tạo thành công/i);
    await context.close();
    console.log(`PASS checkout ${width}: no technical banner, real quote, fixture error kept, no fake success`);
  }
} finally { await browser.close(); }
