// Desk survey only: OSM-derived sample centers are not verified entrances or city boundaries.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from 'pg';
import {config} from 'dotenv';
import {exportFeatures, stageOsm} from './stage-osm.mjs';
import {GROUPS} from './osm-rules.mjs';

const anchors = [
 ['URBAN','way','237665212','HCMUT cơ sở 1'],
 ['URBAN','way','39514795','Chợ Bến Thành'],
 ['URBAN','way','198047671','Bệnh viện Thống Nhất'],
 ['URBAN','node','10591979655','Ga Sài Gòn'],
 ['URBAN','way','1419118309','HCMUT cơ sở 2, Đông Hòa'],
 ['PERIPHERAL','way','530221412','Bệnh viện ĐKKV Củ Chi'],
 ['PERIPHERAL','way','531191849','Bệnh viện ĐKKV Hóc Môn'],
 ['PERIPHERAL','way','489319486','Bệnh viện Bình Chánh'],
 ['PERIPHERAL','way','1087935624','Bệnh viện Nhà Bè'],
 ['PERIPHERAL','way','515126236','Co.opmart Cần Giờ'],
];
// Named candidates only; containment/distance flags require human review, not automatic merging.
const pairs = [
 ['way','1419118309','node','9593572513'],
 ['way','750613377','node','9587618747'],
 ['way','1541329054','node','9593946651'],
 ['way','1010844322','node','9593240663'],
 ['way','530221412','way','1086900731'],
 ['node','3116882997','node','3116882998'],
];
config({quiet:true,path:new URL('../../../.env',import.meta.url)});
const source = new URL(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1','[::1]'].includes(source.hostname)
 || !['postgres:','postgresql:'].includes(source.protocol) || process.argv.length !== 3) {
 throw new Error('One manifest and local Postgres required');
}
const output = fileURLToPath(new URL(`../../../.tmp/nearby-hcm-survey-${randomUUID()}/`,import.meta.url));
const name = `trotot_nearby_test_${randomUUID().replaceAll('-','')}`;
const admin = new Client({connectionString:source.href});
let client, created=false;
try {
 await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`); created=true;
 source.pathname=`/${name}`; client=new Client({connectionString:source.href}); await client.connect();
 await client.query('CREATE EXTENSION postgis; CREATE EXTENSION "uuid-ossp"');
 for (const folder of ['20261010000000_nearby_import_staging','20261010020000_nearby_import_quality']) {
  await client.query(await readFile(new URL(`../../prisma/migrations/${folder}/migration.sql`,import.meta.url),'utf8'));
 }
 const staging=await stageOsm(client,process.argv[2],name,{NODE_ENV:'test',DATABASE_URL:source.href});
 const manifest=JSON.parse(await readFile(process.argv[2],'utf8'));
 const samples=[];
 const getPlace=async (type,id) => (await client.query(`SELECT external_type AS type,external_id AS id,name,category,
  representative_method AS method,ST_Y(location::geometry) AS latitude,ST_X(location::geometry) AS longitude
  FROM nearby_import_places WHERE external_type=$1 AND external_id=$2`,[type,id])).rows[0];
 for (const [kind,type,id,label] of anchors) {
  const center=await getPlace(type,id); assert.ok(center,`Missing anchor ${type}/${id}`);
  const groups={};
  for (const [code,policy] of Object.entries(GROUPS)) {
   if (['FAMOUS','BACH_HOA_XANH'].includes(code)) continue;
   const rows=(await client.query(`SELECT external_type AS type,external_id AS id,name,category,
    representative_method AS method,ST_Y(location::geometry) AS latitude,ST_X(location::geometry) AS longitude,
    ST_Distance(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography) AS meters
    FROM nearby_import_places WHERE category=$3 AND ST_DWithin(location,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$4)
    ORDER BY meters,external_type,external_id`,[center.longitude,center.latitude,code,policy.radiusMeters])).rows;
   assert.ok(rows.every((row,index)=>row.meters>=0 && row.meters<=policy.radiusMeters && (!index||row.meters>=rows[index-1].meters)));
   groups[code]={radiusMeters:policy.radiusMeters,rawCount:rows.length,visibleCap:Math.min(rows.length,20),nearest:rows.slice(0,5)};
  }
  assert.ok(groups[center.category].nearest.some(row=>row.type===type&&row.id===id&&row.meters===0));
  samples.push({kind,label,center,groups});
 }
 const wanted=new Set(pairs.map(([type,id])=>`${type}/${id}`));
 const polygons=new Map(); const checksum=createHash('sha256');
 for await (const feature of exportFeatures(resolve(dirname(process.argv[2]),manifest.exportFile),checksum)) {
  if(feature && wanted.has(`${feature.type}/${feature.id}`) && feature.geometry.type==='MultiPolygon') {
   polygons.set(`${feature.type}/${feature.id}`,feature.geometry);
  }
 }
 assert.equal(checksum.digest('hex'),manifest.exportSha256);
 const candidates=[];
 for(const [ta,ia,tb,ib] of pairs) {
  const a=await getPlace(ta,ia),b=await getPlace(tb,ib); assert.ok(a&&b,'Missing comparison candidate');
  const geometry=polygons.get(`${ta}/${ia}`);
  const measurement=(await client.query(`SELECT ST_Distance(a.location,b.location) AS meters,
   CASE WHEN $5::text IS NULL THEN NULL ELSE ST_Covers(ST_SetSRID(ST_GeomFromGeoJSON($5),4326),b.location::geometry) END AS bInsideAreaA
   FROM nearby_import_places a,nearby_import_places b
   WHERE a.external_type=$1 AND a.external_id=$2 AND b.external_type=$3 AND b.external_id=$4`,
  [ta,ia,tb,ib,geometry?JSON.stringify(geometry):null])).rows[0];
  candidates.push({a,b,...measurement});
 }
 assert.equal(samples.length,10); assert.equal(candidates.length,6);
 await mkdir(output,{recursive:true});
 await writeFile(resolve(output,'report.json'),JSON.stringify({generatedAt:new Date().toISOString(),
  method:'DESK_SURVEY_OSM_SAMPLE_CIRCLES_NOT_CITYWIDE_OR_FIELD_ACCURACY',source:manifest,staging,samples,candidates,
  acceptance:'STAGING_ONLY_NOT_PUBLIC',independentCoordinatesVerified:false},null,2),{flag:'wx'});
 console.log(JSON.stringify({report:resolve(output,'report.json'),staging,samples:samples.map(({label,center,groups})=>
  ({label,latitude:center.latitude,longitude:center.longitude,counts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.rawCount]))})),candidates}));
} catch(error) {
 console.error(`Survey failed (${error.code||error.name}); application DB untouched.`); process.exitCode=1;
} finally {
 await client?.end(); if(created) await admin.query(`DROP DATABASE "${name}"`); await admin.end();
}
