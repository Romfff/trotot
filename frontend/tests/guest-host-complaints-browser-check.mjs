// Intercepted fixtures. Real DB/browser test is separate in backend integration harness.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bankFixture} from './host-bank-browser-check.mjs';
export const bookingId='00000000-0000-4000-8000-000000000001';
const id='00000000-0000-4000-8000-000000000002',at='2026-10-06T00:00:00.000Z';
export async function guestHostComplaintFixture(context,role='TENANT') {
  await bankFixture(context,role);let mode='ok',gate=null,result=null,version=7;
  let row={id,bookingId,reason:'Synthetic guest complaint. '+ 'Nội dung dài kiểm thử màn hẹp. '.repeat(8),status:'OPEN',assigneeId:null,version:1,createdAt:at,overdue:false};
  let history=role==='HOST'?[{...row,events:[{id,action:'CREATED',message:row.reason,createdAt:at}],resolution:null}]:[];
  const calls=[],writes=[];
  await context.route('**/api/management/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;calls.push(path);if(gate)await gate;
    if(request.method()==='GET') {
      if(mode==='error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE',message:'Lỗi kiểm thử'}});
      if(path.endsWith(`/bookings/${bookingId}`))return route.fulfill({json:{success:true,message:'Fixture',data:{bookingId,bookingCode:'FIXTURE-BOOKING',version:mode==='invalid'?0:version,paymentStatus:mode==='unpaid'?'NOT_CONFIGURED':'PAID',bookingStatus:mode==='expired'?'COMPLETED':'CONFIRMED'}}});
      if(path.includes('/bookings/'))return route.fulfill({json:{success:true,message:'Fixture',data:history}});
      if(path.endsWith(`/complaints/${id}`))return route.fulfill({json:{success:true,message:'Fixture',data:mode==='closed'?{...history[0],status:'RESOLVED',resolution:{decision:'HOST',reason:'Synthetic decision',resolvedAt:at}}:history[0]}});
      return route.fulfill({json:{success:true,message:'Fixture',data:mode==='empty'?[]:[row],meta:{page:1,limit:20,total:mode==='empty'?0:1,totalPages:mode==='empty'?0:1}}});
    }
    const body=request.postDataJSON(),key=request.headers()['idempotency-key'];writes.push({path,body,key});
    if(mode==='stale')return route.fulfill({status:409,json:{success:false,errorCode:'STALE_COMPLAINT_VERSION',message:'Phiên bản đã thay đổi.'}});
    if(mode==='expired')return route.fulfill({status:409,json:{success:false,errorCode:'COMPLAINT_WINDOW_CLOSED',message:'Đã qua thời hạn khiếu nại.'}});
    if(!result||result.key!==key) {
      if(path.endsWith('/respond')) {row={...row,version:row.version+1};history=[{...history[0],...row,events:[...history[0].events,{id:'00000000-0000-4000-8000-000000000003',action:'RESPONDED',message:body.message.trim(),createdAt:at}]}];}
      else {row={...row,reason:body.reason.trim()};history=[{...row,events:[{id,action:'CREATED',message:row.reason,createdAt:at}],resolution:null}];}
      result={key,data:row};
    }
    if(mode==='lost'){mode='ok';return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE',message:'Synthetic lost delivery'}});}
    return route.fulfill({json:{success:true,message:'Fixture',data:result.data}});
  });return {calls,writes,mode:v=>{mode=v;},hold:v=>{gate=v;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const require=createRequire(import.meta.url),base=process.argv[2]||'http://127.0.0.1:3322';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
  const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'}),evidence='../.tmp/s4-guest-host-complaint-ui';await mkdir(evidence,{recursive:true});
  const open=async(page,host)=>{await page.goto(`${base}${host?'/host/finance/complaints':`/bookings/${bookingId}/complaints`}`);if(host)await page.getByRole('button',{name:'Xem khiếu nại',exact:true}).click();return page.getByRole('form',{name:host?'Gửi phản hồi khiếu nại':'Tạo khiếu nại'});};
  try {
    for(const host of [false,true])for(const width of [375,1440,1920]) {
      const context=await browser.newContext({viewport:{width,height:1000}}),f=await guestHostComplaintFixture(context,host?'HOST':'TENANT'),page=await context.newPage(),form=await open(page,host),button=form.getByRole('button',{name:host?'Gửi phản hồi':'Gửi khiếu nại',exact:true});
      await button.click();assert.equal(f.writes.length,0);assert.equal(await form.locator('input').evaluate(el=>el===document.activeElement),true);
      await form.getByLabel(host?'Nội dung phản hồi':'Nội dung khiếu nại',{exact:true}).fill(' Synthetic submitted text ');f.mode('lost');await button.click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();assert.equal(await form.locator('input').getAttribute('readonly'),'');
      if(host)assert.equal(await page.getByRole('button',{name:'Xem khiếu nại',exact:true}).isDisabled(),true);
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await form.getByText('Máy chủ đã ghi nhận.',{exact:false}).waitFor();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.writes[0].body.expectedVersion,host?1:7);
      if(host){assert.equal(await form.getByRole('button',{name:'Gửi phản hồi',exact:true}).isEnabled(),true);assert.equal(await page.getByText('Chủ nhà phản hồi',{exact:true}).count(),1);}else{assert.equal(await form.getByRole('button',{name:'Gửi khiếu nại',exact:true}).isDisabled(),true);assert.equal(await page.getByText('Đơn đang có khiếu nại mở.',{exact:false}).count(),1);}
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('Synthetic submitted text')),false);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidence}/${host?'host':'guest'}-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${host?'Host':'Guest'} ${width} validation/focus/stable replay/version/privacy`);
    }
    for(const mode of ['unpaid','invalid','error']) {
      const context=await browser.newContext(),f=await guestHostComplaintFixture(context),page=await context.newPage();f.mode(mode);const form=await open(page,false);if(mode==='error'||mode==='invalid')await page.getByRole('button',{name:'Thử lại dữ liệu'}).waitFor();else await page.getByText('Mã đơn:',{exact:false}).waitFor();assert.equal(await form.getByRole('button',{name:'Gửi khiếu nại',exact:true}).isDisabled(),true);assert.equal(f.writes.length,0);await context.close();console.log(`PASS Guest ${mode} blocked`);
    }
    for(const [role,host] of [['ADMIN',false],['TENANT',true]]) {
      const context=await browser.newContext(),f=await guestHostComplaintFixture(context,role),page=await context.newPage();await page.goto(`${base}${host?'/host/finance/complaints':`/bookings/${bookingId}/complaints`}`);await page.getByText('Tài khoản không có quyền xem trang này.').waitFor();assert.equal(f.calls.length,0);await context.close();console.log(`PASS ${role} wrong role no API`);
    }
    for(const host of [false,true]) {
      const context=await browser.newContext(),f=await guestHostComplaintFixture(context,host?'HOST':'TENANT'),page=await context.newPage();f.mode('stale');const form=await open(page,host);await form.locator('input').fill('Synthetic stale text');await form.getByRole('button',{name:host?'Gửi phản hồi':'Gửi khiếu nại',exact:true}).click();await page.getByText('Phiên bản đã thay đổi.').waitFor();assert.equal(f.writes.length,1);assert.equal(await form.locator('input').inputValue(),'Synthetic stale text');await context.close();console.log(`PASS ${host?'Host':'Guest'} stale preserves text`);
    }
    for(const host of [false,true])for(const kind of ['read','write']) {
      const context=await browser.newContext(),f=await guestHostComplaintFixture(context,host?'HOST':'TENANT'),page=await context.newPage();let release;const gate=new Promise(done=>{release=done;});
      if(kind==='read'){f.hold(gate);await page.goto(`${base}${host?'/host/finance/complaints':`/bookings/${bookingId}/complaints`}`);await page.getByText(host?'Đang tải khiếu nại…':'Đang tải dữ liệu khiếu nại…',{exact:true}).waitFor();}
      else {const form=await open(page,host);await form.locator('input').fill('Synthetic delayed write');f.hold(gate);await form.getByRole('button',{name:host?'Gửi phản hồi':'Gửi khiếu nại',exact:true}).click();await form.getByRole('button',{name:'Đang gửi…',exact:true}).waitFor();}
      await page.evaluate(()=>{const revision='fixture-complaint-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');const channel=new BroadcastChannel('trotot-auth-v1');channel.postMessage({type:'logout',revision});channel.close();});
      await page.getByText('để xem khiếu nại.',{exact:false}).waitFor();const late=page.waitForResponse(r=>r.url().includes('/api/management/'),{timeout:3000}).catch(()=>{});release();await late;assert.equal(await page.getByRole('form').count(),0);assert.equal(await page.getByText('Máy chủ đã ghi nhận.',{exact:false}).count(),0);await context.close();console.log(`PASS ${host?'Host':'Guest'} late ${kind} hidden after logout`);
    }
    for(const host of [false,true]) {
      const context=await browser.newContext(),f=await guestHostComplaintFixture(context,host?'HOST':'TENANT'),page=await context.newPage();f.mode(host?'closed':'expired');const form=await open(page,host);
      if(host){await page.getByRole('heading',{name:'Quyết định cho chủ nhà',exact:true}).waitFor();assert.equal(await form.getByRole('button',{name:'Gửi phản hồi',exact:true}).isDisabled(),true);assert.equal(f.writes.length,0);assert.equal(await page.getByText('Chứng cứ nội bộ:',{exact:false}).count(),0);}
      else {await form.locator('input').fill('Synthetic out of window text');await form.getByRole('button',{name:'Gửi khiếu nại',exact:true}).click();await page.getByText('Đã qua thời hạn khiếu nại.').waitFor();assert.equal(f.writes.length,1);assert.equal(await form.locator('input').inputValue(),'Synthetic out of window text');}
      await context.close();console.log(`PASS ${host?'Host resolved blocked/private proof absent':'Guest server window refusal preserves text'}`);
    }
  }finally{await browser.close();}
}
