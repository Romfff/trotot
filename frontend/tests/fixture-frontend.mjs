// Browser fixture harness: only loopback, test-only JSON; never DB/provider acceptance.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';

export async function fixtureFrontend(target,searchResponse,detailResponse,nearbyResponse) {
  if(target?.startsWith('http://')||target?.startsWith('https://'))return {baseUrl:target,close:async()=>{},serverFixture:false};
  const dir=resolve(target||'.');let child;
  const upstream=createServer((req,res)=>{
    const url=new URL(req.url,'http://fixture.invalid');
    if(req.method==='GET'&&nearbyResponse&&/^\/api\/v1\/properties\/[^/]+\/nearby$/.test(url.pathname)){
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({success:true,message:'Isolated nearby fixture',data:nearbyResponse(url)}));return;
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/properties/long-term/search'){
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(searchResponse(url.searchParams)));return;
    }
    if(req.method==='GET'&&url.pathname==='/api/v1/amenities'){
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({success:true,message:'Catalog fixture',data:[]}));return;
    }
    if(req.method==='GET'&&detailResponse&&/^\/api\/v1\/properties\/[^/]+$/.test(url.pathname)){
      const listing=detailResponse(decodeURIComponent(url.pathname.split('/').at(-1)));
      res.writeHead(listing?200:404,{'content-type':'application/json','cache-control':'no-store'});
      res.end(JSON.stringify(listing?{success:true,message:'Detail fixture',data:listing}:{success:false,errorCode:'PROPERTY_NOT_FOUND',message:'Fixture not found'}));return;
    }
    res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({success:false,errorCode:'SESSION_CLOSED',message:'Anonymous browser fixture'}));
  });
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(done=>reservation.close(done));
  const baseUrl=`http://localhost:${port}`;
  const close=async()=>{if(child&&child.exitCode===null){const closed=once(child,'close');child.kill();await closed;}await new Promise(done=>upstream.close(done));};
  try{
    child=spawn(process.execPath,[resolve(dir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:dir,env:{...process.env,NODE_ENV:'production',NEARBY_ENABLED:nearbyResponse?'true':'false',BACKEND_API_URL:`http://127.0.0.1:${upstream.address().port}/api/v1`,FRONTEND_ORIGIN:baseUrl,TRUSTED_CLIENT_IP_HEADER:'',BFF_PROXY_SECRET:randomBytes(32).toString('hex')},stdio:process.env.FIXTURE_DIAGNOSTICS==='1'?['ignore','ignore','pipe']:'ignore',windowsHide:true,
    });
    if(child.stderr)child.stderr.on('data',bytes=>process.stderr.write(bytes));
    for(let attempt=0;attempt<100;attempt++){
      if(child.exitCode!==null)throw new Error('Owned fixture frontend exited before readiness; build selected directory first');
      if(await fetch(baseUrl+'/login').then(r=>r.ok,()=>false))return {baseUrl,close,serverFixture:true};
      await new Promise(done=>setTimeout(done,100));
    }
    throw new Error('Owned fixture frontend readiness timed out');
  }catch(error){await close();throw error;}
}
