import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'test/auth.integration.spec.ts'], {
  stdio: 'inherit',
  env: { ...process.env, AUTH_INTEGRATION: '1' },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
