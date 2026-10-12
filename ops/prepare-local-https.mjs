import assert from 'node:assert/strict';
import { X509Certificate, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const run=promisify(execFile),root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const manifestFile=resolve(process.argv[2]||''),host=process.argv[3]||'127.0.0.1',port=Number(process.argv[4]||38443);
assert.ok(isIP(host)===4&&/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host),'Only an explicit loopback/private IPv4 address is allowed');
assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535&&![3000,5000,5432,6379,58491,58492].includes(port),'Use a separate unprivileged edge port');
const owner=JSON.parse(await readFile(manifestFile,'utf8'));
assert.ok(/^trotot-app-test-[a-f0-9]{12}$/.test(owner.project)&&/^[a-f0-9]{32}$/.test(owner.id)
  &&owner.project.endsWith(owner.id.slice(0,12))&&owner.database===`app_test_${owner.id}`,'Owned isolated app-test manifest required');
assert.equal(manifestFile,resolve(root,'.tmp',owner.project,'owned-resources.json'),'Do not use external/unowned env files');
const entries=(await readFile(resolve(dirname(manifestFile),'local.env'),'utf8')).trim().split(/\r?\n/).map(line=>{
  const match=/^(LOCAL_[A-Z_]+)=([^\r\n]*)$/.exec(line);assert.ok(match,'Only generated LOCAL_* entries are supported');return match.slice(1);
});
const env=Object.fromEntries(entries),database=new URL(env.LOCAL_DATABASE_URL);
assert.ok(database.hostname==='postgres'&&database.pathname===`/${owner.database}`&&env.LOCAL_POSTGRES_DB===owner.database,'Isolated DB identity mismatch');
const directory=resolve(root,'.tmp',`local-https-${randomUUID().replaceAll('-','')}`);
await mkdir(directory,{mode:0o700});
if(process.platform==='win32'){
  const {stdout}=await run('powershell.exe',['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{windowsHide:true});
  const sid=stdout.trim();assert.match(sid,/^S-1-5-\d+(?:-\d+)+$/);
  await run('icacls.exe',[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true});
}
const openssl=process.env.OPENSSL_BIN||'openssl';
const generate=args=>run(openssl,args,{cwd:directory,windowsHide:true,timeout:30000,maxBuffer:16384});
await generate(['req','-x509','-newkey','rsa:2048','-noenc','-sha256','-days','7','-subj','/CN=Trotot temporary local test CA',
  '-keyout','ca.key','-out','ca.crt','-addext','basicConstraints=critical,CA:TRUE,pathlen:0','-addext','keyUsage=critical,keyCertSign,cRLSign']);
await generate(['req','-new','-newkey','rsa:2048','-noenc','-sha256','-subj',`/CN=${host}`,'-keyout','server.key','-out','server.csr',
  '-addext',`subjectAltName=IP:${host}`,'-addext','basicConstraints=critical,CA:FALSE','-addext','keyUsage=critical,digitalSignature,keyEncipherment','-addext','extendedKeyUsage=serverAuth']);
await generate(['x509','-req','-in','server.csr','-CA','ca.crt','-CAkey','ca.key','-CAcreateserial','-out','server.crt','-days','7','-sha256','-copy_extensions','copy']);
await chmod(resolve(directory,'ca.key'),0o600);
// Protected 0700 directory/Windows ACL; only the edge mounts this leaf key read-only.
await chmod(resolve(directory,'server.key'),0o644);
const ca=new X509Certificate(await readFile(resolve(directory,'ca.crt'))),leaf=new X509Certificate(await readFile(resolve(directory,'server.crt')));
assert.ok(ca.ca&&leaf.verify(ca.publicKey)&&leaf.checkIP(host)&&!leaf.ca,'Certificate identity/chain mismatch');
const config=(await readFile(resolve(root,'ops/nginx.https.local.conf.template'),'utf8')).replaceAll('__HOST__',host).replaceAll('__PORT__',String(port));
await writeFile(resolve(directory,'nginx.conf'),config,{mode:0o600});
Object.assign(env,{LOCAL_FRONTEND_ORIGIN:`https://${host}:${port}`,LOCAL_WEB_PORT:String(port),LOCAL_PREVIEW_BIND:host,
  LOCAL_HTTPS_CONFIG:resolve(directory,'nginx.conf').replaceAll('\\','/'),LOCAL_TLS_DIR:directory.replaceAll('\\','/'),
  LOCAL_BOOKING_ALLOW_UNCONFIGURED_PAYMENT:'true',LOCAL_REALTIME_ENABLED:'true'});
env.LOCAL_HOMESTAY_QUOTE_SECRET ||=randomBytes(32).toString('hex');
await writeFile(resolve(directory,'local.env'),Object.entries(env).map(([name,value])=>`${name}=${value}`).join('\n')+'\n',{mode:0o600});
const result={project:owner.project,database:owner.database,origin:env.LOCAL_FRONTEND_ORIGIN,directory,caFingerprint:ca.fingerprint256,
  expires:leaf.validTo,bind:host,firewallChanged:false,trustStoreChanged:false,notProduction:true};
await writeFile(resolve(directory,'prepared.json'),JSON.stringify(result,null,2),{mode:0o600});
console.log(JSON.stringify(result));
