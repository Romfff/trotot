// Compiled Next UI; all API/image writes are intercepted fixtures, never live DB acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureFrontend } from './fixture-frontend.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[3] || 'playwright');
const listing = JSON.parse(await readFile(new URL('./fixtures/public-listing.json', import.meta.url), 'utf8'));
const photo = index => ({ url: `https://layout.fixture.invalid/${index}.svg`, position: index, sortOrder: index });
const details = slug => ({ ...listing, slug, images: Array.from({ length: slug === 'empty' ? 0 : slug === 'single' ? 1 : 15 }, (_, index) => photo(index)),
  ...(slug === 'long' ? { title: 'Phòng trọ có ban công và không gian sinh hoạt '.repeat(6), host: { fullName: 'Tên chủ nhà dài '.repeat(8) } } : {}) });
const app = await fixtureFrontend(process.argv[2], () => ({ success: true, data: [], meta: { page: 1, total: 0, totalPages: 0 } }), details);
assert.equal(app.serverFixture, true, 'Use an isolated build directory, not a live URL');
const out = resolve(process.env.BROWSER_EVIDENCE_DIR || '.tmp/listing-layout-fix-20261010');
await mkdir(out, { recursive: true });
const passed = [], measurements = [];
const check = (label, condition) => { assert.ok(condition, label); passed.push(label); };
const estimate = { lines: [], totalMonthly: 3500000, deposit: 3500000, missingInputs: [], missingCosts: [], isComplete: true, disclaimer: 'Ước tính fixture' };
const prepare = async page => {
  await page.route('**/api/auth/refresh', r => r.fulfill({ status: 401, json: { success: false, errorCode: 'SESSION_CLOSED' } }));
  await page.route('**/api/listings/properties/*/cost-estimate*', r => r.fulfill({ json: { success: true, data: estimate } }));
  await page.route('https://layout.fixture.invalid/**', r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e8f5f1"/><text x="400" y="300" text-anchor="middle" font-size="32">Ảnh kiểm thử</text></svg>' }));
};
let browser;
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await prepare(page);
  const widths = [...Array.from({ length: 54 }, (_, index) => 1440 - index * 20), 375, 320];
  for (const slug of ['empty', 'single', 'many', 'long']) {
    await page.goto(`${app.baseUrl}/thue-phong-tro/${slug}`);
    await page.locator('[data-testid="cost-estimate-total"]').waitFor();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const sizes = await page.evaluate(() => {
        const blocks = [...document.querySelectorAll('main section, main aside')].map(el => ({ width: el.getBoundingClientRect().width, left: el.getBoundingClientRect().left }));
        return { width: innerWidth, body: document.documentElement.scrollWidth, blocks };
      });
      measurements.push({ slug, ...sizes });
      check(`${slug} ${width}: no body overflow`, sizes.body <= width);
      if (width < 1024) check(`${slug} ${width}: aligned full-width blocks`, sizes.blocks.every(block => Math.abs(block.width - sizes.blocks[0].width) < 1 && Math.abs(block.left - sizes.blocks[0].left) < 1));
      if (width === 375 || width === 1440) await page.screenshot({ path: resolve(out, `detail-${slug}-${width}.png`), fullPage: true });
    }
  }
  await page.close();

  for (const width of [375, 1440]) {
    const host = await browser.newPage({ viewport: { width, height: 900 } });
    const user = { id: '00000000-0000-4000-8000-000000000001', fullName: 'Host kiểm thử', role: 'HOST', status: 'ACTIVE', isPhoneVerified: true, phone: '0990000000' };
    let record = { ...listing, version: 1, status: 'PUBLISHED', images: [photo('broken')], revision: null, longTermDetail: { monthlyPrice: '3500000' }, amenities: [] }, actions = 0;
    await host.route('**/api/**', r => {
      const path = new URL(r.request().url()).pathname;
      if (path === '/api/auth/refresh') return r.fulfill({ json: { success: true, data: { user, accessToken: 'fixture-only-token' } } });
      if (path === '/api/auth/me') return r.fulfill({ json: { success: true, data: user } });
      if (path.endsWith('/conversations/unread')) return r.fulfill({ json: { success: true, data: { totalUnread: 0, conversations: [] } } });
      if (path === '/api/management/host/properties' && r.request().method() === 'GET') return r.fulfill({ json: { success: true, data: [record], meta: { page: 1, total: 1, totalPages: 1 } } });
      if (path === `/api/management/host/properties/${listing.id}/availability` && r.request().method() === 'POST') {
        assert.equal(r.request().postDataJSON().expectedVersion, record.version);
        actions++;
        record = { ...record, version: record.version + 1, isAvailable: !record.isAvailable, images: actions === 1 ? [photo('valid')] : [] };
        return r.fulfill({ json: { success: true, data: record } });
      }
      return r.abort();
    });
    await host.route('https://layout.fixture.invalid/**', r => r.request().url().includes('broken') ? r.fulfill({ status: 404, body: 'Image fixture missing' }) : r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#e8f5f1"/></svg>' }));
    await host.goto(`${app.baseUrl}/host/properties`);
    await host.getByText('Không tải được ảnh', { exact: true }).waitFor();
    check(`${width}: failed thumbnail replaced`, await host.locator('main img').count() === 0);
    await host.screenshot({ path: resolve(out, `host-image-error-${width}.png`), fullPage: true });
    await host.getByRole('button', { name: 'Báo hết phòng', exact: true }).click();
    await host.waitForFunction(() => document.querySelector('main img')?.naturalWidth > 0);
    check(`${width}: changed URL resets image error on same listing`, await host.getByText('Không tải được ảnh', { exact: true }).count() === 0 && actions === 1);
    await host.screenshot({ path: resolve(out, `host-image-valid-${width}.png`), fullPage: true });
    await host.getByRole('button', { name: 'Báo còn phòng', exact: true }).click();
    await host.getByText('Không có ảnh', { exact: true }).waitFor();
    check(`${width}: absent image stays distinct from failed`, await host.locator('main img').count() === 0 && actions === 2);
    check(`${width}: Host page no overflow`, await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await host.screenshot({ path: resolve(out, `host-no-image-${width}.png`), fullPage: true });
    await host.close();
  }
  await writeFile(resolve(out, 'measurements.json'), JSON.stringify({ fixtureOnly: true, checks: passed, measurements }, null, 2));
  console.log(`PASS ${passed.length} checks; ${measurements.length} width/state samples; fixture API/images, no DB/provider acceptance.`);
  if (process.env.RUN_LISTING_UI_PROBE === '1') {
    await browser.close(); browser = null;
    const launch = chromium.launch.bind(chromium); let done;
    chromium.launch = async options => {
      const b = await launch({ ...options, channel: 'msedge' }); done = new Promise(end => b.once('disconnected', end));
      const newContext = b.newContext.bind(b);
      b.newContext = async options => {
        const context = await newContext(options), newPage = context.newPage.bind(context);
        context.newPage = async () => { const p = await newPage(); await prepare(p); return p; };
        return context;
      };
      return b;
    };
    process.argv = [process.execPath, 'probe', `${app.baseUrl}/thue-phong-tro/many`, '--widths', '375,1440', '--sweep', '1440,375,20', '--out', resolve(out, 'probe'), '--pw', 'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node'];
    await import(pathToFileURL(resolve('.agents/skills/ui-ux/scripts/probe.mjs')));
    while (!done) await new Promise(end => setTimeout(end, 10));
    await done;
  }
} finally { await browser?.close(); await app.close(); }
