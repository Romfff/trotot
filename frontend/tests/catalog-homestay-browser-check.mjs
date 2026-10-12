// Browser regressions P01/P02. API/tile fixtures, homestay demo, no application DB writes.
import assert from 'node:assert/strict';
import { fixtureFrontend } from './fixture-frontend.mjs';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[3] || 'playwright');
const fixtureApp = await fixtureFrontend(process.argv[2],()=>({success:true,message:'SSR empty search fixture',data:[],meta:{page:1,limit:20,total:0,totalPages:0}}));
const base = fixtureApp.baseUrl;
const only = process.argv[4];
const evidence = process.env.BROWSER_EVIDENCE_DIR;
if (evidence) await mkdir(evidence,{recursive:true});
let browser;
try {
  browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined});
  if (!only || only === 'catalog') {
    for (const width of [1440,375,768,2560]) {
      for (const failure of [503,429,'network']) {
        const page = await browser.newPage({viewport:{width,height:1000}});
        let mode = failure; let catalogs = 0; let searches = 0;
        let releaseLoading;
        const loadingGate = new Promise(resolve => { releaseLoading = resolve; });
        await page.route('https://tile.openstreetmap.org/**', r => r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
        await page.route('**/api/listings/amenities', async r => {
          catalogs++;
          await loadingGate;
          if (mode === 'network') return r.abort('failed');
          if (typeof mode === 'number') return r.fulfill({status:mode,json:{success:false,errorCode:'TEST_CATALOG_FAILURE',message:'Fixture catalog failure'}});
          return r.fulfill({json:{success:true,data:mode === 'empty' ? [] : [{id:'wifi',name:'Wi-Fi'},{id:'air_cond',name:'Máy lạnh'}]}});
        });
        await page.route('**/api/listings/properties/long-term/search?*', r => {
          searches++; assert.equal(new URL(r.request().url()).searchParams.get('amenities'),'wifi,air_cond');
          return r.fulfill({json:{success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}});
        });
        const initial = `${base}/thue-phong-tro?amenities=wifi,air_cond&maxPrice=3000000`;
        await page.goto(initial);
        await page.getByRole('button',{name:width<1024?'Bộ lọc':/^Tiện ích/,exact:width<1024}).click();
        await page.getByRole('status').filter({hasText:'Đang tải tiện ích'}).waitFor();
        releaseLoading();
        await page.getByRole('alert').filter({hasText:'Chưa thể tải tiện ích'}).waitFor({timeout:20000});
        if (evidence && failure===503) await page.screenshot({path:`${evidence}/p01-${width}.png`,fullPage:true});
        const url = page.url(); const searchCount = searches; const attempts = catalogs;
        assert.equal(new URL(url).searchParams.get('amenities'),'wifi,air_cond');
        mode = 'empty';
        await page.getByRole('button',{name:'Thử tải lại tiện ích',exact:true}).click();
        await page.getByText('Chưa có tiện ích trong danh mục.',{exact:true}).waitFor();
        assert.equal(page.url(),url); assert.equal(searches,searchCount); assert.equal(catalogs,attempts+1);
        await page.reload();
        await page.getByRole('button',{name:width<1024?'Bộ lọc':/^Tiện ích/,exact:width<1024}).click();
        await page.getByText('Chưa có tiện ích trong danh mục.',{exact:true}).waitFor();
        mode = failure; await page.reload();
        await page.getByRole('button',{name:width<1024?'Bộ lọc':/^Tiện ích/,exact:width<1024}).click();
        await page.getByRole('alert').filter({hasText:'Chưa thể tải tiện ích'}).waitFor({timeout:20000});
        mode = 'ok';
        await page.getByRole('button',{name:'Thử tải lại tiện ích',exact:true}).click();
        await page.getByRole('button',{name:'Wi-Fi',exact:true}).waitFor();
        assert.equal(await page.getByRole('button',{name:'Wi-Fi',exact:true}).getAttribute('aria-pressed'),'true');
        assert.equal(await page.getByRole('button',{name:'Máy lạnh',exact:true}).getAttribute('aria-pressed'),'true');
        assert.equal(page.url(),url);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth));
        await page.close();
      }
    }
    console.log('P01 PASS: 503/429/network, empty200, retry200, selection/URL/search unchanged, desktop/mobile.');
  }
  if (!only || only === 'homestay') {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    let mode='error';let lastQuery;
    await page.route('**/api/listings/homestays/search?*',route=>{
      lastQuery=new URL(route.request().url()).searchParams;
      return route.fulfill({status:mode==='error'?503:200,json:mode==='error'
        ?{success:false,errorCode:'TEST_SEARCH_FAILURE',message:'Fixture search unavailable'}
        :{success:true,data:[],meta:{page:1,limit:10,total:0,totalPages:0}}});
    });
    await page.goto(base+'/homestay');
    await page.getByRole('alert').filter({hasText:'Fixture search unavailable'}).waitFor();
    await page.getByLabel('Tên homestay hoặc địa chỉ',{exact:true}).fill('Synthetic destination');
    await page.getByLabel('Nhận phòng',{exact:true}).fill('2027-12-20');
    await page.getByLabel('Trả phòng',{exact:true}).fill('2027-12-22');
    await page.getByLabel('Người lớn',{exact:true}).fill('2');
    await page.getByLabel('Trẻ em',{exact:true}).fill('1');
    mode='empty';await page.getByRole('button',{name:'Tìm phòng',exact:true}).click();
    await page.getByText('Không có phòng phù hợp.',{exact:false}).waitFor();
    assert.equal(lastQuery.get('q'),'Synthetic destination');assert.equal(lastQuery.get('checkIn'),'2027-12-20');
    assert.equal(lastQuery.get('checkOut'),'2027-12-22');assert.equal(lastQuery.get('adults'),'2');assert.equal(lastQuery.get('children'),'1');
    assert.equal(await page.getByLabel('Tên homestay hoặc địa chỉ',{exact:true}).inputValue(),'Synthetic destination');
    assert.equal(await page.getByLabel('Nhận phòng',{exact:true}).inputValue(),'2027-12-20');
    for(const width of [375,768,1440,2560]) {
      await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(evidence)await page.screenshot({path:`${evidence}/p02-live-empty-${width}.png`,fullPage:true});
    }
    await page.getByRole('button',{name:'Xóa lọc',exact:true}).click();
    assert.equal(await page.getByLabel('Tên homestay hoặc địa chỉ',{exact:true}).inputValue(),'');
    assert.equal(lastQuery.has('checkIn'),false);
    console.log('P02 live PASS: error/empty/search/clear, actual API field names and widths375–2560. API fixtures only; real booking UI has its separate backend integration runner.');
    await page.close();
  }
} finally { await browser?.close(); await fixtureApp.close(); }
