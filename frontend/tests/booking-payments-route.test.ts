import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { GET,POST,PUT,DELETE } from '@/app/api/management/[...path]/route';
const origin='http://localhost:3000',id='550e8400-e29b-41d4-a716-446655440000';
const context=(path:string[])=>({params:Promise.resolve({path})});
const request=(method='GET',headers:Record<string,string>={},body:unknown={expectedVersion:1})=>new NextRequest(`${origin}/api/management/bookings/${id}/payment-status`,{method,headers:{authorization:'Bearer fixture',origin,'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{vi.stubEnv('BACKEND_API_URL','http://backend.test/api/v1');vi.stubEnv('BFF_PROXY_SECRET','payment-bff-fixture-secret-0123456789');vi.stubEnv('FRONTEND_ORIGIN',origin);vi.stubEnv('TRUSTED_CLIENT_IP_HEADER','');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('S4 fixed private payment BFF routes',()=>{
  it.each(['payment-status','payment-session'])('forwards only owner GET %s with bearer/no-store/signature and no refresh cookie',async action=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{providerConnected:false,payment:null}})));vi.stubGlobal('fetch',fetchMock);
    const result=await GET(request('GET',{cookie:'refresh=private','x-forwarded-for':'203.0.113.8'}),context(['bookings',id,action]));
    expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('no-store');expect(result.headers.get('set-cookie')).toBeNull();
    const [url,init]=fetchMock.mock.calls[0] as [string,RequestInit],headers=new Headers(init.headers);
    expect(url).toBe(`http://backend.test/api/v1/bookings/${id}/${action}`);expect(headers.get('authorization')).toBe('Bearer fixture');expect(headers.get('cookie')).toBeNull();expect(headers.get('x-trotot-client-ip')).toBe('');
    expect(headers.get('x-trotot-proxy-signature')).toBe(createHmac('sha256',process.env.BFF_PROXY_SECRET!).update(`${headers.get('x-trotot-proxy-timestamp')}\nGET\n/api/v1/bookings/${id}/${action}\n`).digest('hex'));expect(init.cache).toBe('no-store');expect(init.redirect).toBe('error');
  });
  it('POST forwards exact version and key, and preserves unavailable provider failure without retry',async()=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,errorCode:'PAYMENT_NOT_CONFIGURED',message:'Unavailable'}),{status:503}));vi.stubGlobal('fetch',fetchMock);
    const result=await POST(request('POST',{'idempotency-key':'unchanged-key'}),context(['bookings',id,'payment-session']));
    expect(result.status).toBe(503);expect((await result.json()).errorCode).toBe('PAYMENT_NOT_CONFIGURED');expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers=new Headers(fetchMock.mock.calls[0][1].headers);expect(headers.get('idempotency-key')).toBe('unchanged-key');expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({expectedVersion:1}));
  });
  it.each([{expectedVersion:1,amount:1},{expectedVersion:1,paymentStatus:'PAID'},{expectedVersion:1,userId:id},{expectedVersion:'1'},{expectedVersion:0},{},[],null])('rejects forged or invalid session body %j',async body=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);expect((await POST(request('POST',{},body),context(['bookings',id,'payment-session']))).status).toBe(400);expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires bearer/Origin/JSON for session creation',async()=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);const path=['bookings',id,'payment-session'];
    expect((await GET(request('GET',{authorization:''}),context(path))).status).toBe(401);
    expect((await POST(request('POST',{origin:'https://evil.test'}),context(path))).status).toBe(403);
    expect((await POST(request('POST',{'content-type':'text/plain'}),context(path))).status).toBe(415);expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([['host','bookings',id,'payment-status'],['admin','bookings',id,'payment-session'],['bookings','invalid','payment-status'],['bookings',id,'payment-status','extra'],['payments','webhook-ipn'],['bookings',id,'simulate-paid']])('does not expand allowlist %j',async(...path)=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);expect((await GET(request(),context(path))).status).toBe(404);expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([POST,PUT,DELETE])('never allows payment-status writes',async handler=>{
    const fetchMock=vi.fn();vi.stubGlobal('fetch',fetchMock);expect((await handler(request('POST'),context(['bookings',id,'payment-status']))).status).toBe(404);expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([401,403,404,409,429,503])('preserves upstream error %i instead of fabricating success',async status=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,errorCode:'FIXTURE',message:'Fixture'}),{status,headers:{'Retry-After':'10'}}));vi.stubGlobal('fetch',fetchMock);
    const result=await GET(request(),context(['bookings',id,'payment-status']));expect(result.status).toBe(status);if(status===429) expect(result.headers.get('retry-after')).toBe('10');expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
