// Isolated frontend/HTTP fixtures only. No application accounts, DB writes or source tile traffic.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureFrontend} from './fixture-frontend.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=resolve('../.tmp/nearby-ui-20261010');await mkdir(out,{recursive:true});
const point={latitude:10.7725,longitude:106.6578};
const dangerous='<img src=x onerror="window.__nearbyXss=1"> Địa điểm kiểm thử với tên rất dài để kiểm tra xuống dòng trên màn hình điện thoại';
const item=(n)=>({id:`test-${n}`,name:n===1?dangerous:`Địa điểm fixture ${n}`,point:{latitude:point.latitude+n*0.001,longitude:point.longitude},distanceMeters:n*100,category:'MARKETS',source:'OSM',representativeMethod:'OSM_POINT'});
const snapshot={propertyId:'isolated',rentalMode:'LONG_TERM',status:'READY',center:point,stale:false,updatedAt:'2026-10-01T00:00:00Z',snapshotVersion:'snapshot.0',datasetVersion:'fixture',distanceMethod:'GEODESIC',
 attribution:{label:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright'},groups:[{code:'MARKETS',label:'Chợ và siêu thị',radiusMeters:2000,items:[1,2,3,4,5].map(item),total:8,hasMore:true,truncated:false},
 {code:'GROCERIES',label:'Tạp hóa',radiusMeters:1000,items:[],total:0,hasMore:false,truncated:false}]};
const room={id:'isolated',title:'Fixture Nearby — không phải tin thật',slug:'nearby-fixture',addressDetail:'Địa chỉ test',monthlyPrice:3500000,depositAmount:3500000,areaSqm:25,electricityCost:0,waterCost:0,waterUnit:'M3',internetCost:0,garbageCost:0,parkingFee:0,images:[],amenities:[],isAvailable:true,host:{fullName:'Host fixture'},description:'Fixture dùng để kiểm thử UI, không phải dữ liệu ứng dụng.'};
let current=snapshot;const fixture=await fixtureFrontend('.',()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}),()=>room,()=>current);
const browser=await chromium.launch({channel:'msedge'});
const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=','base64');
try{
 for(const width of [375,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('**://*.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:transparent}));
  await page.route('**/api/listings/properties/*/cost-estimate*',route=>route.fulfill({status:503,json:{success:false,errorCode:'TEST_ONLY',message:'Fixture không có bảng giá.'}}));
  current=snapshot;await page.goto(`${fixture.baseUrl}/thue-phong-tro/nearby-fixture`);
  const section=page.locator('section').filter({has:page.getByRole('heading',{name:'Khu vực xung quanh',exact:true})});
  await section.scrollIntoViewIfNeeded();await section.getByRole('button',{name:dangerous,exact:false}).waitFor();
  await page.waitForTimeout(700);assert.equal(await section.locator('img[src="x"]').count(),0);assert.equal(await page.evaluate(()=>window.__nearbyXss),undefined);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await section.screenshot({path:resolve(out,`ready-${width}.png`)});
  await section.getByRole('tab',{name:'Chợ và siêu thị'}).focus();await page.keyboard.press('ArrowRight');
  await section.getByText('Chưa tìm thấy địa điểm thuộc nhóm này', {exact:false}).waitFor();await section.screenshot({path:resolve(out,`empty-${width}.png`)});
  await page.keyboard.press('Home');
  let release;const gate=new Promise(done=>{release=done;});let requested;const requestSeen=new Promise(done=>{requested=done;});
  await page.route('**/api/listings/properties/*/nearby?*',async route=>{
   const url=new URL(route.request().url());if(url.searchParams.has('group')){requested();await gate;}
   return route.fulfill({json:{success:true,data:url.searchParams.has('group')?{...snapshot,groups:[{...snapshot.groups[0],items:[6,7,8].map(item),hasMore:false}]}:snapshot}});
  });
  await section.getByRole('button',{name:'Xem thêm địa điểm'}).click();await requestSeen;
  await section.getByRole('tab',{name:'Tạp hóa'}).click();release();await page.waitForTimeout(500);
  assert.equal(await section.getByRole('tab',{name:'Tạp hóa'}).getAttribute('aria-selected'),'true');
  assert.equal(await section.getByText('Địa điểm fixture 8').count(),0);
  await section.getByRole('tab',{name:'Chợ và siêu thị'}).click();await section.getByText('Địa điểm fixture 8').waitFor();assert.equal(await section.getByRole('button',{name:'Xem thêm địa điểm'}).count(),0);
  await section.screenshot({path:resolve(out,`expanded-${width}.png`)});
  current={...snapshot,stale:true};await page.reload();await section.scrollIntoViewIfNeeded();await section.getByText('Dữ liệu cũ — cập nhật gần nhất',{exact:false}).waitFor();await section.screenshot({path:resolve(out,`stale-${width}.png`)});
  await page.unroute('**://*.openstreetmap.org/**');await page.route('**://*.openstreetmap.org/**',route=>route.abort());await page.reload();await section.scrollIntoViewIfNeeded();await section.getByText('Chưa tải được bản đồ.',{exact:false}).waitFor();
  assert.ok(await section.getByRole('button',{name:dangerous,exact:false}).isVisible());await section.screenshot({path:resolve(out,`tile-error-${width}.png`)});
  current={...snapshot,status:'UNAVAILABLE',groups:[]};await page.reload();await section.scrollIntoViewIfNeeded();await section.getByText('Chưa có dữ liệu khu vực.',{exact:true}).waitFor();await section.screenshot({path:resolve(out,`unavailable-${width}.png`)});
  current=undefined;await page.unroute('**/api/listings/properties/*/nearby?*');
  let fail=true;await page.route('**/api/listings/properties/*/nearby?*',route=>route.fulfill(fail?{status:503,json:{success:false,errorCode:'TEST_FAILURE',message:'Không tải được dữ liệu khu vực fixture.'}}:{json:{success:true,data:snapshot}}));
  await page.reload();await section.scrollIntoViewIfNeeded();await section.getByRole('alert').filter({hasText:'Không tải được dữ liệu khu vực fixture.'}).waitFor();
  await section.screenshot({path:resolve(out,`api-error-${width}.png`)});fail=false;await section.getByRole('button',{name:'Thử lại',exact:true}).click();
  await section.getByRole('button',{name:dangerous,exact:false}).waitFor();assert.equal(await section.getByRole('alert').count(),0);
  await page.close();
 }
 console.log('Nearby UI PASS: 375/1440, long unsafe names escaped, no overflow, keyboard tabs, pagination, late page cannot change selected group, stale, tile failure, unavailable, API error/retry. Fixtures only.');
}finally{await browser.close();await fixture.close();}
