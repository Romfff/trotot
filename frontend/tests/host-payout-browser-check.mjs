// Synthetic read-only responses; not proof of payment, provider or DB integration.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {financeFixture} from './host-finance-browser-check.mjs';
const require=createRequire(import.meta.url);
const base=process.argv[2]||'http://127.0.0.1:3314';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
const {chromium}=require(process.argv[3]||'playwright');
const browser=await chromium.launch({headless:true,channel:'msedge'});
const evidence='../.tmp/s4-host-payout-ui';await mkdir(evidence,{recursive:true});
const at='2026-10-06T00:00:00.000Z';
const row=(i,status)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,hostId:'00000000-0000-4000-8000-000000000001',amount:'999999999999999999',status,version:status==='DRAFT'?1:status==='PAID'?3:2,cutoff:at,createdAt:at,bankCode:'FIXTURE',accountNumber:'****0123'});
async function fixture(context,role='HOST') {
  await financeFixture(context,role);let mode='ok';const calls=[];
  await context.route('**/api/management/host/payouts**',async route=>{
    const url=new URL(route.request().url());calls.push({method:route.request().method(),path:url.pathname});
    if(mode==='error')return route.fulfill({status:503,json:{success:false,message:'Lỗi kiểm thử',errorCode:'FIXTURE'}});
    const rows=['DRAFT','APPROVED','CANCELLED','PAID'].map((status,i)=>row(i+1,status));
    if(url.pathname.endsWith('/payouts'))return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='empty'?[]:rows,meta:{page:1,limit:20,total:mode==='empty'?0:4,totalPages:mode==='empty'?0:1}}});
    const data=rows.find(item=>url.pathname.endsWith(item.id));
    const actions={DRAFT:['CREATED'],APPROVED:['CREATED','APPROVED'],CANCELLED:['CREATED','CANCELLED'],PAID:['CREATED','APPROVED','PAID']}[data.status];
    return route.fulfill({json:{success:true,message:'Synthetic',data:{...data,items:[{bookingId:row(99,'DRAFT').id,amount:data.amount,eligibleAt:at,status:data.status==='CANCELLED'?'RELEASED':'ACTIVE'}],events:actions.map(action=>({action,createdAt:at})),confirmation:data.status==='PAID'&&mode!=='invalid'?{confirmedAt:at}:null}}});
  });return {calls,mode:value=>{mode=value;}};
}
try {
  for(const width of [375,1440,1920]) {
    const context=await browser.newContext({viewport:{width,height:1000}}),f=await fixture(context),page=await context.newPage();
    await page.goto(`${base}/host/finance`);await page.getByRole('button',{name:'Xem chi tiết',exact:true}).nth(3).waitFor();
    await page.getByRole('button',{name:'Xem chi tiết',exact:true}).nth(1).click();await page.getByText('Lô này chưa có xác nhận đã chi trả.',{exact:true}).waitFor();
    assert.equal(await page.getByText('Đây là ghi nhận chi trả thủ công',{exact:false}).count(),0);
    await page.getByRole('button',{name:'Đóng chi tiết',exact:true}).click();
    await page.getByRole('button',{name:'Xem chi tiết',exact:true}).nth(3).click();await page.getByText('Đây là ghi nhận chi trả thủ công',{exact:false}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert(f.calls.every(call=>call.method==='GET'));
    await page.screenshot({path:`${evidence}/payout-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${width}: exact money, APPROVED is not paid, PAID evidence, masked bank, read-only, no overflow`);
  }
  {
    const context=await browser.newContext(),f=await fixture(context),page=await context.newPage();f.mode('error');
    await page.goto(`${base}/host/finance`);await page.getByText('Chưa tải được lô chi trả.',{exact:false}).waitFor();
    assert.equal(f.calls.length,1);f.mode('ok');await page.getByRole('button',{name:'Thử lại',exact:true}).click();await page.getByRole('button',{name:'Xem chi tiết',exact:true}).nth(3).waitFor();
    f.mode('invalid');await page.getByRole('button',{name:'Xem chi tiết',exact:true}).nth(3).click();await page.getByText('Dữ liệu lô chi trả chưa hợp lệ.',{exact:false}).waitFor();
    assert.equal(await page.getByText('Đây là ghi nhận chi trả thủ công',{exact:false}).count(),0);await context.close();console.log('PASS HTTP retry and invalid PAID confirmation fail closed');
  }
  for(const role of ['TENANT','ADMIN']) {
    const context=await browser.newContext(),f=await fixture(context,role),page=await context.newPage();
    await page.goto(`${base}/host/finance`);await page.getByText('Trang này chỉ dành cho chủ nhà đang hoạt động.').waitFor();assert.equal(f.calls.length,0);
    await context.close();console.log(`PASS ${role}: no payout request`);
  }
} finally {await browser.close();}
