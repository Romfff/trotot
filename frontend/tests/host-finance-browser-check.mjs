// Browser rendering against synthetic intercepted APIs, never payment or DB writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bankFixture} from './host-bank-browser-check.mjs';
const require=createRequire(import.meta.url);
export async function financeFixture(context,role='HOST') {
  await bankFixture(context,role);
  await context.route('**/api/management/host/payout-notifications**',route=>route.fulfill({json:{success:true,message:'Synthetic empty notifications',data:[],meta:{page:Number(new URL(route.request().url()).searchParams.get('page')||1),limit:20,total:0,totalPages:0,unreadCount:0}}}));
  await context.route('**/api/management/host/payouts**',route=>route.fulfill({json:{success:true,message:'Synthetic empty payouts',data:[],meta:{page:Number(new URL(route.request().url()).searchParams.get('page')||1),limit:20,total:0,totalPages:0}}}));
  let mode='ok',gate=null,many=false;const calls=[];
  const summary={currency:'VND',source:'LEDGER',serverTime:'2026-10-06T00:00:00.000Z',holdHours:72,bankVerified:false,payoutOperationsReady:false,reviewCount:1,
    balances:{waitingCompletion:'0',pendingHold:'550',eligibleBeforeDeductions:'999999999999999999',frozen:'100'}};
  const journal=(i,kind='PAYMENT')=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,bookingId:'00000000-0000-4000-8000-999999999999',kind,
    createdAt:'2026-10-06T00:00:00.000Z',entries:[{account:'CASH_CLEARING',side:'DEBIT',amount:'999999999999999999'},
      {account:'HOST_PAYABLE',side:'CREDIT',amount:'999999999999999999'}]});
  await context.route('**/api/management/host/finance**',async route=>{
    const request=route.request(),url=new URL(request.url());calls.push({path:url.pathname,method:request.method(),page:url.searchParams.get('page')});
    if(gate)await gate;
    if(mode==='error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_ERROR',message:'Lỗi kiểm thử'}});
    if(url.pathname.endsWith('/transactions')) {
      const page=Number(url.searchParams.get('page'));const data=mode==='empty'?[]:many?(page===1?Array.from({length:20},(_,i)=>journal(i+1)):[journal(21,'PAYOUT')]):[journal(1),journal(2,'REFUND')];
      return route.fulfill({json:{success:true,message:'Synthetic ledger',data,meta:{page,limit:20,total:mode==='empty'?0:many?21:2,totalPages:mode==='empty'?0:many?2:1}}});
    }
    return route.fulfill({json:{success:true,message:'Synthetic summary',data:mode==='invalid'?{...summary,balances:{...summary.balances,pendingHold:NaN}}:summary}});
  });
  return {calls,setMode:value=>{mode=value;},hold:value=>{gate=value;},many:()=>{many=true;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const base=process.argv[2]||'http://127.0.0.1:3314';
  if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local fixture only');
  const {chromium}=require(process.argv[3]||'playwright');const browser=await chromium.launch({headless:true,channel:'msedge'});
  const evidence=process.env.BROWSER_EVIDENCE_DIR||'../.tmp/s4-host-finance-ui';await mkdir(evidence,{recursive:true});
  try {
    for(const width of [375,1440,1920]) {
      const context=await browser.newContext({viewport:{width,height:1000}});const fixture=await financeFixture(context),page=await context.newPage();
      await page.goto(`${base}/host/finance`);await page.getByText('Đủ thời gian giữ, trước bù trừ',{exact:true}).waitFor();
      await page.getByRole('heading',{name:'Ghi nhận thanh toán',exact:true}).waitFor();
      assert.equal(await page.locator('h1').count(),1);
      assert.equal(await page.getByText('999.999.999.999.999.999đ',{exact:true}).count(),5);
      assert.equal(await page.getByText('0đ',{exact:true}).count(),1);
      assert.equal(await page.getByRole('navigation',{name:'Phân trang bút toán'}).count(),0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.getByRole('button',{name:'Mở menu tài khoản'}).click();
      await page.getByRole('menuitem',{name:'Sổ tài chính chủ nhà'}).waitFor();await page.keyboard.press('Escape');
      await page.screenshot({path:`${evidence}/ledger-${width}.png`,fullPage:true});
      assert(fixture.calls.every(call=>call.method==='GET'));
      assert.equal(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('999999999999999999'))),false);
      await context.close();console.log(`PASS exact money/zero/private menu/read-only/no storage/no horizontal overflow ${width}`);
    }
    for(const role of ['TENANT','ADMIN']) {
      const context=await browser.newContext();const fixture=await financeFixture(context,role),page=await context.newPage();
      await page.goto(`${base}/host/finance`);await page.getByText('Trang này chỉ dành cho chủ nhà đang hoạt động.').waitFor();
      assert.equal(fixture.calls.length,0);await context.close();console.log(`PASS ${role} UI gate, no private finance request`);
    }
    {
      const context=await browser.newContext();const fixture=await financeFixture(context),page=await context.newPage();fixture.setMode('error');
      await page.goto(`${base}/host/finance`);await page.getByText('Chưa tải được số liệu.',{exact:false}).waitFor();
      await page.getByText('Chưa tải được trang 1.',{exact:false}).waitFor();assert.equal(await page.getByText('0đ',{exact:true}).count(),0);
      assert.equal(fixture.calls.length,2);fixture.setMode('ok');await page.getByRole('button',{name:'Thử lại',exact:true}).first().click();
      await page.getByText('Đủ thời gian giữ, trước bù trừ',{exact:true}).waitFor();
      fixture.setMode('invalid');await page.getByRole('button',{name:'Tải lại',exact:true}).click();
      await page.getByText('Dữ liệu tài chính chưa hợp lệ.',{exact:false}).waitFor();assert.equal(await page.getByText('550đ',{exact:true}).count(),0);
      await context.close();console.log('PASS HTTP error/no auto retry/manual retry/invalid response hides unconfirmed balances');
    }
    {
      const context=await browser.newContext();const fixture=await financeFixture(context),page=await context.newPage();fixture.setMode('empty');
      await page.goto(`${base}/host/finance`);await page.getByText('Chưa có bút toán ở trang này.').waitFor();
      assert.equal(await page.getByRole('navigation',{name:'Phân trang bút toán'}).count(),0);await context.close();console.log('PASS empty history without dead pagination');
    }
    {
      const context=await browser.newContext({viewport:{width:375,height:1000}});const fixture=await financeFixture(context),page=await context.newPage();fixture.many();
      await page.goto(`${base}/host/finance`);await page.getByRole('button',{name:'Trang sau'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Trang trước'}).isDisabled(),true);
      let release;fixture.hold(new Promise(resolve=>{release=resolve;}));await page.getByRole('button',{name:'Trang sau'}).click();
      await page.getByText('Đang tải lịch sử…').waitFor();assert.equal(await page.getByRole('heading',{name:'Ghi nhận thanh toán',exact:true}).count(),20);
      assert.equal(await page.getByText('1 / 2',{exact:true}).count(),1);release();fixture.hold(null);
      await page.getByText('2 / 2',{exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'Chi trả',exact:true}).count(),1);
      assert.equal(await page.getByRole('button',{name:'Trang sau'}).isDisabled(),true);
      fixture.setMode('error');await page.getByRole('button',{name:'Trang trước'}).click();await page.getByText('Chưa tải được trang 1.',{exact:false}).waitFor();
      assert.equal(await page.getByRole('heading',{name:'Chi trả',exact:true}).count(),0);
      fixture.setMode('ok');await page.getByRole('button',{name:'Thử lại',exact:true}).click();await page.getByText('1 / 2',{exact:true}).waitFor();
      await context.close();console.log('PASS pagination retains previous evidence while pending, page label truthful, failure/retry');
    }
    {
      const context=await browser.newContext();const fixture=await financeFixture(context),page=await context.newPage();
      let release;fixture.hold(new Promise(resolve=>{release=resolve;}));await page.goto(`${base}/host/finance`);
      await page.getByRole('status',{name:'Đang tải số liệu tài chính',exact:true}).waitFor();
      assert.equal(await page.getByText('Chưa có bút toán ở trang này.').count(),0);
      await page.evaluate(()=>{
        const revision='fixture-finance-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');
        const channel=new BroadcastChannel('trotot-auth-v1');channel.postMessage({type:'logout',revision});channel.close();
      });
      await page.getByText('để xem sổ tài chính.',{exact:false}).waitFor();release();fixture.hold(null);
      await page.waitForTimeout(250);assert.equal(await page.getByText('Đủ thời gian giữ, trước bù trừ',{exact:true}).count(),0);
      await context.close();console.log('PASS loading without false empty + late read cannot restore ledger after logout');
    }
  } finally {await browser.close();}
}
