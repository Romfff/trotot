import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','test/listings.integration.spec.ts','--pool=threads','--maxWorkers=1','--silent=false'],{
  stdio:'inherit',env:{...process.env,LISTINGS_INTEGRATION:'1',HOMESTAY_BROWSER:'1'},windowsHide:true});
if(result.error) console.error(result.error.message);
process.exitCode=result.status??1;
