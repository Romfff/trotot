import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { constants, copyFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileHash, validateManifest } from './stage-osm.mjs';

const exec = promisify(execFile);
const IMAGE = 'trotot-nearby-osmium:local';
export const FILTERS = Object.freeze([
  'nwr/shop=supermarket,convenience,general',
  'nwr/amenity=marketplace,university,college,hospital,restaurant,cafe',
  'nwr/healthcare=hospital','nwr/highway=bus_stop','nwr/public_transport=platform',
  'nwr/tourism=attraction,museum,viewpoint',
  'nwr/historic=monument,memorial,castle,archaeological_site,ruins','nwr/railway=station',
]);

function mount(source,target,readonly) {
  // Docker --mount uses commas as delimiters; reject them rather than reinterpreting a path.
  if (source.includes(',') || source.includes('\n') || source.includes('\r')) throw new Error('Unsupported mount path');
  return `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''}`;
}

export function geometryReport(stderr,sourceHash) {
  const errors=stderr.match(/Encountered (\d+) errors\./u);const written=stderr.match(/Wrote (\d+) features\./u);
  if(!errors||!written||!Number.isSafeInteger(Number(errors[1]))||!Number(written[1]))throw new Error('Missing export quality counters');
  const reasons=stderr.split(/\r?\n/u).filter(line=>line.startsWith('Geometry error:')).map(line=>line.slice(0,500));
  if(reasons.length!==Number(errors[1]))throw new Error('Incomplete geometry quarantine report');
  return {policy:'QUARANTINE_GEOMETRY',extractSha256:sourceHash,exported:Number(written[1]),geometryErrors:Number(errors[1]),reasons};
}
export async function prepareExtract({input, output, sourceUrl, sourceAsOf, version,quarantineGeometry=false}, run = exec) {
  const source = await realpath(input);
  if (!source.endsWith('.osm.pbf') || !(await stat(source)).isFile() || !(await stat(source)).size) throw new Error('Nonempty PBF file required');
  const destination = resolve(output);
  const candidate = validateManifest({version,sourceUrl,sourceAsOf,extractFile:'source.osm.pbf',
    extractSha256:'0'.repeat(64),exportFile:'pois.geojsonseq',exportSha256:'0'.repeat(64)});
  const baseArgs=['run','--rm','--network','none','--read-only','--cap-drop','ALL',
    '--security-opt','no-new-privileges','--memory','2g','--cpus','1','--tmpfs','/tmp:rw,size=256m',
    '--mount',mount(source,'/input/source.osm.pbf',true),'--mount',mount(destination,'/output',false),IMAGE];
  // Never reuse or overwrite an operator's existing output directory.
  await mkdir(destination);
  const originalHash = await fileHash(source);
  const options={timeout:60*60*1000,maxBuffer:1024*1024,windowsHide:true};
  await run('docker',[...baseArgs,'tags-filter','/input/source.osm.pbf',...FILTERS,'-o','/output/pois.osm.pbf'],options);
  const exported=await run('docker',[...baseArgs,'export','/output/pois.osm.pbf','-c','/etc/nearby-export.json',
    '-u','type_id','-f','geojsonseq',...(quarantineGeometry?['--show-errors','--verbose']:['--stop-on-error']),'-o','/output/pois.geojsonseq'],options);
  // A source changing during preparation must not receive a trusted manifest.
  if (await fileHash(source) !== originalHash) throw new Error('PBF changed during export');
  // Keep the PBF beside the manifest without asking stage to traverse outside its artifact directory.
  await copyFile(source,resolve(destination,candidate.extractFile),constants.COPYFILE_EXCL);
  if (await fileHash(resolve(destination,candidate.extractFile)) !== originalHash) throw new Error('PBF copy checksum mismatch');
  const exportFile=resolve(destination,candidate.exportFile);
  if (!(await stat(exportFile)).size || (await stat(exportFile)).size > 1024*1024*1024) throw new Error('Export outside staging size budget');
  const manifest={...candidate,extractSha256:originalHash,exportSha256:await fileHash(exportFile)};
  if(quarantineGeometry){
    const report=geometryReport(exported.stderr,originalHash);
    await writeFile(resolve(destination,'geometry-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    manifest.qualityFile='geometry-report.json';manifest.qualitySha256=await fileHash(resolve(destination,manifest.qualityFile));
  }
  await writeFile(resolve(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {directory:destination,manifest:'manifest.json',status:'PREPARED'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [input,output,sourceUrl,sourceAsOf,version,flag]=process.argv.slice(2);
    if (!version || (process.argv.length !== 7&&process.argv.length !== 8)||flag&&flag!=='--quarantine-geometry') throw new Error('Expected INPUT OUTPUT SOURCE_URL SOURCE_AS_OF VERSION [--quarantine-geometry]');
    console.log(JSON.stringify(await prepareExtract({input,output,sourceUrl,sourceAsOf,version,quarantineGeometry:flag==='--quarantine-geometry'})));
  } catch {
    console.error('Extract preparation failed. Check Docker image, PBF, source metadata and fresh output directory. No successful manifest created; failed artifacts are retained for inspection.');
    process.exitCode=1;
  }
}
