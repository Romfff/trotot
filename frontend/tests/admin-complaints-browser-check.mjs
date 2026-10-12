// Intercepted Auth/API fixtures only. Never a real complaint decision or money movement.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bankFixture} from './host-bank-browser-check.mjs';
const id='00000000-0000-4000-8000-000000000001',at='2026-10-06T00:00:00.000Z';
export async function complaintFixture(context,role='ADMIN') {
  await bankFixture(context,role);let mode='ok',readGate=null,writeGate=null,result=null;
  let row={id,bookingId:id,reason:'Khách phản ánh phòng khác mô tả. '+ 'Nội dung kiểm thử dài để rà màn hẹp. '.repeat(6),status:'OPEN',assigneeId:null,version:1,createdAt:at,overdue:true};
  const amounts={baseAmount:'1000',cleaningFee:'100',serviceFee:'0',taxAmount:'0'};
  let bookingSnapshot={version:7,bookingStatus:'CONFIRMED',paymentStatus:'PAID',checkoutAt:'2026-10-10T05:00:00.000Z',amounts:{...amounts,totalAmount:'1100'},
    approvedRefundAmounts:{baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0'},refundedAmount:'0',pendingRefundAmount:'0',remainingRefundableAmounts:amounts,reviewRequired:false};
  let events=[{id,action:'CREATED',message:row.reason,createdAt:at}],resolution=null;const writes=[],calls=[];
  await context.route('**/api/management/admin/finance/complaints**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;calls.push({method:request.method(),path});
    if(request.method()==='GET') {
      if(readGate)await readGate;
      if(mode==='error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE',message:'Lỗi kiểm thử'}});
      if(path.endsWith('/complaints'))return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='empty'?[]:[row],meta:{page:1,limit:20,total:mode==='empty'?0:1,totalPages:mode==='empty'?0:1}}});
      return route.fulfill({json:{success:true,message:'Synthetic',data:{...row,events,resolution:mode==='invalid'?{}:resolution,bookingSnapshot}}});
    }
    const body=request.postDataJSON(),key=request.headers()['idempotency-key'];writes.push({path,body,key});if(writeGate)await writeGate;
    if(mode==='stale')return route.fulfill({status:409,json:{success:false,errorCode:'STALE_COMPLAINT_VERSION',message:'Khiếu nại đã thay đổi. Vui lòng tải lại.'}});
    if(mode==='stale-booking'){bookingSnapshot={...bookingSnapshot,version:8};mode='ok';return route.fulfill({status:409,json:{success:false,errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'}});}
    if(!result||result.key!==key) {
      const action=path.endsWith('/assign')?'ASSIGNED':'RESOLVED';row={...row,version:row.version+1,...(action==='ASSIGNED'?{assigneeId:body.assigneeId}:{status:'RESOLVED',overdue:false})};
      events=[...events,{id:`00000000-0000-4000-8000-${String(row.version).padStart(12,'0')}`,action,message:body.reason.trim(),createdAt:at}];
      if(action==='RESOLVED')resolution={decision:body.decision,reason:body.reason.trim(),resolvedAt:at,actorId:id,evidenceNote:body.evidenceNote.trim(),
        ...(body.decision==='HOST'?{}:{refundObligation:{id,amount:String(Object.values(body.allocation).reduce((sum,v)=>sum+BigInt(v),0n)),status:'PENDING'},
          holdUntil:body.decision==='PARTIAL_REFUND'?'2026-10-09T00:00:00.000Z':null})};
      const {actorId,evidenceNote,...publicResolution}=resolution||{};void actorId;void evidenceNote;
      result={key,data:{...row,...(action==='RESOLVED'?{resolution:publicResolution}:{})}};
    }
    if(mode==='lost'){mode='ok';return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_LOST',message:'Synthetic lost delivery after fixture commit'}});}
    return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='invalid-write'?{...result.data,bookingId:'00000000-0000-4000-8000-000000000099'}:result.data}});
  });return {writes,calls,mode:v=>{mode=v;},holdRead:v=>{readGate=v;},holdWrite:v=>{writeGate=v;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const require=createRequire(import.meta.url),base=process.argv[2]||'http://127.0.0.1:3321';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
  const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});
  const evidence='../.tmp/s4-admin-complaint-ui';await mkdir(evidence,{recursive:true});
  const open=async page=>{await page.goto(`${base}/admin/finance/complaints`);await page.getByRole('button',{name:'Xem khiếu nại',exact:true}).click();return page.getByRole('form',{name:'Xử lý khiếu nại'});};
  const fill=async form=>{await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic review');await form.getByLabel('Ghi chú chứng cứ (khi chốt quyết định)',{exact:true}).fill('Private synthetic evidence');};
  const logout=()=>{const revision='fixture-complaint-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');const channel=new BroadcastChannel('trotot-auth-v1');channel.postMessage({type:'logout',revision});channel.close();};
  try {
    for(const width of [375,1440,1920]) {
      const context=await browser.newContext({viewport:{width,height:1000}}),f=await complaintFixture(context),page=await context.newPage(),form=await open(page);
      await form.getByRole('button',{name:'Phân công',exact:true}).click();assert.equal(f.writes.length,0);assert.equal(await form.locator('[name=reason]').evaluate(el=>el===document.activeElement),true);
      await form.getByLabel('UUID Admin phụ trách (khi phân công)',{exact:true}).fill(id);await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic assignment');
      await form.getByRole('button',{name:'Phân công',exact:true}).click();await form.getByText('Máy chủ đã ghi nhận thao tác.',{exact:false}).waitFor();
      assert.equal(f.writes.length,1);assert.equal(await form.getByRole('button',{name:'Chốt quyết định cho chủ nhà',exact:true}).count(),1);
      await fill(form);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidence}/open-${width}.png`,fullPage:true});
      f.mode('lost');await form.getByRole('button',{name:'Chốt quyết định cho chủ nhà',exact:true}).click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Xem khiếu nại',exact:true}).isDisabled(),true);assert.equal(await form.getByLabel('Lý do xử lý',{exact:true}).getAttribute('readonly'),'');
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByRole('heading',{name:'Quyết định cho chủ nhà',exact:true}).waitFor();
      assert.equal(f.writes.length,3);assert.deepEqual(f.writes[1],f.writes[2]);assert.equal(await form.getByLabel('Lý do xử lý',{exact:true}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('Private synthetic evidence')),false);
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidence}/resolved-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${width}: validation/focus, assign stays OPEN, resolve stable replay, terminal/evidence/no overflow`);
    }
    for(const role of ['HOST','TENANT']) {
      const context=await browser.newContext(),f=await complaintFixture(context,role),page=await context.newPage();await page.goto(`${base}/admin/finance/complaints`);
      await page.getByText('Trang này chỉ dành cho Admin đang hoạt động.').waitFor();assert.equal(f.calls.length,0);assert.equal(await page.getByRole('form').count(),0);await context.close();console.log(`PASS ${role} no Admin API`);
    }
    {
      const context=await browser.newContext({viewport:{width:375,height:1000}}),f=await complaintFixture(context),page=await context.newPage(),form=await open(page);
      await fill(form);await form.getByRole('radio',{name:'Hoàn một phần',exact:true}).check();
      for(const [name,value] of Object.entries({baseAmount:'500',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}))await form.locator(`[name=${name}]`).fill(value);
      f.mode('stale-booking');await form.getByRole('button',{name:'Duyệt khoản hoàn',exact:true}).click();
      await form.getByRole('button',{name:'Đã xem lại snapshot đơn',exact:true}).waitFor();
      assert.equal(await form.getByRole('button',{name:'Duyệt khoản hoàn',exact:true}).isDisabled(),true);
      assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.expectedBookingVersion,7);
      assert.equal(await form.locator('[name=baseAmount]').inputValue(),'500');
      await form.getByRole('button',{name:'Đã xem lại snapshot đơn',exact:true}).click();
      await form.getByRole('button',{name:'Duyệt khoản hoàn',exact:true}).click();await page.getByRole('heading',{name:'Hoàn một phần',exact:true}).waitFor();
      assert.equal(f.writes.length,2);assert.equal(f.writes[1].body.expectedBookingVersion,8);assert.notEqual(f.writes[0].key,f.writes[1].key);
      await context.close();console.log('PASS stale booking: snapshot reload, preserve input, explicit review, new key/version only after review');
    }
    for(const width of [375,1440])for(const decision of ['FULL_REFUND','PARTIAL_REFUND']) {
      const context=await browser.newContext({viewport:{width,height:1000}}),f=await complaintFixture(context),page=await context.newPage(),form=await open(page);
      await fill(form);await form.getByRole('radio',{name:decision==='FULL_REFUND'?'Hoàn toàn bộ':'Hoàn một phần',exact:true}).check();
      await form.getByRole('button',{name:'Duyệt khoản hoàn',exact:true}).click();assert.equal(f.writes.length,0);
      assert.equal(await form.locator('[name=baseAmount]').evaluate(el=>el===document.activeElement),true);
      assert.equal(await form.locator('input[name=expectedBookingVersion]').count(),0);
      for(const [name,value] of Object.entries({baseAmount:'500',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}))await form.locator(`[name=${name}]`).fill(value);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidence}/${decision}-open-${width}.png`,fullPage:true});
      f.mode('lost');await form.getByRole('button',{name:'Duyệt khoản hoàn',exact:true}).click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();
      assert.equal(await form.getByRole('radio',{name:'Quyết định cho chủ nhà',exact:true}).isDisabled(),true);
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByRole('heading',{name:decision==='FULL_REFUND'?'Hoàn toàn bộ':'Hoàn một phần',exact:true}).waitFor();
      assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.writes[0].body.expectedBookingVersion,7);assert.equal(f.writes[0].body.expectedVersion,1);
      await page.getByText('Chờ Admin chuyển trả và xác nhận bằng chứng.',{exact:false}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${evidence}/${decision}-resolved-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${decision} ${width}: validate/version/allocation/stable replay/PENDING/no overflow`);
    }
    for(const mode of ['empty','error','invalid','stale','invalid-write']) {
      const context=await browser.newContext(),f=await complaintFixture(context),page=await context.newPage();f.mode(mode);await page.goto(`${base}/admin/finance/complaints`);
      if(mode==='empty')await page.getByText('Chưa có khiếu nại ở trang này.').waitFor();
      else if(mode==='error')await page.getByRole('button',{name:'Thử lại danh sách'}).waitFor();
      else {await page.getByRole('button',{name:'Xem khiếu nại',exact:true}).click();const form=page.getByRole('form',{name:'Xử lý khiếu nại'});
        if(mode==='invalid'){await page.getByText('Dữ liệu khiếu nại chưa hợp lệ.',{exact:false}).waitFor();assert.equal(await form.getByRole('button',{name:'Chốt quyết định cho chủ nhà'}).isDisabled(),true);}
        else {await fill(form);await form.getByRole('button',{name:'Chốt quyết định cho chủ nhà'}).click();if(mode==='stale')await form.getByText('Khiếu nại đã thay đổi.',{exact:false}).waitFor();else await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();assert.equal(f.writes.length,1);}}
      await context.close();console.log(`PASS ${mode}`);
    }
    for(const kind of ['read','write']) {
      const context=await browser.newContext(),f=await complaintFixture(context),page=await context.newPage();let release;
      const gate=new Promise(done=>{release=done;});
      if(kind==='read'){f.holdRead(gate);await page.goto(`${base}/admin/finance/complaints`);await page.getByText('Đang tải khiếu nại…').waitFor();}
      else {const form=await open(page);await fill(form);f.holdWrite(gate);await form.getByRole('button',{name:'Chốt quyết định cho chủ nhà'}).click();await page.getByText('Đang ghi nhận…',{exact:true}).waitFor();}
      await page.evaluate(logout);await page.getByText('để xem trang quản trị.',{exact:false}).waitFor();
      const late=page.waitForResponse(r=>r.url().includes('/api/management/admin/finance/complaints'),{timeout:3000}).catch(()=>{});release();await late;
      assert.equal(await page.getByRole('form').count(),0);assert.equal(await page.getByRole('heading',{name:'Quyết định cho chủ nhà',exact:true}).count(),0);await context.close();console.log(`PASS late ${kind} cannot restore private UI after logout`);
    }
  }finally{await browser.close();}
}
