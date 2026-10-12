// Audit-only dependency is supplied from a separate tool directory; application lockfiles stay unchanged.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const [toolRoot, origin, slug, port, evidence] = process.argv.slice(2);
const target = new URL(origin);assert.ok(['localhost','127.0.0.1'].includes(target.hostname));assert.equal(target.protocol,'http:');
assert.ok(Number.isInteger(Number(port)) && Number(port)>0);
const {default:lighthouse}=await import(pathToFileURL(resolve(toolRoot,'core/index.js')).href);
const {default:desktop}=await import(pathToFileURL(resolve(toolRoot,'core/config/desktop-config.js')).href);
const reportDir=resolve(evidence);await mkdir(reportDir,{recursive:true});
const reports=[];
for(const device of ['mobile','desktop'])for(const [name,path] of [['search','/thue-phong-tro'],['detail',`/thue-phong-tro/${encodeURIComponent(slug)}`]]){
  // Do not benchmark public tile/media providers. Blocked requests remain in the audits.
  const result=await lighthouse(origin+path,{port:Number(port),hostname:'127.0.0.1',logLevel:'error',output:['json','html'],
    onlyCategories:['performance','seo','best-practices','accessibility'],blockedUrlPatterns:['https://tile.openstreetmap.org/*','https://images.unsplash.com/*']},device==='desktop'?desktop:undefined);
  assert.ok(result,'Lighthouse returned no result');
  const lhr=result.lhr;await writeFile(resolve(reportDir,`${name}-${device}.json`),JSON.stringify(lhr,null,2));
  const html=Array.isArray(result.report)?result.report[1]:result.report;await writeFile(resolve(reportDir,`${name}-${device}.html`),html);
  reports.push({name,device,url:lhr.finalDisplayedUrl,version:lhr.lighthouseVersion,fetchTime:lhr.fetchTime,settings:lhr.configSettings,
    scores:Object.fromEntries(Object.entries(lhr.categories).map(([key,value])=>[key,value.score*100])),
    metrics:Object.fromEntries(['first-contentful-paint','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','speed-index'].map(id=>[id,lhr.audits[id]?.numericValue])),
    failures:Object.values(lhr.audits).filter(a=>a.score!==null&&a.score<1).map(a=>({id:a.id,title:a.title,score:a.score})),
    runtimeError:lhr.runtimeError||null,runWarnings:lhr.runWarnings,environment:lhr.environment,
  });
  console.log(JSON.stringify({name,device,scores:reports.at(-1).scores,metrics:reports.at(-1).metrics,runtimeError:lhr.runtimeError||null}));
}
await writeFile(resolve(reportDir,'summary.json'),JSON.stringify({scope:'real local API/DB;20synthetic public rooms;no images;headlessEdge;simulateddevices;external tiles/media blocked;not production/provider/physicaldevice acceptance',generatedAt:new Date().toISOString(),reports},null,2));
assert.ok(reports.every(report=>report.runtimeError===null),'Lighthouse navigation/runtime error; inspect saved reports');
