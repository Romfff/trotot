import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { BadRequestException,ConflictException,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import type { Request,Response } from 'express';
import { VnpayIpnController } from './vnpay-ipn.controller.js';
import { vnpaySandboxConfig } from './vnpay-config.js';
import { consumeVnpayIpn } from './vnpay-ipn.js';
import type { PrismaService } from '../database/prisma.service.js';
import type { RedisService } from '../redis/redis.service.js';
import type { PaymentRealtimeService } from './payment-realtime.service.js';

vi.mock('./vnpay-ipn.js',()=>({consumeVnpayIpn:vi.fn()}));
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('NODE_ENV','test');vi.stubEnv('VNPAY_SANDBOX_ENABLED','true');
  vi.stubEnv('VNPAY_TMN_CODE','FIXTURE1');vi.stubEnv('VNPAY_HASH_SECRET','fixture-only-vnpay-secret-not-a-credential-12345');
  vi.stubEnv('VNPAY_RETURN_URL','https://trotot.example/payment/return');vi.stubEnv('VNPAY_IPN_IP_LIMIT_PER_MINUTE','240');
});
afterEach(()=>vi.unstubAllEnvs());
function fixture(raw='raw=unchanged&duplicate=1&duplicate=2') {
  const redis={incrementWithTtl:vi.fn().mockResolvedValue(1)},prisma={} as PrismaService;
  const res={setHeader:vi.fn(),status:vi.fn(),json:vi.fn()} as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);vi.mocked(res.json).mockReturnValue(res);
  const req={originalUrl:`/api/v1/payments/vnpay/ipn?${raw}`,socket:{remoteAddress:'127.0.0.1'}} as Request;
  const realtime={publishCommitted:vi.fn().mockResolvedValue(undefined)};
  return {redis,prisma,res,req,realtime,controller:new VnpayIpnController(prisma,redis as unknown as RedisService,realtime as unknown as PaymentRealtimeService)};
}
describe('S4 VNPay HTTP boundary, no real gateway',()=>{
  it('publishes only an APPLIED hint after consumer commit, never REVIEW/failure',async()=>{
    const f=fixture();let resolve!:(value:{outcome:string;bookingId:string;eventId:string;reasonCode:string})=>void;
    vi.mocked(consumeVnpayIpn).mockReturnValueOnce(new Promise(done=>{resolve=done;}));
    const pending=f.controller.ipn(f.req,f.res);await vi.waitFor(()=>expect(consumeVnpayIpn).toHaveBeenCalledOnce());
    expect(f.realtime.publishCommitted).not.toHaveBeenCalled();
    resolve({outcome:'APPLIED',bookingId:'fixture-id',eventId:'fixture-event',reasonCode:'MATCHED'});await pending;
    expect(f.realtime.publishCommitted).toHaveBeenCalledExactlyOnceWith('fixture-id');
    vi.mocked(consumeVnpayIpn).mockResolvedValueOnce({outcome:'REVIEW',bookingId:'fixture-id',eventId:'fixture-event',reasonCode:'BOOKING_NOT_PAYABLE'});
    await f.controller.ipn(f.req,f.res);expect(f.realtime.publishCommitted).toHaveBeenCalledOnce();
  });
  it.each(['false','','TRUE'])('stays off for enabled=%j before Redis or DB',async enabled=>{
    vi.stubEnv('VNPAY_SANDBOX_ENABLED',enabled);const f=fixture();await f.controller.ipn(f.req,f.res);
    expect(f.res.status).toHaveBeenCalledWith(503);expect(f.res.json).toHaveBeenCalledWith({RspCode:'99',Message:'Notification unavailable'});
    expect(f.redis.incrementWithTtl).not.toHaveBeenCalled();expect(consumeVnpayIpn).not.toHaveBeenCalled();
  });
  it('rejects production and invalid secret/return URL without exposing configuration',()=>{
    vi.stubEnv('NODE_ENV','production');expect(vnpaySandboxConfig).toThrow('Chưa cấu hình');
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('VNPAY_HASH_SECRET','short');expect(vnpaySandboxConfig).toThrow('Chưa cấu hình');
    vi.stubEnv('VNPAY_HASH_SECRET','fixture-only-vnpay-secret-not-a-credential-12345');vi.stubEnv('VNPAY_RETURN_URL','http://example.test');expect(vnpaySandboxConfig).toThrow('Chưa cấu hình');
  });
  it('passes unchanged raw query and ACKs only after the awaited consumer resolves',async()=>{
    const f=fixture();vi.mocked(consumeVnpayIpn).mockResolvedValueOnce({outcome:'NOT_SUCCESS'});await f.controller.ipn(f.req,f.res);
    expect(consumeVnpayIpn).toHaveBeenCalledWith(f.prisma,vnpaySandboxConfig(),'raw=unchanged&duplicate=1&duplicate=2');
    expect(f.res.setHeader).toHaveBeenCalledWith('Cache-Control','no-store');expect(f.res.json).toHaveBeenCalledWith({RspCode:'00',Message:'Notification received'});
    expect(f.redis.incrementWithTtl).toHaveBeenCalledWith(expect.stringMatching(/^vnpay:ipn:ip:[a-f0-9]{64}$/),60);
  });
  it('does not resolve a successful ACK before commit completes',async()=>{
    const f=fixture();let resolve!: (result:{outcome:'NOT_SUCCESS'})=>void;
    vi.mocked(consumeVnpayIpn).mockReturnValueOnce(new Promise(done=>{resolve=done;}));
    const pending=f.controller.ipn(f.req,f.res);await vi.waitFor(()=>expect(consumeVnpayIpn).toHaveBeenCalledOnce());expect(f.res.json).not.toHaveBeenCalled();
    resolve({outcome:'NOT_SUCCESS'});await pending;expect(f.res.status).toHaveBeenCalledWith(200);
  });
  it.each([
    [new BadRequestException({errorCode:'INVALID_VNPAY_SIGNATURE'}),'97',200],
    [new BadRequestException({errorCode:'INVALID_VNPAY_NOTIFICATION'}),'99',200],
    [new NotFoundException({errorCode:'PAYMENT_SESSION_NOT_FOUND'}),'01',200],
    [new ConflictException({errorCode:'PAYMENT_EVENT_CONFLICT'}),'99',200],
    [new ServiceUnavailableException({errorCode:'PAYMENT_RECORDING_FAILED'}),'99',503],
    [new Error('private driver evidence'),'99',503],
  ] as const)('maps protocol failure without leaking exception %s',async(error,code,status)=>{
    const f=fixture();vi.mocked(consumeVnpayIpn).mockRejectedValueOnce(error);await f.controller.ipn(f.req,f.res);
    expect(f.res.status).toHaveBeenCalledWith(status);expect(f.res.json).toHaveBeenCalledWith(expect.objectContaining({RspCode:code}));
    expect(JSON.stringify(vi.mocked(f.res.json).mock.calls)).not.toMatch(/private|PAYMENT_RECORDING|hashSecret|FIXTURE1/);
  });
  it('limits by socket peer, supplies Retry-After and never enters DB when over limit',async()=>{
    const f=fixture();f.redis.incrementWithTtl.mockResolvedValueOnce(241);await f.controller.ipn(f.req,f.res);
    expect(f.res.status).toHaveBeenCalledWith(429);expect(f.res.setHeader).toHaveBeenCalledWith('Retry-After','60');expect(consumeVnpayIpn).not.toHaveBeenCalled();
  });
  it('fails closed when Redis is down',async()=>{
    const f=fixture();f.redis.incrementWithTtl.mockRejectedValueOnce(new Error('redis down'));await f.controller.ipn(f.req,f.res);
    expect(f.res.status).toHaveBeenCalledWith(503);expect(consumeVnpayIpn).not.toHaveBeenCalled();
  });
});
