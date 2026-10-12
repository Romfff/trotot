import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { initializeEmptyLocalCatalog, loadCatalog, validateCatalog } from './check-address-catalog.mjs';

// Explicit local-only command. Reads checksum-pinned official exports; never fetches,
// generates example addresses, deletes rows, or logs DATABASE_URL/credentials.
assert.equal(process.argv.length,5,'Usage: node scripts/initialize-local-address-catalog.mjs <catalog.json> <reviewed-sha256> --apply-empty-local');
assert.equal(process.argv[4],'--apply-empty-local','Explicit empty local initialization flag required');
const catalog=await loadCatalog(resolve(process.argv[2]),process.argv[3]);
const env=dotenv.parse(await readFile(resolve('../.env')));
assert.equal(env.NODE_ENV,'development','Local initialization refuses test/production');
const url=new URL(env.DATABASE_URL);
assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname),'Remote database refused');
assert.equal(url.pathname,'/trotot','Only named local trotot accepted');
const pool=new Pool({connectionString:url.toString()});
const client=await pool.connect();
try {
  const result=await initializeEmptyLocalCatalog(client,catalog,env);
  console.log({...validateCatalog(catalog),...result,sourcesVerified:true,localDatabase:'trotot',removedRows:0});
} finally {client.release();await pool.end();}
