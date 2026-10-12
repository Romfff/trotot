// Auth/API fixtures; never a real bank refund. Real DB browser case is separate.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {bankFixture} from './host-bank-browser-check.mjs';
export async function refundFixture(context,role='ADMIN') {
  await bankFixture(context,role);const id='00000000-0000-4000-8000-000000000001',at='2026-10-06T00:00:00.000Z',amount='999999999999999999';
  let mode='ok',paid=false;const writes=[];
  await context.route('**/api/management/admin/finance/refunds**',route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST') {
      const body=request.postDataJSON(),key=request.headers()['idempotency-key'];writes.push({body,key});
      if(mode==='stale')return route.fulfill({status:409,json:{success:false,errorCode:'STALE_REFUND_VERSION',message:'Khoản hoàn đã thay đổi. Vui lòng tải lại.'}});
      paid=true;const data={id,bookingId:id,amount,status:'PAID',version:2,journalId:id,message:'Synthetic manual only'};
      if(mode==='lost'){mode='ok';return route.fulfill({status:503,json:{success:false,errorCode:'REFUND_RECORDING_FAILED',message:'Synthetic delivery lost'}});}
      return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='invalid-write'?{...data,amount:100}:data}});
    }
    if(mode==='error')return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE',message:'Lỗi kiểm thử'}});
    const row={id,bookingId:id,amount,status:paid?'PAID':'PENDING',version:paid?2:1,createdAt:at};
    if(path.endsWith('/refunds'))return route.fulfill({json:{success:true,message:'Synthetic',data:mode==='empty'?[]:[row],meta:{page:1,limit:20,total:mode==='empty'?0:1,totalPages:mode==='empty'?0:1}}});
    return route.fulfill({json:{success:true,message:'Synthetic',data:{...row,cancelledBy:'GUEST',reason:'Synthetic cancellation',updatedAt:at,
      confirmation:paid?{id,journalId:id,actorId:id,bankReference:'FIXTURE',evidenceNote:'Synthetic only',reason:'Fixture',createdAt:at}:mode==='invalid'?{}:null}}});
  });return {writes,mode:v=>{mode=v;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const require=createRequire(import.meta.url),base=process.argv[2]||'http://127.0.0.1:3319';if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local only');
  const {chromium}=require(process.argv[3]||'playwright'),browser=await chromium.launch({headless:true,channel:'msedge'});
  const evidence='../.tmp/s4-admin-refund-ui';await mkdir(evidence,{recursive:true});
  try {
    for(const width of [375,1440,1920]) {
      const context=await browser.newContext({viewport:{width,height:1000}}),f=await refundFixture(context),page=await context.newPage();
      await page.goto(`${base}/admin/finance/refunds`);await page.getByRole('button',{name:'Xem khoản hoàn',exact:true}).click();const form=page.getByRole('form',{name:'Xác nhận khoản hoàn'});
      await form.getByRole('button',{name:'Xác nhận đã chuyển trả',exact:true}).click();assert.equal(f.writes.length,0);
      await form.getByLabel('Lý do xác nhận',{exact:true}).fill('Fixture');await form.getByLabel('Mã giao dịch ngân hàng',{exact:true}).fill('FIXTURE');await form.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Synthetic only');
      f.mode('lost');await form.getByRole('button',{name:'Xác nhận đã chuyển trả',exact:true}).click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'Xem khoản hoàn',exact:true}).isDisabled(),true);assert.equal(await form.getByLabel('Mã giao dịch ngân hàng',{exact:true}).getAttribute('readonly'),'');
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByRole('heading',{name:'Chứng cứ chuyển trả'}).waitFor();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);
      assert.equal(await form.getByLabel('Mã giao dịch ngân hàng',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('Synthetic only')),false);
      await page.screenshot({path:`${evidence}/paid-${width}.png`,fullPage:true});await context.close();console.log(`PASS ${width}: validation, same-key uncertain replay, private evidence/exact money, terminal/no overflow`);
    }
    for(const role of ['HOST','TENANT']) {
      const context=await browser.newContext(),f=await refundFixture(context,role),page=await context.newPage();await page.goto(`${base}/admin/finance/refunds`);
      await page.getByText('Trang này chỉ dành cho Admin đang hoạt động.').waitFor();assert.equal(f.writes.length,0);assert.equal(await page.getByRole('form').count(),0);await context.close();console.log(`PASS ${role} gate`);
    }
    for(const mode of ['empty','error','invalid','stale','invalid-write']) {
      const context=await browser.newContext(),f=await refundFixture(context),page=await context.newPage();f.mode(mode);
      await page.goto(`${base}/admin/finance/refunds`);
      if(mode==='empty')await page.getByText('Chưa có khoản hoàn ở trang này.').waitFor();
      else if(mode==='error')await page.getByRole('button',{name:'Thử lại danh sách'}).waitFor();
      else {await page.getByRole('button',{name:'Xem khoản hoàn',exact:true}).click();
        if(mode==='invalid'){await page.getByText('Dữ liệu khoản hoàn chưa hợp lệ.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Xác nhận đã chuyển trả'}).isDisabled(),true);}
        else {const form=page.getByRole('form',{name:'Xác nhận khoản hoàn'});await form.getByLabel('Lý do xác nhận').fill('Fixture');await form.getByLabel('Mã giao dịch ngân hàng').fill('FIXTURE');await form.getByLabel('Ghi chú chứng cứ').fill('Synthetic');
          await form.getByRole('button',{name:'Xác nhận đã chuyển trả'}).click();if(mode==='stale')await form.getByText('Khoản hoàn đã thay đổi.',{exact:false}).waitFor();else await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();assert.equal(f.writes.length,1);}}
      await context.close();console.log(`PASS ${mode}`);
    }
  }finally{await browser.close();}
}
