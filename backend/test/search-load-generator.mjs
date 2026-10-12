// Test-only generator in its own process, separate from Vitest and the API.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';

let database,api;
try{database=new URL(process.env.DATABASE_URL);api=new URL(process.env.LOAD_API_BASE);}catch{throw Error('Isolated load configuration required');}
assert.ok(process.env.NODE_ENV==='test'&&['localhost','127.0.0.1'].includes(database.hostname)&&database.port==='58491'
  &&/^\/trotot_listing_test_[a-f0-9]{32}$/.test(database.pathname),'Only the owned test DB is allowed');
assert.ok(api.hostname==='127.0.0.1'&&api.protocol==='http:'&&!['','3000','5000'].includes(api.port)&&api.pathname==='/', 'Only the owned API loopback port is allowed');
const secret=process.env.BFF_PROXY_SECRET;
assert.ok(secret==='load-fixture-only-bff-secret-at-least-32chars','Only the synthetic edge secret is allowed');
const scenario=process.env.LISTINGS_LOAD_SCENARIO||'warm',seconds=Number(process.env.LISTINGS_LOAD_SECONDS||10);
assert.ok(['warm','mixed'].includes(scenario)&&[10,60].includes(seconds),'Supported load scenarios: warm/mixed, 10/60 seconds');
const path='/api/v1/properties/long-term/search';
const queries=['?minPrice=3000000&maxPrice=4000000','?sortBy=price_asc','?sortBy=price_desc&limit=10&page=2',
  '?province=79&minArea=20&maxArea=30','?lat=10.7725&lng=106.6578&radius=3000&sortBy=distance_asc',
  '?amenities=wifi','?minPrice=4000000','?page=2','?maxArea=24','?radius=1000&lat=10.77&lng=106.65','?province=01','?limit=50'];
const durations=[],coldDurations=[],statuses={};let lag=0,transportErrors=0;
const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);const p=q=>sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]??0;
  return {count:sorted.length,p50:p(.5),p95:p(.95),p99:p(.99)};};
assert.deepEqual(summarize([3,1,2]),{count:3,p50:2,p95:3,p99:3});
function headers(i){const ip=`192.0.2.${i%250+1}`,timestamp=String(Date.now());
  return {'x-trotot-client-ip':ip,'x-trotot-proxy-timestamp':timestamp,
    'x-trotot-proxy-signature':createHmac('sha256',secret).update(`${timestamp}\nGET\n${path}\n${ip}`).digest('hex')};}
const selected=scenario==='warm'?[queries[0]]:queries;
const warm=await Promise.all(Array.from({length:100},async(_,i)=>{
  const r=await fetch(new URL(path+selected[i%selected.length],api),{headers:headers(i),signal:AbortSignal.timeout(10000)});
  const body=await r.json();return r.status===200&&body.success===true&&Array.isArray(body.data)&&Number.isSafeInteger(body.meta?.total);
}));
assert.ok(warm.every(Boolean),'Warm-up must return the real public envelope');
const delay=monitorEventLoopDelay({resolution:10});delay.enable();
try{
  const count=seconds*500,started=performance.now(),requests=[];
  for(let i=0;i<count;i++){
    const target=started+i*2,wait=target-performance.now();if(wait>0)await new Promise(done=>setTimeout(done,wait));
    lag=Math.max(lag,performance.now()-target);
    // 5% unique price filters are deliberately cold; never report these as cache hits.
    const cold=scenario==='mixed'&&i%20===0;
    const query=cold?`?minPrice=${3100000+i}&maxPrice=4000000`:selected[i%selected.length];
    requests.push((async()=>{const start=performance.now();try{
      const r=await fetch(new URL(path+query,api),{headers:headers(i),signal:AbortSignal.timeout(10000)});await r.arrayBuffer();
      const ms=performance.now()-start;durations.push(ms);if(cold)coldDurations.push(ms);statuses[r.status]=(statuses[r.status]||0)+1;
    }catch{transportErrors++;}})());
  }
  await Promise.all(requests);const elapsed=performance.now()-started;
  console.log('S5_LOAD_RESULT '+JSON.stringify({scope:'separate compiled API/generator;isolated PostGIS/Redis;1000 synthetic PAID listings;250 signed test IPs;guards unchanged;not VPS acceptance',
    scenario,seconds,poolMax:Number(process.env.DATABASE_POOL_MAX||10),warmupRequests:100,queryCount:selected.length,count,
    elapsedMs:elapsed,completedRps:durations.length*1000/elapsed,maxSchedulingLagMs:lag,statuses,transportErrors,
    ...summarize(durations),cold:summarize(coldDurations),generatorEventLoop:{p95:delay.percentile(95)/1e6,max:delay.max/1e6}}));
}finally{delay.disable();}
