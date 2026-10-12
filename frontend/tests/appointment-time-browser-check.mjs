// Synthetic UI regression; uses the compiled time policy, never writes a booking/appointment.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixtureFrontend} from './fixture-frontend.mjs';

const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const {validateAppointmentTime}=await import(new URL('../../backend/dist/appointments/appointment-policy.js',import.meta.url));
const room=JSON.parse(await readFile(new URL('./fixtures/public-listing.json',import.meta.url),'utf8'));
const app=await fixtureFrontend(process.argv[2],()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}),slug=>slug===room.slug?room:null);
const out=resolve(process.env.BROWSER_EVIDENCE_DIR||'.tmp/appointment-time-browser');
const ok=data=>({success:true,message:'Synthetic fixture',data});
const user={id:'00000000-0000-4000-8000-000000000001',fullName:'Synthetic guest',phone:'0990000000',role:'TENANT',status:'ACTIVE',isPhoneVerified:true};
const now=new Date('2026-10-09T00:00:00Z');
let browser;
async function prepare(page) {
  await page.route('**/api/auth/refresh',r=>r.fulfill({json:ok({accessToken:'synthetic-token',user})}));
  await page.route('**/api/auth/me',r=>r.fulfill({json:ok(user)}));
  await page.route('**/api/management/conversations/unread',r=>r.fulfill({json:ok({totalUnread:0,conversations:[]})}));
  await page.route('**/api/listings/properties/*/cost-estimate*',r=>r.fulfill({json:ok({lines:[],totalMonthly:0,deposit:0,missingInputs:[],missingCosts:[],isComplete:true,disclaimer:'Synthetic fixture'})}));
}
async function fill(page) {
  await page.getByRole('button',{name:'Đặt lịch xem trọ',exact:true}).click();
  await page.getByLabel('Ngày xem trọ (giờ Việt Nam)',{exact:true}).fill('2026-10-10');
  await page.getByLabel('Giờ xem trọ (giờ Việt Nam)',{exact:true}).fill('10:46');
}
try {
  await mkdir(out,{recursive:true});
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const width of [375,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}});await prepare(page);
    const requests=[];let failure=null;
    await page.route('**/api/management/appointments',r=>{
      const body=r.request().postDataJSON();requests.push({body,key:r.request().headers()['idempotency-key']});
      if(failure)return r.fulfill({status:failure.status,json:{success:false,errorCode:failure.code,message:'Synthetic failure'}});
      try {validateAppointmentTime(body.scheduledDate,body.scheduledTime,now);}
      catch(error){return r.fulfill({status:400,json:{success:false,...error.getResponse()}});}
      return r.fulfill({status:201,json:ok({id:'00000000-0000-4000-8000-000000000002',propertyId:room.id,title:room.title,...body,status:'PENDING',reason:null,cancelledBy:null,createdAt:now.toISOString(),updatedAt:now.toISOString()})});
    });
    await page.goto(app.baseUrl+'/thue-phong-tro/'+room.slug);await fill(page);
    const dialog=page.getByRole('dialog'),submit=dialog.getByRole('button',{name:'Gửi yêu cầu xem trọ',exact:true});
    assert.ok((await dialog.locator('#scheduledTime-help').innerText()).includes('30 phút'));
    await submit.click();await dialog.getByRole('alert').waitFor();
    assert.ok((await dialog.getByRole('alert').innerText()).includes('theo bước 30 phút'));
    assert.ok(!(await dialog.getByRole('alert').innerText()).includes('Giữ nguyên thông tin'));
    assert.equal(await dialog.getByLabel('Giờ xem trọ (giờ Việt Nam)',{exact:true}).inputValue(),'10:46');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await dialog.screenshot({path:resolve(out,`invalid-${width}.png`)});
    for(const [status,code] of [[403,'FORBIDDEN'],[409,'APPOINTMENT_ALREADY_EXISTS'],[429,'RATE_LIMITED'],[500,'INTERNAL_ERROR']]) {
      failure={status,code};await submit.click();
      await page.waitForFunction(text=>document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes(text),'Synthetic failure');
      assert.equal((await dialog.getByRole('alert').innerText()).includes('Giữ nguyên thông tin'),status===500);
    }
    const lastKey=requests.at(-1).key;
    failure=null;await submit.click();
    await page.waitForFunction(()=>document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('theo bước 30 phút'));
    assert.equal(requests.at(-1).key,lastKey,'unchanged retry keeps idempotency key');
    await dialog.getByLabel('Giờ xem trọ (giờ Việt Nam)',{exact:true}).fill('11:00');await submit.click();
    await dialog.getByText(/Đã gửi yêu cầu xem trọ/).waitFor();
    assert.notEqual(requests.at(-1).key,lastKey,'changed payload receives a new key');
    assert.equal(requests.at(-1).body.scheduledTime,'11:00:00');
    await dialog.screenshot({path:resolve(out,`success-${width}.png`)});await page.close();
  }
  console.log('PASS: 10:46 rejection with step hint; 403/409/429 no misleading retry; 500 retains retry advice; unchanged/new payload keys; 11:00 success; 375/1440.');
  await browser.close();browser=null;
  if(process.env.RUN_APPOINTMENT_PROBE==='1') {
    const launch=chromium.launch.bind(chromium);let done;
    chromium.launch=async options=>{
      const b=await launch({...options,channel:'msedge'});
      done=new Promise(resolveDone=>b.once('disconnected',resolveDone));
      const newContext=b.newContext.bind(b);
      b.newContext=async options=>{
        const context=await newContext(options),newPage=context.newPage.bind(context);
        context.newPage=async()=>{
          const page=await newPage();await prepare(page);
          await page.route('**/api/management/appointments',r=>{
            try {validateAppointmentTime('2026-10-10','10:46:00',now);}
            catch(error){return r.fulfill({status:400,json:{success:false,...error.getResponse()}});}
          });
          const goto=page.goto.bind(page);
          page.goto=async(...args)=>{const result=await goto(...args);await fill(page);await page.getByRole('dialog').getByRole('button',{name:'Gửi yêu cầu xem trọ',exact:true}).click();await page.getByRole('dialog').getByRole('alert').waitFor();return result;};
          return page;
        };return context;
      };return b;
    };
    process.argv=[process.execPath,'probe',app.baseUrl+'/thue-phong-tro/'+room.slug,'--widths','375,1440','--sweep','1440,375,20','--wait','100','--out',resolve(out,'probe'),'--pw','C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node'];
    await import(pathToFileURL(resolve('.agents/skills/ui-ux/scripts/probe.mjs')));
    while(!done)await new Promise(resolveDone=>setTimeout(resolveDone,10));
    await done;
  }
} finally {await browser?.close();await app.close();}
