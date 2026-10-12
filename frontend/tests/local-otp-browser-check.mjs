// Synthetic browser fixtures only: no real OTP, user account, or database writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fixtureFrontend} from './fixture-frontend.mjs';

const {chromium}=createRequire(import.meta.url)(process.argv[3]||'playwright');
const app=await fixtureFrontend(process.argv[2],()=>({success:true,data:[],meta:{page:1,limit:20,total:0,totalPages:0}}));
const out=resolve(process.env.BROWSER_EVIDENCE_DIR||'.tmp/otp-local-browser');
const ok=data=>({success:true,message:'Synthetic fixture',data});
let browser;
try {
  await mkdir(out,{recursive:true});
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const width of [375,1440]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    let code='012345',sends=0;
    await page.route('**/api/auth/register',r=>r.fulfill({status:201,json:ok({registered:true})}));
    await page.route('**/api/auth/send-otp',r=>{sends++;return r.fulfill({json:ok({accepted:true,expiresInSeconds:300,devOtp:code})});});
    await page.route('**/api/auth/forgot-password',r=>r.fulfill({json:ok({accepted:true,expiresInSeconds:300,devOtp:code})}));
    await page.route('**/api/auth/verify-otp',r=>r.fulfill({json:ok({phone:'0990000000'})}));
    await page.goto(app.baseUrl+'/register');
    await page.getByLabel('Họ và tên',{exact:true}).fill('Synthetic guest');
    await page.getByLabel('Số điện thoại',{exact:true}).fill('0990000000');
    await page.getByLabel('Mật khẩu',{exact:true}).fill('Synthetic123!');
    await page.getByLabel('Xác nhận mật khẩu',{exact:true}).fill('Synthetic123!');
    await page.getByRole('button',{name:'Tạo tài khoản',exact:true}).click();
    await page.waitForURL('**/verify-otp');
    await page.locator('.notice').filter({hasText:'Mã OTP thử'}).waitFor();
    assert.equal(sends,1);
    assert.ok((await page.locator('.notice').filter({hasText:'Mã OTP thử'}).innerText()).includes(code));
    assert.equal(await page.getByLabel('Mã xác thực',{exact:true}).inputValue(),'');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:resolve(out,`verify-${width}.png`),fullPage:true});
    await page.getByLabel('Số điện thoại',{exact:true}).fill('0980000000');
    assert.equal(await page.locator('.notice').filter({hasText:'Mã OTP thử'}).count(),0);
    await page.getByLabel('Số điện thoại',{exact:true}).fill('');
    assert.equal(await page.locator('.notice').filter({hasText:'Mã OTP thử'}).count(),0);
    await page.getByLabel('Số điện thoại',{exact:true}).fill('0990000000');
    await page.locator('.notice').filter({hasText:'Mã OTP thử'}).waitFor();
    await page.getByLabel('Mã xác thực',{exact:true}).fill(code);
    await page.getByRole('button',{name:'Xác thực số điện thoại',exact:true}).click();
    await page.waitForURL('**/login?verified=1');
    await page.goto(app.baseUrl+'/verify-otp');
    assert.equal(await page.locator('.notice').filter({hasText:'Mã OTP thử'}).count(),0);
    code='654321';
    await page.goto(app.baseUrl+'/forgot-password');
    await page.getByLabel('Số điện thoại',{exact:true}).fill('0990000000');
    await page.getByRole('button',{name:'Gửi mã xác thực',exact:true}).click();
    await page.waitForURL('**/reset-password?sent=1');
    await page.locator('.notice').filter({hasText:'Mã OTP thử'}).waitFor();
    assert.ok((await page.locator('.notice').filter({hasText:'Mã OTP thử'}).innerText()).includes(code));
    assert.equal(await page.getByLabel('Mã xác thực',{exact:true}).inputValue(),'');
    await page.screenshot({path:resolve(out,`reset-${width}.png`),fullPage:true});
    await page.reload();
    assert.equal(await page.locator('.notice').filter({hasText:'Mã OTP thử'}).count(),0);
    code='567890';
    // Expire only fixture cooldown metadata; duration logic has its own unit test.
    await page.evaluate(() => {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('trotot_otp_cooldown_until:')) sessionStorage.setItem(key,'1');
      }
    });
    await page.reload();
    await page.getByRole('button',{name:'Gửi lại mã OTP',exact:true}).click();
    await page.locator('.notice').filter({hasText:'Mã OTP thử'}).waitFor();
    assert.ok((await page.locator('.notice').filter({hasText:'Mã OTP thử'}).innerText()).includes(code));
    await page.close();
  }
  console.log('PASS: registration/reset synthetic OTP notice, phone mismatch/blank, no auto-fill, clear after verify/reload, resend after cooldown, 375/1440 screenshots.');
} finally {await browser?.close();await app.close();}
