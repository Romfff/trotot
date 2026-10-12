import { afterEach, expect, it, vi } from 'vitest';
import { databasePoolMax } from '../src/config/environment.js';

afterEach(() => vi.unstubAllEnvs());
it('keeps the existing ten-connection default', () => {
  vi.stubEnv('DATABASE_POOL_MAX', undefined);
  expect(databasePoolMax()).toBe(10);
});
it.each(['1', '20', '50'])('accepts bounded pool size %s', value => {
  vi.stubEnv('DATABASE_POOL_MAX', value);
  expect(databasePoolMax()).toBe(Number(value));
});
it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '51', '9007199254740992'])('rejects unsafe pool size %s', value => {
  vi.stubEnv('DATABASE_POOL_MAX', value);
  expect(() => databasePoolMax()).toThrow(/DATABASE_POOL_MAX/);
});
