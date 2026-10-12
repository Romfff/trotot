import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveClientIp } from './client-ip.js';

const secret = 'test-bff-proxy-secret-0123456789-abcdef';
function request(ip: string, timestamp = String(Date.now())) {
  const headers: Record<string, string> = {
    'x-trotot-client-ip': ip,
    'x-trotot-proxy-timestamp': timestamp,
    'x-trotot-proxy-signature': createHmac('sha256', secret)
      .update(`${timestamp}\nPOST\n/api/v1/auth/login\n${ip}`).digest('hex'),
  };
  return {
    ip: '127.0.0.1', method: 'POST', path: '/api/v1/auth/login',
    get: (name: string) => headers[name], headers,
  } as unknown as Request;
}
afterEach(() => vi.unstubAllEnvs());
describe('trusted BFF client IP', () => {
  it('uses a signed edge IP or no shared IP bucket when the local BFF has no edge', () => {
    vi.stubEnv('BFF_PROXY_SECRET', secret);
    expect(resolveClientIp(request('203.0.113.1'))).toBe('203.0.113.1');
    expect(resolveClientIp(request(''))).toBeUndefined();
  });
  it('rejects tampered/expired signatures and never trusts plain forwarding headers', () => {
    vi.stubEnv('BFF_PROXY_SECRET', secret);
    const forged = request('203.0.113.1');
    forged.headers['x-trotot-client-ip'] = '203.0.113.2';
    expect(() => resolveClientIp(forged)).toThrow();
    expect(() => resolveClientIp(request('203.0.113.1', String(Date.now() - 60_000)))).toThrow();
    expect(resolveClientIp({ ip: '127.0.0.1', get: () => undefined,
      headers: { 'x-forwarded-for': '203.0.113.1' } } as unknown as Request)).toBe('127.0.0.1');
  });
});
