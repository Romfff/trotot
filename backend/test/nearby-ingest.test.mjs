import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyOsm, GROUPS, normalizeOsmFeature, osmIdentity, safeTags } from '../scripts/nearby/osm-rules.mjs';
import { assertLocalTarget, exportFeatures, validateManifest } from '../scripts/nearby/stage-osm.mjs';

export const fixture = (id = 'n1', properties = {}) => ({ type: 'Feature', id,
  properties: { '@version': 1, '@timestamp': '2026-10-01T00:00:00Z', name: 'Test-only POI', shop: 'supermarket', ...properties },
  geometry: { type: 'Point', coordinates: [106.6578,10.7725] } });
export const manifest = () => ({ version:'test-only-20261010', sourceUrl:'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf',
  sourceAsOf:'2026-10-01T00:00:00Z', extractFile:'fixture.osm.pbf', extractSha256:'a'.repeat(64),
  exportFile:'fixture.geojsonseq', exportSha256:'b'.repeat(64) });

describe('Approved nearby OSM ingest rules (synthetic fixtures only)', () => {
  it('keeps exact node/way/relation IDs, including values beyond JS safe integer', () => {
    expect(osmIdentity('n1')).toEqual({type:'node',id:'1'});
    expect(osmIdentity('w1')).toEqual({type:'way',id:'1'});
    expect(osmIdentity('a2')).toEqual({type:'way',id:'1'});
    expect(osmIdentity('a3')).toEqual({type:'relation',id:'1'});
    expect(osmIdentity('a18014398509481987')).toEqual({type:'relation',id:'9007199254740993'});
    for (const value of [1,'r1','n0','a1','w-1','n9223372036854775808']) expect(() => osmIdentity(value)).toThrow();
  });
  it('maps allowed categories and does not guess brand/fame/civilian airports', () => {
    for (const [tags,group] of [[{amenity:'marketplace'},'MARKETS'],[{shop:'general'},'GROCERIES'],
      [{amenity:'college'},'UNIVERSITIES'],[{healthcare:'hospital'},'HOSPITALS'],
      [{public_transport:'platform',bus:'yes'},'BUS_STOPS'],[{tourism:'museum'},'ATTRACTIONS'],
      [{amenity:'cafe'},'DINING'],[{railway:'station'},'TRANSPORT']]) expect(classifyOsm(tags)).toBe(group);
    for (const tags of [{aeroway:'aerodrome'},{historic:'yes'},{public_transport:'platform'},
      {railway:'station',station:'subway'},{amenity:'school'}]) expect(classifyOsm(tags)).toBeNull();
    expect(classifyOsm({shop:'convenience',name:'Bách hóa Xanh'})).toBe('GROCERIES');
    expect(GROUPS.FAMOUS.radiusMeters).toBe(50000);
    expect(GROUPS.TRANSPORT.radiusMeters).toBe(5000);
  });
  it('strips personal/contact/contributor tags, prefers Vietnamese name', () => {
    const tags = { name:'English', 'name:vi':'Tên Việt', 'contact:phone':'not retained', email:'not retained', user:'not retained', brand:'x' };
    expect(safeTags(tags)).toEqual({name:'English','name:vi':'Tên Việt',brand:'x'});
    expect(normalizeOsmFeature(fixture('n1',tags)).name).toBe('Tên Việt');
    expect(normalizeOsmFeature(fixture('n1',{name:''}))).toBeNull();
    expect(normalizeOsmFeature(fixture('n1',{shop:'unknown'}))).toBeNull();
  });
  it('rejects malformed/nonfinite/axis-invalid geometry and corrupt provenance', () => {
    expect(normalizeOsmFeature(fixture('n1',{'@timestamp':1790812800})).timestamp).toBe('2026-10-01T00:00:00Z');
    for (const geometry of [{type:'Point',coordinates:[NaN,10]},{type:'Point',coordinates:[10,106]},
      {type:'Point',coordinates:[106,10,1]},{type:'GeometryCollection',geometries:[]}]) {
      expect(() => normalizeOsmFeature({...fixture(),geometry})).toThrow();
    }
    for (const properties of [{'@version':0},{'@timestamp':'2026-02-30T00:00:00Z'},{'@timestamp':'bad'},{'@timestamp':-1},{'@timestamp':Infinity}]) {
      expect(() => normalizeOsmFeature(fixture('n1',properties))).toThrow();
    }
    expect(() => normalizeOsmFeature(fixture('w1'))).toThrow(/mismatch/);
  });
  it('validates source/checksums/date/path and refuses production/remote/wrong database', () => {
    expect(validateManifest(manifest()).version).toBe('test-only-20261010');
    for (const patch of [{sourceUrl:'http://download.geofabrik.de/asia/vietnam-latest.osm.pbf'},
      {sourceUrl:'https://example.com/asia/vietnam-latest.osm.pbf'}, {extractFile:'../escape.osm.pbf'},
      {exportFile:'C:\\escape.geojsonseq'},{sourceAsOf:'2026-02-30T00:00:00Z'},{extractSha256:'bad'},
      {sourceAsOf:'2999-01-01T00:00:00Z'},{extra:true}]) expect(() => validateManifest({...manifest(),...patch})).toThrow();
    const env = {NODE_ENV:'development',DATABASE_URL:'postgresql://localhost/trotot'};
    expect(() => assertLocalTarget(env,'trotot')).not.toThrow();
    for (const patch of [{NODE_ENV:'production'},{DATABASE_URL:'postgresql://example.com/trotot'},
      {DATABASE_URL:'postgresql://localhost/other'}]) expect(() => assertLocalTarget({...env,...patch},'trotot')).toThrow();
  });
  it('streams RFC8142, preserves Unicode and rejects truncation/invalid UTF8/oversize', async () => {
    const directory = await mkdtemp(join(tmpdir(),'trotot-nearby-'));
    const path = join(directory,'fixture.geojsonseq');
    const read = async () => {
      const items=[];
      for await (const item of exportFeatures(path,createHash('sha256'))) items.push(item);
      return items;
    };
    try {
      await writeFile(path,`\x1e${JSON.stringify(fixture('n1',{name:'Chợ có dấu'}))}\n`);
      expect((await read())[0].name).toBe('Chợ có dấu');
      for (const content of ['{}\n','\x1e{}',Buffer.from([30,255,10]),'\x1e'+'x'.repeat(1024*1024+1)+'\n']) {
        await writeFile(path,content); await expect(read()).rejects.toThrow();
      }
    } finally { await rm(directory,{recursive:true,force:true}); }
  });
});
