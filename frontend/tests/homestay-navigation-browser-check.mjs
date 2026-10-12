// Real compiled Next UI; fixture transport only, no DB/Auth/provider acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fixtureFrontend } from './fixture-frontend.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[3] || 'playwright');
const app = await fixtureFrontend(process.argv[2], () => ({ success:true, data:[], meta:{page:1,total:0,totalPages:0} }));
const evidence = process.env.BROWSER_EVIDENCE_DIR;
if (evidence) await mkdir(evidence, {recursive:true});
let browser;
let cases = 0;
try {
  browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined});
  for (const role of ['GUEST', 'TENANT', 'HOST']) {
    for (const width of [375,1440]) {
      const page = await browser.newPage({viewport:{width,height:1000}});
      const user = {id:'00000000-0000-4000-8000-000000000001',fullName:'Người kiểm thử',phone:'0990000000',role,status:'ACTIVE'};
      await page.route('**/api/auth/refresh', r => r.fulfill({status:role === 'GUEST' ? 401 : 200,json:role === 'GUEST' ? {success:false,errorCode:'SESSION_CLOSED',message:'Fixture guest'} : {success:true,data:{user,accessToken:'fixture-only'}}}));
      await page.route('**/api/auth/me', r => r.fulfill({json:{success:true,data:user}}));
      await page.route('**/api/listings/homestays/search?*', r => r.fulfill({json:{success:true,data:[],meta:{page:1,limit:10,total:0,totalPages:0}}}));
      await page.route('**/api/management/**', r => r.fulfill({json:{success:true,data:[],meta:{page:1,limit:10,total:0,totalPages:0}}}));
      await page.route('https://fonts.googleapis.com/**', r => r.fulfill({contentType:'text/css',body:''}));
      await page.route('https://fonts.gstatic.com/**', r => r.abort());
      for (const path of ['/homestay','/bookings','/host/bookings']) {
        await page.goto(app.baseUrl + path);
        const nav = page.getByRole('navigation',{name:'Đặt phòng',exact:true});
        await nav.waitFor();
        const links = nav.getByRole('link');
        assert.equal(await links.count(),3);
        assert.equal(await nav.locator('[aria-current="page"]').count(),1);
        assert.equal(await nav.locator('[aria-current="page"]').getAttribute('href'),path);
        for (let i=0;i<3;i++) {
          const link = links.nth(i);
          const geometry = await link.evaluate(el => {
            const icon=el.querySelector('svg').getBoundingClientRect(), label=el.querySelector('span').getBoundingClientRect(), rect=el.getBoundingClientRect();
            return {height:rect.height,gap:label.left-icon.right,centers:Math.abs(icon.top+icon.height/2-label.top-label.height/2),iconWidth:icon.width,whiteSpace:getComputedStyle(el).whiteSpace};
          });
          assert.ok(geometry.height >= 44);
          assert.ok(geometry.gap >= 7.9);
          assert.ok(geometry.centers < 1);
          assert.equal(geometry.iconWidth,16);
          assert.equal(geometry.whiteSpace,'nowrap');
        }
        const active = nav.locator('[aria-current="page"]');
        assert.deepEqual(await active.evaluate(el => ({color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor})),{color:'rgb(255, 255, 255)',bg:'rgb(24, 114, 92)'});
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (path !== '/homestay') {
          await page.getByText('Đang kiểm tra phiên…',{exact:true}).waitFor({state:'hidden'});
          const permitted = role === 'HOST' || (role === 'TENANT' && path === '/bookings');
          if (permitted) await page.getByText('0 đơn đặt phòng',{exact:true}).waitFor();
          else await page.getByText('Cần đăng nhập bằng tài khoản có quyền phù hợp.',{exact:true}).waitFor();
        }
        // Tab order stays intact; visual focus scrolls the off-screen item into view.
        await links.nth(0).focus();
        await page.keyboard.press('Tab');
        assert.ok(await links.nth(1).evaluate(el => el === document.activeElement));
        await page.keyboard.press('Tab');
        assert.ok(await links.nth(2).evaluate(el => el === document.activeElement));
        const focusedBounds=await links.nth(2).evaluate(el=>{const a=el.getBoundingClientRect(),n=el.closest('nav').getBoundingClientRect();return {left:a.left,right:a.right,navLeft:n.left,navRight:n.right,scrollLeft:el.closest('nav').scrollLeft,scrollWidth:el.closest('nav').scrollWidth,clientWidth:el.closest('nav').clientWidth};});
        assert.ok(focusedBounds.left>=focusedBounds.navLeft-1 && focusedBounds.right<=focusedBounds.navRight+1,JSON.stringify({role,width,path,...focusedBounds}));
        if (role === 'HOST' && evidence) {
          await active.focus();
          await active.evaluate(el=>el.scrollIntoView({block:'nearest',inline:'nearest'}));
          await active.evaluate(el=>el.blur());
          await page.evaluate(() => window.scrollTo(0,0));
          await page.screenshot({path:`${evidence}/${path.replaceAll('/','-').slice(1)}-${width}.png`,fullPage:true});
        }
        cases++;
      }
      // Follow unchanged Link routes by keyboard, not a simulated router.
      const first=page.getByRole('navigation',{name:'Đặt phòng',exact:true}).getByRole('link',{name:'Tìm homestay',exact:true});
      await first.focus(); await page.keyboard.press('Enter');
      await page.waitForURL(app.baseUrl+'/homestay');
      await page.close();
    }
  }
  console.log(`PASS ${cases} page/viewport/role cases: active/spacing/icons/touch/overflow/Tab/Enter; six screenshots. Fixture transport, not live DB/auth acceptance.`);
} finally { await browser?.close(); await app.close(); }
