import assert from 'node:assert/strict';

// Real Auth/BFF only. Credentials come from the owned UUID test database.
export async function loginThroughUi(page, baseUrl, credentials) {
  assert.ok(credentials && /^099\d{7}$/.test(credentials.phone) && typeof credentials.password==='string', 'Synthetic credentials required');
  await page.goto(baseUrl+'/login');
  await page.getByLabel('Số điện thoại',{exact:true}).fill(credentials.phone);
  await page.getByLabel('Mật khẩu',{exact:true}).fill(credentials.password);
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/auth/login')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  const response=await pending;assert.equal(response.status(),200);
  const body=await response.json();
  assert.equal(body.success,true);assert.equal(body.data.user.role,credentials.role);
  assert.equal(Object.hasOwn(body.data,'refreshToken'),false,'Refresh token must not enter browser JSON');
  await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).waitFor();
  await page.waitForURL(url=>url.pathname==='/account');
  const cookie=(await page.context().cookies()).find(c=>c.name==='trotot_refresh');
  assert.ok(cookie?.httpOnly&&cookie.secure&&cookie.sameSite==='Lax'&&cookie.path==='/api/auth','Secure HttpOnly refresh cookie required');
}

export async function logoutThroughUi(page) {
  await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();
  await page.getByRole('menuitem',{name:'Đăng xuất',exact:true}).click();
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/auth/logout')&&r.request().method()==='POST');
  await page.getByRole('dialog').getByRole('button',{name:'Đăng xuất',exact:true}).click();
  assert.equal((await pending).status(),200);
  await page.getByRole('link',{name:'Đăng nhập',exact:true}).first().waitFor();
  await page.waitForURL(url=>url.pathname==='/');
  assert.equal((await page.context().cookies()).some(c=>c.name==='trotot_refresh'),false);
}
