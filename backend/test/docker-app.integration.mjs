import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Own project, random credentials, no main Compose/env/DB, no volume deletion.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const id = randomUUID().replaceAll('-', '');
const project = `trotot-app-test-${id.slice(0, 12)}`;
const dir = resolve(root, '.tmp', project);
const database = `app_test_${id}`;
const envFile = resolve(dir, 'local.env');
const frontendContext = resolve(dir, 'frontend');
const cleanBuildFile = resolve(dir, 'clean-build.yaml');
const checks = [];
const execution = promisify(execFile);
const socket = createServer().listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise((done, fail) => socket.close(error => error ? fail(error) : done()));
const origin = `http://127.0.0.1:${port}`;
const baseArgs = ['compose', '--project-name', project, '--env-file', envFile,
  '-f', resolve(root, 'compose.app.local.yaml'), '-f', cleanBuildFile];
const values = {
  LOCAL_POSTGRES_DB: database, LOCAL_POSTGRES_USER: 'app_test', LOCAL_POSTGRES_PASSWORD: randomBytes(24).toString('hex'),
  LOCAL_REDIS_PASSWORD: randomBytes(24).toString('hex'),
  LOCAL_JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), LOCAL_JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
  LOCAL_BFF_PROXY_SECRET: randomBytes(32).toString('hex'), LOCAL_WEB_PORT: port, LOCAL_FRONTEND_ORIGIN: origin,
};
values.LOCAL_DATABASE_URL = `postgresql://app_test:${values.LOCAL_POSTGRES_PASSWORD}@postgres:5432/${database}?schema=public`;
function redact(text) {
  for (const [key, value] of Object.entries(values)) if (/SECRET|PASSWORD/.test(key)) text = text.replaceAll(String(value), '[REDACTED]');
  return text;
}
async function docker(args, options = {}) {
  try {
    const result = await execution('docker', args, { cwd: root, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true, ...options });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(redact(`${error.code || 'DOCKER_ERROR'}: ${error.stdout || ''}\n${error.stderr || error.message}`));
  }
}
const compose = (args, options) => docker([...baseArgs, ...args], options);
const pass = message => { checks.push(message); console.log('PASS: ' + message); };
const redis = (...args) => compose(['exec', '-T', 'redis', 'sh', '-c', 'REDISCLI_AUTH="$REDIS_PASSWORD" exec redis-cli "$@"', 'owned-test', ...args]);
const apiNode = (script) => compose(['exec', '-T', 'api', 'node', '--input-type=module', '-e', script]);
let started = false;
try {
  await mkdir(dir, { recursive: true });
  // Reproduce a handoff without local generated next-env.d.ts, .next, dependencies or environment files.
  await mkdir(frontendContext);
  for (const name of ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json',
    'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs', 'src', 'public', 'tests', 'vitest.config.mts']) {
    await cp(resolve(root, 'frontend', name), resolve(frontendContext, name), { recursive: true });
  }
  await writeFile(cleanBuildFile, `services:\n  web:\n    build:\n      context: ${JSON.stringify(frontendContext.replaceAll('\\', '/'))}\n`);
  await writeFile(envFile, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  await writeFile(resolve(dir, 'owned-resources.json'), JSON.stringify({ project, database, origin, id, volumesRetained: true }, null, 2));
  await compose(['config', '--quiet']);
  console.log('Building isolated Linux app stack (lockfile npm ci; no production secrets).');
  // Desktop BuildKit on this machine crashed with concurrent external builds.
  await docker(['build', '--target', 'checks', '--tag', `${project}-frontend-checks`, frontendContext], { timeout: 900_000 });
  pass('Clean frontend context: lockfile install, build, unit tests, lint and typecheck without generated inputs');
  for (const service of ['migrate', 'api', 'web']) await compose(['build', service], { timeout: 900_000 });
  started = true;
  await compose(['up', '-d'], { timeout: 180_000 });
  for (let attempt = 0; attempt < 60; attempt++) {
    const health = await fetch(origin + '/api/v1/health').catch(() => null);
    if (health?.ok) break;
    if (attempt === 59) throw new Error('Owned stack health timed out');
    await new Promise(done => setTimeout(done, 1000));
  }
  const health = await fetch(origin + '/api/v1/health');
  assert.equal(health.status, 200); assert.equal((await health.json()).data.database, 'ok');
  pass('Nginx â†’ real API/PostGIS/Redis health; migration completed before API');
  await apiNode(`import {WebSocket} from 'ws';
    const check=async(origin,allowed)=>new Promise((resolve,reject)=>{
      const ws=new WebSocket('ws://edge:8080/socket.io/?EIO=4&transport=websocket',{headers:{Origin:origin}});
      const timer=setTimeout(()=>{ws.terminate();reject(Error('Socket proxy timeout'));},5000);
      ws.on('message',frame=>{clearTimeout(timer);ws.close();if(allowed&&frame.toString().startsWith('0'))resolve();else reject(Error('Unexpected Engine.IO handshake'));});
      ws.on('error',()=>{clearTimeout(timer);if(!allowed)resolve();else reject(Error('Allowed socket handshake failed'));});
    });await check('${origin}',true);await check('https://untrusted.example',false);`);
  pass('Nginx forwards real Engine.IO WebSocket handshake; allowed Origin works and foreign Origin is rejected');
  const migrations = await compose(['exec', '-T', 'postgres', 'psql', '-U', 'app_test', '-d', database, '-Atc', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL']);
  const migrationCount = (await readdir(resolve(root, 'backend/prisma/migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory()).length;
  assert.equal(migrations, String(migrationCount));
  await compose(['run', '--rm', 'migrate']);
  assert.equal(await compose(['exec', '-T', 'postgres', 'psql', '-U', 'app_test', '-d', database, '-Atc', 'SELECT count(*) FROM _prisma_migrations']), String(migrationCount));
  pass(`Fresh ${migrationCount} migrations and repeated deploy preserves schema`);
  const ids = (await compose(['ps', '-q', 'api', 'web', 'edge', 'postgres', 'redis'])).split(/\s+/);
  const inspections = JSON.parse(await docker(['inspect', ...ids]));
  for (const container of inspections) {
    assert.equal(container.Config.Labels['com.docker.compose.project'], project);
    const ports = Object.values(container.NetworkSettings.Ports || {}).flat().filter(Boolean);
    if (container.Config.Labels['com.docker.compose.service'] === 'edge') assert.equal(ports[0].HostIp, '127.0.0.1');
    else assert.equal(ports.length, 0);
  }
  assert.equal(JSON.parse(await apiNode('console.log(JSON.stringify({uid:process.getuid(),node:process.version}))')).uid, 1000);
  assert.equal(await compose(['exec', '-T', 'web', 'id', '-u']), '1000');
  assert.equal(await compose(['exec', '-T', 'edge', 'id', '-u']), '101');
  pass('API/web/edge non-root; DB/Redis/API/web no host ports; edge loopback only');
  await apiNode("import bcrypt from 'bcrypt'; import sharp from 'sharp'; const h=await bcrypt.hash('synthetic-local-only',4); if(!await bcrypt.compare('synthetic-local-only',h))throw Error('bcrypt'); const m=await sharp(Buffer.from('<svg width=\"1\" height=\"1\"></svg>')).metadata(); if(m.width!==1)throw Error('sharp');");
  pass('Linux native bcrypt/sharp dependencies execute');
  const slug = `container-fixture-${id}`;
  const seed = `import {PrismaClient} from './dist/generated/prisma/client.js'; import {PrismaPg} from '@prisma/adapter-pg'; const p=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})}); try { const u=await p.user.create({data:{phone:'0990000001',fullName:'Container test fixture',passwordHash:'test-only',role:'HOST'}}); await p.addressProvince.create({data:{code:'79',name:'Synthetic Province'}}); await p.addressWard.create({data:{code:'26740',name:'Synthetic Ward',provinceCode:'79'}}); for(const status of ['PUBLISHED','PENDING_REVIEW'])await p.property.create({data:{hostId:u.id,slug:status==='PUBLISHED'?'${slug}':'pending-${id}',title:status==='PUBLISHED'?'Verified container fixture':'Private container fixture',description:'Synthetic integration data',propertyType:'PHONG_TRO',rentalMode:'LONG_TERM',addressDetail:'Synthetic street',provinceCode:'79',wardCode:'26740',latitude:10.77,longitude:106.65,status,longTermDetail:{create:{monthlyPrice:3500000,depositAmount:3500000,areaSqm:25.5,electricityCost:3500,waterCost:20000,waterUnit:'M3',internetCost:0,garbageCost:0,parkingFee:0,contactPhone:'0990000001'}}}}); }finally{await p.$disconnect();}`;
  await apiNode(seed);
  const html = await (await fetch(origin + '/thue-phong-tro/' + slug)).text();
  assert.ok(html.includes('Verified container fixture')); assert.ok(html.includes('application/ld+json'));
  assert.ok(!html.includes('Private container fixture'));
  const staticPath = html.match(/src="([^"\s]+\/_next\/static\/[^"\s]+|\/_next\/static\/[^"\s]+)"/)?.[1];
  assert.ok(staticPath); assert.equal((await fetch(new URL(staticPath, origin))).status, 200);
  assert.equal((await fetch(origin + '/thue-phong-tro/pending-' + id)).status, 404);
  pass('Built Next standalone SSR/metadata/JSON-LD/static assets; pending fixture 404');

  const network = `${project}_app`;
  for (const tail of [20, 21]) {
    const ip = `172.30.247.${tail}`;
    const key = `sprint2:limit:ip:${createHash('sha256').update(ip).digest('hex')}`;
    const client = `const edge='http://edge:8080'; const h={'x-forwarded-for':'198.51.100.99','x-real-ip':'198.51.100.99','x-trotot-edge-ip':'198.51.100.99','x-trotot-client-ip':'198.51.100.99','x-trotot-proxy-signature':'0'.repeat(64),'x-trotot-proxy-timestamp':String(Date.now())}; for(const path of ['/thue-phong-tro/${slug}','/thue-phong-tro','/sitemap.xml','/sitemaps/1.xml','/api/listings/properties/long-term/search','/api/v1/properties/long-term/search']){const r=await fetch(edge+path,{headers:h});if(r.status!==200)throw Error(path+': '+r.status);await r.text();}`;
    await docker(['run', '--rm', '--network', network, '--ip', ip, 'node:24.15.0-bookworm-slim', 'node', '-e', client]);
    assert.equal(Number(await redis('get', key)), 6);
    // LISTEN_HOST=0.0.0.0 uses IPv4 sockets; the raw call adds one to the same client's bucket.
    const direct = `const r=await fetch('http://api:5000/api/v1/properties/long-term/search',{headers:{'x-forwarded-for':'198.51.100.99','x-trotot-edge-ip':'198.51.100.99'}});if(r.status!==200)throw Error('direct spoof');await r.text();`;
    await docker(['run','--rm','--network',network,'--ip',ip,'node:24.15.0-bookworm-slim','node','-e',direct]);
    assert.equal(Number(await redis('get', key)), 7);
  }
  const forgedKey = `sprint2:limit:ip:${createHash('sha256').update('198.51.100.99').digest('hex')}`;
  assert.equal(await redis('exists', forgedKey), '0');
  pass('Two Linux client IPs: SSR/BFF/direct edge six requests each; proxy overwrite/signature stripping and direct unsigned spoof rejection');

  const apiImage = inspections.find(c => c.Config.Labels['com.docker.compose.service'] === 'api').Image;
  for (const [name, overrides, expected] of [
    ['missing', {JWT_ACCESS_SECRET: ''}, 'Missing required environment variable: JWT_ACCESS_SECRET'],
    ['production', {NODE_ENV:'production'}, 'Mock OTP is development-only'],
    ['trust', {TRUSTED_PROXY_CIDRS:'0.0.0.0/0'}, 'TRUSTED_PROXY_CIDRS'],
  ]) {
    const probeFile = resolve(dir, `negative-${name}.env`);
    const probe = {NODE_ENV:'development',OTP_PROVIDER:'mock',DATABASE_URL:values.LOCAL_DATABASE_URL || 'postgresql://test:test@postgres:5432/test',REDIS_PASSWORD:values.LOCAL_REDIS_PASSWORD,JWT_ACCESS_SECRET:values.LOCAL_JWT_ACCESS_SECRET,JWT_REFRESH_SECRET:values.LOCAL_JWT_REFRESH_SECRET,...overrides};
    await writeFile(probeFile, Object.entries(probe).map(([k,v])=>`${k}=${v}`).join('\n'), {mode:0o600});
    let output=''; try { await docker(['run','--rm','--env-file',probeFile,apiImage]); assert.fail('Unsafe startup was accepted'); } catch(error) { output=error.message; }
    assert.ok(output.includes(expected), name+' startup diagnostic');
    assert.ok(!output.includes(values.LOCAL_JWT_REFRESH_SECRET));
  }
  pass('Missing secret, production mock OTP, and wildcard trust all fail before binding without leaking secrets');

  await redis('set', 'owned-app-persistence', 'fixture');
  await compose(['stop', 'edge', 'web', 'api']);
  await compose(['restart', 'postgres', 'redis']);
  await compose(['up', '-d']);
  for (let attempt=0;attempt<60;attempt++) {
    const r=await fetch(origin+'/api/v1/health').catch(()=>null);
    if(r?.ok)break;
    if(attempt===59)throw Error('Restart health timed out');
    await new Promise(done=>setTimeout(done,1000));
  }
  assert.equal(await redis('get','owned-app-persistence'),'fixture');
  assert.ok((await (await fetch(origin+'/thue-phong-tro/'+slug)).text()).includes('Verified container fixture'));
  assert.equal(await compose(['exec','-T','postgres','psql','-U','app_test','-d',database,'-Atc','SELECT count(*) FROM properties']),'2');
  pass('Own stack restart preserves DB records, migrations, Redis AOF and public SSR');
  await writeFile(resolve(dir,'result.json'),JSON.stringify({date:new Date().toISOString(),project,database,origin,checks,result:'PASS',volumesRetained:true},null,2));
  console.log(`Evidence: ${dir}`);
} catch(error) {
  if(started) {
    const logs=redact(await compose(['logs','--no-color','--tail','60','migrate','api','web','edge']).catch(()=>''));
    await writeFile(resolve(dir,'failure-logs.txt'),logs); console.error(logs);
  }
  await writeFile(resolve(dir,'result.json'),JSON.stringify({date:new Date().toISOString(),project,checks,result:'FAIL',error:redact(error.message)},null,2));
  console.error(redact(error.message)); process.exitCode=1;
} finally {
  if(started) {
    const ownedIds=(await compose(['ps','-aq'])).split(/\s+/).filter(Boolean);
    const owned=ownedIds.length?JSON.parse(await docker(['inspect',...ownedIds])):[];
    assert.ok(owned.every(c=>c.Config.Labels['com.docker.compose.project']===project));
    await compose(['down','--timeout','15']); // Never --volumes; retain only this project's test volumes.
  }
}
