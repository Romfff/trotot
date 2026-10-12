import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
  'src/bookings/bookings.service.spec.ts', '--pool=threads', '--maxWorkers=1',
  '--coverage', '--coverage.provider=istanbul', '--coverage.include=src/bookings/bookings.service.ts',
  '--coverage.include=src/homestays/homestay-availability.service.ts', '--coverage.reportsDirectory=coverage-unit',
  '--coverage.reporter=text', '--coverage.reporter=json-summary', '--coverage.thresholds.lines=90',
  '--coverage.thresholds.statements=90', '--coverage.thresholds.branches=90', '--coverage.thresholds.functions=90'],
  { stdio: 'inherit', env: process.env, windowsHide: true });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
