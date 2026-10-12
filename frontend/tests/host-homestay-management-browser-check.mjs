// Isolated HTTP/Auth/catalog/GPS fixtures. No DB writes or provider acceptance.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixtureFrontend} from './fixture-frontend.mjs';
const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const app=await fixtureFrontend(process.argv[2],()=>({success:true,data:[],meta:{page:1,total:0,totalPages:0}}));
const out=process.env.BROWSER_EVIDENCE_DIR; if(out)await mkdir(out,{recursive:true});
const id='00000000-0000-4000-8000-000000000001',unitId='00000000-0000-4000-8000-000000000002';
const ok=data=>({success:true,data});
const unit={id:unitId,version:3,status:'PUBLISHED',pendingRevision:null,unitName:'Phòng A',maxAdults:2,maxChildren:0,maxGuests:null,maxNights:90,bedrooms:1,bathrooms:1,
  basePricePerNight:'500000',weekendPricePerNight:null,cleaningFee:'0',checkInTime:'1970-01-01T14:00:00.000Z',checkOutTime:'1970-01-01T12:00:00.000Z',sameDayBookingCutoff:'1970-01-01T18:00:00.000Z',cancellationPolicy:'FLEXIBLE',instantBook:false};
const content={title:'Homestay đã duyệt',description:'Mô tả đã duyệt',propertyType:'HOMESTAY',addressDetail:'24 Đường kiểm thử',provinceCode:'79',wardCode:'26740',latitude:10.7725,longitude:106.6578,amenityIds:[],imageUrls:[],videoUrl:null};
const original={...content,id,slug:'synthetic-homestay',version:7,status:'PUBLISHED',homestayUnits:[unit],images:[],amenities:[],revision:null};
let browser,checks=0,probePrepare;
try{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge'});
  for(const width of [375,1440]){
    const page=await browser.newPage({viewport:{width,height:1000}});let role='HOST',record=structuredClone(original),mode='ok',writes=[],release;
    const user=()=>({id:'00000000-0000-4000-8000-000000000099',fullName:'Tài khoản kiểm thử',phone:'0990000000',role,status:'ACTIVE',isPhoneVerified:true});
    const prepare=async page=>{
    await page.route('**/api/auth/refresh',r=>r.fulfill({json:ok({user:user(),accessToken:'fixture-only-token'})}));
    await page.route('**/api/auth/me',r=>r.fulfill({json:ok(user())}));
    await page.route('**/api/management/conversations/unread',r=>r.fulfill({json:ok({totalUnread:0,conversations:[]})}));
    await page.route('**/api/listings/catalog/provinces',r=>r.fulfill({json:ok({version:'fixture',items:[{code:'79',name:'Thành phố Hồ Chí Minh'}]})}));
    await page.route('**/api/listings/catalog/wards?*',r=>r.fulfill({json:ok({version:'fixture',items:[{code:'26740',name:'Phường kiểm thử',provinceCode:'79'}]})}));
    await page.route('**/api/listings/amenities',r=>r.fulfill({json:ok([])}));
    await page.route('**/api/listing-location',r=>r.fulfill({status:503,json:{success:false,errorCode:'GEOCODING_NOT_CONFIGURED',message:'Chưa kết nối dịch vụ tìm địa chỉ.'}}));
    await page.route('https://tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef2ed"/></svg>'}));
    await page.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok){ok({coords:{latitude:10.77251234,longitude:106.65781234}});}}}));
    await page.route('**/api/management/**',async r=>{
      const path=new URL(r.request().url()).pathname.replace('/api/management','');
      if(path==='/conversations/unread')return r.fulfill({json:ok({totalUnread:0,conversations:[]})});
      if(!/^\/(host|admin)\/homestays/.test(path))return r.fulfill({status:404,json:{success:false,message:'No fixture for this route'}});
      if(r.request().method()==='GET')return r.fulfill({json:path===`/host/homestays`||path===`/admin/homestays`?{...ok([record]),meta:{page:1,total:1,totalPages:1}}:ok(record)});
      const body=r.request().postDataJSON();writes.push({path,method:r.request().method(),body});
      assert.equal(r.request().headers().authorization,'Bearer fixture-only-token');
      if(mode==='stale')return r.fulfill({status:409,json:{success:false,errorCode:'STALE_HOMESTAY_VERSION',message:'Phiên bản đã thay đổi. Tải lại nội dung.'}});
      if(mode==='error')return r.fulfill({status:503,json:{success:false,errorCode:'BACKEND_UNAVAILABLE',message:'Không thể kết nối máy chủ.'}});
      if(mode==='blocked-delete')return r.fulfill({status:409,json:{success:false,errorCode:'ACTIVE_BOOKINGS',message:'Còn đơn hiệu lực, chỉ được ẩn tin.'}});
      if(mode==='slow')await new Promise(done=>{release=done;});
      record={...record,version:record.version+1};
      if(path.endsWith('/hide'))record.status='HIDDEN';
      if(path.endsWith('/show'))record.status='PUBLISHED';
      if(path.endsWith('/approve'))record={...record,...record.revision?.content,revision:null};
      return r.fulfill({json:ok(record)});
    });
    };await prepare(page);
    const shot=async name=>{
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name}: no horizontal overflow ${width}`);checks++;
      if(out)await page.screenshot({path:`${out}/${name}-${width}.png`,fullPage:true});
    };
    const choose=async(label,name)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name,exact:true}).click();await page.waitForFunction(label=>document.activeElement?.getAttribute('aria-label')===label,label);};
    await page.goto(app.baseUrl+'/account');
    await page.getByRole('navigation',{name:'Đăng tin cho thuê',exact:true}).getByRole('link',{name:'Đăng homestay',exact:true}).waitFor();checks++;
    await shot('account-posting-entry');
    await page.goto(app.baseUrl+'/host/properties/create');
    const posting=page.getByRole('navigation',{name:'Chọn loại tin đăng',exact:true});
    await posting.getByRole('link',{name:'Trọ dài hạn',exact:true}).waitFor();
    assert.equal(await posting.getByRole('link',{name:'Trọ dài hạn',exact:true}).getAttribute('aria-current'),'page');checks++;
    await shot('posting-type-choice');
    await posting.getByRole('link',{name:'Homestay / Villa',exact:true}).focus();await page.keyboard.press('Enter');
    await page.waitForURL('**/host/homestays/create');
    assert.equal(await posting.getByRole('link',{name:'Homestay / Villa',exact:true}).getAttribute('aria-current'),'page');checks++;
    await page.getByLabel('Tên homestay',{exact:true}).fill('Homestay kiểm thử');
    await page.getByLabel('Mô tả',{exact:true}).fill('Mô tả kiểm thử, không gửi vào cơ sở dữ liệu.');
    await shot('create-unselected');
    assert.equal(await page.getByRole('combobox',{name:'Phường/xã',exact:true}).isDisabled(),true);checks++;
    await choose('Tỉnh/thành phố','Thành phố Hồ Chí Minh');await choose('Phường/xã','Phường kiểm thử');
    await page.locator('[name="addressDetail"]').fill('24 Đường kiểm thử');
    await page.getByRole('region',{name:'Bản đồ chọn vị trí phòng'}).locator('.leaflet-pane').first().waitFor({state:'attached'});
    await page.getByRole('button',{name:'Dùng vị trí hiện tại',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Đã dùng vị trí hiện tại'}).waitFor();
    await page.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();
    const fillUnit=async()=>{for(const [name,value] of Object.entries({unitName:'Phòng kiểm thử',maxAdults:'2',maxChildren:'0',maxNights:'90',bedrooms:'1',bathrooms:'1',basePricePerNight:'500000',cleaningFee:'0',checkInTime:'14:00:00',checkOutTime:'12:00:00'}))await page.locator(`[name="${name}"]`).fill(value);};
    await fillUnit();await shot('create-confirmed');
    mode='error';await page.getByRole('button',{name:'Gửi duyệt homestay',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Không thể kết nối máy chủ.'}).waitFor();
    assert.equal(await page.getByLabel('Tên homestay',{exact:true}).inputValue(),'Homestay kiểm thử');assert.equal(writes.length,1);checks++;
    const create=writes[0].body;assert.equal(create.wardCode,'26740');assert.equal(create.latitude,10.772512);assert.equal(create.longitude,106.657812);assert.equal(create.units[0].cleaningFee,0);assert.equal(create.units[0].weekendPricePerNight,null);assert.equal(create.units[0].checkInTime,'14:00:00');assert.ok(!('status' in create)&&!('districtCode' in create)&&!('commissionRate' in create.units[0]));checks++;
    mode='slow';await page.getByRole('button',{name:'Gửi duyệt homestay',exact:true}).evaluate(el=>{el.click();el.click();});
    await page.waitForFunction(()=>document.querySelector('button[aria-busy="true"]'));
    while(!release)await page.waitForTimeout(20);assert.equal(writes.length,2);checks++;release();
    await page.waitForURL('**/host/homestays');await page.getByRole('link',{name:'Quản lý homestay và phòng',exact:true}).waitFor();
    mode='ok';await page.goto(app.baseUrl+`/host/homestays/${id}`);await page.getByRole('button',{name:'Thêm phòng',exact:true}).waitFor();await shot('host-detail');
    await page.getByRole('button',{name:'Sửa phòng',exact:true}).click();await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('[name="checkInTime"]').inputValue(),'14:00:00');assert.equal(await page.locator('[name="weekendPricePerNight"]').inputValue(),'');checks++;
    await page.locator('[name="unitName"]').fill('Phòng sửa');await shot('unit-edit');
    mode='stale';await page.getByRole('button',{name:'Gửi duyệt phòng',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();
    assert.equal(await page.getByRole('button',{name:'Gửi duyệt phòng',exact:true}).isDisabled(),true);assert.equal(writes.at(-1).body.expectedVersion,3);assert.equal(writes.at(-1).method,'PUT');checks++;
    await page.getByRole('button',{name:'Quay lại',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    mode='ok';await page.getByRole('button',{name:'Thêm phòng',exact:true}).click();await fillUnit();
    await page.getByRole('button',{name:'Gửi duyệt phòng',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(writes.at(-1).method,'POST');assert.equal(writes.at(-1).body.expectedVersion,record.version-1);checks++;
    mode='blocked-delete';await page.getByRole('button',{name:'Xóa phòng',exact:true}).click();await page.getByRole('button',{name:'Xác nhận xóa',exact:true}).click();
    await page.getByRole('dialog').getByRole('alert').filter({hasText:'Còn đơn hiệu lực'}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.equal(writes.at(-1).body.expectedVersion,3);checks++;
    await page.getByRole('button',{name:'Giữ lại',exact:true}).click();mode='ok';await page.getByRole('button',{name:'Ẩn tin',exact:true}).click();await page.getByRole('button',{name:'Hiện tin',exact:true}).waitFor();checks++;
    record={...record,revision:{status:'PENDING_REVIEW',content:{...content,title:'Bản sửa chờ duyệt'}}};
    await page.goto(app.baseUrl+`/host/homestays/${id}/edit`);await page.getByLabel('Tên homestay',{exact:true}).waitFor();
    // The form renders before Leaflet's lazy import is ready; verify the enabled state after map initialization.
    await page.waitForFunction(()=>document.getElementById('listing-location-confirm')?.disabled===false);
    assert.equal(await page.getByLabel('Tên homestay',{exact:true}).inputValue(),'Bản sửa chờ duyệt');assert.equal(await page.locator('[name="latitude"]').inputValue(),'10.772500');assert.equal(await page.getByRole('button',{name:'Xác nhận vị trí',exact:true}).isDisabled(),false);checks++;
    mode='stale';await page.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();await page.getByRole('button',{name:'Gửi duyệt homestay',exact:true}).click();await page.getByRole('button',{name:'Tải lại nội dung mới nhất',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Gửi duyệt homestay',exact:true}).isDisabled(),true);checks++;
    role='ADMIN';mode='ok';record={...record,status:'PUBLISHED',homestayUnits:[{...unit,pendingRevision:{...unit,unitName:'Phòng sửa chờ duyệt'}}]};
    await page.goto(app.baseUrl+`/admin/homestays/${id}`);await page.getByRole('heading',{name:'Bản sửa chờ duyệt',exact:true}).waitFor();await page.getByRole('heading',{name:'Phòng sửa chờ duyệt',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Thêm phòng',exact:true}).count(),0);await shot('admin-review');
    await page.getByRole('button',{name:'Duyệt toàn bộ nội dung chờ',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã cập nhật homestay.'}).waitFor();assert.deepEqual(writes.at(-1).body,{expectedVersion:record.version-1});checks++;
    // A rejected property revision must not be shown as the content Admin is approving with a pending unit.
    record={...original,revision:{status:'REJECTED',content:{...content,title:'Bản sửa đã từ chối'}}};
    await page.reload();await page.getByRole('heading',{name:'Homestay đã duyệt',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Bản sửa đã từ chối',exact:true}).count(),0);checks++;
    role='TENANT';await page.goto(app.baseUrl+'/host/homestays/create');await page.getByRole('main').getByText('Chức năng này dành cho chủ nhà có tài khoản đang hoạt động.',{exact:true}).waitFor();assert.equal(await page.getByLabel('Tên homestay',{exact:true}).count(),0);checks++;
    role='HOST';await page.goto(app.baseUrl+'/admin/homestays');await page.getByRole('main').getByText('Trang này chỉ dành cho Admin đang hoạt động.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Duyệt toàn bộ nội dung chờ',exact:true}).count(),0);checks++;
    record=structuredClone(original);role='HOST';mode='ok';probePrepare=prepare;
    await page.close();
  }
  console.log(`PASS ${checks} browser checks: Host create/edit, catalog codes, confirmation, payload/time/zero/null, preserved errors, mutation lock, stale versions, unit add/edit, active-booking delete block, hide, Admin revision preview/review and role gates at 375/1440. Fixtures only; no real DB/provider acceptance.`);
  if(process.env.RUN_HOMESTAY_PROBE==='1'){
    await browser.close();browser=null;
    const launch=chromium.launch.bind(chromium);let done;
    chromium.launch=async options=>{
      const b=await launch({...options,channel:'msedge'});done=new Promise(end=>b.once('disconnected',end));
      const newContext=b.newContext.bind(b);
      b.newContext=async options=>{
        const context=await newContext(options),newPage=context.newPage.bind(context);
        context.newPage=async()=>{
          const page=await newPage();await probePrepare(page);
          const goto=page.goto.bind(page);
          page.goto=async(...args)=>{const result=await goto(...args);await page.getByRole('button',{name:'Thêm phòng',exact:true}).waitFor();return result;};return page;
        };return context;
      };return b;
    };
    process.argv=[process.execPath,'probe',app.baseUrl+`/host/homestays/${id}`,'--widths','375,1440','--sweep','1440,375,20','--wait','100','--out',resolve(out||'.tmp/homestay-ui','probe'),'--pw','C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node'];
    await import(pathToFileURL(resolve('.agents/skills/ui-ux/scripts/probe.mjs')));
    while(!done)await new Promise(end=>setTimeout(end,10));await done;
  }
}finally{await browser?.close();await app.close();}
