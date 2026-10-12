import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ListingContactRateLimitGuard, OptionalContactTokenGuard } from './listing-contact.guard.js';
import type { RedisService } from '../redis/redis.service.js';

const context = (authorization?: string, userId?: string) => ({switchToHttp:()=>({getRequest:()=>({headers:authorization === undefined ? {} : {authorization},get:()=>undefined,ip:'203.0.113.8',user:userId?{id:userId}:undefined})})}) as ExecutionContext;
beforeEach(()=>{vi.stubEnv('JWT_ACCESS_SECRET','test-only-independent-contact-counter-secret');vi.stubEnv('LISTING_CONTACT_IP_LIMIT_PER_MINUTE','');vi.stubEnv('LISTING_CONTACT_USER_LIMIT_PER_MINUTE','');});
afterEach(()=>vi.unstubAllEnvs());
describe('contact temporary limits',()=>{
  it('uses approved defaults and anonymized expiring keys',async()=>{
    const incrementWithTtl=vi.fn().mockResolvedValue(1);
    const guard=new ListingContactRateLimitGuard({incrementWithTtl} as unknown as RedisService);
    expect(await guard.canActivate(context(undefined,'fixture-user'))).toBe(true);
    expect(incrementWithTtl).toHaveBeenCalledTimes(2);
    for(const [key,ttl] of incrementWithTtl.mock.calls){expect(key).toMatch(/^sprint2:limit:contact:(ip|user):[a-f0-9]{64}$/);expect(key).not.toMatch(/fixture-user|203\.0\.113\.8/);expect(ttl).toBe(60);}
    incrementWithTtl.mockResolvedValue(11);await expect(guard.canActivate(context())).rejects.toMatchObject({status:429,response:{errorCode:'RATE_LIMITED',retryAfter:60}});
  });
  it('uses configured IP and user ceilings, failing closed on Redis failure',async()=>{
    vi.stubEnv('LISTING_CONTACT_IP_LIMIT_PER_MINUTE','3');vi.stubEnv('LISTING_CONTACT_USER_LIMIT_PER_MINUTE','2');
    const incrementWithTtl=vi.fn().mockImplementation((key:string)=>Promise.resolve(key.includes(':user:')?3:1));
    const guard=new ListingContactRateLimitGuard({incrementWithTtl} as unknown as RedisService);
    await expect(guard.canActivate(context(undefined,'fixture-user'))).rejects.toMatchObject({status:429});
    incrementWithTtl.mockRejectedValue(new Error('synthetic failure'));
    await expect(guard.canActivate(context())).rejects.toMatchObject({status:503,response:{errorCode:'RATE_LIMIT_UNAVAILABLE'}});
  });
  it('rejects invalid configuration instead of disabling limits',()=>{
    vi.stubEnv('LISTING_CONTACT_IP_LIMIT_PER_MINUTE','0');
    expect(()=>new ListingContactRateLimitGuard({} as RedisService)).toThrow('must be a positive integer');
  });
  it('only bypasses authentication when the header is absent',async()=>{
    const guard=new OptionalContactTokenGuard({} as never);
    expect(await guard.canActivate(context())).toBe(true);
    await expect(guard.canActivate(context(''))).rejects.toMatchObject({status:401});
    await expect(guard.canActivate(context('Basic invalid'))).rejects.toMatchObject({status:401});
  });
});
