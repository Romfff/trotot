// Synthetic payment/bank snapshots only; no external transfer or provider success.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {bankFixture} from './host-bank-browser-check.mjs';
const require=createRequire(import.meta.url),base=process.argv[2]||'http://127.0.0.1:3318';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});
const id='00000000-0000-4000-8000-000000000001',at='2026-10-06T00:00:00.000Z',amount='999999999999999999';
const evidence='../.tmp/s4-admin-payout-actions-ui';await mkdir(evidence,{recursive:true});
async function fixture(context,status='DRAFT') {
  await bankFixture(context,'ADMIN');let version=status==='DRAFT'?1:2,mode='ok',created=false;const calls=[],replays=new Map();
  await context.route('**/api/management/admin/finance/payouts**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname,action=path.split('/').at(-1);
    if(request.method()==='POST') {
      const body=request.postDataJSON(),key=request.headers()['idempotency-key'];calls.push({path,body,key});
      if(replays.has(key))return route.fulfill({json:{success:true,message:'Synthetic',data:replays.get(key)}});
      if(mode==='stale')return route.fulfill({status:409,json:{success:false,errorCode:'STALE_PAYOUT_VERSION',message:'Lô đã thay đổi. Vui lòng tải lại.'}});
      if(action==='payouts'){created=true;const result={id,hostId:id,amount,status:'DRAFT',version:1,cutoff:at};replays.set(key,result);return route.fulfill({json:{success:true,message:'Synthetic',data:result}});}
      assert.equal(body.expectedVersion,version);version++;
      status=action==='approve'?'APPROVED':action==='cancel'?'CANCELLED':'PAID';
      const result={id,status,version,...(status==='PAID'?{amount,message:'Manual fixture only'}:{})};replays.set(key,result);
      if(mode==='lost'){mode='ok';return route.fulfill({status:503,json:{success:false,errorCode:'PAYOUT_RECORDING_FAILED',message:'Synthetic delivery lost after commit'}});}
      return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='invalid'?{...result,status:'BROKEN'}:result}});
    }
    const row={id,hostId:id,amount,status,version,cutoff:at,createdAt:at,bankCode:'FIXTURE',accountNumber:'****12AB'};
    if(action==='export')return route.fulfill({json:{success:true,message:'Synthetic',data:{filename:`payout-${id}-v${version}.csv`,encoding:'UTF-8',csv:'\ufeff"payout_id","host_id","account_number","amount_vnd"\r\n"fixture","fixture","\'0012AB","\'999999999999999999"\r\n'}}});
    if(action==='payouts')return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='empty'&&!created?[]:[row],meta:{page:1,limit:20,total:mode==='empty'&&!created?0:1,totalPages:mode==='empty'&&!created?0:1}}});
    const events=status==='DRAFT'?['CREATED']:status==='APPROVED'?['CREATED','APPROVED']:status==='PAID'?['CREATED','APPROVED','PAID']:['CREATED','CANCELLED'];
    return route.fulfill({json:{success:true,message:'Synthetic',data:{...row,accountNumber:'0012AB',accountName:'Synthetic Host',bankAccountId:id,bankVersion:1,
      operations:{canApprove:status==='DRAFT',canExport:status==='APPROVED',canConfirmPaid:status==='APPROVED',canCancel:['DRAFT','APPROVED'].includes(status),reviewRequired:false},
      items:[{bookingId:id,amount,eligibleAt:at,status:status==='CANCELLED'?'RELEASED':'ACTIVE'}],events:events.map(action=>({action,actorId:id,reason:'Synthetic review',createdAt:at})),
      confirmation:status==='PAID'?{confirmedAt:at,actorId:id,bankReference:'FIXTURE',evidenceNote:'Synthetic only',reason:'Fixture'}:null}}});
  });return {calls,mode:value=>{mode=value;}};
}
async function open(width,status='DRAFT') {
  const context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true}),f=await fixture(context,status),page=await context.newPage();
  await page.goto(`${base}/admin/finance/payouts`);await page.getByRole('button',{name:'Xem chi tiết',exact:true}).click();
  const form=page.getByRole('form',{name:'Thao tác lô chi trả'});await form.getByLabel('Lý do xử lý',{exact:true}).waitFor();return {context,f,page,form};
}
try {
  for(const width of [375,1440,1920]) {
    const {context,f,page,form}=await open(width);
    await form.getByRole('button',{name:'Duyệt lô, chưa chuyển tiền'}).click();assert.equal(f.calls.length,0);
    await form.getByLabel('Lý do xử lý',{exact:true}).fill('Fixture review');await form.getByRole('button',{name:'Duyệt lô, chưa chuyển tiền'}).click();
    await form.getByRole('button',{name:'Xác nhận đã chuyển tiền'}).waitFor();assert.equal(f.calls.length,1);
    await page.getByText('Lô chưa có xác nhận đã chi trả.',{exact:true}).waitFor();
    const downloading=page.waitForEvent('download');await form.getByRole('button',{name:'Xuất CSV',exact:true}).click();
    assert.equal((await downloading).suggestedFilename(),`payout-${id}-v2.csv`);assert.equal(f.calls.length,1);
    await form.getByLabel('Lý do xử lý',{exact:true}).fill('Fixture payout');await form.getByLabel('Mã giao dịch ngân hàng',{exact:true}).fill('FIXTURE');
    await form.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Synthetic only');f.mode('lost');
    await form.getByRole('button',{name:'Xác nhận đã chuyển tiền'}).click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Đóng chi tiết',exact:true}).isDisabled(),true);
    assert.equal(await form.getByLabel('Mã giao dịch ngân hàng',{exact:true}).getAttribute('readonly'),'');
    await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByText('Admin đã ghi nhận chi trả thủ công',{exact:true}).waitFor();
    assert.equal(f.calls.length,3);assert.deepEqual(f.calls[1],f.calls[2]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:`${evidence}/paid-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${width}: approve distinct, CSV no payment, lost commit stable replay, exact amount, no overflow`);
  }
  {
    const {context,f,page,form}=await open(375);await form.getByLabel('Lý do xử lý',{exact:true}).fill('Cancel fixture');
    await form.getByRole('button',{name:'Hủy lô',exact:true}).click();await page.getByText('Đã nhả khỏi lô',{exact:false}).waitFor();assert.equal(f.calls.length,1);await context.close();console.log('PASS cancel/release display');
  }
  {
    const context=await browser.newContext(),f=await fixture(context);f.mode('empty');const page=await context.newPage();await page.goto(`${base}/admin/finance/payouts`);
    const form=page.getByRole('form',{name:'Tạo lô chi trả'});await form.getByLabel('ID Host (UUID)').fill(id);await form.getByLabel('Lý do xử lý',{exact:true}).fill('Create fixture');
    await form.getByRole('button',{name:'Tạo lô nháp',exact:true}).click();await page.getByText('0012AB',{exact:true}).waitFor();assert.equal(f.calls.length,1);await context.close();console.log('PASS create opens server draft');
  }
  for(const mode of ['stale','invalid']) {
    const {context,f,page,form}=await open(375);f.mode(mode);await form.getByLabel('Lý do xử lý',{exact:true}).fill('Fixture');await form.getByRole('button',{name:'Duyệt lô, chưa chuyển tiền'}).click();
    if(mode==='stale')await form.getByText('Lô đã thay đổi. Vui lòng tải lại.',{exact:true}).waitFor();
    else {await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();assert.equal(await page.getByRole('button',{name:'Đóng chi tiết',exact:true}).isDisabled(),true);}
    assert.equal(f.calls.length,1);await context.close();console.log(`PASS ${mode}: no automatic POST/reported success`);
  }
}finally{await browser.close();}
