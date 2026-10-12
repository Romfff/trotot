// Actual compiled Next UI with loopback fixture transport/images. Not provider or DB acceptance.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import { fixtureFrontend } from './fixture-frontend.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[3]||'playwright');
const fixture=JSON.parse(await readFile(new URL('./fixtures/public-listing.json',import.meta.url),'utf8'));
const photo=index=>({url:`https://gallery.fixture.invalid/${index}.svg`,position:index,sortOrder:index});
const details=slug=>slug==='empty'?{...fixture,slug,images:[]} : slug==='single'?{...fixture,slug,images:[photo(1)]} : slug==='broken'?{...fixture,slug,images:[{...photo(1),url:'https://gallery.fixture.invalid/broken.svg'}]} : slug==='invalid'?{...fixture,slug,images:[{url:'javascript:alert(1)',position:1,sortOrder:1}]} : {...fixture,slug,images:Array.from({length:15},(_,index)=>photo(15-index))};
const app=await fixtureFrontend(process.argv[2],()=>({success:true,data:[],meta:{page:1,total:0,totalPages:0}}),details);
const evidence=process.env.BROWSER_EVIDENCE_DIR;if(evidence)await mkdir(evidence,{recursive:true});
const passed=[];let browser;
const check=(label,condition)=>{assert.ok(condition,label);passed.push(label);};
try{
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined,headless:true});
  for(const width of [375,1440]){
    const page=await browser.newPage({viewport:{width,height:1000},hasTouch:true});
    let failImage=true,contactRequests=0,contactMode='success';
    await page.route('**/api/auth/refresh',r=>r.fulfill({status:401,json:{success:false,errorCode:'SESSION_CLOSED',message:'Fixture guest'}}));
    await page.route('**/api/listings/properties/*/cost-estimate*',r=>r.fulfill({json:{success:true,data:{lines:[],totalMonthly:3500000,deposit:3500000,missingInputs:[],missingCosts:[],isComplete:true,disclaimer:'Ước tính kiểm thử'}}}));
    await page.route('**/api/listings/properties/*/contact',async r=>{
      contactRequests++;
      if(contactMode==='error')return r.fulfill({status:429,headers:{'Retry-After':'60'},json:{success:false,errorCode:'RATE_LIMITED',message:'Giới hạn kiểm thử. Thử lại sau.'}});
      if(contactMode==='invalid')return r.fulfill({json:{success:true,data:{contactPhone:42,contactZalo:null}}});
      return r.fulfill({json:{success:true,data:{contactPhone:'0990000000',contactZalo:'0990000001'}}});
    });
    await page.route('https://gallery.fixture.invalid/**',r=>{
      if(r.request().url().endsWith('/broken.svg')&&failImage)return r.fulfill({status:503,body:'Fixture image failure'});
      const index=new URL(r.request().url()).pathname.replace(/\D/g,'');
      return r.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e8f5f1"/><text x="400" y="300" text-anchor="middle" fill="#10302b" font-size="32">Ảnh kiểm thử ${index}</text></svg>`});
    });
    await page.route('https://fonts.googleapis.com/**',r=>r.fulfill({contentType:'text/css',body:''}));
    await page.route('https://fonts.gstatic.com/**',r=>r.abort());
    for(const slug of ['empty','invalid','single','broken','many']){
      await page.goto(`${app.baseUrl}/thue-phong-tro/${slug}`);
      const gallery=page.getByRole('region',{name:'Hình ảnh phòng',exact:true});await gallery.waitFor();
      check(`${width} ${slug} no body overflow`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      check(`${width} ${slug} contact never auto-fetched`,contactRequests===0);
      check(`${width} ${slug} initial HTML has no phone`,!(await page.content()).includes('0990000000'));
      if(width<1024)check(`${width} ${slug} content fills mobile column`,await page.locator('main section, main aside').evaluateAll(blocks=>{
        const target=blocks[0].getBoundingClientRect();
        return blocks.every(block=>Math.abs(block.getBoundingClientRect().width-target.width)<1);
      }));
      if(slug==='empty'||slug==='invalid')check(`${width} ${slug} empty gallery`,await gallery.getByText('Tin này chưa có hình ảnh.',{exact:true}).isVisible());
      if(slug==='single')check(`${width} single no redundant arrows`,await gallery.getByRole('button',{name:'Ảnh sau',exact:true}).count()===0);
      if(slug==='broken'){
        await gallery.getByRole('button',{name:'Thử tải lại ảnh',exact:true}).waitFor();
        if(evidence)await page.screenshot({path:`${evidence}/gallery-error-${width}.png`,fullPage:true});
        failImage=false;
        await gallery.getByRole('button',{name:'Thử tải lại ảnh',exact:true}).click();
        await gallery.locator('img').waitFor();await page.waitForFunction(()=>document.querySelector('section[aria-label="Hình ảnh phòng"] img')?.naturalWidth>0);
        check(`${width} broken image retry`,await gallery.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
      }
      if(slug==='many'){
        check(`${width} 15 sorted photos`,await gallery.getByRole('button',{name:/^Xem ảnh \d+$/}).count()===15);
        const main=gallery.getByRole('group');await main.focus();await page.keyboard.press('ArrowRight');
        check(`${width} keyboard next`,(await gallery.getByRole('status').innerText())==='Ảnh 2 / 15');
        await page.keyboard.press('End');check(`${width} End`,(await gallery.getByRole('status').innerText())==='Ảnh 15 / 15');
        await page.keyboard.press('ArrowRight');check(`${width} end bounded`,(await gallery.getByRole('status').innerText())==='Ảnh 15 / 15');
        await page.keyboard.press('Home');await gallery.getByRole('button',{name:'Ảnh sau',exact:true}).click();
        check(`${width} mouse next`,(await gallery.getByRole('status').innerText())==='Ảnh 2 / 15');
        await gallery.getByRole('button',{name:'Xem ảnh 4',exact:true}).click();check(`${width} thumbnail selection`,(await gallery.getByRole('status').innerText())==='Ảnh 4 / 15');
        const gesture=async (x,y)=>main.evaluate((el,{x,y})=>{
          el.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[new Touch({identifier:1,target:el,clientX:250,clientY:150})]}));
          el.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[new Touch({identifier:1,target:el,clientX:x,clientY:y})]}));
        },{x,y});
        await gesture(150,160);
        check(`${width} synthetic horizontal swipe`,(await gallery.getByRole('status').innerText())==='Ảnh 5 / 15');
        await gesture(240,250);
        check(`${width} vertical gesture preserved`,(await gallery.getByRole('status').innerText())==='Ảnh 5 / 15');
        await main.scrollIntoViewIfNeeded();const bounds=await main.boundingBox();
        const cdp=await page.context().newCDPSession(page),x=bounds.x+bounds.width*0.75,y=bounds.y+bounds.height*0.5;
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-100,y}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
        await page.waitForFunction(()=>document.querySelector('section[aria-label="Hình ảnh phòng"] [role="status"]')?.textContent==='Ảnh 6 / 15');
        check(`${width} browser-emulated touch swipe`,(await gallery.getByRole('status').innerText())==='Ảnh 6 / 15');
        const last=gallery.getByRole('button',{name:'Xem ảnh 15',exact:true});await last.focus();await page.keyboard.press('Enter');
        check(`${width} final thumbnail reachable`,await last.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.parentElement.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;}));
        await page.keyboard.press('Tab');
        check(`${width} gallery Tab reaches appointment before cost inputs`,await page.getByRole('link',{name:'Đăng nhập để hẹn xem trọ',exact:true}).evaluate(el=>el===document.activeElement));
        await page.keyboard.press('Tab');
        check(`${width} contact follows appointment`,await page.getByRole('button',{name:'Xem số liên hệ',exact:true}).evaluate(el=>el===document.activeElement));
        await page.keyboard.press('Tab');await page.keyboard.press('Tab');
        check(`${width} cost inputs follow contact actions`,await page.locator('#estimate-electricity').evaluate(el=>el===document.activeElement));
        await main.focus();await page.keyboard.press('Home');
        if(evidence){await main.evaluate(el=>el.blur());await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidence}/gallery-${width}.png`,fullPage:true});}
        contactMode='error';const reveal=page.getByRole('button',{name:'Xem số liên hệ',exact:true});await reveal.click();await page.getByRole('alert').filter({hasText:'Giới hạn kiểm thử'}).waitFor();
        check(`${width} error never reveals phone`,await page.locator('a[href^="tel:"]').count()===0);
        contactMode='invalid';await reveal.click();await page.getByRole('alert').filter({hasText:'Không đọc được thông tin liên hệ'}).waitFor();
        check(`${width} invalid response handled`,await page.locator('a[href^="tel:"]').count()===0);
        contactMode='success';await reveal.click();await page.locator('a[href="tel:0990000000"]').waitFor();
        check(`${width} contact success/retry`,contactRequests===3&&await page.locator('a[href="https://zalo.me/0990000001"]').isVisible());
      }
    }
    await page.close();
  }
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  const user={id:'00000000-0000-4000-8000-000000000001',fullName:'Người kiểm thử',phone:'0990000002',role:'TENANT',status:'ACTIVE',email:null,avatarUrl:null,isPhoneVerified:true,isIdentityVerified:false,createdAt:null,updatedAt:null};
  await context.route('**/api/auth/refresh',r=>r.fulfill({json:{success:true,data:{user,accessToken:'fixture-only-token'}}}));
  await context.route('**/api/auth/me',r=>r.fulfill({json:{success:true,data:user}}));
  await context.route('**/api/management/conversations/unread',r=>r.fulfill({json:{success:true,data:{totalUnread:0,conversations:[]}}}));
  // Header now reads appointment notices as well as chat unread. Keep that
  // transport isolated so an unmocked401 cannot invalidate the fixture session.
  await context.route('**/api/management/notifications?*',r=>r.fulfill({json:{success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0,unreadCount:0}}}));
  await context.route('**/api/auth/logout',r=>r.fulfill({json:{success:true,data:{loggedOut:true}}}));
  await context.route('**/api/listings/properties/*/cost-estimate*',r=>r.fulfill({json:{success:true,data:{lines:[],totalMonthly:3500000,deposit:3500000,missingInputs:[],missingCosts:[],isComplete:true,disclaimer:'Ước tính kiểm thử'}}}));
  let release,started;const waiting=new Promise(done=>{started=done;});
  await context.route('**/api/listings/properties/*/contact',async r=>{
    check('authenticated contact includes memory Bearer',r.request().headers().authorization==='Bearer fixture-only-token');
    started();await new Promise(done=>{release=done;});
    try{await r.fulfill({json:{success:true,data:{contactPhone:'0990000000',contactZalo:null}}});}catch{/* Aborted after session changed. */}
  });
  const viewer=await context.newPage(),logoutTab=await context.newPage();
  await viewer.goto(`${app.baseUrl}/thue-phong-tro/empty`);await viewer.getByRole('button',{name:'Mở menu tài khoản',exact:true}).waitFor();
  await logoutTab.goto(`${app.baseUrl}/thue-phong-tro/empty`);await logoutTab.getByRole('button',{name:'Mở menu tài khoản',exact:true}).waitFor();
  await viewer.getByRole('button',{name:'Xem số liên hệ',exact:true}).click();await waiting;
  await logoutTab.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();await logoutTab.getByRole('menuitem',{name:'Đăng xuất',exact:true}).click();
  await logoutTab.getByRole('dialog').getByRole('button',{name:'Đăng xuất',exact:true}).click();
  await viewer.getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();release();
  await viewer.waitForFunction(()=>document.querySelector('button[aria-busy="false"]')?.textContent?.includes('Xem số liên hệ'));
  check('other-tab logout clears view and ignores late contact response',await viewer.locator('a[href^="tel:"]').count()===0);
  await context.close();
  console.log(`PASS ${passed.length} assertions (compiled Next/Edge, fixture transport; swipe dispatched, not physical phone).`);
  console.log(passed.join('\n'));
}finally{await browser?.close();await app.close();}
