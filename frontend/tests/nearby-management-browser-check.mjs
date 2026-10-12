// Production UI against isolated HTTP fixtures; not a server authorization or real-account test.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureFrontend} from './fixture-frontend.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[2]||'C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=resolve('../.tmp/nearby-ui-20261010');await mkdir(out,{recursive:true});
const id='00000000-0000-4000-8000-000000000001';
const place={id:'00000000-0000-4000-8000-000000000002',name:'Nhà ga fixture — tên dài kiểm tra bố cục, không phải địa điểm thật',point:{latitude:10.78,longitude:106.66},distanceMeters:144,category:'TRANSPORT',source:'OSM',representativeMethod:'OSM_POINT'};
const snapshot={propertyId:id,rentalMode:'SHORT_TERM',status:'READY',center:{latitude:10.7725,longitude:106.6578},stale:false,updatedAt:'2026-10-01T00:00:00Z',snapshotVersion:'fixture.0',datasetVersion:'fixture',distanceMethod:'GEODESIC',attribution:{label:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright'},groups:[{code:'TRANSPORT',label:'Nhà ga',radiusMeters:5000,items:[place],total:1,hasMore:false,truncated:false}]};
const fixture=await fixtureFrontend('.',()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}),undefined,()=>snapshot);
const browser=await chromium.launch({channel:'msedge'});
const transparent=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=','base64');
const envelope=data=>({success:true,data});
try{
 for(const width of [375,1440]){
  const page=await browser.newPage({viewport:{width,height:1000}});
  await page.route('**://*.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:transparent}));
  await page.route('**/api/listings/homestays/**',route=>{
   const path=new URL(route.request().url()).pathname;
   const data=path.endsWith('/calendar')?{unitId:id,month:'2026-10',days:[]}:{id,slug:'nearby-fixture',title:'Homestay fixture — không phải tin thật',description:'Chỉ dùng kiểm thử.',address:{addressDetail:'Địa chỉ fixture',wardName:'Phường fixture'},amenities:[],media:[],units:[{id,unitName:'Phòng fixture',maxAdults:2,maxChildren:0,maxGuests:2,maxNights:30,instantBook:false,bedrooms:1,bathrooms:1,checkInTime:'14:00:00',checkOutTime:'12:00:00',cancellationPolicy:'FLEXIBLE',basePricePerNight:1,cleaningFee:0}]};
   return route.fulfill({json:envelope(data)});
  });
  await page.route('**/api/listings/properties/*/reviews*',route=>route.fulfill({json:{...envelope([]),meta:{page:1,limit:10,total:0,totalPages:0}}}));
  await page.goto(`${fixture.baseUrl}/homestay/nearby-fixture`);
  const section=page.locator('section').filter({has:page.getByRole('heading',{name:'Khu vực xung quanh',exact:true})});
  await section.scrollIntoViewIfNeeded();await section.getByRole('button',{name:place.name,exact:false}).waitFor();
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex, nofollow');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await section.screenshot({path:resolve(out,`homestay-${width}.png`)});
  await page.close();

  const admin=await browser.newPage({viewport:{width,height:1000}});
  const user={id:'00000000-0000-4000-8000-000000000003',fullName:'Admin fixture',phone:'0900000000',role:'ADMIN',status:'ACTIVE',isPhoneVerified:true};
  await admin.route('**/api/auth/refresh',route=>route.fulfill({json:envelope({accessToken:'isolated-fixture-not-a-valid-token',user})}));
  await admin.route('**/api/auth/me',route=>route.fulfill({json:envelope(user)}));
  let row={item:place,groupCode:'TRANSPORT',hidden:false,reason:null,version:0};let fail=false;let conflict=false;const writes=[];
  await admin.route('**/api/management/admin/properties/**',route=>{
   if(route.request().method()==='GET')return route.fulfill({json:envelope([row])});
   const body=route.request().postDataJSON();writes.push({body,key:route.request().headers()['idempotency-key']});
   if(fail)return route.fulfill({status:503,json:{success:false,errorCode:'TEST_FAILURE',message:'Lỗi mạng fixture, dữ liệu chưa lưu.'}});
   if(conflict){row={...row,version:row.version+1,hidden:false};return route.fulfill({status:409,json:{success:false,errorCode:'STALE_NEARBY_VISIBILITY',message:'Mục này đã đổi. Vui lòng tải lại.'}});}
   row={...row,hidden:body.hidden,reason:body.reason,version:row.version+1};return route.fulfill({json:envelope({id:place.id,...body,version:row.version})});
  });
  await admin.goto(`${fixture.baseUrl}/admin/properties/${id}/nearby`);
  await admin.getByRole('button',{name:'Ẩn mục sai',exact:true}).waitFor();
  await admin.getByRole('button',{name:'Ẩn mục sai',exact:true}).click();
  const reason=admin.getByRole('textbox',{name:'Lý do ẩn hoặc hiện địa điểm'});
  await reason.fill('  Địa điểm fixture sai vị trí  ');fail=true;
  await admin.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();await admin.getByRole('alert').filter({hasText:'Lỗi mạng fixture'}).waitFor();
  assert.equal(await reason.inputValue(),'  Địa điểm fixture sai vị trí  ');assert.equal(await admin.getByRole('button',{name:'Hiện lại',exact:true}).count(),0);
  fail=false;await admin.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();await admin.getByRole('button',{name:'Hiện lại',exact:true}).waitFor();
  assert.equal(writes[0].key,writes[1].key);assert.equal(writes[1].body.reason,'Địa điểm fixture sai vị trí');
  assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await admin.screenshot({path:resolve(out,`admin-hidden-${width}.png`),fullPage:true});
  await admin.getByRole('button',{name:'Hiện lại',exact:true}).click();await reason.fill('Fixture xác minh lại');conflict=true;
  await admin.getByRole('button',{name:'Lưu thay đổi',exact:true}).click();await admin.getByRole('alert').filter({hasText:'Mục này đã đổi'}).waitFor();
  await admin.getByRole('button',{name:'Ẩn mục sai',exact:true}).waitFor();assert.equal(await reason.count(),0);
  await admin.screenshot({path:resolve(out,`admin-conflict-${width}.png`),fullPage:true});
  await admin.close();
 }
 console.log('Nearby homestay/Admin UI PASS: 375/1440, noindex, no overflow, failed write retains input, retry key reused, server acknowledgement then refetch, conflict refetch. HTTP fixtures only.');
}finally{await browser.close();await fixture.close();}
