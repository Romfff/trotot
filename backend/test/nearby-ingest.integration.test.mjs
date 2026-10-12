import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { config } from 'dotenv';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { stageOsm } from '../scripts/nearby/stage-osm.mjs';
import { prepareExtract } from '../scripts/nearby/prepare-extract.mjs';

config({quiet:true,path:new URL('../../.env',import.meta.url)});
describe.skipIf(process.env.NEARBY_INTEGRATION !== '1')('Nearby staging: real isolated PostGIS', () => {
  const name = `trotot_nearby_test_${randomUUID().replaceAll('-','')}`;
  let admin, client, url, directory, created = false;
  const hash = value => createHash('sha256').update(value).digest('hex');
  const feature = (id='n1',longitude=106.6578,latitude=10.7725) => ({type:'Feature',id,
    properties:{name:'Synthetic POI, not public','@version':1,'@timestamp':'2026-10-01T00:00:00Z',shop:'supermarket',phone:'discard me'},
    geometry:{type:'Point',coordinates:[longitude,latitude]}});
  async function input(features, version=randomUUID(), tamper=false) {
    const extract = Buffer.from('Synthetic test bytes, not an OSM extract');
    const output = features.map(f=>`\x1e${JSON.stringify(f)}\n`).join('');
    await writeFile(join(directory,'fixture.osm.pbf'),extract);
    await writeFile(join(directory,'fixture.geojsonseq'),output);
    const manifest = {version,sourceUrl:'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf',
      sourceAsOf:'2026-10-01T00:00:00Z',extractFile:'fixture.osm.pbf',extractSha256:hash(extract),
      exportFile:'fixture.geojsonseq',exportSha256:tamper?'0'.repeat(64):hash(output)};
    await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest));
    return join(directory,'manifest.json');
  }
  const stage = path => stageOsm(client,path,name,{NODE_ENV:'test',DATABASE_URL:url});
  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL);
    if (!['localhost','127.0.0.1','[::1]'].includes(source.hostname)) throw new Error('Local PostGIS required');
    admin = new Client({connectionString:source.href}); await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`); created=true;
    source.pathname=`/${name}`; url=source.href;
    client = new Client({connectionString:url}); await client.connect();
    await client.query('CREATE EXTENSION postgis; CREATE EXTENSION "uuid-ossp"');
    await client.query(await readFile(new URL('../prisma/migrations/20261010000000_nearby_import_staging/migration.sql',import.meta.url),'utf8'));
    await client.query(await readFile(new URL('../prisma/migrations/20261010020000_nearby_import_quality/migration.sql',import.meta.url),'utf8'));
    directory=await mkdtemp(join(tmpdir(),'trotot-nearby-db-'));
  },30000);
  afterAll(async () => {
    await client?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin?.end();
    if (directory) await rm(directory,{recursive:true,force:true});
  });
  it('stages inside VN only, checks type identity, strips contact data, uses meters/GiST', async () => {
    const polygon={...feature('a2'),geometry:{type:'Polygon',coordinates:[[[106.65,10.77],[106.66,10.77],[106.66,10.78],[106.65,10.78],[106.65,10.77]]]}};
    const result=await stage(await input([feature(),polygon,{...polygon,id:'a3'},feature('n2',100,15)]));
    expect(result).toMatchObject({status:'STAGED',imported:3,outside:1});
    const rows=await client.query('SELECT external_type,external_id,tags,ST_X(location::geometry) AS lng FROM nearby_import_places');
    expect(rows.rows.map(r=>`${r.external_type}:${r.external_id}`).sort()).toEqual(['node:1','relation:1','way:1']);
    expect(rows.rows.every(r=>!('phone' in r.tags)&&r.lng>106)).toBe(true);
    const distance=await client.query(`SELECT ST_Distance(ST_MakePoint(106.6578,10.7725)::geography,
      ST_Project(ST_MakePoint(106.6578,10.7725)::geography,2000,0)) AS distance,
      ST_DWithin(ST_MakePoint(106.6578,10.7725)::geography,ST_Project(ST_MakePoint(106.6578,10.7725)::geography,2001,0),2000) AS outside`);
    expect(distance.rows[0].distance).toBeCloseTo(2000,3); expect(distance.rows[0].outside).toBe(false);
    await client.query('SET enable_seqscan=off');
    const plan=await client.query(`EXPLAIN SELECT * FROM nearby_import_places WHERE ST_DWithin(location,ST_MakePoint(106.6578,10.7725)::geography,2000)`);
    expect(JSON.stringify(plan.rows)).toContain('nearby_import_places_location_idx');
  });
  it('rolls back malformed geometry, late checksum failure, empty and duplicate records', async () => {
    const before=Number((await client.query('SELECT count(*) FROM nearby_imports')).rows[0].count);
    const badPolygon={...feature('a8'),geometry:{type:'Polygon',coordinates:[[[106.65,10.77],[106.66,10.78],[106.65,10.78],[106.66,10.77],[106.65,10.77]]]}};
    const future={...feature(),properties:{...feature().properties,'@timestamp':'2026-10-02T00:00:00Z'}};
    for (const features of [[feature(),badPolygon],[],[feature(),feature()],[future]]) await expect(stage(await input(features))).rejects.toThrow();
    await expect(stage(await input([feature()],randomUUID(),true))).rejects.toThrow(/checksum/);
    expect(Number((await client.query('SELECT count(*) FROM nearby_imports')).rows[0].count)).toBe(before);
  });
  it('same-version retries and concurrent imports never overwrite or duplicate a dataset', async () => {
    const path=await input([feature()],randomUUID());
    const peer=new Client({connectionString:url}); await peer.connect();
    try {
      const attempts=await Promise.allSettled([stage(path),stageOsm(peer,path,name,{NODE_ENV:'test',DATABASE_URL:url})]);
      expect(attempts.filter(r=>r.status==='fulfilled')).toHaveLength(1);
      expect(attempts.filter(r=>r.status==='rejected')).toHaveLength(1);
      await expect(stage(path)).rejects.toThrow();
    } finally { await peer.end(); }
  });
  it('approved quarantine records invalid PostGIS geometry and checksum-linked export counters; invalid provenance still fails',async()=>{
    const bad={...feature('a8'),geometry:{type:'Polygon',coordinates:[[[106.65,10.77],[106.66,10.78],[106.65,10.78],[106.66,10.77],[106.65,10.77]]]}};
    const path=await input([feature(),bad]);const manifest=JSON.parse(await readFile(path,'utf8'));
    const report={policy:'QUARANTINE_GEOMETRY',extractSha256:manifest.extractSha256,exported:2,geometryErrors:1,reasons:['Geometry error: test only']};
    const bytes=JSON.stringify(report);await writeFile(join(directory,'geometry-report.json'),bytes);
    manifest.qualityFile='geometry-report.json';manifest.qualitySha256=hash(bytes);await writeFile(path,JSON.stringify(manifest));
    expect(await stage(path)).toMatchObject({imported:1,quarantined:2});
    const stored=(await client.query('SELECT quarantined_count,report FROM nearby_import_quality')).rows[0];
    expect(stored.quarantined_count).toBe(2);expect(stored.report.postgisErrors).toEqual([{type:'way',id:'4',reason:'Invalid PostGIS geometry'}]);
    await writeFile(join(directory,'geometry-report.json'),JSON.stringify({...report,exported:99}));await expect(stage(path)).rejects.toThrow('checksum');
  });
  it.skipIf(process.env.NEARBY_OSMIUM !== '1')('actual osmium converts XML to PBF to RFC8142 and stages its output', async () => {
    const exec = promisify(execFile);
    const fixtureDirectory=fileURLToPath(new URL('./fixtures',import.meta.url));
    const run=async (source,args) => (await exec('docker',['run','--rm','--network','none','--read-only',
      '--cap-drop','ALL','--security-opt','no-new-privileges','--memory','2g','--cpus','1',
      '--mount',`type=bind,source=${source},target=/data,readonly`,'trotot-nearby-osmium:local',...args],
      {encoding:'buffer',maxBuffer:1024*1024,timeout:30000})).stdout;
    const pbf=await run(fixtureDirectory,['cat','/data/nearby.osm','-f','pbf']);
    await writeFile(join(directory,'fixture.osm.pbf'),pbf);
    const output=join(directory,'prepared');
    await prepareExtract({input:join(directory,'fixture.osm.pbf'),output,version:`converter-${randomUUID()}`,
      sourceUrl:'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf',sourceAsOf:'2026-10-01T00:00:00Z'});
    expect(await stage(join(output,'manifest.json'))).toMatchObject({imported:2,outside:0,status:'STAGED'});
  },60000);
});
