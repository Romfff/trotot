import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function validateCatalog(catalog) {
  assert.equal(catalog.sourceUrl,'https://danhmuchanhchinh.nso.gov.vn/Default.aspx','Unsupported catalog source');
  assert.match(catalog.asOf,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(catalog.asOf).toISOString().slice(0,10),catalog.asOf,'Invalid asOf date');
  assert.equal(catalog.version,`nso-${catalog.asOf}`,'Version/date mismatch');
  assert.ok(Array.isArray(catalog.provinces)&&catalog.provinces.length>0,'Empty provinces');
  assert.ok(Array.isArray(catalog.wards)&&catalog.wards.length>0,'Empty wards');
  const provinces=new Set(), wards=new Set(), parents=new Set();
  for(const [rows,width,keys,seen] of [[catalog.provinces,2,['code','name'],provinces],[catalog.wards,5,['code','name','provinceCode'],wards]]) {
    for(const row of rows) {
      assert.deepEqual(Object.keys(row).sort(),keys.toSorted(),'Unexpected catalog fields');
      assert.equal(typeof row.code,'string','Codes must preserve leading zeroes');
      assert.match(row.code,new RegExp(`^\\d{${width}}$`),'Invalid code');
      assert.ok(!seen.has(row.code),'Duplicate code');seen.add(row.code);
      assert.equal(typeof row.name,'string');
      assert.ok(row.name.length>0&&row.name.length<=150&&[...row.name].every(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127)&&row.name===row.name.trim(),'Invalid name');
      if(width===5){assert.ok(provinces.has(row.provinceCode),'Unknown province');parents.add(row.provinceCode);}
    }
  }
  assert.equal(parents.size,provinces.size,'Province without wards');
  return {version:catalog.version,provinces:provinces.size,wards:wards.size};
}

export async function loadCatalog(path,sha256) {
  assert.match(sha256,/^[a-f0-9]{64}$/,'Supply the reviewed catalog SHA256');
  const bytes=await readFile(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sha256,'Catalog checksum mismatch');
  const catalog=JSON.parse(bytes);
  validateCatalog(catalog);
  assert.equal(catalog.sourceFiles.length,2,'Expected province and ward source exports');
  const files=new Set();
  for(const source of catalog.sourceFiles) {
    assert.equal(typeof source.file,'string');
    assert.equal(basename(source.file),source.file,'Source must be adjacent to catalog');
    assert.match(source.file,new RegExp(`^official-nso-${catalog.asOf}-(provinces|wards)\\.xls$`));
    assert.ok(!files.has(source.file),'Duplicate source file');files.add(source.file);
    assert.match(source.sha256,/^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(await readFile(resolve(dirname(path),source.file))).digest('hex'),source.sha256,'Source checksum mismatch');
  }
  return catalog;
}

// Caller owns the transaction. Never delete codes or move wards between provinces.
export async function stageCatalog(client,catalog) {
  validateCatalog(catalog);
  assert.match((await client.query('SELECT current_database() AS name')).rows[0].name,/^trotot_catalog_test_[a-f0-9]{32}$/,'Catalog staging accepts only its dedicated test database');
  return writeCatalog(client,catalog);
}

// D05 local initialization only, not an automatic startup seed or territorial update.
// Never weaken the dedicated test-only guard above to import into the real database.
export async function initializeEmptyLocalCatalog(client,catalog,env) {
  validateCatalog(catalog);
  const url=new URL(env.DATABASE_URL);
  assert.equal(env.NODE_ENV,'development','Local initialization refuses test/production');
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Local initialization refuses remote databases');
  assert.equal(url.pathname,'/trotot','Local initialization accepts only the named local trotot database');
  assert.equal((await client.query('SELECT current_database() AS name')).rows[0].name,'trotot','Database connection differs from the reviewed target');
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query('LOCK TABLE address_provinces,address_wards,address_catalog_metadata IN ACCESS EXCLUSIVE MODE');
    const counts=(await client.query('SELECT (SELECT count(*) FROM address_provinces)::int AS provinces,(SELECT count(*) FROM address_wards)::int AS wards,(SELECT count(*) FROM address_catalog_metadata)::int AS metadata')).rows[0];
    assert.deepEqual(counts,{provinces:0,wards:0,metadata:0},'Catalog is not empty: review an update instead of overwriting existing data');
    const result=await writeCatalog(client,catalog);
    await client.query('COMMIT');
    return result;
  } catch(error) {await client.query('ROLLBACK');throw error;}
}

async function writeCatalog(client,catalog) {
  const provinces=new Map(catalog.provinces.map(p=>[p.code,p]));
  const wards=new Map(catalog.wards.map(w=>[w.code,w]));
  for(const row of (await client.query('SELECT code FROM address_provinces')).rows) {
    assert.ok(provinces.has(row.code),'Existing province missing: review territorial changes first');
  }
  for(const row of (await client.query('SELECT code,province_code FROM address_wards')).rows) {
    assert.ok(wards.has(row.code),'Existing ward missing: review territorial changes first');
    assert.equal(wards.get(row.code).provinceCode,row.province_code,'Ward parent change requires review');
  }
  const p=await client.query(`INSERT INTO address_provinces(code,name)
    SELECT code,name FROM jsonb_to_recordset($1::jsonb) AS incoming(code text,name text)
    ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name
    WHERE address_provinces.name IS DISTINCT FROM EXCLUDED.name RETURNING code`,[JSON.stringify(catalog.provinces)]);
  const w=await client.query(`INSERT INTO address_wards(code,name,province_code)
    SELECT code,name,"provinceCode" FROM jsonb_to_recordset($1::jsonb) AS incoming(code text,name text,"provinceCode" text)
    ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name
    WHERE address_wards.name IS DISTINCT FROM EXCLUDED.name RETURNING code`,[JSON.stringify(catalog.wards)]);
  await client.query(`INSERT INTO address_catalog_metadata(id,version,as_of,source_url) VALUES(true,$1,$2::date,$3)
    ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,as_of=EXCLUDED.as_of,source_url=EXCLUDED.source_url,imported_at=clock_timestamp()
    WHERE (address_catalog_metadata.version,address_catalog_metadata.as_of,address_catalog_metadata.source_url)
      IS DISTINCT FROM (EXCLUDED.version,EXCLUDED.as_of,EXCLUDED.source_url)`,[catalog.version,catalog.asOf,catalog.sourceUrl]);
  return {provinceChanges:p.rowCount,wardChanges:w.rowCount};
}

export async function dryRun(client,catalog) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try{return await stageCatalog(client,catalog);}finally{await client.query('ROLLBACK');}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const catalog=await loadCatalog(process.argv[2],process.argv[3]);
  console.log({...validateCatalog(catalog),sourcesVerified:true,databaseTouched:false});
}
