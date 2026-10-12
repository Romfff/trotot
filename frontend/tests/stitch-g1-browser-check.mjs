// Compiled UI + isolated transport fixtures. No real users, DB or financial writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fixtureFrontend} from './fixture-frontend.mjs';
const require=createRequire(import.meta.url);
const playwrightModule=process.argv[3] || 'playwright';
const {chromium}=require(playwrightModule);
const playwrightRoot=dirname(dirname(dirname(require.resolve(`${playwrightModule}/package.json`))));
const phase=process.argv[4] || 'after';
const evidence=resolve(process.env.BROWSER_EVIDENCE_DIR || `../docs/evidence/stitch-g1-${phase}`);
await mkdir(evidence,{recursive:true});
const fixture=JSON.parse(await readFile(new URL('./fixtures/public-listing.json',import.meta.url),'utf8'));
const room={...fixture,isVerified:true,title:'Phòng kiểm thử với tên dài để rà bố cục, không phải tin đăng thật',
  host:{fullName:'[DEMO] Tên chủ nhà kiểm thử',avatarUrl:null},
  images:[{url:'https://fixture.invalid/broken.jpg',position:0,sortOrder:0}]};
const result={success:true,data:[room],meta:{page:1,limit:20,total:40,totalPages:2}};
const stay={id:'fixture-unit',slug:'fixture-stay',title:'Homestay kiểm thử, không phải tin thật',address:'Địa chỉ kiểm thử',unitName:'Phòng mẫu',maxAdults:4,maxChildren:0,maxGuests:4,maxNights:30,instantBook:false,bedrooms:1,bathrooms:1,checkInTime:'14:00:00',checkOutTime:'12:00:00',cancellationPolicy:'FLEXIBLE',basePricePerNight:550000,cleaningFee:0,media:[{url:'https://fixture.invalid/broken.jpg',sortOrder:0}]};
const app=await fixtureFrontend(process.argv[2],query=>query.get('page')==='10'?{...result,meta:{...result.meta,page:10,total:400,totalPages:20}}:result,slug=>slug==='missing'?null:{...room,slug});
let browser;let assertions=0;const measurements=[];
const check=(value,message)=>{assert.ok(value,message);assertions++;};
try {
  if(phase==='probe'){
    for(const [name,path] of [['home','/'],['search','/thue-phong-tro?location=bk'],['detail','/thue-phong-tro/fixture-room']]){
      if(process.argv[5]&&process.argv[5]!==name)continue;
      const child=spawn(process.execPath,[resolve('../.agents/skills/ui-ux/scripts/probe.mjs'),app.baseUrl+path,'--pw',playwrightRoot,'--widths','375,1440','--sweep','--out',`${evidence}/${name}`],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      let output='';child.stdout.on('data',bytes=>{output+=bytes;});child.stderr.on('data',bytes=>{output+=bytes;});
      const [code]=await once(child,'close');await writeFile(`${evidence}/${name}.log`,output);
      assert.equal(code,0,`${name} probe did not complete: ${output.slice(-1200)}`);
      console.log(`Probe ${name}: saved to ${evidence}/${name}`);
    }
  }else{
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL || undefined});
  for(const width of [375,768,1024,1440]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    let mode='full';let release;let galleryRequests=0;
    const gate=new Promise(done=>{release=done;});
    await page.route('https://fixture.invalid/**',route=>route.fulfill({status:404,body:'Fixture missing media'}));
    await page.route('https://tile.openstreetmap.org/**',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')}));
    await page.route('**/api/listings/properties/long-term/search?*',async route=>{
      if(mode==='loading')await gate;
      return route.fulfill({status:mode==='error'?503:200,json:mode==='error'?{success:false,errorCode:'FIXTURE_ERROR',message:'Lỗi kiểm thử'}:{...result,data:mode==='empty'?[]:[room]}});
    });
    await page.route('**/api/listings/homestays/search?*',async route=>{
      if(mode==='loading')await gate;
      return route.fulfill({status:mode==='error'?503:200,json:mode==='error'?{success:false,errorCode:'FIXTURE_ERROR',message:'Lỗi kiểm thử'}:{success:true,data:mode==='empty'?[]:[stay],meta:{page:1,limit:4,total:mode==='empty'?0:1,totalPages:1}}});
    });
    await page.route('**/api/listings/amenities',route=>route.fulfill({json:{success:true,data:[{id:'wifi',name:'Wi-Fi'},{id:'air_cond',name:'Máy lạnh'}]}}));
    await page.route('**/api/listings/properties/*/cost-estimate*',route=>route.fulfill({json:{success:true,data:{lines:[],totalMonthly:3500000,deposit:3500000,missingInputs:[],missingCosts:[],isComplete:true,disclaimer:'Ước tính kiểm thử'}}}));
    await page.route('**/api/listings/properties/*/contact',route=>{galleryRequests++;return route.fulfill({status:429,json:{success:false,errorCode:'FIXTURE_LIMIT',message:'Giới hạn kiểm thử'}});});
    const capture=async(name)=>{
      await page.screenshot({path:`${evidence}/${name}-${width}.png`,fullPage:true});
      const measured=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
      measurements.push({name,width,...measured});
      if(phase==='after')check(measured.scroll<=width,`${name}: horizontal overflow ${width}`);
    };
    await page.goto(app.baseUrl);await page.getByRole('heading',{name:stay.title,exact:true}).waitFor();
    if(phase==='after'){
      await page.getByText('Không tải được ảnh',{exact:true}).first().waitFor();
      check(!await page.getByText('Chính chủ',{exact:true}).count(),'no unproven verification badge');
      check(!await page.getByText(/chi phí xác thực|bàn giao chuẩn mực/).count(),'no unproven copy');
    }
    await capture('home');
    const homeSwitch=phase==='before'?page.getByRole('tab',{name:'Homestay',exact:true}):page.getByRole('group',{name:'Loại chỗ ở'}).getByRole('button',{name:'Homestay',exact:true});
    await homeSwitch.focus();await page.keyboard.press('Enter');await page.locator('#home-hs-adults').waitFor();
    if(phase==='after'){
      check(await homeSwitch.getAttribute('aria-pressed')==='true','keyboard changes home selection');
      check((await homeSwitch.boundingBox()).height>=44,'home touch target 44px');
      check(await page.locator('#home-hs-adults option[value="4"]').textContent()==='4 người','capacity label matches submitted value');
    }
    await capture('home-homestay');
    await page.goto(app.baseUrl+'/thue-phong-tro?location=bk');await page.getByRole('heading',{name:room.title,exact:true}).waitFor();await capture('search');
    if(phase==='after'&&width>=1024){
      await page.locator('.leaflet-container').waitFor();
      check(await page.locator('.leaflet-container').evaluate(element=>getComputedStyle(element).overflow==='hidden'),'Leaflet renderer is clipped inside the map');
    }
    if(width<1024){
      await page.getByRole('button',{name:'Bộ lọc',exact:true}).click();await capture('search-filters');
      if(phase==='after')check((await page.getByRole('button',{name:'Đóng bộ lọc',exact:true}).boundingBox()).height>=44,'filter close 44px');
      await page.getByRole('button',{name:'Đóng bộ lọc',exact:true}).click();
    }
    if(phase==='after'){
      await page.goto(app.baseUrl+'/thue-phong-tro?page=10');
      await page.getByRole('navigation',{name:'Phân trang',exact:true}).waitFor();await capture('search-many-pages');
    }
    const costReady=page.waitForResponse(response=>response.url().includes('/cost-estimate')&&response.status()===200);
    await page.goto(app.baseUrl+'/thue-phong-tro/fixture-room');await page.getByRole('heading',{name:room.title,exact:true}).waitFor();
    await costReady;await page.getByText('Đang cập nhật ước tính.',{exact:true}).waitFor({state:'hidden'});await capture('detail');
    if(phase==='after'){
      check(await page.getByText(room.host.fullName,{exact:true}).count()===1,'person name not normalized as listing title');
      check(!await page.getByText('Chính chủ',{exact:true}).count(),'detail has no unproven badge');
      check(galleryRequests===0,'contact is not fetched before user action');
    }
    await page.getByRole('button',{name:'Xem số liên hệ',exact:true}).click();await page.getByRole('alert').filter({hasText:'Giới hạn kiểm thử'}).waitFor();await capture('detail-contact-error');
    if(phase==='after')check(await page.locator('a[href^="tel:"]').count()===0,'error does not expose phone');
    for(const state of ['empty','error','loading']){
      mode=state;await page.goto(app.baseUrl);
      await (state==='loading'?page.getByRole('status').filter({hasText:'Đang tải trọ'}):state==='error'?page.getByRole('alert').first():page.getByText('Chưa có tin đang hiển thị ở mục này.').first()).waitFor();
      await capture(`home-${state}`);
      if(state==='error'&&phase==='after'){
        mode='full';await page.getByRole('button',{name:'Thử lại',exact:true}).first().click();
        await page.getByRole('heading',{name:room.title,exact:true}).waitFor();assertions++;
      }
      if(state==='loading')release();
    }
    await page.goto(app.baseUrl+'/thue-phong-tro/missing');
    if(phase==='after')check(await page.locator('h1').filter({hasText:room.title}).count()===0,'missing listing exposes no detail');
    await capture('detail-missing');await page.close();
  }
  await writeFile(`${evidence}/measurements.json`,JSON.stringify({phase,assertions,measurements},null,2));
  console.log(`${phase}: ${assertions} assertions; fixture-only screenshots at ${evidence}`);
  }
}finally{await browser?.close();await app.close();}
