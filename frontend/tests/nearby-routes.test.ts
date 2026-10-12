import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET as publicGet} from '../src/app/api/listings/[...path]/route';
import {GET as adminGet,PATCH} from '../src/app/api/management/[...path]/route';
const id='00000000-0000-4000-8000-000000000001';const poi='00000000-0000-4000-8000-000000000002';
const origin='http://localhost:3000';const fetcher=vi.fn();
const context=(path:string[])=>({params:Promise.resolve({path})});
beforeEach(()=>{fetcher.mockReset();vi.stubGlobal('fetch',fetcher);vi.stubEnv('FRONTEND_ORIGIN',origin);vi.stubEnv('BACKEND_API_URL','http://backend.test/api/v1');vi.stubEnv('BFF_PROXY_SECRET','nearby-test-secret-0123456789abcdef');vi.stubEnv('TRUSTED_CLIENT_IP_HEADER','');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('public nearby uses fixed path, passes pagination/version, never forwards identity, keeps meta outside data',async()=>{
 const envelope={success:true,data:{status:'READY'},meta:{page:2,limit:5,total:8,totalPages:2}};
 fetcher.mockResolvedValue(new Response(JSON.stringify(envelope)));
 const result=await publicGet(new NextRequest(`${origin}/api/listings/properties/fixture/nearby?group=MARKETS&page=2&snapshotVersion=version`,{headers:{authorization:'Bearer not-public',cookie:'not-public'}}),context(['properties','fixture','nearby']));
 expect(await result.json()).toEqual(envelope);expect(result.headers.get('cache-control')).toBe('no-store');
 const [url,init]=fetcher.mock.calls[0];expect(url).toBe('http://backend.test/api/v1/properties/fixture/nearby?group=MARKETS&page=2&snapshotVersion=version');
 expect(new Headers(init.headers).has('authorization')).toBe(false);expect(new Headers(init.headers).has('cookie')).toBe(false);
});
it('Admin read requires bearer, visibility requires same origin and exact approved body; no arbitrary writes',async()=>{
 const path=['admin','properties',id,'nearby'];
 expect((await adminGet(new NextRequest(origin),context(path))).status).toBe(401);
 fetcher.mockImplementation(async()=>new Response(JSON.stringify({success:true,data:[]})));
 expect((await adminGet(new NextRequest(origin,{headers:{authorization:'Bearer fixture'}}),context(path))).status).toBe(200);
 const write=(data:unknown,from=origin)=>new NextRequest(origin,{method:'PATCH',headers:{origin:from,authorization:'Bearer fixture','content-type':'application/json','Idempotency-Key':'test-nearby-001'},body:JSON.stringify(data)});
 const body={hidden:true,reason:'Wrong location',expectedVersion:0};const action=[...path,poi,'visibility'];
 expect((await PATCH(write(body),context(action))).status).toBe(200);
 expect(fetcher.mock.calls[1][1].method).toBe('PATCH');expect(new Headers(fetcher.mock.calls[1][1].headers).get('Idempotency-Key')).toBe('test-nearby-001');
 for(const bad of [{...body,actorId:id},{...body,expectedVersion:-1},{...body,hidden:'true'},{...body,reason:''}])expect((await PATCH(write(bad),context(action))).status).toBe(400);
 expect((await PATCH(write(body,'https://evil.test'),context(action))).status).toBe(403);
 expect((await PATCH(write(body),context([...path,poi,'delete']))).status).toBe(404);expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([403,404,409,429,503])('preserves Admin error %s and Retry-After without client-side success',async status=>{
 fetcher.mockResolvedValue(new Response(JSON.stringify({success:false,errorCode:'TEST_ONLY',message:'Fixture error'}),{status,headers:{'Retry-After':'60'}}));
 const result=await adminGet(new NextRequest(origin,{headers:{authorization:'Bearer fixture'}}),context(['admin','properties',id,'nearby']));
 expect(result.status).toBe(status);expect((await result.json()).success).toBe(false);if(status===429)expect(result.headers.get('retry-after')).toBe('60');
});
