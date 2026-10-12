// Presentation fixtures only: intercepted HTTP/WS, no real notices or accounts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureFrontend} from './fixture-frontend.mjs';

const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const app=await fixtureFrontend(resolve(process.argv[2]||'.'),()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}));
assert.equal(app.serverFixture,true,'Do not run notification write fixtures against a real server');
const evidence=process.env.BROWSER_EVIDENCE_DIR;
const ok=data=>({success:true,message:'Fixture',data});
const user={id:'00000000-0000-4000-8000-000000000001',fullName:'Người dùng Test',phone:'0990000000',role:'TENANT',status:'ACTIVE',isPhoneVerified:true};
const notices=Array.from({length:12},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+2).padStart(12,'0')}`,appointmentId:'00000000-0000-4000-8000-000000000050',type:'APPOINTMENT_ACCEPTED',message:i===0?'Chủ nhà đã xác nhận lịch xem phòng của bạn. '+ 'Tên phòng rất dài '.repeat(18):`Thông báo lịch xem trọ ${i+1}`,readAt:i===1?'2026-10-10T00:00:00Z':null,createdAt:'2026-10-09T17:15:00Z'}));
let browser;
try {
  if(evidence)await mkdir(evidence,{recursive:true});
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});
  async function fixture(width,role='TENANT') {
    const page=await browser.newPage({viewport:{width,height:900}});
    const state={count:23,rows:structuredClone(notices),mode:'ok',gets:0,posts:0,release:null,session:user,refreshRelease:null};
    state.session={...user,role};
    await page.routeWebSocket('ws://localhost:5000/socket.io/**',socket=>socket.close());
    await page.route('**/api/auth/refresh',async r=>{
      if(state.mode==='restore')await new Promise(done=>{state.refreshRelease=done;});
      return r.fulfill(state.session?{json:ok({accessToken:'fixture-only',user:state.session})}:{status:401,json:{success:false,errorCode:'SESSION_CLOSED',message:'Fixture anonymous'}});
    });
    await page.route('**/api/auth/me',r=>r.fulfill({json:ok(state.session)}));
    await page.route('**/api/auth/logout',r=>{state.session=null;return r.fulfill({json:ok({signedOut:true})});});
    await page.route('**/api/management/**',async r=>{
      const path=new URL(r.request().url()).pathname;
      if(path==='/api/management/notifications'&&r.request().method()==='GET') {
        state.gets++;
        if(state.mode==='slow-list')await new Promise(done=>{state.release=done;});
        if(state.mode==='list-error')return r.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_ERROR',message:'Chưa tải được thông báo.'}});
        return r.fulfill({json:{...ok(state.rows),meta:{page:1,limit:20,total:state.rows.length,totalPages:1,unreadCount:state.count}}});
      }
      if(/^\/api\/management\/notifications\/[^/]+\/read$/.test(path)) {
        state.posts++;
        assert.equal(r.request().method(),'POST');
        if(state.mode==='read-error')return r.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_ERROR',message:'Chưa đánh dấu đã đọc được.'}});
        if(state.mode==='slow-read')await new Promise(done=>{state.release=done;});
        const notice=state.rows.find(n=>n.id===path.split('/').at(-2));
        if(!notice.readAt){notice.readAt='2026-10-10T01:00:00Z';state.count--;}
        return r.fulfill({json:ok(notice)});
      }
      if(path.endsWith('/conversations/unread'))return r.fulfill({json:ok({totalUnread:99,conversations:[]})});
      if(path.endsWith('/appointments'))return r.fulfill({json:{...ok([]),meta:{page:1,limit:20,total:0,totalPages:0}}});
      return r.fulfill({status:405,json:{success:false,message:'Unsupported fixture request'}});
    });
    return {page,state};
  }
  const bell=page=>page.getByRole('button',{name:/^Thông báo(?:,|$)/});
  const panel=page=>page.getByRole('dialog',{name:'Thông báo',exact:true});
  async function shot(page,name) {
    await page.waitForTimeout(200); // Capture the settled Radix animation, not a translucent frame.
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
    if(evidence)await page.screenshot({path:`${evidence}/${name}-${page.viewportSize().width}.png`});
  }
  for(const width of [375,1440]) {
    const {page,state}=await fixture(width);
    await page.goto(app.baseUrl+'/account');
    await page.getByRole('button',{name:'Thông báo, 23 chưa đọc',exact:true}).waitFor();
    const b=await bell(page).boundingBox(),a=await page.getByRole('button',{name:'Mở menu tài khoản'}).boundingBox();
    assert.ok(b.width>=44&&b.height>=44&&b.x+b.width<=a.x&&Math.abs(b.y-a.y)<2,'bell left of account, aligned, 44px');
    assert.equal(await page.getByTestId('notification-badge').innerText(),'9+');
    await shot(page,'header-many');
    if(width===375) {
      await bell(page).click();await page.waitForURL('**/notifications');
      assert.equal(await panel(page).count(),0,'mobile goes straight to page');
      assert.equal(state.posts,0,'navigation alone does not mark any notice read');
      await shot(page,'mobile-notifications');
      for(const count of [0,1,2,9,10]) {
        state.count=count;await page.reload();await page.getByRole('button',{name:`Thông báo, ${count} chưa đọc`,exact:true}).waitFor();
        assert.equal(await page.getByTestId('notification-badge').count(),count?1:0);await shot(page,`badge-${count}`);
      }
      state.rows=[];state.count=0;await page.reload();await page.getByText('Chưa có thông báo nào.',{exact:true}).waitFor();await shot(page,'empty');
      state.mode='list-error';await page.reload();await page.getByRole('alert').getByText('Chưa tải được thông báo.',{exact:true}).waitFor();await shot(page,'list-error');
      state.mode='ok';state.rows=structuredClone(notices);state.count=23;
      await page.getByRole('button',{name:'Tải lại thông báo',exact:true}).click();await page.getByRole('button',{name:'Thông báo, 23 chưa đọc',exact:true}).waitFor();
      await page.close();continue;
    }
    await bell(page).focus();await page.keyboard.press('Enter');await panel(page).waitFor();
    assert.equal(await panel(page).locator('li').count(),8,'max 8 newest of server list');
    assert.equal(state.posts,0,'opening never marks read');
    assert.ok((await panel(page).boundingBox()).width>350,'not trigger-width');
    assert.equal(await panel(page).locator('time').first().innerText(),'00:15 10/10/26','Vietnam timestamp');
    await shot(page,'popover-many');
    await page.keyboard.press('Escape');await panel(page).waitFor({state:'hidden'});
    // The closing animation is hidden immediately to prevent overlapping panels;
    // Radix restores focus when its retained content finishes unmounting.
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')?.startsWith('Thông báo,'));
    assert.equal(await bell(page).evaluate(el=>el===document.activeElement),true,'Escape restores trigger focus');
    const gets=state.gets;
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});window.dispatchEvent(new Event('visibilitychange'));});
    const refetch=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/management/notifications');
    await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'visible'});window.dispatchEvent(new Event('visibilitychange'));});await refetch;
    assert.ok(state.gets>gets,'returning to tab refetches notifications without a timer');
    for(const count of [0,1,2,9,10,1284500]) {
      state.count=count;await page.reload();await page.getByRole('button',{name:`Thông báo, ${count} chưa đọc`,exact:true}).waitFor();
      assert.equal(await page.getByTestId('notification-badge').count(),count?1:0);
      if(count)assert.equal(await page.getByTestId('notification-badge').innerText(),count===1?'':count>9?'9+':String(count));
      await shot(page,`badge-${count}`);
    }
    state.mode='slow-list';state.count=0;state.rows=[];
    await page.reload();await bell(page).click();await panel(page).getByRole('status').waitFor();await shot(page,'loading');
    state.mode='ok';state.release();await panel(page).getByText('Chưa có thông báo',{exact:true}).waitFor();await shot(page,'empty');
    state.mode='list-error';await page.reload();await bell(page).click();await panel(page).getByRole('alert').waitFor();await shot(page,'list-error');
    state.mode='ok';state.count=3;state.rows=structuredClone(notices).slice(0,3);
    state.rows[0].message='<script>window.__noticeXss=1</script> '+ 'Địa chỉ dài '.repeat(35);
    await panel(page).getByRole('button',{name:'Thử lại',exact:true}).click();await panel(page).locator('li').first().waitFor();
    assert.equal(await page.evaluate(()=>window.__noticeXss),undefined);
    state.mode='read-error';await panel(page).locator('li button').first().click();await panel(page).getByRole('alert').waitFor();
    assert.ok(page.url().endsWith('/account'));assert.equal(state.count,3);assert.equal(await bell(page).getAttribute('aria-label'),'Thông báo, 3 chưa đọc');await shot(page,'read-error');
    state.mode='slow-read';await panel(page).getByRole('button',{name:'Thử đánh dấu đã đọc lại',exact:true}).click();
    await panel(page).getByText('Đang đánh dấu đã đọc…',{exact:true}).waitFor();
    assert.ok(page.url().endsWith('/account'));assert.equal(await bell(page).getAttribute('aria-label'),'Thông báo, 3 chưa đọc');
    assert.equal(await panel(page).locator('li button:not(:disabled)').count(),0,'prevent duplicate clicks while pending');
    state.mode='ok';state.release();await page.waitForURL('**/my-appointments');await page.getByRole('button',{name:'Thông báo, 2 chưa đọc',exact:true}).waitFor();
    assert.equal(state.posts,2);await bell(page).click();await panel(page).getByRole('link',{name:'Xem tất cả'}).click();await page.waitForURL('**/notifications');
    await page.setViewportSize({width:375,height:900});await shot(page,'mobile-many');
    await page.close();
  }
  for(const role of ['HOST','ADMIN','BANNED','ANONYMOUS','RESTORING']) {
    const {page,state}=await fixture(1440,role==='HOST'?'HOST':'TENANT');
    if(role==='ADMIN')state.session.role='ADMIN';
    if(role==='BANNED')state.session.status='BANNED';
    if(role==='ANONYMOUS')state.session=null;
    if(role==='RESTORING')state.mode='restore';
    await page.goto(app.baseUrl+'/account');
    if(role==='RESTORING') {
      await page.getByText('Đang kiểm tra phiên…',{exact:true}).waitFor();assert.equal(await bell(page).count(),0);assert.equal(state.gets,0);
      state.mode='ok';state.refreshRelease();await bell(page).waitFor();
    } else if(role!=='HOST') {
      await page.getByRole(role==='ANONYMOUS'?'link':'button',{name:role==='ANONYMOUS'?'Đăng nhập':'Mở menu tài khoản',exact:true}).first().waitFor();
      assert.equal(await bell(page).count(),0);assert.equal(state.gets,0,'no unauthorized notification call');
    } else {
      await page.getByRole('button',{name:'Thông báo, 23 chưa đọc',exact:true}).waitFor();await bell(page).click();
      await panel(page).locator('li button').first().click();await page.waitForURL('**/host/appointments');
      await bell(page).click();await page.setViewportSize({width:375,height:900});await panel(page).waitFor({state:'hidden'});
      await bell(page).click();await page.waitForURL('**/notifications');
    }
    await page.close();
  }
  // Existing logout unmounts the bell; a late mark-read response must not navigate.
  const {page,state}=await fixture(1440);await page.goto(app.baseUrl+'/account');await page.getByRole('button',{name:'Thông báo, 23 chưa đọc',exact:true}).waitFor();
  await bell(page).click();state.mode='slow-read';await panel(page).locator('li button').first().click();await panel(page).getByText('Đang đánh dấu đã đọc…',{exact:true}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Mở menu tài khoản'}).click();await page.getByRole('menuitem',{name:'Đăng xuất'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.waitForURL(app.baseUrl+'/');state.release();await page.waitForTimeout(300);
  assert.equal(await bell(page).count(),0);assert.equal(page.url(),app.baseUrl+'/','late old-session response cannot navigate');await page.close();
  console.log('PASS: 375/1440 header and mobile navigation; badge 0/1/2/9/10/large; 8-row cap; VN time; escaped/long text; loading/empty/error+retry; no optimistic mark-read; Tenant/Host routes; restored/anonymous/Admin/banned gates; resize, Escape/focus and logout late-response guard. Synthetic HTTP/WS only, no DB writes.');
} finally { if(browser)await browser.close();await app.close(); }
