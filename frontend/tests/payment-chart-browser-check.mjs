// Presentation fixtures only: no real token, gateway, DB, bank transfer or payment confirmation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bankFixture} from './host-bank-browser-check.mjs';
import {financeFixture} from './host-finance-browser-check.mjs';
export const fixtureBookingId='00000000-0000-4000-8000-000000000088';
export async function paymentChartFixture(context,kind='payment') {
  if(kind==='chart') {
    await financeFixture(context);
    await context.route('**/api/management/host/finance/revenue**',route=>{
      const year=Number(new URL(route.request().url()).searchParams.get('year'));
      return route.fulfill({json:{success:true,message:'Synthetic monthly report',data:{year,timeZone:'Asia/Ho_Chi_Minh',basis:'LEDGER_POSTED',currency:'VND',
        months:Array.from({length:12},(_,i)=>({month:`${year}-${String(i+1).padStart(2,'0')}`,roomAndCleaning:i===9?'999999999999999999':'0',commission:'0',refundRecognized:'0',hostEarned:i===9?'999999999999999999':i===8?'-990':'0',paidOut:'0',reviewCount:i===4?1:0,isComplete:i!==4}))}}});
    });
    return;
  }
  await bankFixture(context,'TENANT');
  await context.route(`**/api/management/bookings/${fixtureBookingId}/payment-status`,route=>route.fulfill({json:{success:true,message:'Synthetic unconfigured payment',data:{bookingId:fixtureBookingId,bookingCode:'SYNTHETIC-UI-ONLY',version:1,bookingStatus:'PENDING_PAYMENT',paymentStatus:'NOT_CONFIGURED',amount:'9999999999',currency:'VND',serverTime:'2026-10-07T12:00:00.000Z',reservationExpiresAt:'2026-10-07T12:15:00.000Z',reservationExpired:false,providerConnected:false,payment:null}}}));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const base=process.argv[2];if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local presentation fixture only');
  const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');const browser=await chromium.launch({channel:'msedge',headless:true});
  const out=process.env.BROWSER_EVIDENCE_DIR||'../.tmp/s4-payment-chart-fixture';await mkdir(out,{recursive:true});
  try {for(const kind of ['payment','chart'])for(const width of [375,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000}});await paymentChartFixture(context,kind);const page=await context.newPage();
    await page.goto(base+(kind==='chart'?'/host/finance':`/bookings/${fixtureBookingId}/payment`));
    if(kind==='chart') {const chart=page.getByRole('region',{name:'Tài chính theo tháng ghi sổ',exact:true});await chart.getByText('999.999.999.999.999.999đ',{exact:true}).waitFor();await chart.getByText('-990đ',{exact:true}).waitFor();await chart.getByText('Cần đối soát',{exact:true}).waitFor();}
    else {await page.getByText('Chưa thanh toán.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:/Chuẩn bị phiên/}).count(),0);assert.equal(await page.getByText('Chưa kết nối cổng thanh toán; đơn chưa được thanh toán.',{exact:true}).count(),0);}
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`${out}/${kind}-${width}.png`,fullPage:true});await context.close();console.log(`PASS fixture ${kind} ${width}: exact amounts/unknown/no overflow`);
  }}finally{await browser.close();}
}
