import {test} from 'vitest';
import assert from 'node:assert/strict';
import {validateCatalog,loadCatalog,initializeEmptyLocalCatalog,stageCatalog} from '../scripts/check-address-catalog.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const valid=()=>({sourceUrl:'https://danhmuchanhchinh.nso.gov.vn/Default.aspx',asOf:'2026-10-04',version:'nso-2026-10-04',provinces:[{code:'01',name:'Thành phố Hà Nội'}],wards:[{code:'00004',name:'Phường Ba Đình',provinceCode:'01'}]});
test('String codes and reviewed snapshot metadata are retained',()=>{
 const catalog=valid();assert.deepEqual(validateCatalog(catalog),{version:'nso-2026-10-04',provinces:1,wards:1});assert.equal(catalog.wards[0].code,'00004');
});
test('Reject duplicate, malformed, empty, cross-province and unexpected fields',()=>{
 for(const mutate of [c=>c.wards.push({...c.wards[0]}),c=>c.provinces.push({...c.provinces[0]}),c=>c.wards[0].code=4,c=>c.wards[0].code='4',c=>c.wards[0].provinceCode='79',c=>c.wards=[],c=>c.provinces.push({code:'79',name:'Other'}),c=>c.wards[0].name='bad\nname',c=>c.wards[0].extra=true]){const c=valid();mutate(c);assert.throws(()=>validateCatalog(c));}
});
test('Reject unsupported source, version/date mismatch and invalid calendar date',()=>{
 for(const mutate of [c=>c.sourceUrl='https://example.com',c=>c.version='nso-2025-07-01',c=>c.asOf='2026-02-30']){const c=valid();mutate(c);assert.throws(()=>validateCatalog(c));}
});
test('Pinned catalog plus both original source hashes required; tampering/traversal/duplicates rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'trotot-catalog-'));const hash=b=>createHash('sha256').update(b).digest('hex');
 try{
  const c=valid();c.sourceFiles=[];
  for(const level of ['provinces','wards']){const file=`official-nso-${c.asOf}-${level}.xls`;await writeFile(join(dir,file),level);c.sourceFiles.push({file,sha256:hash(level)});}
  const path=join(dir,'catalog.json');
  async function save(){const data=JSON.stringify(c);await writeFile(path,data);return hash(data);}
  assert.equal((await loadCatalog(path,await save())).wards[0].code,'00004');
  await assert.rejects(loadCatalog(path,'0'.repeat(64)),/Catalog checksum/);
  await writeFile(join(dir,c.sourceFiles[0].file),'tampered');await assert.rejects(loadCatalog(path,await save()),/Source checksum/);
  await writeFile(join(dir,c.sourceFiles[0].file),'provinces');
  c.sourceFiles[1]={...c.sourceFiles[0]};await assert.rejects(loadCatalog(path,await save()),/Duplicate source/);
  c.sourceFiles[0].file='../outside.xls';await assert.rejects(loadCatalog(path,await save()),/adjacent/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('Local initialization refuses production, remote, wrong named DB and mismatched connection before writes',async()=>{
 const queries=[];const client={query:async sql=>{queries.push(sql);return {rows:[{name:'wrong_database'}]};}};
 for(const env of [{NODE_ENV:'production',DATABASE_URL:'postgresql://localhost/trotot'}, {NODE_ENV:'development',DATABASE_URL:'postgresql://example.com/trotot'}, {NODE_ENV:'development',DATABASE_URL:'postgresql://localhost/other'}, {NODE_ENV:'development',DATABASE_URL:'postgresql://localhost/trotot'}]) await assert.rejects(initializeEmptyLocalCatalog(client,valid(),env));
 assert.ok(queries.every(sql=>sql==='SELECT current_database() AS name'));
 await assert.rejects(stageCatalog({query:async()=>({rows:[{name:'trotot'}]})},valid()),/dedicated test database/);
});

test('Local initialization locks catalog and refuses any existing rows with rollback, no inserts',async()=>{
 const queries=[];const client={query:async sql=>{queries.push(sql);return {rows:sql.startsWith('SELECT current_database')?[{name:'trotot'}]:[{provinces:1,wards:0,metadata:0}]};}};
 await assert.rejects(initializeEmptyLocalCatalog(client,valid(),{NODE_ENV:'development',DATABASE_URL:'postgresql://localhost/trotot'}),/not empty/);
 assert.ok(queries.includes('BEGIN ISOLATION LEVEL SERIALIZABLE'));
 assert.ok(queries.some(sql=>sql.startsWith('LOCK TABLE address_provinces')));
 assert.equal(queries.at(-1),'ROLLBACK');assert.ok(!queries.some(sql=>sql.startsWith('INSERT')));
});
