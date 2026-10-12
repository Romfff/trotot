import { type ExecutionContext, HttpException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { RedisService } from '../redis/redis.service.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard, sprint2RateLimits } from './sprint2-rate-limit.guard.js';

function context(request: Partial<Request>) {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}
function counter() {
  const incrementWithTtl = vi.fn().mockResolvedValue(1);
  return { incrementWithTtl, redis: { incrementWithTtl } as unknown as RedisService };
}

describe('Sprint 2 request limits', () => {
  it('does not let unsigned forwarding headers change the transport IP bucket', async () => {
    const { redis, incrementWithTtl } = counter(); const guard = new Sprint2IpRateLimitGuard(redis);
    for (const ip of ['203.0.113.10','203.0.113.11']) await guard.canActivate(context({
      ip: '127.0.0.1', headers: { 'x-forwarded-for': ip, 'x-trotot-client-ip': ip }, get: () => undefined,
    }));
    expect(incrementWithTtl.mock.calls[0]).toEqual(incrementWithTtl.mock.calls[1]);
    expect(incrementWithTtl.mock.calls[0][0]).not.toContain('127.0.0.1');
  });
  it('keeps signed local proxy requests in a bucket and rejects a tampered proxy before Redis', async () => {
    const { redis, incrementWithTtl } = counter(); const guard = new Sprint2IpRateLimitGuard(redis);
    const secret = 'test-sprint2-proxy-secret-32-characters';
    const timestamp = String(Date.now()); const path = '/api/v1/properties/long-term/search';
    vi.stubEnv('BFF_PROXY_SECRET', secret);
    try {
      const headers: Record<string,string> = { 'x-trotot-proxy-timestamp': timestamp, 'x-trotot-client-ip': '',
        'x-trotot-proxy-signature': createHmac('sha256',secret).update(`${timestamp}\nGET\n${path}\n`).digest('hex') };
      await guard.canActivate(context({ method: 'GET', path, ip:'127.0.0.1', get: name => headers[name] }));
      expect(incrementWithTtl).toHaveBeenCalledOnce();
      headers['x-trotot-client-ip'] = '203.0.113.10';
      await expect(guard.canActivate(context({ method: 'GET', path, get: name => headers[name] }))).rejects.toMatchObject({ status:403 });
      expect(incrementWithTtl).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); }
  });
  it('shares write quota across routes and uses authenticated user identity, with a separate read bucket', async () => {
    const { redis, incrementWithTtl } = counter(); const guard = new Sprint2UserRateLimitGuard(redis);
    const user = { id:'fixture-host', role:'HOST' as const };
    for (const method of ['POST','PUT','DELETE']) await guard.canActivate(context({ method, user }));
    expect(incrementWithTtl.mock.calls[0]).toEqual(incrementWithTtl.mock.calls[1]);
    expect(incrementWithTtl.mock.calls[0]).toEqual(incrementWithTtl.mock.calls[2]);
    await guard.canActivate(context({ method:'GET', user }));
    expect(incrementWithTtl.mock.calls[3][0]).not.toBe(incrementWithTtl.mock.calls[0][0]);
    await guard.canActivate(context({ method:'HEAD', user }));
    expect(incrementWithTtl.mock.calls[4]).toEqual(incrementWithTtl.mock.calls[3]);
    await expect(guard.canActivate(context({ method:'POST', body:{ userId:user.id } }))).rejects.toMatchObject({ status:401 });
    expect(incrementWithTtl).toHaveBeenCalledTimes(5);
  });
  it('allows the boundary request and returns 429 on the next one', async () => {
    const { redis, incrementWithTtl } = counter(); const guard = new Sprint2UserRateLimitGuard(redis);
    incrementWithTtl.mockResolvedValueOnce(sprint2RateLimits.write).mockResolvedValueOnce(sprint2RateLimits.write + 1);
    const request = context({ method:'POST', user:{ id:'fixture-host',role:'HOST' } });
    expect(await guard.canActivate(request)).toBe(true);
    try { await guard.canActivate(request); throw new Error('Expected rate limit'); }
    catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getResponse()).toMatchObject({ errorCode:'RATE_LIMITED' });
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });
  it('stops the operation with 503 if Redis cannot enforce its limit', async () => {
    const { redis, incrementWithTtl } = counter(); incrementWithTtl.mockRejectedValue(new Error('Redis offline'));
    await expect(new Sprint2IpRateLimitGuard(redis).canActivate(context({ ip:'127.0.0.1',get:()=>undefined }))).rejects.toMatchObject({ status:503 });
  });
});
