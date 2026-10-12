import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertLocalTarget } from './stage-osm.mjs';
import { CONFIG_VERSION } from './osm-rules.mjs';

export async function promoteDataset(client,version,reviewReference,expectedDatabase,env=process.env,rollbackFrom) {
  assertLocalTarget(env,expectedDatabase);
  if (typeof version!=='string'||!/^[a-z0-9][a-z0-9_-]{0,99}$/u.test(version)
    ||typeof reviewReference!=='string'||!reviewReference.trim()||reviewReference.length>500
    ||[...reviewReference].some(char=>char.charCodeAt(0)<32)) throw new Error('Dataset version and reviewed evidence required');
  if ((await client.query('SELECT current_database() AS name')).rows[0]?.name!==expectedDatabase) throw new Error('Connected database mismatch');
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('nearby-dataset-promotion',0))");
    const result=await client.query('SELECT * FROM nearby_imports WHERE version=$1 FOR SHARE',[version]);
    const dataset=result.rows[0];
    if (!dataset||dataset.config_version!==CONFIG_VERSION||dataset.status!=='STAGED'||!dataset.feature_count) throw new Error('Reviewed staged dataset required');
    const current=(await client.query(`SELECT s.import_id,i.source_as_of,i.version FROM nearby_dataset_state s
      JOIN nearby_imports i ON i.id=s.import_id WHERE s.id=1 FOR UPDATE OF s`)).rows[0];
    if (current?.import_id===dataset.id) { await client.query('COMMIT'); return {version,status:'ACTIVE',replayed:true}; }
    if(rollbackFrom!==undefined&&(!current||current.version!==rollbackFrom))throw new Error('Active dataset changed; rollback refused');
    if (current&&dataset.source_as_of<current.source_as_of&&rollbackFrom===undefined) throw new Error('Cannot promote older dataset');
    const count=Number((await client.query('SELECT count(*) AS total FROM nearby_import_places WHERE import_id=$1',[dataset.id])).rows[0].total);
    if (count!==dataset.feature_count) throw new Error('Staging count mismatch');
    await client.query(`INSERT INTO nearby_places
      (external_type,external_id,name,category,tags,location,representative_method,dataset_id,source_version,source_updated_at)
      SELECT external_type,external_id,name,category,tags,location,representative_method,import_id,source_version,source_updated_at
      FROM nearby_import_places WHERE import_id=$1
      ON CONFLICT(source,external_type,external_id) DO UPDATE SET name=excluded.name,category=excluded.category,
       tags=excluded.tags,location=excluded.location,representative_method=excluded.representative_method,
       dataset_id=excluded.dataset_id,source_version=excluded.source_version,source_updated_at=excluded.source_updated_at,retired_at=NULL`,[dataset.id]);
    await client.query('UPDATE nearby_places SET retired_at=now() WHERE dataset_id<>$1 AND retired_at IS NULL',[dataset.id]);
    await client.query(`INSERT INTO nearby_dataset_state(id,import_id,review_reference) VALUES(1,$1,$2)
      ON CONFLICT(id) DO UPDATE SET import_id=excluded.import_id,promoted_at=now(),review_reference=excluded.review_reference`,[dataset.id,reviewReference.trim()]);
    if(rollbackFrom!==undefined){
      // A known-bad generation must disappear immediately, not survive in the 30-day stale window.
      await client.query(`UPDATE property_nearby_state SET active_snapshot_id=NULL WHERE active_snapshot_id IN
        (SELECT id FROM property_nearby_snapshots WHERE dataset_id=$1)`,[current.import_id]);
    }
    await client.query('INSERT INTO nearby_dataset_events(from_import_id,to_import_id,action,reason) VALUES($1,$2,$3,$4)',
      [current?.import_id||null,dataset.id,rollbackFrom===undefined?'PROMOTE':'ROLLBACK',reviewReference.trim()]);
    await client.query('COMMIT');
    return {version,status:'ACTIVE',replayed:false};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const [version,review,flag,database,rollbackFlag,rollbackFrom]=process.argv.slice(2);
  if((process.argv.length!==6&&process.argv.length!==8)||flag!=='--confirm-db'||rollbackFlag&&rollbackFlag!=='--rollback-from'||rollbackFlag&&!rollbackFrom)throw new Error('Expected VERSION REVIEW_REFERENCE --confirm-db DATABASE [--rollback-from ACTIVE_VERSION]');
  const {config}=await import('dotenv');config({quiet:true,path:new URL('../../../.env',import.meta.url)});
  assertLocalTarget(process.env,database);
  const {Client}=await import('pg');const client=new Client({connectionString:process.env.DATABASE_URL});await client.connect();
  try{console.log(JSON.stringify(await promoteDataset(client,version,review,database,process.env,rollbackFrom)));}finally{await client.end();}
 }catch{console.error('Nearby promotion failed. Verify reviewed staging, source date and local target; no partial promotion committed.');process.exitCode=1;}
}
