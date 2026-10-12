export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function positiveIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function databasePoolMax(): number {
  const max = positiveIntegerEnv('DATABASE_POOL_MAX', 10);
  if (max > 50) throw new Error('DATABASE_POOL_MAX must not exceed 50 per API process');
  return max;
}

export function durationSeconds(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) throw new Error('Token TTL must use a value such as 15m or 30d');
  const amount = Number(match[1]);
  const unitSeconds: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = amount * unitSeconds[match[2]];
  if (!Number.isSafeInteger(seconds) || seconds <= 0) throw new Error('Token TTL is invalid');
  return seconds;
}

export function validateEnvironment(): void {
  requiredEnv('DATABASE_URL');
  requiredEnv('REDIS_PASSWORD');
  requiredEnv('JWT_ACCESS_SECRET');
  requiredEnv('JWT_REFRESH_SECRET');
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const secret = requiredEnv(key);
    if (secret.length < 32) throw new Error(`${key} must be at least 32 characters`);
  }
  durationSeconds(process.env.ACCESS_TOKEN_TTL ?? '15m');
  durationSeconds(process.env.REFRESH_TOKEN_TTL ?? '30d');
  if (process.env.BFF_PROXY_SECRET && requiredEnv('BFF_PROXY_SECRET').length < 32) {
    throw new Error('BFF_PROXY_SECRET must be at least 32 characters');
  }
  const otpProvider = process.env.OTP_PROVIDER || 'mock';
  if (otpProvider !== 'mock') {
    throw new Error('Only OTP_PROVIDER=mock is implemented in this Sprint 1 backend');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Mock OTP is development-only; configure a real OTP provider before production');
  }
}
