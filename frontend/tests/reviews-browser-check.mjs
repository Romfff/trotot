// Review UI regressions. Default: synthetic HTTP fixtures, no DB writes.
// REVIEWS_BROWSER_FIXTURE is supplied only by the isolated backend DB suite.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {fixtureFrontend} from './fixture-frontend.mjs';
import {loginThroughUi,logoutThroughUi} from './login-through-ui.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.argv[3]||'playwright');
const dir=resolve(process.argv[2]||'.');
const live=process.env.REVIEWS_BROWSER_FIXTURE?JSON.parse(process.env.REVIEWS_BROWSER_FIXTURE):null;
const evidence=process.env.BROWSER_EVIDENCE_DIR;
const bookingId=live?.bookingId||'00000000-0000-4000-8000-000000000001';
const slug=live?.slug||'review-ui-fixture';
const user=live?.user||{id:'00000000-0000-4000-8000-000000000002',phone:'0990000000',fullName:'Synthetic guest',role:'TENANT',status:'ACTIVE',email:null,avatarUrl:null,isPhoneVerified:true,isIdentityVerified:false,createdAt:null,updatedAt:null};
const completed={bookingId,bookingCode:'SYNTHETIC-REVIEW-UI',unitId:'00000000-0000-4000-8000-000000000003',checkInDate:'2020-01-01',checkOutDate:'2020-01-03',numAdults:1,numChildren:0,
  guestName:'Synthetic guest',guestPhone:'0990000000',guestEmail:null,bookingStatus:'COMPLETED',paymentStatus:'PAID',expiresAt:'2020-01-01T00:00:00Z',serverTime:'2026-10-08T00:00:00Z',version:1,payment:null,
  baseAmount:1000,cleaningFee:100,serviceFee:0,taxAmount:0,totalAmount:1100,nightlyPrices:[]};
const item={id:'00000000-0000-4000-8000-000000000004',cleanliness:1,location:3,value:5,comment:'<script>window.__reviewXss=1</script>\n'+'long'.repeat(50),authorName:'Synthetic author',createdAt:'2026-10-07T17:30:00Z'};
const ok=data=>({success:true,message:'Synthetic fixture',data});
const listed=(data,page=1,total=data.length,totalPages=data.length?1:0)=>({...ok(data),meta:{page,limit:10,total,totalPages}});
async function realFrontend() {
  if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(live.api))throw new Error('Isolated API must use loopback');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const baseUrl=`http://localhost:${port}`;
  const child=spawn(process.execPath,[resolve(dir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
    cwd:dir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:`${live.api}/api/v1`,FRONTEND_ORIGIN:baseUrl,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
  });
  const close=async()=>{if(child.exitCode===null){const finished=once(child,'close');child.kill();await finished;}};
  try {
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw new Error('Isolated frontend exited');
      if(await fetch(baseUrl+'/login').then(r=>r.ok,()=>false))return {baseUrl,close};
      await new Promise(done=>setTimeout(done,100));
    }
    throw new Error('Isolated frontend not ready');
  }catch(error){await close();throw error;}
}
const app=live?await realFrontend():await fixtureFrontend(dir,()=>listed([]));
if(evidence)await mkdir(evidence,{recursive:true});
let browser;
try {
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});
  async function newPage(width=1440) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    if(live)await loginThroughUi(page,app.baseUrl,live.login);
    else {
      await page.route('**/api/auth/refresh',r=>r.fulfill({json:ok({accessToken:'synthetic-ui-token',user})}));
      await page.route('**/api/auth/me',r=>r.fulfill({json:ok(user)}));
      await page.route('**/api/auth/logout',r=>r.fulfill({json:ok({loggedOut:true})}));
    }
    return page;
  }
  async function screenshot(page,name) {
    await page.evaluate(()=>{window.scrollTo(0,0);});await page.mouse.move(0,0);
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow');
    if(evidence)await page.screenshot({path:`${evidence}/${name}-${page.viewportSize().width}.png`,fullPage:true});
  }
  async function openReview(page) {
    await page.goto(app.baseUrl+'/bookings');
    const row=page.locator('li').filter({hasText:live?.bookingCode||completed.bookingCode});
    await row.getByRole('button',{name:'Xem / viết đánh giá',exact:true}).click();
    return row;
  }
  async function score(page) {
    for(const [label,value] of [['Sạch sẽ',1],['Vị trí',3],['Đáng tiền',5]])await page.getByRole('radio',{name:`${label}: ${value}/5`,exact:true}).check();
    await page.getByLabel('Nhận xét',{exact:true}).fill(item.comment);
  }
  if(live) {
    const page=await newPage();const row=await openReview(page);
    await row.getByRole('form',{name:'Viết đánh giá'}).waitFor();await score(page);
    const sent=page.waitForResponse(r=>r.url().endsWith(`/bookings/${bookingId}/review`)&&r.request().method()==='POST');
    await row.getByRole('button',{name:'Gửi đánh giá'}).click();
    assert.equal((await sent).status(),201);await row.getByText('Đã gửi đánh giá.',{exact:true}).waitFor();
    for(const width of [375,1440]){await page.setViewportSize({width,height:1000});await screenshot(page,'real-bff-review-saved');}
    await page.reload();const persisted=page.locator('li').filter({hasText:live.bookingCode});
    await persisted.getByRole('button',{name:'Xem / viết đánh giá'}).click();
    await persisted.getByRole('heading',{name:'Đánh giá của bạn'}).waitFor();assert.equal(await persisted.getByRole('form').count(),0);
    await page.goto(app.baseUrl+`/homestay/${slug}`);
    await page.getByRole('region',{name:'Đánh giá của khách'}).getByText(item.comment,{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__reviewXss),undefined);
    for(const width of [375,1440]){await page.setViewportSize({width,height:1000});await screenshot(page,'real-bff-review-public');}
    await logoutThroughUi(page);await page.goto(app.baseUrl+`/homestay/${slug}`);
    await page.getByRole('region',{name:'Đánh giá của khách'}).getByText(item.comment,{exact:true}).waitFor();
    await page.goto(app.baseUrl+'/bookings');await page.getByText('Cần đăng nhập bằng tài khoản có quyền phù hợp.',{exact:true}).waitFor();
    assert.equal(await page.getByText(live.bookingCode,{exact:true}).count(),0);
    await page.close();console.log('REAL PASS: real Tenant UI login/HttpOnly cookie/refresh, review create 201 and persisted readonly, public anonymous review after logout, private booking gate, escaped comment, 375/1440. Booking/completed/payment records are synthetic DB fixtures, no gateway/device acceptance.');
  } else {
    for(const width of [375,1440]) {
      const page=await newPage(width);let stored=null,mode='ok',posts=0,release;
      await page.route('**/api/management/bookings?*',r=>r.fulfill({json:listed([completed,{...completed,bookingId:'00000000-0000-4000-8000-000000000005',bookingCode:'NOT-COMPLETED',bookingStatus:'CONFIRMED'}])}));
      await page.route(`**/api/management/bookings/${bookingId}/review`,async r=>{
        if(r.request().method()==='GET')return r.fulfill({json:ok(stored)});
        posts++;assert.deepEqual(r.request().postDataJSON(),{cleanliness:1,location:3,value:5,comment:item.comment});
        if(mode==='slow')await new Promise(done=>{release=done;});
        if(mode==='error')return r.fulfill({status:503,json:{success:false,errorCode:'TEST_UNAVAILABLE',message:'Chưa gửi được đánh giá fixture.'}});
        if(mode==='duplicate'){stored=item;return r.fulfill({status:409,json:{success:false,errorCode:'REVIEW_ALREADY_EXISTS',message:'Đơn này đã được đánh giá.'}});}
        stored=item;return r.fulfill({status:201,json:ok(item)});
      });
      const row=await openReview(page);await row.getByRole('form',{name:'Viết đánh giá'}).waitFor();
      assert.equal(await page.locator('li').filter({hasText:'NOT-COMPLETED'}).getByRole('button',{name:'Xem / viết đánh giá'}).count(),0);
      assert.equal(await row.locator('input:checked').count(),0);await screenshot(page,'review-form');
      await row.getByRole('button',{name:'Gửi đánh giá'}).click();assert.equal(posts,0);
      assert.equal(await row.getByText('Chọn điểm từ 1 đến 5.',{exact:true}).count(),3);
      assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('name')),'cleanliness');
      await score(page);await screenshot(page,'review-selected');
      mode='error';await row.getByRole('button',{name:'Gửi đánh giá'}).click();await row.getByRole('alert').waitFor();
      assert.equal(await page.getByLabel('Nhận xét').inputValue(),item.comment);await screenshot(page,'review-submit-error');
      mode='slow';await row.getByRole('button',{name:'Gửi đánh giá'}).dblclick();
      await page.waitForFunction(()=>document.querySelector('[aria-busy="true"]'));assert.equal(posts,2);
      release();await row.getByText('Đã gửi đánh giá.',{exact:true}).waitFor();assert.equal(await row.getByRole('form').count(),0);
      assert.equal(await page.evaluate(()=>window.__reviewXss),undefined);await screenshot(page,'review-saved');
      await page.reload();const saved=page.locator('li').filter({hasText:completed.bookingCode});
      await saved.getByRole('button',{name:'Xem / viết đánh giá'}).click();await saved.getByRole('heading',{name:'Đánh giá của bạn'}).waitFor();
      stored=null;mode='duplicate';await page.reload();const conflict=page.locator('li').filter({hasText:completed.bookingCode});
      await conflict.getByRole('button',{name:'Xem / viết đánh giá'}).click();await score(page);
      await conflict.getByRole('button',{name:'Gửi đánh giá'}).click();await conflict.getByRole('heading',{name:'Đánh giá của bạn'}).waitFor();
      assert.equal(await conflict.getByRole('form').count(),0);
      await page.close();
    }
    const page=await newPage();let mode='empty';let second;
    await page.route(`**/api/listings/homestays/${slug}?*`,r=>r.fulfill({json:ok({id:'fixture',slug,title:'Synthetic homestay',description:'',address:{addressDetail:'Fixture',wardName:'Fixture'},amenities:[],units:[],media:[]})}));
    await page.route(`**/api/listings/properties/${slug}/reviews?*`,async r=>{
      const p=Number(new URL(r.request().url()).searchParams.get('page'));
      if(mode==='error')return r.fulfill({status:503,json:{success:false,message:'Chưa tải được đánh giá fixture.'}});
      if(mode==='pages'&&p===2)await new Promise(done=>{second=done;});
      return r.fulfill({json:mode==='empty'?listed([]):listed([{...item,id:String(p),authorName:`Synthetic page ${p}`}],p,11,2)});
    });
    await page.goto(app.baseUrl+`/homestay/${slug}`);const region=page.getByRole('region',{name:'Đánh giá của khách'});
    await region.getByText('Chưa có đánh giá cho chỗ ở này.').waitFor();
    for(const width of [375,1440]){await page.setViewportSize({width,height:1000});await screenshot(page,'review-empty');}
    mode='error';await page.reload();await region.getByRole('alert').waitFor();mode='pages';await region.getByRole('button',{name:'Thử lại'}).click();
    await region.getByText('Synthetic page 1',{exact:true}).waitFor();
    for(const width of [375,1440]){await page.setViewportSize({width,height:1000});await screenshot(page,'review-public');}
    await region.getByRole('button',{name:'Trang đánh giá sau'}).click();await region.getByRole('status').waitFor();
    await page.goto(app.baseUrl+`/homestay/${slug}`);second();await region.getByText('Synthetic page 1',{exact:true}).waitFor();
    assert.equal(await region.getByText('Synthetic page 2',{exact:true}).count(),0);await page.close();
    // A review response committed after logout must not restore private UI/cache.
    const logout=await newPage(375);let releasePost;
    await logout.route('**/api/management/bookings?*',r=>r.fulfill({json:listed([completed])}));
    await logout.route(`**/api/management/bookings/${bookingId}/review`,async r=>{
      if(r.request().method()==='GET')return r.fulfill({json:ok(null)});
      await new Promise(done=>{releasePost=done;});return r.fulfill({status:201,json:ok(item)});
    });
    const row=await openReview(logout);await score(logout);await row.getByRole('button',{name:'Gửi đánh giá'}).click();
    await logout.waitForFunction(()=>document.querySelector('[aria-busy="true"]'));
    await logout.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();await logout.getByRole('menuitem',{name:'Đăng xuất',exact:true}).click();
    await logout.getByRole('dialog').getByRole('button',{name:'Đăng xuất',exact:true}).click();
    await logout.getByRole('link',{name:'Đăng nhập',exact:true}).first().waitFor();releasePost();
    await logout.waitForTimeout(250);assert.equal(await logout.getByText('Đã gửi đánh giá.',{exact:true}).count(),0);await logout.close();
    console.log('FIXTURE PASS: required scores/comment, focus, non-completed gate, 503 preserves input, double-submit lock, 409 readonly reload, persisted own review, public empty/error/retry/pagination/late result, XSS escaping, logout late response, 375/1440. HTTP/Auth fixtures, no application DB writes.');
  }
} finally {await browser?.close();await app.close();}
