// Browser rendering and interactions with intercepted synthetic Auth/API only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {financeFixture} from './host-finance-browser-check.mjs';
import {complaintFixture} from './admin-complaints-browser-check.mjs';
import {bankFixture} from './host-bank-browser-check.mjs';
const require=createRequire(import.meta.url),base=process.argv[2],{chromium}=require(process.argv[3]);
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local only');
const browser=await chromium.launch({headless:true,channel:'msedge'}),id='00000000-0000-4000-8000-000000000001',at='2026-10-07T00:00:00.000Z';
const evidence='../.tmp/s4-debt-ui';await mkdir(evidence,{recursive:true});
const pageData=data=>({success:true,message:'Synthetic',data,meta:{page:1,limit:20,total:data.length,totalPages:data.length?1:0}});
try {
 for(const width of [375,1440]){
  const context=await browser.newContext({viewport:{width,height:950}});await financeFixture(context);
  await context.route('**/api/management/host/finance/debts**',r=>r.fulfill({json:pageData([{id,bookingId:id,amount:'450000',remainingAmount:'0',createdAt:at}])}));
  await context.route('**/api/management/host/finance/settlements**',r=>r.fulfill({json:pageData([{id,cutoff:at,grossEligible:'450000',debtOffset:'450000',netPayout:'0',batchId:null,status:'OFFSET',createdAt:at}])}));
  await context.route('**/api/management/host/finance/revenue**',r=>r.fulfill({json:{success:true,message:'Synthetic',data:{year:2026,timeZone:'Asia/Ho_Chi_Minh',basis:'LEDGER_POSTED',currency:'VND',months:Array.from({length:12},(_,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,roomAndCleaning:'0',commission:'0',refundRecognized:'0',hostEarned:'0',paidOut:'0',reviewCount:0,isComplete:true}))}}}));
  const page=await context.newPage();await page.goto(`${base}/host/finance`);
  await page.getByText('Đã bù trừ · không chuyển tiền',{exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`${evidence}/host-${width}.png`,fullPage:true});await context.close();
  const admin=await browser.newContext({viewport:{width,height:950}});await complaintFixture(admin);
  await admin.route(`**/api/management/admin/finance/complaints/${id}`,r=>r.fulfill({json:{success:true,message:'Synthetic',data:{id,bookingId:id,reason:'Mixed-source fixture',status:'OPEN',assigneeId:null,version:1,createdAt:at,overdue:true,events:[],resolution:null,
   settlementReview:{originalHostAmount:'900000',offsetAmount:'450000',paidAmount:'450000',potentialExcessAmount:'450000'},
   bookingSnapshot:{version:7,bookingStatus:'COMPLETED',paymentStatus:'PAID',checkoutAt:at,amounts:{baseAmount:'1000000',cleaningFee:'0',serviceFee:'0',taxAmount:'0',totalAmount:'1000000'},approvedRefundAmounts:{baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0'},refundedAmount:'0',pendingRefundAmount:'0',remainingRefundableAmounts:null,reviewRequired:true}}}}));
  const p=await admin.newPage();await p.goto(`${base}/admin/finance/complaints`);await p.getByRole('button',{name:'Xem khiếu nại',exact:true}).click();
  await p.getByRole('heading',{name:'Đang đối soát · quá 7 ngày'}).waitFor();
  assert(await p.getByRole('button',{name:'Chốt quyết định cho chủ nhà',exact:true}).isDisabled());
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await p.screenshot({path:`${evidence}/review-${width}.png`,fullPage:true});await admin.close();
  console.log(`PASS ${width}: Host offset is not paid; Admin review numbers/overdue/no overflow`);
 }
 const context=await browser.newContext();await bankFixture(context,'ADMIN');let writes=[];
 await context.route('**/api/management/admin/finance/payouts**',r=>r.fulfill({json:pageData([])}));
 await context.route('**/api/management/admin/finance/settlements',async r=>{writes.push({key:r.request().headers()['idempotency-key'],body:r.request().postDataJSON()});await r.fulfill({json:{success:true,message:'Synthetic',data:{id,hostId:id,cutoff:at,grossEligible:'450000',debtOffset:'450000',netPayout:'0',batchId:null}}});});
 const p=await context.newPage();await p.goto(`${base}/admin/finance/payouts`);const form=p.getByRole('form',{name:'Tạo lô chi trả'});
 await form.getByLabel('ID Host (UUID)').fill(id);await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic settlement');await form.getByRole('button',{name:'Quyết toán và lập lô',exact:true}).click();
 await p.getByText('Đã ghi bù trừ toàn bộ khoản đủ điều kiện. Không lập lô 0đ và không chuyển tiền.').waitFor();assert.equal(writes.length,1);assert(writes[0].key);await context.close();
 console.log('PASS zero-net settlement records offset without opening a fake payout');
}finally{await browser.close();}
