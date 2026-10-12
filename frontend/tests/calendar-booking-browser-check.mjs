// Synthetic Auth/API only; never credentials or real customer data.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {calendarFixture,unitId,bookingId} from './host-calendar-browser-check.mjs';

export async function bookingFixture(context) {
  await calendarFixture(context);let mode='ok',gate=null,reads=0;
  await context.route('**/api/management/host/bookings/**',async route=>{
    reads++;if(gate)await gate;
    if(mode==='404')return route.fulfill({status:404,json:{success:false,errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'}});
    const month=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit'}).format(new Date());
    return route.fulfill({json:{success:true,message:'Fixture',data:{unitId:mode==='wrong-unit'?bookingId:unitId,bookingId,bookingCode:'TEST-CALENDAR',
      checkInDate:`${month}-10`,checkOutDate:`${month}-12`,guestName:'Khách kiểm thử với tên dài '.repeat(8),guestPhone:'0990000001',
      bookingStatus:'CONFIRMED',paymentStatus:'NOT_CONFIGURED'}}});
  });return {mode:value=>{mode=value;},hold:value=>{gate=value;},get reads(){return reads;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const require=createRequire(import.meta.url),base=process.argv[2]||'http://127.0.0.1:3325';
  if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Local only');
  const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});
  await mkdir('../.tmp/s4-calendar-booking-ui',{recursive:true});
  try {
    for(const width of [375,1440]) {
      const context=await browser.newContext({viewport:{width,height:1000}}),fixture=await bookingFixture(context),page=await context.newPage();
      await page.goto(`${base}/host/calendar/${unitId}`,{timeout:120000});await page.locator('[data-date]').first().waitFor();
      assert.equal(fixture.reads,0);const month=await page.getByLabel('Tháng (YYYY-MM)').inputValue(),day=page.locator(`[data-date="${month}-10"]`);
      await day.click();const dialog=page.getByRole('dialog');await dialog.getByText('0990000001',{exact:true}).waitFor();
      await dialog.getByText('Chưa kết nối thanh toán',{exact:true}).waitFor();assert.equal(fixture.reads,1);
      assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`../.tmp/s4-calendar-booking-ui/detail-${width}.png`,fullPage:true});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await day.evaluate(el=>el===document.activeElement),true);
      await page.getByRole('button',{name:'Xem thông tin đơn',exact:true}).click();await page.getByRole('dialog').getByText('0990000001',{exact:true}).waitFor();assert.equal(fixture.reads,2);
      await page.getByRole('button',{name:'Đóng hộp thoại'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
      await page.locator(`[data-date="${month}-08"]`).click();await day.click({modifiers:['Shift']});await page.getByRole('heading',{name:'Đã chọn 3 ngày'}).waitFor();assert.equal(await page.getByText('0990000001',{exact:true}).count(),0);assert.equal(fixture.reads,2);
      await context.close();console.log(`PASS ${width} detail/no prefetch/no cache/long text/focus/range`);
    }
    for(const mode of ['wrong-unit','404']) {
      const context=await browser.newContext(),fixture=await bookingFixture(context),page=await context.newPage();fixture.mode(mode);
      await page.goto(`${base}/host/calendar/${unitId}`);await page.locator('[data-date]').first().waitFor();const month=await page.getByLabel('Tháng (YYYY-MM)').inputValue();
      await page.locator(`[data-date="${month}-10"]`).click();await page.getByRole('button',{name:'Thử lại thông tin đơn'}).waitFor();assert.equal(await page.getByText('0990000001',{exact:true}).count(),0);
      fixture.mode('ok');await page.getByRole('button',{name:'Thử lại thông tin đơn'}).click();await page.getByRole('dialog').getByText('0990000001',{exact:true}).waitFor();
      await context.close();console.log(`PASS ${mode} hides contacts and retries explicitly`);
    }
    for(const kind of ['close','logout']) {
      const context=await browser.newContext(),fixture=await bookingFixture(context),page=await context.newPage();let release;const gate=new Promise(done=>{release=done;});
      await page.goto(`${base}/host/calendar/${unitId}`);await page.locator('[data-date]').first().waitFor();const month=await page.getByLabel('Tháng (YYYY-MM)').inputValue();fixture.hold(gate);
      await page.locator(`[data-date="${month}-10"]`).click();await page.getByRole('status',{name:'Đang tải thông tin đơn'}).waitFor();
      if(kind==='close')await page.keyboard.press('Escape');else await page.evaluate(()=>{
        const revision='fixture-calendar-detail-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');
        const channel=new BroadcastChannel('trotot-auth-v1');channel.postMessage({type:'logout',revision});channel.close();
      });
      await page.getByRole('dialog').waitFor({state:'hidden'});release();await page.waitForTimeout(200);
      assert.equal(await page.getByText('0990000001',{exact:true}).count(),0);assert.equal(await page.getByRole('dialog').count(),0);
      await context.close();console.log(`PASS late detail after ${kind} hidden`);
    }
  } finally {await browser.close();}
}
