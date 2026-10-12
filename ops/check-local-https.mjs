// Real local HTTPS/BFF/API/DB/Socket checks, never production data or payment success.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { loginThroughUi, logoutThroughUi } from '../frontend/tests/login-through-ui.mjs';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(process.argv[2] || '');
assert.match(directory, /[\\/]\.tmp[\\/]local-https-[a-f0-9]{32}$/);
assert.equal(resolve(directory, '../..'), root, 'Only this workspace test directory');
const prepared = JSON.parse(await readFile(resolve(directory, 'prepared.json'), 'utf8'));
assert.match(prepared.project, /^trotot-app-test-[a-f0-9]{12}$/);
const owned = JSON.parse(await readFile(resolve(root, '.tmp', prepared.project, 'owned-resources.json'), 'utf8'));
assert.equal(prepared.database, owned.database);
assert.equal(prepared.project, `trotot-app-test-${owned.id.slice(0, 12)}`);
assert.equal(prepared.database, `app_test_${owned.id}`);
const ca = await readFile(resolve(directory, 'ca.crt'));
const leaf = new X509Certificate(await readFile(resolve(directory, 'server.crt')));
assert.equal(new X509Certificate(ca).fingerprint256, prepared.caFingerprint);
assert.equal(prepared.origin, `https://${prepared.bind}:${new URL(prepared.origin).port}`);
assert.ok(leaf.checkIP(prepared.bind));
const origin = prepared.origin;
const secretValues = (await readFile(resolve(directory, 'local.env'), 'utf8')).split(/\r?\n/)
  .filter(line => /PASSWORD|SECRET|DATABASE_URL/.test(line)).map(line => line.slice(line.indexOf('=') + 1));
function redact(value) {
  for (const secret of secretValues.filter(Boolean)) value = value.replaceAll(secret, '[REDACTED]');
  return value;
}
function execute(args, input) {
  return new Promise((done, fail) => {
    const child = spawn('docker', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '', error = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { error += chunk; });
    const timer = setTimeout(() => { child.kill(); fail(Error('Owned Docker operation timed out')); }, 60000);
    child.on('error', failure => { clearTimeout(timer); fail(failure); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? done(output.trim()) : fail(Error(redact(`Docker exit ${code}: ${error.slice(-2048)}`))); });
    child.stdin.end(input || '');
  });
}
const args = ['compose', '--project-name', prepared.project, '--env-file', resolve(directory, 'local.env'),
  '-f', resolve(root, 'compose.app.local.yaml'), '-f', resolve(root, 'compose.app.https.local.yaml')];
const compose = (tail, input) => execute([...args, ...tail], input);
const checks = [];
function pass(label) { checks.push(label); console.log('PASS: ' + label); }
function https(path, options = {}) {
  return new Promise((done, fail) => {
    const { body, ...settings } = options;
    const req = request(new URL(path, origin), { ca, timeout: 10000, ...settings }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, text,
        json: () => JSON.parse(text) }));
    });
    req.on('timeout', () => req.destroy(Error('HTTPS timeout'))); req.on('error', fail);
    req.end(body);
  });
}
let browser;
try {
  const ids = (await compose(['ps', '-q', 'api', 'web', 'edge', 'postgres', 'redis'])).split(/\s+/);
  assert.equal(ids.length, 5);
  const containers = JSON.parse(await execute(['inspect', ...ids]));
  for (const container of containers) {
    assert.equal(container.Config.Labels['com.docker.compose.project'], prepared.project);
    const ports = Object.values(container.NetworkSettings.Ports || {}).flat().filter(Boolean);
    if (container.Config.Labels['com.docker.compose.service'] === 'edge') {
      assert.equal(ports.length, 1); assert.equal(ports[0].HostIp, prepared.bind);
      assert.equal(ports[0].HostPort, new URL(origin).port);
      assert.ok(!container.Mounts.some(m => /ca\.key$/.test(m.Source)));
    } else assert.equal(ports.length, 0);
  }
  pass('Owned containers: one explicit HTTPS edge port; no DB/Redis/API/web host ports or CA private-key mount');
  const health = await https('/api/v1/health');
  assert.equal(health.status, 200); assert.equal(health.json().data.database, 'ok');
  pass('CA-verified TLS identity/chain and real PostgreSQL/Redis health');
  for (const path of ['/', '/login', '/homestay', '/thue-phong-tro']) assert.equal((await https(path)).status, 200);
  pass('Built Next pages and real public routes over HTTPS');
  assert.equal((await https('/api/docs')).status, 404);
  assert.equal((await https('/api/v1/admin/dashboard')).status, 401);
  assert.equal((await https('/api/v1/conversations')).status, 401);
  for (const foreign of ['https://untrusted.example', undefined]) {
    const headers = { 'content-type': 'application/json' }; if (foreign) headers.Origin = foreign;
    const result = await https('/api/auth/login', { method: 'POST', headers, body: '{}' });
    assert.equal(result.status, 403);
  }
  await assert.rejects(https('/', { headers: { Host: 'untrusted.example' } }));
  await assert.rejects(https('/', { minVersion: 'TLSv1.1', maxVersion: 'TLSv1.1' }));
  for (const path of ['/ca.key', '/server.key', '/local.env']) assert.equal((await https(path)).status, 404);
  const publicCa = await https('/__local-test-ca.crt');
  assert.equal(publicCa.status, 200); assert.equal(new X509Certificate(publicCa.text).fingerprint256, prepared.caFingerprint);
  pass('Private endpoints anonymous-denied; missing/foreign Origin and forged Host denied; TLS 1.1 denied; no key/env served');

  // Credentials stay only in the protected ignored directory and pipe, never CLI/log.
  const credentialFile = resolve(directory, 'test-accounts.json');
  let fixtures;
  try { fixtures = JSON.parse(await readFile(credentialFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    fixtures = { accounts: ['TENANT', 'HOST', 'ADMIN'].map((role, i) => ({ role, phone: `099700000${i + 1}`,
      password: randomBytes(18).toString('base64url') + 'Aa1!', fullName: `HTTPS test ${role}` })),
      slug: `https-test-${owned.id}`, title: 'Phòng kiểm thử HTTPS', project: prepared.project };
    await writeFile(credentialFile, JSON.stringify(fixtures, null, 2), { mode: 0o600 });
  }
  assert.equal(fixtures.project, prepared.project);
  assert.equal(fixtures.slug, `https-test-${owned.id}`);
  assert.equal(fixtures.title, 'Phòng kiểm thử HTTPS');
  assert.equal(fixtures.accounts.length, 3);
  for (const [i, role] of ['TENANT', 'HOST', 'ADMIN'].entries()) {
    assert.equal(fixtures.accounts[i].role, role);
    assert.equal(fixtures.accounts[i].phone, `099700000${i + 1}`);
    assert.equal(typeof fixtures.accounts[i].password, 'string');
    secretValues.push(fixtures.accounts[i].password);
  }
  const seed = `import fs from 'node:fs';import bcrypt from 'bcrypt';import{PrismaClient}from './dist/generated/prisma/client.js';import{PrismaPg}from '@prisma/adapter-pg';
    const f=JSON.parse(fs.readFileSync(0,'utf8'));const url=new URL(process.env.DATABASE_URL);
    if(url.hostname!=='postgres'||url.pathname!=='/${owned.database}')throw Error('Owned DB required');
    const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
    try {await p.$transaction(async tx=>{const users=[];for(const a of f.accounts){let u=await tx.user.findUnique({where:{phone:a.phone}});
      if(u){if(u.role!==a.role||!await bcrypt.compare(a.password,u.passwordHash))throw Error('Fixture identity mismatch; no overwrite');}
      else u=await tx.user.create({data:{phone:a.phone,fullName:a.fullName,role:a.role,passwordHash:await bcrypt.hash(a.password,10),isPhoneVerified:true}});users.push(u);}
      let property=await tx.property.findUnique({where:{slug:f.slug}});if(!property){
        const ward=await tx.addressWard.findFirstOrThrow();property=await tx.property.create({data:{hostId:users[1].id,slug:f.slug,title:f.title,description:'Synthetic HTTPS integration fixture only',
          propertyType:'PHONG_TRO',rentalMode:'LONG_TERM',listingPlan:'FREE',addressDetail:'Synthetic street',provinceCode:ward.provinceCode,wardCode:ward.code,
          latitude:10.77,longitude:106.65,status:'PUBLISHED',longTermDetail:{create:{monthlyPrice:3500000,depositAmount:0,areaSqm:25,electricityCost:3500,waterCost:20000,waterUnit:'M3',internetCost:0,garbageCost:0,parkingFee:0,contactPhone:users[1].phone}}}});}
      if(property.hostId!==users[1].id)throw Error('Fixture ownership mismatch');
      const slug='https-homestay-${owned.id}';let stay=await tx.property.findUnique({where:{slug}});
      if(!stay){const ward=await tx.addressWard.findFirstOrThrow();stay=await tx.property.create({data:{hostId:users[1].id,slug,title:'Homestay kiểm thử HTTPS',description:'Synthetic HTTPS fixture only',
        propertyType:'HOMESTAY',rentalMode:'SHORT_TERM',provinceCode:ward.provinceCode,wardCode:ward.code,addressDetail:'Synthetic street',latitude:10.77,longitude:106.65,status:'PUBLISHED',
        homestayUnits:{create:{unitName:'Phòng kiểm thử',maxAdults:2,maxChildren:1,maxGuests:3,bedrooms:1,bathrooms:1,basePricePerNight:'600000',weekendPricePerNight:'750000',cleaningFee:'150000',
          checkInTime:new Date('1970-01-01T14:00:00Z'),checkOutTime:new Date('1970-01-01T12:00:00Z'),cancellationPolicy:'FLEXIBLE',instantBook:true,status:'PUBLISHED'}}}});}
      if(stay.hostId!==users[1].id)throw Error('Homestay fixture ownership mismatch');
      const unit=await tx.homestayUnit.findFirstOrThrow({where:{propertyId:stay.id}});
      return {ready:true,homestaySlug:slug,unitId:unit.id};
    }).then(result=>console.log(JSON.stringify(result)));}finally{await p.$disconnect();}`;
  const seeded = JSON.parse(await compose(['exec', '-T', 'api', 'node', '--input-type=module', '-e', seed], JSON.stringify(fixtures)));
  assert.equal(seeded.ready, true); assert.equal(seeded.homestaySlug, `https-homestay-${owned.id}`);
  await writeFile(resolve(directory, 'test-data.json'), JSON.stringify(seeded, null, 2), { mode: 0o600 });
  pass('Synthetic verified Tenant/Host/Admin, long-term listing and homestay in owned test DB; no main data modified');

  const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
  // Scope trust exception to this exact leaf SPKI; Node checks above validate its CA/IP.
  // This does not install a root CA or disable TLS validation on the application.
  const spki = createHash('sha256').update(leaf.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || 'msedge',
    args: [`--ignore-certificate-errors-spki-list=${spki}`] });
  const guestContext = await browser.newContext({ viewport: { width: 375, height: 900 } });
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guest = await guestContext.newPage(), host = await hostContext.newPage();
  const sockets = [];
  guest.on('websocket', socket => { sockets.push(socket.url()); });
  await loginThroughUi(guest, origin, fixtures.accounts[0]);
  await loginThroughUi(host, origin, fixtures.accounts[1]);
  await guest.goto(`${origin}/thue-phong-tro/${fixtures.slug}`);
  await guest.getByRole('button', { name: 'Chat với chủ nhà', exact: true }).click();
  await guest.getByText('Đã kết nối', { exact: true }).waitFor();
  const content = 'HTTPS real chat ' + randomBytes(6).toString('hex');
  await guest.getByLabel('Tin nhắn', { exact: true }).fill(content);
  await guest.getByRole('button', { name: 'Gửi', exact: true }).click();
  await guest.getByRole('list', { name: 'Lịch sử tin nhắn' }).getByText(content, { exact: true }).waitFor();
  await host.getByRole('button', { name: 'Mở tin nhắn', exact: true }).click();
  await host.getByRole('button', { name: fixtures.title, exact: false }).click();
  await host.getByText('Đã kết nối', { exact: true }).waitFor();
  await host.getByRole('list', { name: 'Lịch sử tin nhắn' }).getByText(content, { exact: true }).waitFor();
  await host.getByLabel('Tin nhắn', { exact: true }).fill(content + ' Host reply');
  await host.getByRole('button', { name: 'Gửi', exact: true }).click();
  await guest.getByText(content + ' Host reply', { exact: true }).waitFor();
  assert.ok(sockets.some(url => url.startsWith(origin.replace('https:', 'wss:') + '/socket.io/')));
  assert.ok(sockets.every(url => !/[?&](token|accessToken)=/.test(url)), 'No token in Socket URL');
  pass('Real UI login with Secure/HttpOnly refresh cookie and two-way chat via same-origin WSS/Nginx; no bridge/mocked Auth');
  for (const width of [375, 1440]) {
    await guest.setViewportSize({ width, height: 900 });
    assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await guest.screenshot({ path: resolve(directory, `https-chat-${width}.png`) });
  }
  await guest.keyboard.press('Escape');
  await guest.goto(origin + '/account'); await guest.reload();
  await guest.getByRole('button', { name: 'Mở menu tài khoản', exact: true }).waitFor();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const future = days => { const date = new Date(today + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  await guest.goto(`${origin}/homestay/${seeded.homestaySlug}`);
  await guest.getByLabel('Nhận phòng', { exact: true }).fill(future(5));
  await guest.getByLabel('Trả phòng', { exact: true }).fill(future(7));
  await guest.getByRole('button', { name: 'Xem báo giá', exact: true }).click();
  await guest.getByRole('link', { name: 'Tiếp tục đặt phòng', exact: true }).click();
  const holdResponse = guest.waitForResponse(r => r.url().endsWith('/api/management/bookings/hold') && r.request().method() === 'POST');
  await guest.getByRole('button', { name: 'Giữ phòng', exact: true }).click();
  const heldResponse = await holdResponse;
  assert.equal(heldResponse.status(), 201);
  const held = (await heldResponse.json()).data;
  assert.match(held.bookingId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
  assert.equal(held.bookingStatus, 'PENDING_PAYMENT'); assert.equal(held.paymentStatus, 'NOT_CONFIGURED');
  assert.equal(held.payment, null, 'No synthetic payment success');
  assert.equal(held.totalAmount, held.baseAmount + held.cleaningFee + held.serviceFee + held.taxAmount);
  const calendarPath = `/api/listings/homestays/units/${seeded.unitId}/calendar?month=${future(5).slice(0, 7)}&adults=1&children=0`;
  const reservedCalendar = (await https(calendarPath)).json();
  assert.equal(reservedCalendar.data.days.find(day => day.date === future(5)).isAvailable, false);
  await guest.getByRole('link', { name: 'Xem đơn của tôi', exact: true }).click();
  await guest.getByRole('button', { name: 'Hủy đơn chưa thanh toán', exact: true }).click();
  await guest.getByText('Bạn đã hủy', { exact: true }).waitFor();
  const freedCalendar = (await https(calendarPath)).json();
  assert.equal(freedCalendar.data.days.find(day => day.date === future(5)).isAvailable, true);
  const ledger = await compose(['exec', '-T', 'postgres', 'psql', '-U', 'app_test', '-d', owned.database, '-Atc',
    `SELECT booking_status||'|'||payment_status||'|'||(SELECT count(*) FROM finance_journals WHERE booking_id='${held.bookingId}') FROM bookings WHERE id='${held.bookingId}'`]);
  assert.equal(ledger, 'CANCELLED_BY_GUEST|NOT_CONFIGURED|0');
  pass('HTTPS real quote → hold → unavailable calendar → Guest cancellation → released calendar; no PAID/CONFIRMED or money journal');
  await logoutThroughUi(guest); await logoutThroughUi(host);
  const adminContext = await browser.newContext(); const admin = await adminContext.newPage();
  await loginThroughUi(admin, origin, fixtures.accounts[2]); await admin.goto(origin + '/admin');
  await admin.getByText('GMV gốc', { exact: true }).waitFor();
  await logoutThroughUi(admin);
  pass('375/1440 automated bounds/screenshots, real refresh after reload/logout and protected Admin dashboard');
  await writeFile(resolve(directory, 'https-check-result.json'), JSON.stringify({ date: new Date().toISOString(), origin,
    project: prepared.project, result: 'PASS', checks, fixtureOnly: true, physicalMobileTested: false,
    browserTrust: 'exact leaf SPKI exception in test process; root CA not installed', firewallChanged: false, trustStoreChanged: false }, null, 2));
} catch (error) {
  await writeFile(resolve(directory, 'https-check-result.json'), JSON.stringify({ date: new Date().toISOString(), origin,
    result: 'FAIL', checks, error: redact(error.message) }, null, 2));
  console.error(redact(error.message)); process.exitCode = 1;
} finally { await browser?.close(); }
