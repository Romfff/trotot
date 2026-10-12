// Synthetic intercepted Auth/bank only. Never a real verification or transfer.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bankFixture} from './host-bank-browser-check.mjs';
const require=createRequire(import.meta.url),at='2026-10-06T00:00:00.000Z';
const id='00000000-0000-4000-8000-000000000002',hostId='00000000-0000-4000-8000-000000000001';
export async function adminBankFixture(context,role='ADMIN') {
  await bankFixture(context,role);
  let state={id,hostId,bankCode:'FIXTURE',accountNumber:'0012AB',accountName:'Synthetic Host',status:'PENDING',createdAt:at,version:1,isCurrent:true,
    events:[{id,actorId:hostId,action:'SUBMITTED',reason:'Synthetic submission',evidenceNote:'Test fixture only',createdAt:at}]};
  let mode='ok',gate=null,result=null;const calls=[],writes=[];
  await context.route('**/api/management/admin/finance/bank-accounts**',async route=>{
    const request=route.request(),url=new URL(request.url());calls.push({method:request.method(),path:url.pathname});
    if(request.method()==='GET') {
      if(gate)await gate;
      if(mode==='read-error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE',message:'Lỗi kiểm thử'}});
      if(url.pathname.endsWith('/bank-accounts')) {
        const {accountName,events,...row}=state;void accountName;void events;
        return route.fulfill({json:{success:true,message:'Synthetic list',data:mode==='empty'?[]:[{...row,accountNumber:'****12AB'}],meta:{page:Number(url.searchParams.get('page')),limit:20,total:mode==='empty'?0:1,totalPages:mode==='empty'?0:1}}});
      }
      return route.fulfill({json:{success:true,message:'Synthetic detail',data:mode==='invalid'?{...state,accountName:null}:state}});
    }
    writes.push({path:url.pathname,key:request.headers()['idempotency-key'],body:request.postDataJSON()});
    if(mode==='stale')return route.fulfill({status:409,json:{success:false,errorCode:'STALE_BANK_VERSION',message:'Thông tin ngân hàng đã thay đổi. Vui lòng tải lại.'}});
    if(!result) {
      const status=url.pathname.endsWith('/verify')?'VERIFIED':'REJECTED';
      result={id,version:2,status,payoutReady:status==='VERIFIED'};
      state={...state,status,version:2,events:[...state.events,{id:'00000000-0000-4000-8000-000000000003',actorId:hostId,action:status,...request.postDataJSON(),createdAt:at}]};
    }
    if(mode==='lost')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_LOST_RESPONSE',message:'Synthetic post-commit delivery failure'}});
    return route.fulfill({json:{success:true,message:'Synthetic review',data:result}});
  });
  return {calls,writes,mode:value=>{mode=value;},hold:value=>{gate=value;},historical:()=>{state={...state,isCurrent:false};}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const base=process.argv[2]||'http://127.0.0.1:3316';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
  const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});
  const evidence='../.tmp/s4-admin-bank-ui';await mkdir(evidence,{recursive:true});
  try {
    for(const width of [375,1440,1920]) {
      const context=await browser.newContext({viewport:{width,height:1000}}),fixture=await adminBankFixture(context),page=await context.newPage();
      await page.goto(`${base}/admin/finance/bank-accounts`);await page.getByRole('button',{name:'Xem tài khoản',exact:true}).waitFor();
      assert.equal(await page.getByText('0012AB',{exact:true}).count(),0);
      await page.getByRole('button',{name:'Xem tài khoản',exact:true}).click();await page.getByText('0012AB',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Xác minh tài khoản',exact:true}).click();assert.equal(fixture.writes.length,0);
      assert.equal(await page.getByText('Nhập từ 1 đến 500 ký tự.',{exact:true}).count(),2);
      await page.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic review');await page.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Test fixture, no real bank verification');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${evidence}/review-${width}.png`,fullPage:true});
      fixture.mode('lost');await page.getByRole('button',{name:'Xác minh tài khoản',exact:true}).click();await page.getByRole('button',{name:'Thử lại cùng yêu cầu',exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Xem tài khoản',exact:true}).isDisabled(),true);
      assert.notEqual(await page.getByLabel('Lý do xử lý',{exact:true}).getAttribute('readonly'),null);
      fixture.mode('ok');await page.getByRole('button',{name:'Thử lại cùng yêu cầu',exact:true}).click();await page.getByText('Máy chủ đã ghi nhận xử lý.',{exact:false}).waitFor();
      assert.equal(fixture.writes.length,2);assert.deepEqual(fixture.writes[0],fixture.writes[1]);assert.match(fixture.writes[0].key,/^[a-f0-9-]{36}$/);
      await page.getByText('Đã xác minh · Bản hiện tại',{exact:true}).first().waitFor();
      assert.equal(await page.getByRole('button',{name:'Xác minh tài khoản',exact:true}).isDisabled(),true);
      assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('0012AB')),false);
      await context.close();console.log(`PASS ${width}: private detail, validation, same-key lost-response replay, no storage, no overflow`);
    }
    for(const role of ['HOST','TENANT']) {
      const context=await browser.newContext(),fixture=await adminBankFixture(context,role),page=await context.newPage();
      await page.goto(`${base}/admin/finance/bank-accounts`);await page.getByText('Trang này chỉ dành cho Admin đang hoạt động.').waitFor();assert.equal(fixture.calls.length,0);
      await context.close();console.log(`PASS ${role}: no admin bank request`);
    }
    for(const mode of ['empty','read-error','invalid','historical','stale','reject']) {
      const context=await browser.newContext(),fixture=await adminBankFixture(context),page=await context.newPage();
      if(['empty','read-error'].includes(mode))fixture.mode(mode);if(mode==='historical')fixture.historical();
      await page.goto(`${base}/admin/finance/bank-accounts`);
      if(mode==='empty')await page.getByText('Chưa có tài khoản ở trang này.').waitFor();
      else if(mode==='read-error') {await page.getByRole('button',{name:'Thử lại tải dữ liệu',exact:true}).waitFor();fixture.mode('ok');await page.getByRole('button',{name:'Thử lại tải dữ liệu',exact:true}).click();await page.getByRole('button',{name:'Xem tài khoản',exact:true}).waitFor();}
      else {
        if(mode==='invalid')fixture.mode('invalid');
        await page.getByRole('button',{name:'Xem tài khoản',exact:true}).click();
        if(mode==='invalid')await page.getByText('Dữ liệu ngân hàng chưa hợp lệ.',{exact:false}).waitFor();
        else {
          await page.getByText('0012AB',{exact:true}).waitFor();
          if(mode==='historical')assert.equal(await page.getByRole('button',{name:'Xác minh tài khoản',exact:true}).isDisabled(),true);
          else {
            await page.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic review');await page.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Synthetic evidence');
            if(mode==='stale')fixture.mode('stale');
            await page.getByRole('button',{name:mode==='reject'?'Từ chối tài khoản':'Xác minh tài khoản',exact:true}).click();
            if(mode==='stale')await page.getByText('Thông tin ngân hàng đã thay đổi. Vui lòng tải lại.',{exact:true}).waitFor();
            else await page.getByText('Đã từ chối · Bản hiện tại',{exact:true}).first().waitFor();
          }
        }
      }
      await context.close();console.log(`PASS ${mode}`);
    }
    {
      const context=await browser.newContext(),fixture=await adminBankFixture(context),page=await context.newPage();let release;
      fixture.hold(new Promise(resolve=>{release=resolve;}));await page.goto(`${base}/admin/finance/bank-accounts`);await page.getByRole('status',{name:'Đang tải ngân hàng',exact:true}).waitFor();
      await page.evaluate(()=>{const revision='fixture-admin-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');const channel=new BroadcastChannel('trotot-auth-v1');channel.postMessage({type:'logout',revision});channel.close();});
      await page.getByText('để xem trang quản trị.',{exact:false}).waitFor();release();fixture.hold(null);await page.waitForTimeout(200);
      assert.equal(await page.getByRole('button',{name:'Xem tài khoản',exact:true}).count(),0);await context.close();console.log('PASS late read cannot restore private data after logout');
    }
  } finally {await browser.close();}
}
