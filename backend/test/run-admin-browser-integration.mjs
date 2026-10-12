import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','test/listings.integration.spec.ts'],{stdio:'inherit',env:{...process.env,LISTINGS_INTEGRATION:'1',LISTINGS_BROWSER:'1',...(process.argv[2]?{FRONTEND_TEST_DIR:process.argv[2]}:{}),...(process.argv[3]?{PLAYWRIGHT_PACKAGE_PATH:process.argv[3]}:{})}});
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
