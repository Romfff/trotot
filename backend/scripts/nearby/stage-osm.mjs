import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_VERSION, normalizeOsmFeature } from './osm-rules.mjs';

const boundaryFile = fileURLToPath(new URL('../../../frontend/src/lib/vietnam-boundary.json', import.meta.url));
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_EXPORT_BYTES = 1024 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateManifest(input, now = new Date()) {
  const keys = ['version','sourceUrl','sourceAsOf','extractFile','extractSha256','exportFile','exportSha256'];
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => ![...keys,'qualityFile','qualitySha256'].includes(key))
    || keys.some(key => typeof input[key] !== 'string')) throw new Error('Invalid ingest manifest');
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/u.test(input.version)) throw new Error('Invalid dataset version');
  const url = new URL(input.sourceUrl);
  if (url.protocol !== 'https:' || url.hostname !== 'download.geofabrik.de' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/asia\/vietnam(?:-[a-z0-9]+)?\.osm\.pbf$/u.test(url.pathname)) {
    throw new Error('Unsupported extract source');
  }
  const date = new Date(input.sourceAsOf);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(input.sourceAsOf)
    || !Number.isFinite(date.getTime()) || date.toISOString() !== input.sourceAsOf.replace('Z','.000Z') || date > now) {
    throw new Error('Invalid source date');
  }
  for (const key of ['extractSha256','exportSha256']) if (!/^[a-f0-9]{64}$/u.test(input[key])) throw new Error('Invalid checksum');
  for (const key of ['extractFile','exportFile']) {
    if (input[key] !== basename(input[key]) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/u.test(input[key])) {
      throw new Error('Source files must be adjacent to manifest');
    }
  }
  if (!input.extractFile.endsWith('.osm.pbf') || !input.exportFile.endsWith('.geojsonseq')) throw new Error('Invalid source extension');
  if(input.qualityFile!==undefined||input.qualitySha256!==undefined){
    if(typeof input.qualityFile!=='string'||input.qualityFile!==basename(input.qualityFile)||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}\.json$/u.test(input.qualityFile)
      ||typeof input.qualitySha256!=='string'||!/^[a-f0-9]{64}$/u.test(input.qualitySha256))throw new Error('Invalid quality report manifest');
  }
  return input;
}

async function adjacentFile(directory, filename) {
  const path = await realpath(resolve(directory, filename));
  if (dirname(path) !== directory || !(await stat(path)).isFile()) throw new Error('Source file escaped manifest directory');
  return path;
}

export async function fileHash(path) {
  const checksum = createHash('sha256');
  for await (const chunk of createReadStream(path)) checksum.update(chunk);
  return checksum.digest('hex');
}

export async function* exportFeatures(path, checksum) {
  let pending = Buffer.alloc(0), total = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 65536 })) {
    total += chunk.length;
    if (total > MAX_EXPORT_BYTES) throw new Error('Export exceeds 1 GiB staging budget');
    checksum.update(chunk);
    pending = Buffer.concat([pending, chunk]);
    let newline;
    while ((newline = pending.indexOf(10)) !== -1) {
      const line = pending.subarray(0, newline);
      pending = pending.subarray(newline + 1);
      if (line.length > MAX_LINE_BYTES) throw new Error('OSM feature exceeds size budget');
      if (!line.length || line[0] !== 0x1e) throw new Error('Expected RFC8142 record separator');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(line.subarray(1));
      yield normalizeOsmFeature(JSON.parse(text));
    }
    if (pending.length > MAX_LINE_BYTES) throw new Error('OSM feature exceeds size budget');
  }
  if (pending.length) throw new Error('Truncated GeoJSON sequence');
}

export function assertLocalTarget(env, expectedDatabase) {
  const url = new URL(env.DATABASE_URL);
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') throw new Error('Staging command is local/test only');
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)
    || !['postgres:','postgresql:'].includes(url.protocol)
    || !/^trotot(?:_nearby_test_[a-f0-9]{32})?$/u.test(expectedDatabase)
    || decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) throw new Error('Unexpected local database');
}

export async function stageOsm(client, manifestPath, expectedDatabase, env = process.env) {
  assertLocalTarget(env, expectedDatabase);
  const connected = await client.query('SELECT current_database() AS name');
  if (connected.rows[0]?.name !== expectedDatabase) throw new Error('Connected database mismatch');
  const manifestRealPath = await realpath(manifestPath);
  if ((await stat(manifestRealPath)).size > 8192) throw new Error('Manifest too large');
  const manifest = validateManifest(JSON.parse(await readFile(manifestRealPath, 'utf8')));
  const directory = dirname(manifestRealPath);
  const extractFile = await adjacentFile(directory, manifest.extractFile);
  const exportFile = await adjacentFile(directory, manifest.exportFile);
  if (await fileHash(extractFile) !== manifest.extractSha256) throw new Error('Extract checksum mismatch');
  let quality=null;
  if(manifest.qualityFile){
    const path=await adjacentFile(directory,manifest.qualityFile);
    if((await stat(path)).size>1024*1024||await fileHash(path)!==manifest.qualitySha256)throw new Error('Quality report checksum or size mismatch');
    quality=JSON.parse(await readFile(path,'utf8'));
    if(quality.policy!=='QUARANTINE_GEOMETRY'||quality.extractSha256!==manifest.extractSha256||!Number.isSafeInteger(quality.exported)||quality.exported<1
      ||!Number.isSafeInteger(quality.geometryErrors)||quality.geometryErrors<0||!Array.isArray(quality.reasons)||quality.reasons.length!==quality.geometryErrors
      ||quality.reasons.some(reason=>typeof reason!=='string'||reason.length>500))throw new Error('Invalid geometry quality report');
  }
  const boundaryBytes = await readFile(boundaryFile);
  const boundary = JSON.parse(boundaryBytes.toString('utf8'));
  const checksum = createHash('sha256');
  const id = randomUUID();
  let imported = 0, ignored = 0, outside = 0;const invalidGeometry=[];
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    // No promotion/update/delete: repeated version is rejected by the DB unique constraint.
    await client.query(`INSERT INTO nearby_imports
      (id,version,config_version,source_url,source_as_of,extract_sha256,export_sha256,boundary_sha256,feature_count,ignored_count,outside_count)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,0,0)`,
    [id,manifest.version,CONFIG_VERSION,manifest.sourceUrl,manifest.sourceAsOf,manifest.extractSha256,manifest.exportSha256,hash(boundaryBytes)]);
    await client.query('CREATE TEMP TABLE nearby_guard (area geometry(MultiPolygon,4326)) ON COMMIT DROP');
    await client.query('INSERT INTO nearby_guard VALUES (ST_SetSRID(ST_GeomFromGeoJSON($1),4326))', [JSON.stringify(boundary)]);
    for await (const feature of exportFeatures(exportFile, checksum)) {
      if (!feature) { ignored++; continue; }
      if (Date.parse(feature.timestamp) > Date.parse(manifest.sourceAsOf)) throw new Error('Feature newer than extract timestamp');
      const result = await client.query(`WITH geometry AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON($1),4326) AS g
      ), point AS (
        SELECT ST_IsValid(g) AND NOT ST_IsEmpty(g) AS valid, ST_PointOnSurface(g) AS p FROM geometry
      ) SELECT valid, ST_X(p) AS longitude, ST_Y(p) AS latitude,
        ST_X(p) BETWEEN 102.1 AND 109.5 AND ST_Y(p) BETWEEN 8.4 AND 23.4
        AND ST_Covers((SELECT area FROM nearby_guard),p) AS supported FROM point`, [JSON.stringify(feature.geometry)]);
      const point = result.rows[0];
      if (!point?.valid || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
        if(!quality)throw new Error('Invalid PostGIS geometry');
        invalidGeometry.push({type:feature.type,id:feature.id,reason:'Invalid PostGIS geometry'});continue;
      }
      if (!point.supported) { outside++; continue; }
      await client.query(`INSERT INTO nearby_import_places
        (import_id,external_type,external_id,source_version,source_updated_at,name,category,tags,location,representative_method)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,ST_SetSRID(ST_MakePoint($9,$10),4326)::geography,$11)`,
      [id,feature.type,feature.id,feature.version,feature.timestamp,feature.name,feature.category,JSON.stringify(feature.tags),
        point.longitude,point.latitude,feature.representativeMethod]);
      imported++;
    }
    if (checksum.digest('hex') !== manifest.exportSha256) throw new Error('Export checksum mismatch');
    if (!imported) throw new Error('Empty dataset cannot be staged');
    if(quality){
      if(imported+ignored+outside+invalidGeometry.length!==quality.exported)throw new Error('Quality report feature count mismatch');
      await client.query('INSERT INTO nearby_import_quality(import_id,quarantined_count,report) VALUES($1,$2,$3)',[id,quality.geometryErrors+invalidGeometry.length,JSON.stringify({...quality,postgisErrors:invalidGeometry,qualitySha256:manifest.qualitySha256})]);
    }
    await client.query('UPDATE nearby_imports SET feature_count=$2, ignored_count=$3, outside_count=$4 WHERE id=$1', [id,imported,ignored,outside]);
    await client.query('COMMIT');
    return { version: manifest.version, status: 'STAGED', imported, ignored, outside,quarantined:(quality?.geometryErrors||0)+invalidGeometry.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [manifest, flag, database] = process.argv.slice(2);
  try {
    if (!manifest || flag !== '--confirm-db' || !database || process.argv.length !== 5) throw new Error('Usage: node scripts/nearby/stage-osm.mjs MANIFEST --confirm-db DATABASE');
    const { config } = await import('dotenv'); config({ quiet: true, path: new URL('../../../.env', import.meta.url) });
    assertLocalTarget(process.env, database);
    const { Client } = await import('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try { console.log(JSON.stringify(await stageOsm(client, manifest, database))); }
    finally { await client.end(); }
  } catch {
    // Do not print source rows, connection strings or provider payloads.
    console.error('Nearby staging failed. Check target, manifest, checksums, geometry and unique dataset version. No partial import committed.');
    process.exitCode = 1;
  }
}
