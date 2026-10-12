// Reads real local API data. Never writes users, bookings or listing state.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[3]||'playwright');
const base=process.argv[2]||'http://localhost:3000';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local UI checks only');
const before=process.argv[4]==='before', evidence=process.env.BROWSER_EVIDENCE_DIR||'../.tmp/home-demo-sync-20261005';
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
try{
  for(const width of [1440,375]){
    const page=await browser.newPage({viewport:{width,height:1000}});
    await page.goto(base);await page.getByRole('heading',{name:'Tìm phòng trọ và homestay',exact:true}).waitFor();
    if(!before){
      const cards=page.locator('main a[href*="/demo-local-trotot-"]');await cards.first().waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('main a[href*="/demo-local-trotot-"]').length===8);
      assert.equal(await cards.count(),8);
      assert.equal(await page.locator('main a[href^="/phong-tro/"]').count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      // Full-page screenshots do not trigger offscreen lazy images themselves.
      for(const image of await cards.locator('img').all()){
        await image.scrollIntoViewIfNeeded();await image.evaluate(img=>new Promise(resolve=>{
          if(img.complete)return resolve();img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,10000);
        }));
      }
      await page.evaluate(()=>window.scrollTo(0,0));
    }
    await page.screenshot({path:`${evidence}/${before?'before':'after'}-${width}.png`,fullPage:true});
    if(!before){
      await page.locator('main a[href^="/thue-phong-tro/demo-local-"]').first().click();
      await page.getByRole('heading',{level:1}).waitFor();
      assert.equal((await page.locator('main').innerText()).includes('[DEMO]'),false);
      assert.equal((await page.locator('main').innerText()).includes('Dữ liệu mẫu chỉ để kiểm thử local.'),false);
      await page.goto(base);await page.locator('main a[href^="/homestay/demo-local-"]').first().click();
      await page.getByRole('heading',{level:1}).waitFor();
      assert.equal((await page.locator('main').innerText()).includes('[DEMO]'),false);
      await page.getByText('Phòng mẫu',{exact:false}).first().waitFor();
      await page.goto(base);await page.getByRole('button',{name:'Tìm phòng',exact:true}).click();
      await page.waitForURL('**/thue-phong-tro?*');
      const found=page.locator('main a[href^="/thue-phong-tro/demo-local-"]');
      await found.first().waitFor();assert.equal(await found.count(),3);
      await page.goto(base);await page.getByRole('button',{name:'Homestay',exact:true}).click();
      await page.getByLabel('Điểm đến',{exact:true}).fill('Studio');
      await page.getByRole('button',{name:'Tìm homestay',exact:true}).click();
      await page.waitForURL('**/homestay?*');
      assert.equal(new URL(page.url()).searchParams.get('q'),'Studio');
      await page.getByRole('textbox',{name:'Tên homestay hoặc địa chỉ',exact:true}).waitFor();
      assert.equal(await page.getByRole('textbox',{name:'Tên homestay hoặc địa chỉ',exact:true}).inputValue(),'Studio');
      await page.locator('a[href^="/homestay/demo-local-"]').first().waitFor();
      console.log(`PASS live local home/cards/details/search at ${width}px`);
    }
    await page.close();
  }
  if(!before){
    const page=await browser.newPage({viewport:{width:375,height:1000}});
    let fail=true;
    await page.route('**/api/listings/properties/long-term/search?*',route=>fail?route.fulfill({status:503,json:{success:false,message:'Lỗi API kiểm thử'}}):route.continue());
    await page.goto(base);
    await page.getByRole('alert').filter({hasText:'Chưa tải được danh sách'}).waitFor();
    assert.equal(await page.locator('main a[href^="/thue-phong-tro/demo-local-"]').count(),0);
    fail=false;await page.getByRole('button',{name:'Thử lại',exact:true}).click();
    await page.locator('main a[href^="/thue-phong-tro/demo-local-"]').first().waitFor();
    await page.close();
    const empty=await browser.newPage({viewport:{width:375,height:1000}});
    let release;const gate=new Promise(resolve=>{release=resolve;});
    for(const pattern of ['**/api/listings/properties/long-term/search?*','**/api/listings/homestays/search?*']){
      await empty.route(pattern,async route=>{await gate;await route.fulfill({json:{success:true,data:[],meta:{page:1,limit:4,total:0,totalPages:0}}});});
    }
    await empty.goto(base);await empty.getByRole('status').filter({hasText:'Đang tải phòng trọ'}).waitFor();
    assert.equal(await empty.getByText('Chưa có tin đang hiển thị ở mục này.',{exact:true}).count(),0);
    release();await empty.getByText('Chưa có tin đang hiển thị ở mục này.',{exact:true}).first().waitFor();
    await empty.waitForFunction(()=>Array.from(document.querySelectorAll('main p')).filter(p=>p.textContent==='Chưa có tin đang hiển thị ở mục này.').length===2);
    assert.equal(await empty.locator('main a[href*="/demo-local-trotot-"]').count(),0);
    await empty.close();
    const stress=await browser.newPage({viewport:{width:375,height:1000}});
    await stress.route('**/api/listings/homestays/search?*',async route=>{
      const response=await route.fetch();const body=await response.json();
      body.data[0].title='[DEMO] '+ 'Tên homestay rất dài '.repeat(12);body.data[0].basePricePerNight=0;
      await route.fulfill({response,json:body});
    });
    await stress.goto(base);await stress.getByRole('heading',{level:3}).filter({hasText:'Tên homestay rất dài'}).waitFor();
    assert.equal(await stress.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await stress.close();
    console.log('PASS API-error/retry + loading/empty/no-fake-fallback + long-title/zero-price UI fixtures (no DB writes)');
  }
}finally{await browser.close();}
