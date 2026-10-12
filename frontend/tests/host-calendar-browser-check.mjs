// UI/Auth/API fixtures only; real DB contract checks run separately.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bankFixture} from './host-bank-browser-check.mjs';
export const unitId='11111111-1111-4111-8111-111111111111';
export const bookingId='22222222-2222-4222-8222-222222222222';
export async function calendarFixture(context,role='HOST') {
  await bankFixture(context,role); const writes=[];let lost=false,version=1,mode='ok',gate=null;
  await context.route('**/api/management/host/calendar/**',async route=>{
    const request=route.request(),url=new URL(request.url());if(gate)await gate;
    if(request.method()==='GET') {
      const month=url.searchParams.get('month'),count=new Date(`${month}-01T00:00:00Z`);count.setUTCMonth(count.getUTCMonth()+1);count.setUTCDate(0);
      const days=Array.from({length:count.getUTCDate()},(_,index)=>({date:`${month}-${String(index+1).padStart(2,'0')}`,status:index===8?'BLOCKED':index===9?'BOOKED':'AVAILABLE',price:index===0?0:350001,...(index===9?{bookingId}:{})}));
      return route.fulfill({json:{success:true,message:'Fixture',data:{unitId:mode==='invalid'?'bad':unitId,month,timeZone:'Asia/Ho_Chi_Minh',version,days}}});
    }
    const body=request.postDataJSON(),key=request.headers()['idempotency-key'];writes.push({body,key,path:url.pathname});
    if(lost){lost=false;version=body.expectedVersion+1;return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE',message:'Synthetic lost response'}});}
    if(mode==='stale')return route.fulfill({status:409,json:{success:false,errorCode:'STALE_HOMESTAY_VERSION',message:'Phiên bản lịch đã thay đổi.'}});
    version=body.expectedVersion+1;return route.fulfill({json:{success:true,message:'Fixture',data:{version,updatedDates:body.dates}}});
  });return {writes,lose:()=>{lost=true;},mode:value=>{mode=value;},hold:value=>{gate=value;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const require=createRequire(import.meta.url),base=process.argv[2]||'http://127.0.0.1:3323';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
  const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});await mkdir('../.tmp/s4-calendar-ui',{recursive:true});
  try {
    for(const width of [375,1440,1920]) {
      const context=await browser.newContext({viewport:{width,height:1000}}),fixture=await calendarFixture(context),page=await context.newPage();
      await page.goto(`${base}/host/calendar/${unitId}`);await page.locator('[data-date]').first().waitFor();
      const month=(await page.getByLabel('Tháng (YYYY-MM)').inputValue());
      await page.locator(`[data-date="${month}-01"]`).click();await page.locator(`[data-date="${month}-03"]`).click({modifiers:['Shift']});await page.getByRole('heading',{name:'Đã chọn 3 ngày'}).waitFor();
      await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).fill('350000.5');fixture.lose();await page.getByRole('button',{name:'Áp dụng cho ngày đã chọn',exact:true}).click();
      await page.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();assert.equal(await page.getByRole('button',{name:'Tháng sau',includeHidden:true}).isDisabled(),true);
      await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);
      await page.getByRole('button',{name:'Đóng hộp thoại',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),1);
      assert.equal(await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).getAttribute('readonly'),'');
      await page.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByText('Máy chủ đã ghi nhận.',{exact:false}).waitFor();assert.deepEqual(fixture.writes[0],fixture.writes[1]);
      assert.equal(fixture.writes[0].body.customPrice,350000.5);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`../.tmp/s4-calendar-ui/calendar-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${width} range/replay/version/no overflow`);
    }
    for(const role of ['TENANT','ADMIN']) {const context=await browser.newContext(),fixture=await calendarFixture(context,role),page=await context.newPage();await page.goto(`${base}/host/calendar/${unitId}`);await page.getByText('Trang này chỉ dành cho chủ nhà đang hoạt động.').waitFor();assert.equal(fixture.writes.length,0);assert.equal(await page.locator('[data-date]').count(),0);await context.close();console.log(`PASS wrong role ${role}`);}
    for(const action of ['Khóa ngày','Mở ngày','Giá mặc định']) {
      const context=await browser.newContext(),fixture=await calendarFixture(context),page=await context.newPage();await page.goto(`${base}/host/calendar/${unitId}`);await page.locator('[data-date]').first().click();await page.getByRole('button',{name:'Chỉnh ngày đã chọn',exact:true}).click();await page.getByRole('button',{name:action,exact:true}).click();await page.getByRole('button',{name:'Áp dụng cho ngày đã chọn',exact:true}).click();await page.getByText('Máy chủ đã ghi nhận.',{exact:false}).waitFor();
      assert.equal(fixture.writes.length,1);assert.equal(fixture.writes[0].body.expectedVersion,1);if(action==='Giá mặc định')assert.equal(fixture.writes[0].body.customPrice,null);else assert.equal(fixture.writes[0].body.isBlocked,action==='Khóa ngày');await context.close();console.log(`PASS ${action} explicit target`);
    }
    {
      const context=await browser.newContext({viewport:{width:1440,height:1000}}),fixture=await calendarFixture(context),page=await context.newPage();await page.goto(`${base}/host/calendar/${unitId}`);
      const days=page.locator('[data-date]');await days.first().waitFor();const first=await days.nth(0).boundingBox(),third=await days.nth(2).boundingBox();
      await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();await page.mouse.move(third.x+third.width/2,third.y+third.height/2,{steps:10});await page.mouse.up();
      await page.getByRole('dialog').waitFor();await page.getByRole('heading',{name:'Đã chọn 3 ngày'}).waitFor();assert.equal(await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).evaluate(el=>el===document.activeElement),true);
      await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).fill('bad');await page.getByRole('button',{name:'Áp dụng cho ngày đã chọn',exact:true}).click();assert.equal(fixture.writes.length,0);
      await page.mouse.click(5,5);assert.equal(await page.getByRole('dialog').count(),1);await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
      assert.equal(await days.nth(2).evaluate(el=>el===document.activeElement),true);await page.getByRole('button',{name:'Chỉnh ngày đã chọn',exact:true}).click();assert.equal(await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).inputValue(),'bad');
      await page.getByRole('button',{name:'Đóng',exact:true}).click();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(fixture.writes.length,0);await context.close();console.log('PASS drag opens popup, focus, validation, dismiss, retained input/no write');
    }
    for(const mode of ['invalid','stale']) {
      const context=await browser.newContext(),fixture=await calendarFixture(context),page=await context.newPage();fixture.mode(mode);await page.goto(`${base}/host/calendar/${unitId}`);
      if(mode==='invalid'){await page.getByRole('button',{name:'Thử lại lịch'}).waitFor();assert.equal(await page.getByRole('button',{name:'Chỉnh ngày đã chọn',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('dialog').count(),0);}
      else{await page.locator('[data-date]').first().click();await page.getByRole('button',{name:'Chỉnh ngày đã chọn',exact:true}).click();await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).fill('300000');await page.getByRole('button',{name:'Áp dụng cho ngày đã chọn',exact:true}).click();await page.getByText('Phiên bản lịch đã thay đổi.').waitFor();assert.equal(await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).inputValue(),'300000');assert.equal(fixture.writes.length,1);}
      await context.close();console.log(`PASS ${mode} no false success`);
    }
    for(const kind of ['read','write']) {
      const context=await browser.newContext(),fixture=await calendarFixture(context),page=await context.newPage();let release;const gate=new Promise(done=>{release=done;});
      if(kind==='read')fixture.hold(gate);
      await page.goto(`${base}/host/calendar/${unitId}`);
      if(kind==='read')await page.getByRole('status',{name:'Đang tải lịch'}).waitFor();
      else{await page.locator('[data-date]').first().click();await page.getByRole('button',{name:'Chỉnh ngày đã chọn',exact:true}).click();await page.getByLabel('Giá mỗi đêm (VND)',{exact:true}).fill('350000');fixture.hold(gate);await page.getByRole('button',{name:'Áp dụng cho ngày đã chọn',exact:true}).click();await page.getByRole('button',{name:'Đang lưu…'}).waitFor();}
      await page.evaluate(()=>{const revision='fixture-calendar-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');const channel=new BroadcastChannel('trotot-auth-v1');channel.postMessage({type:'logout',revision});channel.close();});
      await page.getByText('để quản lý lịch.',{exact:false}).waitFor();const late=page.waitForResponse(r=>r.url().includes('/api/management/'),{timeout:3000}).catch(()=>{});release();await late;assert.equal(await page.getByRole('form').count(),0);assert.equal(await page.getByText('Máy chủ đã ghi nhận.',{exact:false}).count(),0);await context.close();console.log(`PASS late ${kind} after logout hidden`);
    }
  }finally{await browser.close();}
}
