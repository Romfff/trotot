// Fixture UI, or real protected BFF/API/DB via an isolated integration runner.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fixtureFrontend} from './fixture-frontend.mjs';
import {loginThroughUi,logoutThroughUi} from './login-through-ui.mjs';
const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const dir=resolve(process.argv[2]||'.'),live=process.env.ADMIN_BROWSER_FIXTURE?JSON.parse(process.env.ADMIN_BROWSER_FIXTURE):null;
async function realFrontend(){
  assert.match(live.api,/^http:\/\/127\.0\.0\.1:\d+$/);
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(done=>reservation.close(done));const baseUrl=`http://localhost:${port}`;
  const child=spawn(process.execPath,[resolve(dir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
    cwd:dir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:live.api+'/api/v1',FRONTEND_ORIGIN:baseUrl,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
  const close=async()=>{if(child.exitCode===null){const done=once(child,'close');child.kill();await done;}};
  try{for(let i=0;i<100;i++){
    if(child.exitCode!==null)throw new Error('Isolated Admin frontend exited');
    if(await fetch(baseUrl+'/login').then(r=>r.ok,()=>false))return{baseUrl,close};
    await new Promise(done=>setTimeout(done,100));
  }throw new Error('Admin frontend timeout');}catch(error){await close();throw error;}
}
const app=live?await realFrontend():await fixtureFrontend(dir,()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}));
const id='00000000-0000-4000-8000-000000000001',target='00000000-0000-4000-8000-000000000002';
const user={id,fullName:'Synthetic Admin',phone:'0990000000',role:'ADMIN',status:'ACTIVE',isPhoneVerified:true,email:null};
const ok=data=>({success:true,data});
const report={from:'2026-10-01',to:'2026-10-08',currency:'VND',timeZone:'Asia/Ho_Chi_Minh',serverTime:'2026-10-08T00:00:00Z',
  money:{gmv:'9007199254740993',refundApproved:'150000',refundTransferred:'100000',refundPendingTransfer:'50000',commissionRecognized:'100000',gmvLessApprovedRefunds:'9007199254590993'},
  listings:{PUBLISHED:20,PENDING_REVIEW:3,HIDDEN:2},deletedListings:1,users:[{role:'TENANT',status:'ACTIVE',count:20},{role:'HOST',status:'BANNED',count:1},{role:'ADMIN',status:'ACTIVE',count:1}],reviewCount:0,isComplete:true};
const evidence=process.env.BROWSER_EVIDENCE_DIR;let browser;
try{
  if(evidence)await mkdir(evidence,{recursive:true});
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});
  if(live){
    const page=await browser.newPage({viewport:{width:375,height:900}});
    await loginThroughUi(page,app.baseUrl,live.login);
    const dashboard=page.waitForResponse(r=>r.url().includes('/api/management/admin/dashboard?'));
    await page.goto(app.baseUrl+'/admin');const response=await dashboard;assert.equal(response.status(),200);
    const data=(await response.json()).data;assert.equal(data.money.gmv,'0');assert.equal(data.isComplete,true);
    await page.getByText('GMV gốc',{exact:true}).waitFor();
    const shot=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(evidence)await page.screenshot({path:`${evidence}/${name}-${page.viewportSize().width}.png`,fullPage:true});};
    for(const width of [375,1440]){await page.setViewportSize({width,height:900});await shot('real-admin-dashboard');}
    await page.goto(app.baseUrl+'/admin/users');
    const row=page.getByRole('listitem').filter({hasText:live.target.fullName});
    await row.getByRole('button',{name:'Khóa tài khoản',exact:true}).click();
    await page.getByLabel('Lý do',{exact:true}).fill('Synthetic real browser ban');
    const ban=page.waitForResponse(r=>r.url().endsWith(`/users/${live.target.id}/ban`)&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Xác nhận khóa',exact:true}).click();assert.equal((await ban).status(),200);
    await page.getByRole('dialog').waitFor({state:'hidden'});await row.getByRole('button',{name:'Mở tài khoản',exact:true}).waitFor();
    for(const width of [375,1440]){await page.setViewportSize({width,height:900});await shot('real-admin-banned');}
    await row.getByRole('button',{name:'Mở tài khoản',exact:true}).click();await page.getByLabel('Lý do',{exact:true}).fill('Synthetic real browser unban');
    const unban=page.waitForResponse(r=>r.url().endsWith(`/users/${live.target.id}/unban`)&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Xác nhận mở',exact:true}).click();assert.equal((await unban).status(),200);
    await page.getByRole('dialog').waitFor({state:'hidden'});await row.getByRole('button',{name:'Khóa tài khoản',exact:true}).waitFor();
    await page.reload();await row.getByRole('button',{name:'Khóa tài khoản',exact:true}).waitFor();
    await logoutThroughUi(page);await page.goto(app.baseUrl+'/admin');
    await page.getByRole('main').getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
    assert.equal(await page.getByText('GMV gốc',{exact:true}).count(),0);
    await page.close();console.log('REAL PASS: real Admin UI login, HttpOnly cookie/refresh, dashboard/list/ban/unban through protected Next BFF/isolated DB, reload and logout access gate; 375/1440. Not production/device acceptance.');
  }else{
  for(const width of [375,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});let mode='error',status='ACTIVE',action='error',posts=0,release;
    await page.route('**/api/auth/refresh',r=>r.fulfill({json:ok({accessToken:'synthetic-admin-token',user})}));
    await page.route('**/api/auth/me',r=>r.fulfill({json:ok(user)}));
    await page.route('**/api/management/admin/dashboard?*',r=>mode==='error'?r.fulfill({status:503,json:{success:false,message:'Synthetic report unavailable'}}):r.fulfill({json:ok(report)}));
    await page.route('**/api/management/admin/users?*',r=>r.fulfill({json:{...ok([
      {...user,createdAt:null,updatedAt:null},
      {id:target,fullName:'<script>window.__adminXss=1</script> '+'Tên rất dài '.repeat(8),role:'HOST',status,createdAt:null,updatedAt:null},
    ]),meta:{page:1,limit:20,total:2,totalPages:1}}}));
    await page.route(`**/api/management/admin/users/${target}/*`,async r=>{
      posts++;assert.equal(r.request().postDataJSON().reason,'Synthetic reason');
      if(action==='error')return r.fulfill({status:503,json:{success:false,message:'Synthetic moderation unavailable'}});
      if(action==='stale')return r.fulfill({status:409,json:{success:false,errorCode:'STALE_USER_STATUS',message:'Synthetic stale state'}});
      await new Promise(done=>{release=done;});status='BANNED';return r.fulfill({json:ok({id:target,status})});
    });
    const shot=async name=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`overflow ${name} ${width}`);if(evidence)await page.screenshot({path:`${evidence}/${name}-${width}.png`,fullPage:true});};
    await page.goto(app.baseUrl+'/admin');await page.getByText('Synthetic report unavailable',{exact:true}).waitFor();await shot('admin-report-error');
    mode='ok';await page.getByRole('button',{name:'Thử lại',exact:true}).click();await page.getByText('9.007.199.254.740.993 đ',{exact:true}).waitFor();await shot('admin-report');
    await page.goto(app.baseUrl+'/admin/users');await page.getByRole('button',{name:'Khóa tài khoản',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Khóa tài khoản',exact:true}).count(),1,'cannot ban self');await shot('admin-users');
    await page.getByRole('button',{name:'Khóa tài khoản',exact:true}).click();const reason=page.getByLabel('Lý do',{exact:true});await reason.fill('Synthetic reason');
    await page.getByRole('button',{name:'Xác nhận khóa',exact:true}).click();await page.getByText('Synthetic moderation unavailable',{exact:true}).waitFor();assert.equal(await reason.inputValue(),'Synthetic reason');await shot('admin-ban-error');
    action='stale';await page.getByRole('button',{name:'Xác nhận khóa',exact:true}).click();await page.getByText('Synthetic stale state',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Xác nhận khóa',exact:true}).isDisabled(),true);await shot('admin-ban-stale');
    await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Khóa tài khoản',exact:true}).evaluate(node=>node===document.activeElement),true,'restore trigger focus');
    action='slow';await page.getByRole('button',{name:'Khóa tài khoản',exact:true}).click();await page.getByLabel('Lý do',{exact:true}).fill('Synthetic reason');
    await page.getByRole('button',{name:'Xác nhận khóa',exact:true}).evaluate(node=>{node.click();node.click();});
    while(!release)await page.waitForTimeout(20);assert.equal(posts,3,'one slow request after two failed attempts');
    await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1,'pending cannot close');release();
    await page.getByRole('dialog').waitFor({state:'hidden'});await page.getByRole('button',{name:'Mở tài khoản',exact:true}).waitFor();await shot('admin-user-banned');
    assert.equal(await page.evaluate(()=>window.__adminXss),undefined);await page.close();
  }
  console.log('FIXTURE PASS: Admin report error/retry/precise VND, ban reason preserved, stale state, double-click, pending lock, Escape/focus, self guard, escaped names, 375/1440. HTTP/Auth fixtures; DB checks are separate.');
  }
}finally{await browser?.close();await app.close();}
