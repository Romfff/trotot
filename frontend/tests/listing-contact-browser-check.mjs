// UI/transport fixtures only: no real session, DB writes, GPS, or provider calls.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fixtureFrontend} from './fixture-frontend.mjs';

const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const app=await fixtureFrontend(process.argv[2],()=>({success:true,data:[]}));
const evidence=process.argv[4]||'../.tmp/listing-contact-copy';
await mkdir(evidence,{recursive:true});
const id='00000000-0000-4000-8000-000000000002';
const user={id:'00000000-0000-4000-8000-000000000001',fullName:'Chủ nhà kiểm thử',role:'HOST',status:'ACTIVE',isPhoneVerified:true};
const prices={monthlyPrice:'3500000',depositAmount:'0',areaSqm:'25',electricityCost:'3500.5',waterCost:'20000',internetCost:'0',garbageCost:'0',parkingFee:'0'};
const record={id,slug:'fixture',version:1,title:'Phòng kiểm thử',description:'Dữ liệu kiểm thử giao diện, không ghi vào DB.',propertyType:'PHONG_TRO',status:'PENDING_REVIEW',isAvailable:true,provinceCode:'79',wardCode:'26740',addressDetail:'24 Đường kiểm thử',latitude:10.773333,longitude:106.658889,videoUrl:null,images:[],amenities:[],revision:null,longTermDetail:{...prices,waterUnit:'M3',allowPets:false,contactPhone:'0990000000'}};
let browser;let cases=0;
try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const width of [375,1440]) for(const mode of ['create','edit']) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    const page=await context.newPage();let submitted;let saves=0;
    await context.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef2ed"/></svg>'}));
    await context.route('https://fonts.googleapis.com/**',r=>r.abort());
    await context.route('https://fonts.gstatic.com/**',r=>r.abort());
    await context.route('**/api/auth/refresh',r=>r.fulfill({json:{success:true,data:{user,accessToken:'fixture-only'}}}));
    await context.route('**/api/auth/me',r=>r.fulfill({json:{success:true,data:user}}));
    await context.route('**/api/listings/catalog/provinces',r=>r.fulfill({json:{success:true,data:{items:[{code:'79',name:'Thành phố Hồ Chí Minh'}]}}}));
    await context.route('**/api/listings/catalog/wards?*',r=>r.fulfill({json:{success:true,data:{items:[{code:'26740',name:'Phường kiểm thử',provinceCode:'79'}]}}}));
    await context.route('**/api/listings/amenities',r=>r.fulfill({json:{success:true,data:[]}}));
    await context.route('**/api/listing-location',r=>r.fulfill({status:503,json:{success:false,message:'Chưa kết nối dịch vụ',errorCode:'GEOCODER_NOT_CONFIGURED'}}));
    await context.route('**/api/management/**',r=>{
      if(r.request().method()==='GET') return r.fulfill({json:{success:true,data:new URL(r.request().url()).pathname.endsWith(`/host/properties/${id}`)?record:[],meta:{page:1,total:0,totalPages:0}}});
      submitted=r.request().postDataJSON();saves++;
      return r.fulfill({status:400,json:{success:false,message:'Dữ liệu gửi lên không hợp lệ.',errors:['contactPhone','contactZalo'].map(field=>({field,message:`${field} must match /^\\+?[0-9]{9,15}$/ regular expression`}))}});
    });
    await page.goto(app.baseUrl+(mode==='create'?'/host/properties/create':`/host/properties/${id}/edit`));
    await page.locator('[name="title"]').waitFor();
    await page.getByRole('region',{name:'Bản đồ chọn vị trí phòng'}).locator('.leaflet-pane').first().waitFor({state:'attached'});
    if(mode==='create') {
      await page.locator('[name="title"]').fill(record.title);
      await page.locator('textarea[name="description"]').fill(record.description);
      for(const [label,name] of [['Tỉnh/thành phố','Thành phố Hồ Chí Minh'],['Phường/xã','Phường kiểm thử']]) {
        await page.getByRole('combobox',{name:label,exact:true}).click();
        await page.getByRole('option',{name,exact:true}).click();
        await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,label);
      }
      await page.locator('[name="addressDetail"]').fill(record.addressDetail);
    }
    await page.evaluate(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){ok({coords:{latitude:10.773333,longitude:106.658889}});}}}));
    await page.getByRole('button',{name:'Dùng vị trí hiện tại',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Đã dùng vị trí hiện tại'}).waitFor();
    await page.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();
    await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
    for(const [name,value] of Object.entries(prices)) await page.locator(`[name="${name}"]`).fill(value);
    await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
    await page.locator('[name="contactPhone"]').fill('abc');
    await page.locator('[name="contactZalo"]').fill('xyz');
    await page.getByRole('button',{name:mode==='edit'?'Gửi bản sửa để duyệt':'Gửi tin để duyệt',exact:true}).click();
    await page.locator('#contactPhone-help').waitFor();
    assert.equal(await page.locator('#contactPhone-help').innerText(),'Số điện thoại liên hệ không hợp lệ. Nhập 9–15 chữ số, có thể thêm + ở đầu.');
    assert.equal(await page.locator('#contactZalo-help').innerText(),'Số Zalo không hợp lệ. Nhập 9–15 chữ số, có thể thêm + ở đầu.');
    assert.equal(await page.getByText(/regular expression/).count(),0);
    assert.equal(await page.locator('[name="contactPhone"]').inputValue(),'abc');
    assert.equal(await page.locator('[name="contactZalo"]').inputValue(),'xyz');
    assert.equal(await page.locator('[name="contactPhone"]').getAttribute('aria-describedby'),'contactPhone-help');
    assert.equal(await page.locator('[name="contactPhone"]').getAttribute('aria-invalid'),'true');
    assert.equal(saves,1);assert.equal(submitted.contactPhone,'abc');assert.equal(submitted.contactZalo,'xyz');
    assert.equal(submitted.expectedVersion,mode==='edit'?1:undefined);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('[name="contactPhone"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${evidence}/${mode}-${width}.png`,fullPage:true});
    cases++;await context.close();
  }
  console.log(JSON.stringify({result:'PASS',cases,widths:[375,1440],scope:'Browser UI with mocked API errors; no DB writes'}));
} finally {await browser?.close();await app.close();}
