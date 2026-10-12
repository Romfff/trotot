// Test-only preload: aggregate timings, never request bodies, identities or secrets.
import assert from 'node:assert/strict';
import { Server } from 'node:http';
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import pg from 'pg';

const url=new URL(process.env.DATABASE_URL);
assert.ok(process.env.NODE_ENV==='test' && ['localhost','127.0.0.1'].includes(url.hostname) && url.port==='58491'
  && /^\/trotot_listing_test_[a-f0-9]{32}$/.test(url.pathname),'Profiler accepts only the isolated load database');
const stages=new Map();
function record(stage,ms){
  assert.ok(Number.isFinite(ms)&&ms>=0);
  if(!stages.has(stage))stages.set(stage,[]);
  const values=stages.get(stage);if(values.length<10000)values.push(ms);
}
function summary(values){
  const ordered=[...values].sort((a,b)=>a-b);
  const percentile=p=>ordered[Math.max(0,Math.ceil(ordered.length*p)-1)]??0;
  return {count:values.length,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:ordered.at(-1)??0};
}
assert.deepEqual(summary([3,1,2]),{count:3,p50:2,p95:3,p99:3,max:3});
function measure(prototype,method,stage){
  const original=prototype[method];assert.equal(typeof original,'function');
  prototype[method]=async function(...args){const start=performance.now();try{return await Reflect.apply(original,this,args);}
    finally{record(stage,performance.now()-start);}};
}
// pg's pool uses callback APIs internally. Keep their signatures and return values.
const connect=pg.Pool.prototype.connect;
pg.Pool.prototype.connect=function(callback){
  if(typeof callback!=='function')return Reflect.apply(connect,this,arguments);
  const start=performance.now();
  return Reflect.apply(connect,this,[function(...args){record('poolWait',performance.now()-start);return Reflect.apply(callback,this,args);}]);
};
const clientQuery=pg.Client.prototype.query;
pg.Client.prototype.query=function(...args){
  const callback=args.at(-1);
  if(args[0]?.name==='public-search-generation-v1'&&typeof callback==='function'){
    const start=performance.now();args[args.length-1]=function(...result){record('generationWire',performance.now()-start);return Reflect.apply(callback,this,result);};
  }
  return Reflect.apply(clientQuery,this,args);
};
const [{PrismaService},{ListingsService},{RedisService}]=await Promise.all([
  import('../dist/database/prisma.service.js'),import('../dist/listings/listings.service.js'),import('../dist/redis/redis.service.js'),
]);
measure(PrismaService.prototype,'publicSearchGeneration','generation');
measure(ListingsService.prototype,'search','search');
measure(ListingsService.prototype,'loadSearch','coldSearch');
measure(RedisService.prototype,'incrementWithTtl','redisCounter');
const emit=Server.prototype.emit;
Server.prototype.emit=function(event,...args){
  if(event==='request' && args[0]?.url?.startsWith('/api/v1/properties/long-term/search')){
    const start=performance.now();args[1].once('finish',()=>record('http',performance.now()-start));
  }
  return Reflect.apply(emit,this,[event,...args]);
};
const delay=monitorEventLoopDelay({resolution:10});delay.enable();
const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())record('gc',entry.duration);});
observer.observe({entryTypes:['gc']});
const initialCpu=process.cpuUsage(),initialLoop=performance.eventLoopUtilization();
setInterval(()=>{
  const cpu=process.cpuUsage(initialCpu),memory=process.memoryUsage();
  console.log('S5_PROFILE '+JSON.stringify({stages:Object.fromEntries([...stages].map(([name,values])=>[name,summary(values)])),
    eventLoop:{p95:delay.percentile(95)/1e6,max:delay.max/1e6,utilization:performance.eventLoopUtilization(initialLoop).utilization},
    cpuMs:(cpu.user+cpu.system)/1000,rssMB:memory.rss/1048576,heapMB:memory.heapUsed/1048576}));
},1000).unref();
