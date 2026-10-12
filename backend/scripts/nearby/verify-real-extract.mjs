// Diagnostic staging only: owns an isolated local DB and drops only that exact generated DB.
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Client} from 'pg';
import {config} from 'dotenv';
import {stageOsm} from './stage-osm.mjs';
config({quiet:true,path:new URL('../../../.env',import.meta.url)});
const source=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1','[::1]'].includes(source.hostname)||process.argv.length!==3)throw new Error('One manifest and local DB required');
const name=`trotot_nearby_test_${randomUUID().replaceAll('-','')}`;
const admin=new Client({connectionString:source.href});let client,created=false;
try{
 await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
 source.pathname=`/${name}`;client=new Client({connectionString:source.href});await client.connect();
 await client.query('CREATE EXTENSION postgis; CREATE EXTENSION "uuid-ossp"');
 for(const folder of ['20261010000000_nearby_import_staging','20261010020000_nearby_import_quality'])
  await client.query(await readFile(new URL(`../../prisma/migrations/${folder}/migration.sql`,import.meta.url),'utf8'));
 const result=await stageOsm(client,process.argv[2],name,{NODE_ENV:'test',DATABASE_URL:source.href});
 const groups=(await client.query('SELECT category,count(*)::int AS total FROM nearby_import_places GROUP BY category ORDER BY category')).rows;
 const suspected=(await client.query(`SELECT count(*)::int AS total FROM nearby_import_places a JOIN nearby_import_places b
  ON a.import_id=b.import_id AND (a.external_type,a.external_id)<(b.external_type,b.external_id)
  AND a.category=b.category AND a.name=b.name AND ST_DWithin(a.location,b.location,25)`)).rows[0].total;
 console.log(JSON.stringify({...result,groups,suspectedSameNameWithin25m:suspected,acceptance:'STAGING_ONLY_NOT_PUBLIC',manualSurvey:'NOT_DONE'}));
}catch{console.error('Real extract verification failed; isolated test DB is cleaned up; application DB untouched.');process.exitCode=1;}
finally{await client?.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
