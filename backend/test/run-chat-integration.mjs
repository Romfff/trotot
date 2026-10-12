import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const result=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','test/chat.integration.spec.ts'],{
  env:{...process.env,CHAT_INTEGRATION:'1'},stdio:'inherit',windowsHide:true,
});
process.exit(result.status??1);
