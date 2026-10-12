import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET,POST,PUT,DELETE} from '../src/app/api/management/[...path]/route';
const id='00000000-0000-4000-8000-000000000001',origin='http://localhost:3000';
const ctx=(path:string[])=>({params:Promise.resolve({path})});
const request=(method='GET',body:unknown={},headers:Record<string,string>={})=>new NextRequest(origin+'/api/management/admin/users?from=2026-01-01&to=2026-01-31',{
  method,headers:{authorization:'Bearer synthetic-token',...(method==='GET'?{}:{origin,'content-type':'application/json'}),...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})});
beforeEach(()=>{vi.stubEnv('FRONTEND_ORIGIN',origin);vi.stubEnv('BACKEND_API_URL','https://backend.test/api/v1');vi.stubEnv('BFF_PROXY_SECRET','admin-test-bff-secret-at-least-32-characters');vi.stubEnv('TRUSTED_CLIENT_IP_HEADER','');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('S5 Admin BFF allowlist, mock upstream',()=>{
  it.each(['users','dashboard'])('GET %s forwards query and bearer, no cookie/private cache',async part=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:[]})));vi.stubGlobal('fetch',fetch);
    const response=await GET(request('GET',{}, {cookie:'private-cookie'}),ctx(['admin',part]));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(fetch.mock.calls[0][0]).toBe(`https://backend.test/api/v1/admin/${part}?from=2026-01-01&to=2026-01-31`);
    expect(new Headers(fetch.mock.calls[0][1].headers).get('cookie')).toBeNull();
  });
  it.each(['ban','unban'])('POST %s accepts only explicit expectedStatus/reason',async action=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:true,data:{id}})));vi.stubGlobal('fetch',fetch);
    const body={expectedStatus:action==='ban'?'ACTIVE':'BANNED',reason:'Synthetic reason'};
    expect((await POST(request('POST',body),ctx(['admin','users',id,action]))).status).toBe(200);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
  });
  it.each([{reason:' '},{reason:'x'.repeat(501)},{reason:3},{expectedStatus:'PENDING'},{expectedStatus:1},{role:'ADMIN'},{actorId:id},{sessionVersion:1}])('rejects forged body %j',async bad=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect((await POST(request('POST',{expectedStatus:'ACTIVE',reason:'Fixture',...bad}),ctx(['admin','users',id,'ban']))).status).toBe(400);expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks missing authentication, other Origin, UUID traversal and unapproved methods',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect((await GET(request('GET',{}, {authorization:''}),ctx(['admin','dashboard']))).status).toBe(401);
    expect((await POST(request('POST',{expectedStatus:'ACTIVE',reason:'Fixture'},{origin:'https://evil.test'}),ctx(['admin','users',id,'ban']))).status).toBe(403);
    for(const path of [['admin','users',id],['admin','users','..','ban'],['admin','users',id,'delete']])expect((await POST(request('POST'),ctx(path))).status).toBe(404);
    for(const method of [PUT,DELETE])expect((await method(request('POST'),ctx(['admin','users',id,'ban']))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([403,404,409,429,503])('preserves server status %s and never retries moderation automatically',async status=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({success:false,errorCode:'FIXTURE',message:'Fixture'}),{status,headers:{'Retry-After':'60'}}));vi.stubGlobal('fetch',fetch);
    const result=await POST(request('POST',{expectedStatus:'ACTIVE',reason:'Fixture'}),ctx(['admin','users',id,'ban']));
    expect(result.status).toBe(status);expect(fetch).toHaveBeenCalledOnce();if(status===429)expect(result.headers.get('retry-after')).toBe('60');
  });
});
