// Browser-rendered UI with intercepted Auth/bank fixtures. No DB or real bank writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
export async function bankFixture(context, role = 'HOST') {
  const user = { id:'00000000-0000-4000-8000-000000000001', fullName:'Synthetic Host', role, status:'ACTIVE', phone:'0990000001', email:null };
  let state = { version:0, account:null, payoutReady:false };
  let mode = 'ok', readMode = 'ok', writeGate = null, readGate = null; const writes = [];
  await context.route('**/api/auth/refresh', route => route.fulfill({json:{success:true,data:{accessToken:'synthetic-fixture',user}}}));
  await context.route('**/api/auth/me', route => route.fulfill({json:{success:true,data:user}}));
  await context.route('**/api/management/host/bank-account', async route => {
    if (route.request().method() === 'GET') {
      if(readGate)await readGate;
      if(readMode === 'error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_FAILED',message:'Lỗi kiểm thử'}});
      return route.fulfill({json:{success:true,data:state}});
    }
    const body = route.request().postDataJSON(), key=route.request().headers()['idempotency-key'];
    writes.push({body,key});
    if(writeGate)await writeGate;
    if(mode === 'uncertain') return route.fulfill({status:503,json:{success:false,errorCode:'BANK_RECORDING_FAILED',message:'Synthetic uncertain write'}});
    if(mode === 'stale') return route.fulfill({status:409,json:{success:false,errorCode:'STALE_BANK_VERSION',message:'Thông tin ngân hàng đã thay đổi. Vui lòng tải lại.'}});
    state={version:state.version+1,payoutReady:false,account:{id:'00000000-0000-4000-8000-000000000002',hostId:user.id,...body,status:'PENDING',createdAt:'2026-10-06T00:00:00Z'}};
    return route.fulfill({json:{success:true,data:state}});
  });
  return { writes, setMode: value=>{mode=value;}, setRead: value=>{readMode=value;}, setState: value=>{state=value;}, holdWrite: value=>{writeGate=value;}, holdRead: value=>{readGate=value;} };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base=process.argv[2]||'http://127.0.0.1:3314';
  if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local fixture UI only');
  const {chromium}=require(process.argv[3]||'playwright');
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  const evidence=process.env.BROWSER_EVIDENCE_DIR||'../.tmp/host-bank-ui-20261006'; await mkdir(evidence,{recursive:true});
  try {
    for(const width of [375,1440,1920]) {
      const context=await browser.newContext({viewport:{width,height:1000}}); const fixture=await bankFixture(context),page=await context.newPage();
      await page.goto(`${base}/host/bank-account`); await page.getByText('Chưa có tài khoản nhận tiền.',{exact:false}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${evidence}/empty-${width}.png`,fullPage:true});
      const submit=page.getByRole('button',{name:'Gửi Admin xác minh',exact:true}); await submit.click();
      assert.equal(fixture.writes.length,0); assert.equal(await page.locator('input[name=bankCode]').evaluate(el=>el===document.activeElement),true);
      await page.getByLabel('Mã ngân hàng',{exact:true}).fill('FIXTURE');
      await page.getByLabel('Số tài khoản',{exact:true}).fill('0012AB');
      await page.getByLabel('Tên chủ tài khoản',{exact:true}).fill('Synthetic fixture');
      fixture.setMode('uncertain'); await submit.click();
      await page.getByText('Chưa xác nhận được kết quả lưu.',{exact:false}).waitFor();
      assert.equal(await page.getByLabel('Số tài khoản',{exact:true}).getAttribute('readonly'),'');
      assert.equal(fixture.writes.length,1); fixture.setMode('ok');
      await page.getByRole('button',{name:'Thử lại cùng thông tin',exact:true}).click();
      await page.getByText('Đã gửi thông tin để Admin xác minh.',{exact:false}).waitFor();
      await page.getByText('Chờ Admin xác minh',{exact:true}).waitFor();
      assert.equal(fixture.writes.length,2); assert.deepEqual(fixture.writes[0],fixture.writes[1]);
      assert.equal(fixture.writes[0].body.expectedVersion,0); assert.equal(await page.getByLabel('Số tài khoản',{exact:true}).inputValue(),'');
      assert.equal(await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('0012AB')||v.includes('Synthetic fixture'))),false);
      await page.screenshot({path:`${evidence}/pending-${width}.png`,fullPage:true});
      await context.close(); console.log(`PASS empty/validation/ambiguous retry/key/body/privacy/pending/responsive ${width}px`);
    }
    for(const role of ['TENANT','ADMIN']) {
      const context=await browser.newContext(); const fixture=await bankFixture(context,role), page=await context.newPage();
      await page.goto(`${base}/host/bank-account`);await page.getByText('Trang này chỉ dành cho chủ nhà đang hoạt động.').waitFor();
      assert.equal(await page.locator('form').count(),0);assert.equal(fixture.writes.length,0);await context.close();console.log(`PASS ${role} UI gate (server authorization separately tested)`);
    }
    const context=await browser.newContext({viewport:{width:375,height:1000}});const fixture=await bankFixture(context),page=await context.newPage();fixture.setRead('error');
    await page.goto(`${base}/host/bank-account`); await page.getByText('Chưa tải được thông tin ngân hàng.',{exact:false}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).getAttribute('aria-disabled'),'true');
    fixture.setRead('ok');await page.getByRole('button',{name:'Thử lại tải thông tin'}).click();await page.getByText('Chưa có tài khoản nhận tiền.',{exact:false}).waitFor();
    await page.getByLabel('Mã ngân hàng',{exact:true}).fill('FIXTURE');await page.getByLabel('Số tài khoản',{exact:true}).fill('0012');await page.getByLabel('Tên chủ tài khoản',{exact:true}).fill('Synthetic');
    fixture.setMode('stale');await page.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).click();await page.getByText('Thông tin ngân hàng đã thay đổi.',{exact:false}).waitFor();
    assert.equal(await page.getByLabel('Số tài khoản',{exact:true}).inputValue(),'0012');assert.equal(fixture.writes.length,1);
    await context.close();console.log('PASS read error/retry + stale version keeps input, no automatic write');
    for(const status of ['VERIFIED','REJECTED']) {
      const context=await browser.newContext({viewport:{width:375,height:1000}});const fixture=await bankFixture(context),page=await context.newPage();
      let release;fixture.holdRead(new Promise(resolve=>{release=resolve;}));
      fixture.setState({version:2,payoutReady:status==='VERIFIED',account:{id:'fixture',hostId:'fixture',bankCode:'FIXTURE',accountNumber:'0'.repeat(50),accountName:'Synthetic '.repeat(15),status,createdAt:'2026-10-06T00:00:00Z'}});
      await page.goto(`${base}/host/bank-account`);await page.getByRole('status',{name:'Đang tải ngân hàng',exact:true}).waitFor();
      assert.equal(await page.locator('form').count(),0);release();await page.getByText(status==='VERIFIED'?'Đã xác minh':'Chưa được chấp nhận',{exact:true}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${evidence}/${status.toLowerCase()}-375.png`,fullPage:true});await context.close();
      console.log(`PASS loading/long values/${status} without claiming a payout entitlement`);
    }
    const lateContext=await browser.newContext(),lateFixture=await bankFixture(lateContext),latePage=await lateContext.newPage();
    let release;lateFixture.holdWrite(new Promise(resolve=>{release=resolve;}));
    await latePage.goto(`${base}/host/bank-account`);await latePage.getByText('Chưa có tài khoản nhận tiền.',{exact:false}).waitFor();
    await latePage.getByLabel('Mã ngân hàng',{exact:true}).fill('FIXTURE');await latePage.getByLabel('Số tài khoản',{exact:true}).fill('0012');await latePage.getByLabel('Tên chủ tài khoản',{exact:true}).fill('Synthetic');
    await latePage.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).click();await latePage.getByRole('button',{name:'Đang gửi…',exact:true}).waitFor();
    await latePage.evaluate(()=>{
      const revision='fixture-logout';localStorage.setItem('trotot-auth-revision',revision);localStorage.setItem('trotot-auth-logout-pending','1');localStorage.removeItem('trotot-auth-session-id');
      const channel=new BroadcastChannel('trotot-auth-v1');channel.postMessage({type:'logout',revision});channel.close();
    });
    await latePage.getByText('để quản lý ngân hàng nhận tiền.',{exact:false}).waitFor();release();
    await latePage.waitForTimeout(250);assert.equal(await latePage.locator('form').count(),0);assert.equal(await latePage.getByText('Đã gửi thông tin để Admin xác minh.',{exact:false}).count(),0);
    await lateContext.close();console.log('PASS late bank response cannot restore private form after logout (fixture broadcast)');
  } finally {await browser.close();}
}
