// Synthetic Auth/catalog/GPS; no save and no DB writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fixtureFrontend} from './fixture-frontend.mjs';
const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const app=await fixtureFrontend(process.argv[2],()=>({success:true,data:[],meta:{page:1,total:0,totalPages:0}}));
const out=process.env.BROWSER_EVIDENCE_DIR;if(out)await mkdir(out,{recursive:true});
const ok=data=>({success:true,data});
const user={id:'00000000-0000-4000-8000-000000000001',fullName:'Synthetic Host',phone:'0990000000',role:'HOST',status:'ACTIVE',isPhoneVerified:true};
let browser,checks=0;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge'});
  for(const width of [375,768,1440]){
    const page=await browser.newPage({viewport:{width,height:1000}});
    await page.route('**/api/auth/refresh',r=>r.fulfill({json:ok({user,accessToken:'fixture-only-token'})}));
    await page.route('**/api/auth/me',r=>r.fulfill({json:ok(user)}));
    await page.route('**/api/management/conversations/unread',r=>r.fulfill({json:ok({totalUnread:0,conversations:[]})}));
    await page.route('**/api/listings/catalog/provinces',r=>r.fulfill({json:ok({version:'fixture',items:[{code:'79',name:'Thành phố Hồ Chí Minh'}]})}));
    await page.route('**/api/listings/catalog/wards?*',r=>r.fulfill({json:ok({version:'fixture',items:[{code:'26740',name:'Phường kiểm thử',provinceCode:'79'}]})}));
    await page.route('**/api/listings/amenities',r=>r.fulfill({json:ok([])}));
    await page.route('**/api/listing-location',r=>r.fulfill({status:503,json:{success:false,errorCode:'GEOCODING_NOT_CONFIGURED',message:'Chưa kết nối dịch vụ tìm địa chỉ.'}}));
    await page.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef2ed"/></svg>'}));
    await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){ok({coords:{latitude:10.7725,longitude:106.6578}});}}}));
    await page.goto(app.baseUrl+'/host/properties/create');
    await page.locator('[name="title"]').fill('Phòng kiểm thử giao diện');await page.locator('textarea[name="description"]').fill('Dữ liệu fixture.');
    const choose=async(label,name)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:true}).click();await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,label);};
    await choose('Tỉnh/thành phố','Thành phố Hồ Chí Minh');await choose('Phường/xã','Phường kiểm thử');
    await page.locator('[name="addressDetail"]').fill('24 Đường kiểm thử');
    await page.getByRole('region',{name:'Bản đồ chọn vị trí phòng'}).locator('.leaflet-pane').first().waitFor({state:'attached'});
    await page.getByRole('button',{name:'Dùng vị trí hiện tại',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã dùng vị trí hiện tại'}).waitFor();
    await page.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();await page.locator('[name="monthlyPrice"]').waitFor({state:'visible'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
    const a=await page.locator('[name="electricityCost"]').boundingBox(),b=await page.locator('[name="waterCost"]').boundingBox();assert.ok(Math.abs(a.width-b.width)<2);checks++;
    for(const field of ['electricityCost','waterCost','internetCost','garbageCost','parkingFee']){
      const input=page.locator(`[name="${field}"]`);assert.equal(await input.inputValue(),'');assert.equal(await input.evaluate(el=>el.validity.valueMissing),true);checks++;
      const button=input.locator('xpath=ancestor::div[contains(@class,"min-w-0")]').getByRole('button');assert.equal(await button.evaluate(el=>getComputedStyle(el).fontSize),'12px');assert.ok((await button.boundingBox()).height>=44);checks++;
      await button.click();assert.equal(await input.inputValue(),'0');assert.equal(await input.evaluate(el=>el.validity.valid),true);checks++;
    }
    await page.evaluate(()=>scrollTo(0,0));if(out)await page.screenshot({path:`${out}/fees-${width}.png`,fullPage:true});
    await page.close();
  }
  console.log(`PASS ${checks} fee UI checks at 375/768/1440: equal water/electricity widths, 12px labels, 44px targets, blank required vs explicit zero and no horizontal overflow. Fixtures only.`);
}finally{await browser?.close();await app.close();}
