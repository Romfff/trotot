import { expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareExtract, FILTERS,geometryReport } from '../scripts/nearby/prepare-extract.mjs';
import { fileHash } from '../scripts/nearby/stage-osm.mjs';

async function temporary(check) {
  const directory=await mkdtemp(join(tmpdir(),'nearby-prepare-'));
  const input=join(directory,'source.osm.pbf');
  await writeFile(input,'synthetic PBF bytes');
  const options={input,output:join(directory,'prepared'),version:'test-only',
    sourceUrl:'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf',sourceAsOf:'2026-10-01T00:00:00Z'};
  try { await check(options); } finally { await rm(directory,{recursive:true,force:true}); }
}

it('prepares manifest only after both tools succeed, uses bounded isolated containers and exact argument arrays',async()=>temporary(async options=>{
  const calls=[];
  const run=async (tool,args,config)=>{
    calls.push({tool,args,config});
    await writeFile(join(options.output,args.includes('tags-filter')?'pois.osm.pbf':'pois.geojsonseq'),'synthetic output');
  };
  expect(await prepareExtract(options,run)).toMatchObject({status:'PREPARED'});
  const manifest=JSON.parse(await readFile(join(options.output,'manifest.json'),'utf8'));
  expect(manifest.extractSha256).toBe(await fileHash(options.input));
  expect(manifest.exportSha256).toBe(await fileHash(join(options.output,'pois.geojsonseq')));
  for (const {tool,args,config} of calls) {
    expect(tool).toBe('docker'); expect(args).toContain('--network'); expect(args).toContain('none');
    expect(args).toContain('--read-only'); expect(args).toContain('--cap-drop'); expect(args).toContain('ALL');
    expect(args).toContain('2g'); expect(config.windowsHide).toBe(true);
  }
  expect(calls[0].args).toEqual(expect.arrayContaining(FILTERS));
  expect(calls[0].args).not.toContain('--omit-referenced');
  expect(calls[1].args).toContain('--stop-on-error');
  await expect(prepareExtract(options,run)).rejects.toThrow();
  expect(calls).toHaveLength(2);
}));

it('tool failure retains artifacts but no manifest, never performs cleanup or DB writes',async()=>temporary(async options=>{
  let count=0;
  await expect(prepareExtract(options,async()=>{
    count++; await writeFile(join(options.output,'partial'),'partial'); throw new Error('tool failed');
  })).rejects.toThrow('tool failed');
  expect(count).toBe(1);
  expect(await readFile(join(options.output,'partial'),'utf8')).toBe('partial');
  await expect(access(join(options.output,'manifest.json'))).rejects.toThrow();
}));

it('rejects source changes during export without a manifest',async()=>temporary(async options=>{
  await expect(prepareExtract(options,async()=>{
    await writeFile(options.input,'changed during processing');
  })).rejects.toThrow('changed during export');
  await expect(access(join(options.output,'manifest.json'))).rejects.toThrow();
}));

it('rejects provider/path/metadata errors before starting Docker or writing output',async()=>temporary(async options=>{
  for (const patch of [{sourceUrl:'https://internal.example/secret'}, {version:'../escape'}, {output:options.output+',readonly'},
    {sourceAsOf:'bad'}]) {
    await expect(prepareExtract({...options,...patch},async()=>{throw new Error('must not run');})).rejects.toThrow();
    await expect(access(options.output)).rejects.toThrow();
  }
}));

it('geometry quarantine is explicit, checksum-linked, and refuses incomplete counters',async()=>temporary(async options=>{
 const calls=[];
 const run=async(tool,args)=>{calls.push(args);await writeFile(join(options.output,args.includes('tags-filter')?'pois.osm.pbf':'pois.geojsonseq'),'synthetic output');
  return {stderr:'Geometry error: Could not build area geometry\n[ 0:00] Wrote 12 features.\n[ 0:00] Encountered 1 errors.\n'};};
 await prepareExtract({...options,quarantineGeometry:true},run);
 const manifest=JSON.parse(await readFile(join(options.output,'manifest.json'),'utf8'));
 expect(manifest.qualitySha256).toBe(await fileHash(join(options.output,manifest.qualityFile)));
 expect(calls[1]).not.toContain('--stop-on-error');expect(calls[1]).toContain('--show-errors');
 expect(JSON.parse(await readFile(join(options.output,manifest.qualityFile),'utf8'))).toMatchObject({exported:12,geometryErrors:1,policy:'QUARANTINE_GEOMETRY'});
 expect(()=>geometryReport('Encountered 1 errors. Wrote 12 features.','a')).toThrow('Incomplete');
 expect(()=>geometryReport('tool crashed','a')).toThrow('Missing');
}));
