// Synthetic read fixtures; never a real payout or payment provider.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {bankFixture} from './host-bank-browser-check.mjs';
const require=createRequire(import.meta.url),base=process.argv[2]||'http://127.0.0.1:3317';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});
const at='2026-10-06T00:00:00.000Z',id='00000000-0000-4000-8000-000000000001';
const evidence='../.tmp/s4-admin-payout-read-ui';await mkdir(evidence,{recursive:true});
async function fixture(context,role='ADMIN') {
  await bankFixture(context,role);let mode='ok';const calls=[];
  const row={id,hostId:id,amount:'999999999999999999',status:'APPROVED',version:2,cutoff:at,createdAt:at,bankCode:'FIXTURE',accountNumber:'****12AB'};
  await context.route('**/api/management/admin/finance/payouts**',route=>{
    const request=route.request(),url=new URL(request.url());calls.push(request.method());
    if(mode==='error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE',message:'Lỗi kiểm thử'}});
    if(url.pathname.endsWith('/payouts'))return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='empty'?[]:[row],meta:{page:1,limit:20,total:mode==='empty'?0:1,totalPages:mode==='empty'?0:1}}});
    return route.fulfill({json:{success:true,message:'Synthetic',data:{...row,accountNumber:'0012AB',accountName:mode==='invalid'?null:'Synthetic Host',bankAccountId:id,bankVersion:1,
      operations:{canApprove:false,canExport:true,canConfirmPaid:true,canCancel:true,reviewRequired:false},items:[{bookingId:id,amount:row.amount,eligibleAt:at,status:'ACTIVE'}],
      events:['CREATED','APPROVED'].map(action=>({action,actorId:id,reason:'Synthetic review',createdAt:at})),confirmation:null}}});
  });return {calls,mode:value=>{mode=value;}};
}
try {
  for(const width of [375,1440,1920]) {
    const context=await browser.newContext({viewport:{width,height:1000}}),f=await fixture(context),page=await context.newPage();
    await page.goto(`${base}/admin/finance/payouts`);await page.getByRole('button',{name:'Xem chi tiết',exact:true}).click();
    await page.getByText('Lô chưa có xác nhận đã chi trả.',{exact:true}).waitFor();assert.equal(await page.getByText('0012AB',{exact:true}).count(),1);
    assert.equal(await page.getByText('999.999.999.999.999.999đ',{exact:true}).count(),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert(f.calls.every(method=>method==='GET'));
    await page.screenshot({path:`${evidence}/read-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${width}: exact amount, masked list/private detail, approved not paid, read only/no overflow`);
  }
  for(const role of ['HOST','TENANT']) {
    const context=await browser.newContext(),f=await fixture(context,role),page=await context.newPage();await page.goto(`${base}/admin/finance/payouts`);
    await page.getByText('Trang này chỉ dành cho Admin đang hoạt động.').waitFor();assert.equal(f.calls.length,0);await context.close();console.log(`PASS ${role} gate`);
  }
  for(const mode of ['empty','error','invalid']) {
    const context=await browser.newContext(),f=await fixture(context),page=await context.newPage();if(mode!=='invalid')f.mode(mode);
    await page.goto(`${base}/admin/finance/payouts`);
    if(mode==='empty')await page.getByText('Chưa có lô ở trang này.').waitFor();
    else if(mode==='error')await page.getByRole('button',{name:'Thử lại',exact:true}).waitFor();
    else {f.mode(mode);await page.getByRole('button',{name:'Xem chi tiết',exact:true}).click();await page.getByText('Dữ liệu lô chi trả chưa hợp lệ.',{exact:false}).waitFor();assert.equal(await page.getByText('0012AB',{exact:true}).count(),0);}
    await context.close();console.log(`PASS ${mode}`);
  }
} finally {await browser.close();}
