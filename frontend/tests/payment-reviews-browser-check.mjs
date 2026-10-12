// Synthetic Auth/API fixtures only. No provider, bank, DB writes or fake paid action.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { bankFixture } from './host-bank-browser-check.mjs';

export async function paymentReviewFixture(context, role = 'ADMIN') {
  await bankFixture(context, role);
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const row = n => ({ id: id(n), sessionId: id(100 + n), bookingId: id(200 + n), bookingCode: `FIXTURE-${n}`,
    provider: 'VNPAY_SANDBOX', transactionNo: String(1000 + n), expectedAmount: '9999999999', receivedAmount: '1099',
    reasonCode: 'AMOUNT_MISMATCH', sessionBookingVersion: 1, bookingVersion: 2, bookingStatus: 'CANCELLED', paymentStatus: 'PENDING',
    sessionExpiresAt: '2026-10-06T17:00:00.000Z', payDate: null, receivedAt: '2026-10-06T17:01:00.000Z' });
  let mode = 'ok', detailMode = 'ok', total = 2, gate = null, detailGate = null;
  const requests = [];
  await context.route('**/api/management/admin/finance/payment-reviews**', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname, page: url.searchParams.get('page') });
    assert.equal(request.method(), 'GET');
    const isList = url.pathname.endsWith('/payment-reviews'), selectedMode = isList ? mode : detailMode;
    if (isList && gate) await gate;
    if (!isList && detailGate) await detailGate;
    if (selectedMode === 'error') return route.fulfill({ status: 503, json: { success: false, errorCode: 'FIXTURE_FAILED', message: 'Lỗi kiểm thử' } });
    if (isList) {
      const page = Number(url.searchParams.get('page')), size = mode === 'empty' ? 0 : total;
      const data = Array.from({ length: Math.min(20, Math.max(0, size - (page - 1) * 20)) }, (_, i) => row((page - 1) * 20 + i + 1));
      return route.fulfill({ json: { success: true, message: 'Synthetic fixture', data: mode === 'invalid' ? [{ ...row(1), receivedAmount: 1099 }] : data,
        meta: { page, limit: 20, total: size, totalPages: Math.ceil(size / 20) } } });
    }
    const n = Number(url.pathname.split('/').at(-1).split('-').at(-1));
    return route.fulfill({ json: { success: true, message: 'Synthetic fixture', data: { ...row(n), ...(selectedMode === 'invalid' ? { receivedAmount: 1099 } : {}) } } });
  });
  return { requests, mode: value => { mode = value; }, detailMode: value => { detailMode = value; }, total: value => { total = value; },
    hold: value => { gate = value; }, holdDetail: value => { detailGate = value; } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url), base = process.argv[2] || 'http://127.0.0.1:3327';
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local fixture UI only');
  const { chromium } = require(process.argv[3] || 'playwright'), browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const evidence = process.env.BROWSER_EVIDENCE_DIR || '../.tmp/s4-payment-review-ui'; await mkdir(evidence, { recursive: true });
  try {
    for (const width of [375, 1440, 1920]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } }), f = await paymentReviewFixture(context), page = await context.newPage();
      await page.goto(`${base}/admin/finance/payment-reviews`);
      await page.getByRole('button', { name: 'Xem giao dịch 1001', exact: true }).click();
      const detail = page.locator('#payment-review-detail');
      await detail.getByText('9.999.999.999đ', { exact: true }).waitFor();
      await detail.getByText('1.099đ', { exact: true }).waitFor();
      await detail.getByText('Đã hủy', { exact: true }).waitFor();
      const close = page.getByRole('button', { name: 'Đóng chi tiết 1001', exact: true });
      assert.equal(await close.getAttribute('aria-expanded'), 'true');
      await close.click(); assert.equal(await detail.locator('dl').count(), 0);
      await page.getByRole('button', { name: 'Xem giao dịch 1001', exact: true }).click();
      await detail.getByText('9.999.999.999đ', { exact: true }).waitFor();
      assert.equal(await page.getByRole('form').count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('9999999999')), false);
      await page.screenshot({ path: `${evidence}/detail-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Mở menu tài khoản' }).click();
      await page.getByRole('menuitem', { name: 'Giao dịch cần đối soát', exact: true }).waitFor();
      assert(f.requests.every(r => r.method === 'GET')); await context.close(); console.log(`PASS ${width}: exact money, snapshot/current state, no mutation/private storage, menu, responsive`);
    }
    for (const role of ['HOST', 'TENANT']) {
      const context = await browser.newContext(), f = await paymentReviewFixture(context, role), page = await context.newPage();
      await page.goto(`${base}/admin/finance/payment-reviews`); await page.getByText('Trang này chỉ dành cho Admin đang hoạt động.').waitFor();
      assert.equal(f.requests.length, 0); await context.close(); console.log(`PASS ${role}: private UI gate, no review request`);
    }
    for (const mode of ['empty', 'error', 'invalid']) {
      const context = await browser.newContext(), f = await paymentReviewFixture(context), page = await context.newPage(); f.mode(mode);
      await page.goto(`${base}/admin/finance/payment-reviews`);
      if (mode === 'empty') await page.getByText('Không có giao dịch cần đối soát ở trang này.').waitFor();
      else {
        await page.getByRole('button', { name: 'Thử lại', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: /Xem giao dịch/ }).count(), 0);
        f.mode('ok'); await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
        await page.getByRole('button', { name: 'Xem giao dịch 1001', exact: true }).waitFor();
      }
      await context.close(); console.log(`PASS ${mode}: fail closed, explicit retry, no writes`);
    }
    const context = await browser.newContext(), f = await paymentReviewFixture(context), page = await context.newPage();
    f.total(21); let release; f.hold(new Promise(resolve => { release = resolve; }));
    await page.goto(`${base}/admin/finance/payment-reviews`); await page.getByRole('status', { name: 'Đang tải giao dịch', exact: true }).waitFor();
    assert.equal(await page.getByText('Không có giao dịch cần đối soát ở trang này.').count(), 0);
    release(); f.hold(null); await page.getByRole('button', { name: 'Xem giao dịch 1001', exact: true }).click();
    await page.locator('#payment-review-detail').getByText('FIXTURE-1', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Trang sau', exact: true }).click();
    await page.getByRole('button', { name: 'Xem giao dịch 1021', exact: true }).waitFor();
    assert.equal(await page.locator('#payment-review-detail').getByText('FIXTURE-1', { exact: true }).count(), 0);
    f.detailMode('invalid'); await page.getByRole('button', { name: 'Xem giao dịch 1021', exact: true }).click();
    await page.locator('#payment-review-detail').getByRole('button', { name: 'Thử lại', exact: true }).waitFor();
    assert.equal(await page.locator('#payment-review-detail').locator('dl').count(), 0);
    f.detailMode('ok'); await page.locator('#payment-review-detail').getByRole('button', { name: 'Thử lại', exact: true }).click();
    await page.locator('#payment-review-detail').getByText('FIXTURE-21', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Trang trước', exact: true }).click();
    await page.getByRole('button', { name: 'Xem giao dịch 1001', exact: true }).waitFor();
    let late; f.holdDetail(new Promise(resolve => { late = resolve; }));
    await page.getByRole('button', { name: 'Xem giao dịch 1001', exact: true }).click();
    await page.getByRole('status', { name: 'Đang tải chi tiết giao dịch', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Xem giao dịch 1002', exact: true }).click();
    f.holdDetail(null); late(); await page.locator('#payment-review-detail').getByText('FIXTURE-2', { exact: true }).waitFor();
    assert.equal(await page.locator('#payment-review-detail').getByText('FIXTURE-1', { exact: true }).count(), 0);
    await page.evaluate(() => {
      const revision = 'fixture-logout'; localStorage.setItem('trotot-auth-revision', revision); localStorage.setItem('trotot-auth-logout-pending', '1'); localStorage.removeItem('trotot-auth-session-id');
      const channel = new BroadcastChannel('trotot-auth-v1'); channel.postMessage({ type: 'logout', revision }); channel.close();
    });
    await page.getByText('để xem trang quản trị.', { exact: false }).waitFor();
    assert.equal(await page.locator('#payment-review-detail').count(), 0); assert(f.requests.every(r => r.method === 'GET'));
    await context.close(); console.log('PASS loading, pagination, bad detail/retry, late detail, logout clears private UI');
  } finally { await browser.close(); }
}
