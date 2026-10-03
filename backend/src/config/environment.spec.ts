import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateEnvironment } from './environment.js';

describe('validateEnvironment', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('requires a Redis password to match the authenticated Compose service', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://local:local@127.0.0.1:5432/trotot');
    vi.stubEnv('REDIS_PASSWORD', '');
    vi.stubEnv('JWT_ACCESS_SECRET', 'a'.repeat(32));
    vi.stubEnv('JWT_REFRESH_SECRET', 'b'.repeat(32));
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('OTP_PROVIDER', 'mock');

    expect(() => validateEnvironment())
      .toThrow('Missing required environment variable: REDIS_PASSWORD');
  });
});
