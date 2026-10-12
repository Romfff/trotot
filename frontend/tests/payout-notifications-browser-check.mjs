// Real browser rendering, intercepted synthetic Auth/finance APIs; no financial writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {financeFixture} from './host-finance-browser-check.mjs';
const require=createRequire(import.meta.url);
export async function payoutNoticeFixture(context,role='HOST') {
  await financeFixture(context,role);
  let mode='ok',gate=null,writeGate=null,many=false;const calls=[],reads=new Set();
  const row=i=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,batchId:'00000000-0000-4000-8000-999999999999',
    type:['CREATED','APPROVED','CANCELLED','PAID'][(i-1)%4],message:i===4?'Admin đã ghi nhận bằng chứng chi trả thủ công. Hệ thống không thực hiện chuyển tiền.':i===2?'Admin đã duyệt lô chi trả. Đây chưa phải xác nhận đã chuyển tiền.':'Thông báo kiểm thử. '.repeat(14),
    createdAt:'2026-10-06T00:00:00.000Z',readAt:reads.has(i)?'2026-10-06T01:00:00.000Z':null});
  await context.route('**/api/management/host/payout-notifications**',async route=>{
    const req=route.request(),url=new URL(req.url());calls.push({method:req.method(),path:url.pathname,body:req.postDataJSON()});
    if(req.method()==='POST') {
      if(writeGate)await writeGate;
      if(mode==='write-error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_ERROR',message:'Lỗi kiểm thử'}});
      const id=url.pathname.split('/').at(-2),i=Number(id.split('-').at(-1));reads.add(i);
      return route.fulfill({json:{success:true,message:'Synthetic receipt',data:row(i)}});
    }
    if(gate)await gate;
    if(mode==='error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_ERROR',message:'Lỗi kiểm thử'}});
    const page=Number(url.searchParams.get('page')||1),total=mode==='empty'?0:many?21:4;
    const data=Array.from({length:Math.min(20,Math.max(0,total-(page-1)*20))},(_,i)=>row((page-1)*20+i+1));
    return route.fulfill({json:{success:true,message:'Synthetic notices',data,meta:{page,limit:20,total,totalPages:Math.ceil(total/20),unreadCount:total-reads.size}}});
  });
  return {calls,setMode:v=>{mode=v;},hold:v=>{gate=v;},holdWrite:v=>{writeGate=v;},many:()=>{many=true;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const base=process.argv[2]||'http://127.0.0.1:3326';
  if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local fixtures only');
  const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});
  const dir=process.env.BROWSER_EVIDENCE_DIR||'../.tmp/s4-payout-notification-ui';await mkdir(dir,{recursive:true});
  try {
    for(const width of [375,1440]) {
      const ctx=await browser.newContext({viewport:{width,height:1000}}),fixture=await payoutNoticeFixture(ctx),page=await ctx.newPage();
      await page.goto(`${base}/host/finance`);const section=page.getByRole('region',{name:'Thông báo chi trả'});
      await section.getByText('4 chưa đọc',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await section.getByText('Admin đã duyệt lô chi trả. Đây chưa phải xác nhận đã chuyển tiền.').count(),1);
      await page.screenshot({path:`${dir}/notices-${width}.png`,fullPage:true});
      const button=section.getByRole('button',{name:'Đánh dấu đã đọc: Lô chi trả mới',exact:true});
      fixture.setMode('write-error');await button.click();await section.getByRole('alert').waitFor();
      assert.equal(await section.getByText('4 chưa đọc',{exact:true}).count(),1);
      fixture.setMode('ok');await button.focus();await page.keyboard.press('Enter');
      await section.getByText('3 chưa đọc',{exact:true}).waitFor();
      const read=section.getByRole('button',{name:'Đã đọc: Lô chi trả mới',exact:true});
      assert.equal(await read.evaluate(el=>el===document.activeElement),true);
      assert.equal(await read.getAttribute('aria-disabled'),'true');await page.keyboard.press('Enter');
      assert.equal(fixture.calls.filter(c=>c.method==='POST').length,2);
      assert(fixture.calls.filter(c=>c.method==='POST').every(c=>JSON.stringify(c.body)==='{}'));
      await page.reload();await section.getByText('3 chưa đọc',{exact:true}).waitFor();
      assert.equal(await section.getByRole('button',{name:'Đã đọc: Lô chi trả mới',exact:true}).count(),1);
      await ctx.close();console.log(`PASS ${width}: exact manual wording/long text/responsive/write failure/retry/keyboard/focus/no duplicate read`);
    }
    for(const role of ['TENANT','ADMIN']) {
      const ctx=await browser.newContext(),fixture=await payoutNoticeFixture(ctx,role),page=await ctx.newPage();
      await page.goto(`${base}/host/finance`);await page.getByText('Trang này chỉ dành cho chủ nhà đang hoạt động.').waitFor();
      assert.equal(fixture.calls.length,0);await ctx.close();console.log(`PASS ${role}: no notification request`);
    }
    for(const mode of ['empty','error']) {
      const ctx=await browser.newContext(),fixture=await payoutNoticeFixture(ctx),page=await ctx.newPage();fixture.setMode(mode);
      await page.goto(`${base}/host/finance`);const section=page.getByRole('region',{name:'Thông báo chi trả'});
      await section.getByText(mode==='empty'?'Chưa có thông báo chi trả ở trang này.':'Chưa tải được thông báo.',{exact:false}).waitFor();
      assert.equal(await section.getByRole('navigation').count(),0);
      assert.equal(fixture.calls.length,1);
      if(mode==='error') {fixture.setMode('ok');await section.getByRole('button',{name:'Thử lại',exact:true}).click();await section.getByText('4 chưa đọc',{exact:true}).waitFor();}
      await ctx.close();console.log(`PASS ${mode}: no dead pagination/no auto retry/manual recovery`);
    }
    {
      const ctx=await browser.newContext(),fixture=await payoutNoticeFixture(ctx),page=await ctx.newPage();fixture.many();
      await page.goto(`${base}/host/finance`);const section=page.getByRole('region',{name:'Thông báo chi trả'});
      await section.getByText('1 / 2',{exact:true}).waitFor();await section.getByRole('button',{name:'Thông báo trang sau'}).click();
      await section.getByText('2 / 2',{exact:true}).waitFor();assert.equal(await section.locator('li').count(),1);
      assert.equal(await section.getByRole('button',{name:'Thông báo trang sau'}).isDisabled(),true);
      await ctx.close();console.log('PASS complete page/last page/pagination boundaries');
    }
    {
      const ctx=await browser.newContext(),fixture=await payoutNoticeFixture(ctx),page=await ctx.newPage();let release;
      fixture.hold(new Promise(resolve=>{release=resolve;}));await page.goto(`${base}/host/finance`);
      await page.getByRole('status',{name:'Đang tải thông báo chi trả',exact:true}).waitFor();
      assert.equal(await page.getByText('Chưa có thông báo chi trả ở trang này.').count(),0);
      await page.evaluate(()=>{const revision='fixture-notices-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');const ch=new BroadcastChannel('trotot-auth-v1');ch.postMessage({type:'logout',revision});ch.close();});
      await page.getByText('để xem sổ tài chính.',{exact:false}).waitFor();release();fixture.hold(null);await page.waitForTimeout(250);
      assert.equal(await page.getByRole('region',{name:'Thông báo chi trả'}).count(),0);
      await ctx.close();console.log('PASS loading/no false empty/late response hidden after logout');
    }
    {
      const ctx=await browser.newContext(),fixture=await payoutNoticeFixture(ctx),page=await ctx.newPage();let release;
      await page.goto(`${base}/host/finance`);const section=page.getByRole('region',{name:'Thông báo chi trả'});
      await section.getByText('4 chưa đọc',{exact:true}).waitFor();
      fixture.holdWrite(new Promise(resolve=>{release=resolve;}));
      const button=section.getByRole('button',{name:'Đánh dấu đã đọc: Lô chi trả mới',exact:true});
      await button.focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');
      await page.waitForTimeout(100);assert.equal(fixture.calls.filter(c=>c.method==='POST').length,1);
      assert.equal(await section.getByText('4 chưa đọc',{exact:true}).count(),1);
      await page.evaluate(()=>{const revision='fixture-notices-write-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');const ch=new BroadcastChannel('trotot-auth-v1');ch.postMessage({type:'logout',revision});ch.close();});
      await page.getByText('để xem sổ tài chính.',{exact:false}).waitFor();const reads=fixture.calls.filter(c=>c.method==='GET').length;
      release();fixture.holdWrite(null);await page.waitForTimeout(250);
      assert.equal(await page.getByRole('region',{name:'Thông báo chi trả'}).count(),0);
      assert.equal(fixture.calls.filter(c=>c.method==='GET').length,reads);
      await ctx.close();console.log('PASS parallel click guarded/no optimistic receipt/late write cannot refetch after logout');
    }
  }finally{await browser.close();}
}
