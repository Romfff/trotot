import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root=resolve('..');
const require=createRequire(`${root}/backend/package.json`);
const {Pool}=require('pg'); const Redis=require('ioredis');
const env=require('dotenv').parse(readFileSync(`${root}/.env`));
const owned={project:process.env.RUNTIME_TEST_PROJECT,database:new URL(env.DATABASE_URL).pathname.slice(1)};
assert.match(owned.project,/^trotot-s345-[a-f0-9]{12}$/);
assert.match(owned.database,/^trotot_clean_test_[a-f0-9]{32}$/);
assert.equal(new URL(env.DATABASE_URL).pathname,`/${owned.database}`);
assert.equal(new URL(env.DATABASE_URL).hostname,'localhost');
function docker(args) { return execFileSync('docker',args,{encoding:'utf8',timeout:60000}); }
for(const name of ['postgres','redis']) assert.equal(docker(['inspect','--format','{{index .Config.Labels "com.docker.compose.project"}}',`${owned.project}-${name}-1`]).trim(),owned.project);
assert.equal(env.NODE_ENV,'test');
const ports=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}',`${owned.project}-postgres-1`]));
assert.ok(ports['5432/tcp'].some(p=>p.HostPort===new URL(env.DATABASE_URL).port&&p.HostIp==='127.0.0.1'));
assert.equal(env.REDIS_HOST,'localhost');
const redisPorts=JSON.parse(docker(['inspect','--format','{{json .NetworkSettings.Ports}}',`${owned.project}-redis-1`]));
assert.ok(redisPorts['6379/tcp'].some(p=>p.HostPort===env.REDIS_PORT&&p.HostIp==='127.0.0.1'));
const openPool=()=>new Pool({connectionString:env.DATABASE_URL});
const openRedis=()=>new Redis({host:env.REDIS_HOST,port:Number(env.REDIS_PORT),password:env.REDIS_PASSWORD,lazyConnect:true});
let pool=openPool();let redis=openRedis();
const migrationCount=readdirSync(resolve('prisma/migrations'),{withFileTypes:true}).filter(d=>d.isDirectory()).length;
const id=randomUUID(); const key=`ops-test:${id}`;
let child; let fixture=false; let logs='';
async function stop(){ if(!child) return; const c=child; child=undefined; if(c.exitCode===null){ const closed=once(c,'close');c.kill();await closed; } }
async function start(){
  const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=socket.address().port;await new Promise(r=>socket.close(r));
  logs='';child=spawn(process.execPath,['dist/main.js'],{cwd:`${root}/backend`,env:{...process.env,...env,PORT:String(port)},stdio:['ignore','pipe','pipe'],windowsHide:true});
  child.stdout.on('data',b=>{logs+=b});child.stderr.on('data',b=>{logs+=b});
  const end=Date.now()+45000;
  while(Date.now()<end){
    assert.equal(child.exitCode,null,'API must stay running');
    try{const r=await fetch(`http://127.0.0.1:${port}/api/v1/health`,{signal:AbortSignal.timeout(1500)});if(r.status===200){assert.deepEqual((await r.json()).data,{status:'ok',database:'ok',redis:'ok'});return port;}}catch{}
    await new Promise(r=>setTimeout(r,250));
  }
  throw new Error('Isolated API readiness timed out');
}
try{
  await pool.query("INSERT INTO users(id,phone,password_hash,full_name,role) VALUES ($1,'0980000001','fixture-only','Restart fixture','HOST')",[id]);fixture=true;
  await pool.query('INSERT INTO host_profiles(user_id,balance_wallet) VALUES ($1,987654.32)',[id]);
  await redis.set(key,'fixture-persistence');
  await start();await stop();
  await pool.end();await redis.quit();
  // Restart only the two verified task-owned containers. Volumes remain attached.
  docker(['restart',`${owned.project}-postgres-1`,`${owned.project}-redis-1`]);
  pool=openPool();redis=openRedis();
  for(const name of ['postgres','redis']){
    const end=Date.now()+45000; let healthy=false;
    while(Date.now()<end){healthy=docker(['inspect','--format','{{.State.Health.Status}}',`${owned.project}-${name}-1`]).trim()==='healthy';if(healthy)break;await new Promise(r=>setTimeout(r,500));}
    assert.ok(healthy,`${name} healthy after restart`);
  }
  await start();
  assert.equal((await pool.query('SELECT balance_wallet::text AS value FROM host_profiles WHERE user_id=$1',[id])).rows[0].value,'987654.32');
  assert.equal(await redis.get(key),'fixture-persistence');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].n,migrationCount);
  await stop();
  for(const [extra,message] of [[{JWT_ACCESS_SECRET:''},'Missing required environment variable: JWT_ACCESS_SECRET'],[{NODE_ENV:'production'},'Mock OTP is development-only']]){
    const result=execFailure({...process.env,...env,...extra});assert.ok(result.includes(message));
    for(const secret of [env.POSTGRES_PASSWORD,env.REDIS_PASSWORD,env.JWT_ACCESS_SECRET,env.JWT_REFRESH_SECRET]) assert.ok(!result.includes(secret));
  }
  console.log(JSON.stringify({result:'PASS',checks:['clean built API readiness before/after restart','PostGIS + Redis AOF persistence','migration records match source','missing env fails safely','production OTP mock rejected'],notRun:['app Linux container','worker/booking/payment recovery','production deployment']}));
}finally{await stop();if(fixture)await pool.query('DELETE FROM users WHERE id=$1',[id]);await redis.del(key);await redis.quit();await pool.end();}
function execFailure(environment){
  try{execFileSync(process.execPath,['dist/main.js'],{cwd:`${root}/backend`,env:environment,encoding:'utf8',timeout:15000,stdio:'pipe',windowsHide:true});throw new Error('Invalid environment unexpectedly started');}
  catch(e){assert.notEqual(e.status,0);assert.equal(e.status,1);return String(e.stdout??'')+String(e.stderr??'');}
}
