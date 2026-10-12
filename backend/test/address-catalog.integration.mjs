import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import dotenv from 'dotenv';
import {Pool} from 'pg';
import {loadCatalog,stageCatalog,dryRun} from '../scripts/check-address-catalog.mjs';
const env=dotenv.parse(await readFile(resolve(process.env.ADDRESS_CATALOG_TEST_ENV||'../.env')));
const source=new URL(env.DATABASE_URL);
assert.ok(['test','development'].includes(env.NODE_ENV),'Production catalog test refused');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(source.hostname));
// Like the listings harness, this connection only creates/drops its own UUID DB.
// stageCatalog still rejects the main/clean connection before any catalog writes.
assert.match(source.pathname,/^\/(trotot|trotot_clean_test_[a-f0-9]{32})$/,'Only known local development/owned clean infrastructure accepted');
const file=resolve(process.argv[2]);const sha256=process.argv[3];const catalog=await loadCatalog(file,sha256);
const name=`trotot_catalog_test_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({connectionString:source.toString()});let pool,created=false,client;
const evidence={version:catalog.version,sha256,provinces:catalog.provinces.length,wards:catalog.wards.length,checks:[],realDatabase:true,mainDatabaseTouched:false};
try {
  await admin.query(`CREATE DATABASE "${name}"`);created=true;
  source.pathname=`/${name}`;
  await promisify(execFile)(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{env:{...process.env,...env,DATABASE_URL:source.toString()},timeout:60000,windowsHide:true});
  pool=new Pool({connectionString:source.toString()});client=await pool.connect();
  const migrations=(await readdir(resolve('prisma/migrations'),{withFileTypes:true})).filter(d=>d.isDirectory()).length;
  assert.equal((await client.query('SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL')).rows[0].n,migrations);
  evidence.migrations=migrations;
  assert.deepEqual(await dryRun(client,catalog),{provinceChanges:34,wardChanges:3321});
  assert.equal((await client.query('SELECT count(*)::int AS n FROM address_wards')).rows[0].n,0);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM address_provinces')).rows[0].n,0);
  evidence.checks.push('Fresh dry-run rolls back all provinces and wards');
  await client.query('BEGIN');
  assert.deepEqual(await stageCatalog(client,catalog),{provinceChanges:34,wardChanges:3321});
  assert.deepEqual(await stageCatalog(client,catalog),{provinceChanges:0,wardChanges:0});
  await client.query('COMMIT');
  const saved=async()=>({provinces:(await client.query('SELECT code,name FROM address_provinces ORDER BY code')).rows,wards:(await client.query('SELECT code,name,province_code AS "provinceCode" FROM address_wards ORDER BY code')).rows});
  const expected={provinces:catalog.provinces.toSorted((a,b)=>a.code.localeCompare(b.code)),wards:catalog.wards.toSorted((a,b)=>a.code.localeCompare(b.code))};
  assert.deepEqual(await saved(),expected);
  evidence.checks.push('All 3355 records match reviewed source; repeated staging changes zero rows');
  const changed=structuredClone(catalog);changed.wards[0].name+=' thử';
  assert.deepEqual(await dryRun(client,changed),{provinceChanges:0,wardChanges:1});
  assert.deepEqual(await saved(),expected);
  evidence.checks.push('Rename dry-run rolls back and retains leading zero codes');
  const moved=structuredClone(catalog);moved.wards[0].provinceCode='79';
  await assert.rejects(dryRun(client,moved),/parent change requires review/);
  const missing=structuredClone(catalog);missing.wards.shift();
  await assert.rejects(dryRun(client,missing),/Existing ward missing/);
  assert.deepEqual(await saved(),expected);
  evidence.checks.push('Territorial removal/reparent refuses automatic mutation');
  await client.query('BEGIN');
  await client.query("CREATE FUNCTION pg_temp.catalog_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_ONLY_CATALOG_FAILURE'; END $$");
  await client.query('CREATE TRIGGER catalog_test_failure BEFORE UPDATE ON address_wards FOR EACH ROW EXECUTE FUNCTION pg_temp.catalog_fail()');
  await client.query('COMMIT');
  changed.provinces[0].name+=' thử';
  await assert.rejects(dryRun(client,changed),/TEST_ONLY_CATALOG_FAILURE/);
  assert.deepEqual(await saved(),expected);
  await client.query('DROP TRIGGER catalog_test_failure ON address_wards');
  evidence.checks.push('Ward write failure rolls back preceding province rename');
  for(const [sql,values,code] of [
    ['INSERT INTO address_wards(code,name,province_code) VALUES($1,$2,$3)',['99999','Test invalid parent','99'],'23503'],
    ['INSERT INTO address_wards(code,name,province_code) VALUES($1,$2,$3)',['00004','Test duplicate','01'],'23505'],
  ]){await client.query('BEGIN');await assert.rejects(client.query(sql,values),e=>e.code===code);await client.query('ROLLBACK');}
  evidence.checks.push('Database FK and unique constraints reject invalid parent/duplicate');
  const forbidden=await admin.connect();try{await assert.rejects(dryRun(forbidden,catalog),/dedicated test database/);}finally{forbidden.release();}
  evidence.checks.push('Default clean/main-style DB target rejected before catalog writes');
  console.log(JSON.stringify(evidence,null,2));
  if(process.env.ADDRESS_CATALOG_EVIDENCE)await writeFile(process.env.ADDRESS_CATALOG_EVIDENCE,JSON.stringify({...evidence,verifiedAt:new Date().toISOString()},null,2)+'\n');
} finally {
  if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}
  if(pool)await pool.end();
  if(created){assert.match(name,/^trotot_catalog_test_[a-f0-9]{32}$/);await admin.query(`DROP DATABASE "${name}"`);}
  await admin.end();
}
