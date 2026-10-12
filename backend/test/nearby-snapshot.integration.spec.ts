import '../src/config/load-env.js';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Client} from 'pg';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {PrismaService} from '../src/database/prisma.service.js';
import {NearbySnapshotService} from '../src/nearby/nearby-snapshot.service.js';
import {NearbyService} from '../src/nearby/nearby.service.js';
import {NearbyQueryDto} from '../src/nearby/nearby.dto.js';
import {PaginatedResource} from '../src/common/paginated-resource.js';
import {promoteDataset} from '../scripts/nearby/promote-dataset.mjs';
import {nearbyConfigVersion} from '../src/nearby/nearby-policy.js';
import {AccessTokenGuard} from '../src/auth/access-token.guard.js';
import {RolesGuard} from '../src/auth/roles.guard.js';
import {SignJWT} from 'jose';
import {Reflector} from '@nestjs/core';
import {Roles} from '../src/auth/roles.decorator.js';
import type {ExecutionContext} from '@nestjs/common';
import {RedisService} from '../src/redis/redis.service.js';
import {NearbyRateLimitGuard} from '../src/nearby/nearby-rate-limit.guard.js';
import {ApiEnvelopeInterceptor} from '../src/common/api-envelope.interceptor.js';
import {lastValueFrom,of} from 'rxjs';
import {NearbyWorkerService} from '../src/nearby/nearby-worker.service.js';
import {NearbyController} from '../src/nearby/nearby.controller.js';
import {Sprint2UserRateLimitGuard} from '../src/common/sprint2-rate-limit.guard.js';
import {ApiExceptionFilter} from '../src/common/api-exception.filter.js';
import {Test} from '@nestjs/testing';
import {ValidationPipe} from '@nestjs/common';
import {Queue} from 'bullmq';

describe.skipIf(process.env.NEARBY_INTEGRATION!=='1')('Nearby snapshots: isolated real PostGIS and authorization',()=>{
 const original=process.env.DATABASE_URL!;const originalFlag=process.env.NEARBY_ENABLED;
 const name=`trotot_nearby_test_${randomUUID().replaceAll('-','')}`;
 let admin:Client,db:Client,prisma:PrismaService,worker:NearbySnapshotService,service:NearbyService,created=false;
 let propertyId:string,hostId:string,adminId:string,tenantId:string;const slug='nearby-isolated-fixture';
 const query=(extra={})=>Object.assign(new NearbyQueryDto(),extra);
 beforeAll(async()=>{
  const url=new URL(original);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Local DB only');
  admin=new Client({connectionString:url.href});await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);created=true;
  url.pathname=`/${name}`;process.env.DATABASE_URL=url.href;process.env.NEARBY_ENABLED='true';
  const require=createRequire(import.meta.url);
  await promisify(execFile)(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy'],{env:process.env,timeout:120000,maxBuffer:1024*1024});
  db=new Client({connectionString:url.href});await db.connect();prisma=new PrismaService();await prisma.$connect();
  worker=new NearbySnapshotService(prisma);service=new NearbyService(prisma);
  let sequence=1;const user=async(role:string)=>prisma.user.create({data:{phone:`090000000${sequence++}`,passwordHash:'not-a-login',fullName:'Synthetic test only',role,status:'ACTIVE'}});
  hostId=(await user('HOST')).id;adminId=(await user('ADMIN')).id;tenantId=(await user('TENANT')).id;
  await prisma.addressProvince.create({data:{code:'TEST',name:'Isolated province'}});
  await prisma.addressWard.create({data:{code:'TEST-WARD',provinceCode:'TEST',name:'Isolated ward'}});
  const property=await prisma.property.create({data:{hostId,title:'Isolated fixture, never public',slug,propertyType:'PHONG_TRO',rentalMode:'LONG_TERM',
   description:'Test',addressDetail:'Test',provinceCode:'TEST',wardCode:'TEST-WARD',latitude:10.7725,longitude:106.6578,status:'PUBLISHED',
   longTermDetail:{create:{monthlyPrice:1,depositAmount:1,areaSqm:1,electricityCost:0,waterCost:0,garbageCost:0,contactPhone:'fixture'}}}});
  propertyId=property.id;await db.query("UPDATE properties SET updated_at=now()-interval '10 minutes' WHERE id=$1",[propertyId]);
  const datasetId=randomUUID();await db.query(`INSERT INTO nearby_imports(id,version,config_version,source_url,source_as_of,extract_sha256,export_sha256,boundary_sha256,feature_count,ignored_count,outside_count)
   VALUES($1,'snapshot-test',$2,'https://download.geofabrik.de/asia/vietnam-latest.osm.pbf','2026-10-01',repeat('a',64),repeat('b',64),repeat('c',64),8,0,0)`,[datasetId,nearbyConfigVersion]);
  for(let i=1;i<=8;i++)await db.query(`INSERT INTO nearby_import_places(import_id,external_type,external_id,source_version,source_updated_at,name,category,tags,location,representative_method)
   VALUES($1,'node',$2,1,'2026-10-01',$3,'GROCERIES','{}',ST_Project(ST_MakePoint(106.6578,10.7725)::geography,$4::float8,0::float8),'OSM_POINT')`,[datasetId,String(i),`Synthetic grocery ${i}`,i*50]);
  await promoteDataset(db,'snapshot-test','Synthetic integration evidence, not a production review',name,{NODE_ENV:'test',DATABASE_URL:url.href});
 },180000);
 afterAll(async()=>{
  await prisma?.$disconnect();await db?.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin?.end();
  process.env.DATABASE_URL=original;if(originalFlag===undefined)delete process.env.NEARBY_ENABLED;else process.env.NEARBY_ENABLED=originalFlag;
 });
 it('sweep recovers, concurrent jobs publish once, pagination and geodesic ordering',async()=>{
  expect((await worker.due()).map(row=>row.id)).toContain(propertyId);
  const results=await Promise.all([worker.generate(propertyId),worker.generate(propertyId)]);expect(results.filter(Boolean)).toHaveLength(1);
  const first=await service.read(slug,query());expect(first).toMatchObject({status:'READY',stale:false});
  const group=(first as any).groups.find((g:any)=>g.code==='GROCERIES');expect(group.total).toBe(8);expect(group.items).toHaveLength(5);
  expect(group.items[0].distanceMeters).toBeCloseTo(50,2);
  const next=await service.read(slug,query({group:'GROCERIES',page:2,snapshotVersion:(first as any).snapshotVersion}));
  expect(next).toBeInstanceOf(PaginatedResource);expect((next as any).data.groups[0].items).toHaveLength(3);
  expect(await worker.generate(propertyId)).toBe(false);
 });
 it('visibility CAS, concurrent requests, retry, rollback and append-only audit',async()=>{
  const first:any=await service.read(slug,query());const id=first.groups.find((g:any)=>g.code==='GROCERIES').items[0].id;
  const body={hidden:true,reason:'Incorrect location',expectedVersion:0};
  const attempts=await Promise.allSettled([service.visibility(adminId,propertyId,id,'test-hide-001',body),service.visibility(adminId,propertyId,id,'test-hide-002',body)]);
  expect(attempts.filter(a=>a.status==='fulfilled')).toHaveLength(1);expect(attempts.filter(a=>a.status==='rejected')).toHaveLength(1);
  const key=attempts[0].status==='fulfilled'?'test-hide-001':'test-hide-002';expect(await service.visibility(adminId,propertyId,id,key,body)).toMatchObject({version:1});
  await expect(service.visibility(adminId,propertyId,id,key,{...body,reason:'Different'})).rejects.toMatchObject({status:409});
  await expect(service.read(slug,query({group:'GROCERIES',snapshotVersion:first.snapshotVersion}))).rejects.toMatchObject({status:409});
  expect((await service.adminRead(propertyId) as any[]).find(row=>row.item.id===id)).toMatchObject({hidden:true,version:1});
  const current:any=await service.read(slug,query());expect(current.groups.find((g:any)=>g.code==='GROCERIES').total).toBe(7);
  expect(Number((await db.query('SELECT count(*) FROM nearby_visibility_audit')).rows[0].count)).toBe(1);
  await expect(db.query("UPDATE nearby_visibility_audit SET after_value='{}'")).rejects.toThrow(/append-only/);
  await expect(service.visibility(adminId,randomUUID(),id,'test-wrong-pair',body)).rejects.toMatchObject({status:404});
  await service.visibility(adminId,propertyId,id,'test-show-001',{...body,hidden:false,expectedVersion:1});
 });
 it('hidden/deleted/locked Host are not public; changed coordinates never serve old snapshot',async()=>{
  const previousSnapshot=(await service.read(slug,query()) as any).snapshotVersion;
  await db.query("UPDATE properties SET status='HIDDEN' WHERE id=$1",[propertyId]);await expect(service.read(slug,query())).rejects.toMatchObject({status:404});
  await db.query("UPDATE properties SET status='PUBLISHED',deleted_at=now() WHERE id=$1",[propertyId]);await expect(service.read(slug,query())).rejects.toMatchObject({status:404});
  await db.query("UPDATE properties SET deleted_at=NULL WHERE id=$1",[propertyId]);await db.query("UPDATE users SET status='BLOCKED' WHERE id=$1",[hostId]);
  await expect(service.read(slug,query())).rejects.toMatchObject({status:404});await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[hostId]);
  await db.query('UPDATE properties SET latitude=latitude+0.01 WHERE id=$1',[propertyId]);expect(await service.read(slug,query())).toMatchObject({status:'PENDING',groups:[]});
  await expect(service.read(slug,query({group:'GROCERIES',page:2,snapshotVersion:previousSnapshot}))).rejects.toMatchObject({status:409});
  await db.query("UPDATE properties SET updated_at=now() WHERE id=$1",[propertyId]);expect(await worker.generate(propertyId)).toBe(false);
 });
 it('actual token guard rejects locked users; Admin role guard blocks Tenant and Host',async()=>{
  const guard=new AccessTokenGuard(prisma);const secret=new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
  const token=async(id:string)=>new SignJWT({tokenType:'access',sessionVersion:0}).setSubject(id).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(secret);
  expect((await guard.authenticate(await token(adminId))).user.role).toBe('ADMIN');
  await db.query("UPDATE users SET status='BLOCKED' WHERE id=$1",[tenantId]);await expect(guard.authenticate(await token(tenantId))).rejects.toMatchObject({status:401});
  class Protected {} Roles('ADMIN')(Protected);const roles=new RolesGuard(new Reflector());
  const context=(role:string)=>({getHandler:()=>()=>{},getClass:()=>Protected,switchToHttp:()=>({getRequest:()=>({user:{id:hostId,role}})})}) as unknown as ExecutionContext;
  for(const role of ['TENANT','HOST'])expect(()=>roles.canActivate(context(role))).toThrow();expect(roles.canActivate(context('ADMIN'))).toBe(true);
 });
 it('failed generation rolls back, keeps old pointer, survives restart and exposes unavailable only for the new pin',async()=>{
  const old=(await db.query('SELECT active_snapshot_id FROM property_nearby_state WHERE property_id=$1',[propertyId])).rows[0].active_snapshot_id;
  await db.query("UPDATE properties SET updated_at=now()-interval '10 minutes' WHERE id=$1",[propertyId]);
  await db.query("CREATE FUNCTION nearby_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic generation failure'; END; $$");
  await db.query('CREATE TRIGGER nearby_test_failure BEFORE INSERT ON property_nearby_places FOR EACH ROW EXECUTE FUNCTION nearby_test_fail()');
  try{
   await expect(worker.generate(propertyId)).rejects.toThrow();
   expect((await db.query('SELECT active_snapshot_id FROM property_nearby_state WHERE property_id=$1',[propertyId])).rows[0].active_snapshot_id).toBe(old);
   expect(await service.read(slug,query())).toMatchObject({status:'UNAVAILABLE',groups:[]});
   const restarted=new NearbySnapshotService(prisma);expect(await restarted.generate(propertyId)).toBe(false);
   expect((await restarted.due()).map(row=>row.id)).not.toContain(propertyId);
   for(const minutes of [5,30,7*24*60]){
    await db.query("UPDATE nearby_job_failures SET next_retry_at=now()-interval '1 minute' WHERE property_id=$1",[propertyId]);
    await expect(restarted.generate(propertyId)).rejects.toThrow();
    const retry=(await db.query('SELECT extract(epoch FROM(next_retry_at-now())) AS seconds FROM nearby_job_failures WHERE property_id=$1',[propertyId])).rows[0];
    expect(Number(retry.seconds)).toBeGreaterThan(minutes*60-10);expect(Number(retry.seconds)).toBeLessThan(minutes*60+10);
   }
  }finally{await db.query('DROP TRIGGER nearby_test_failure ON property_nearby_places');await db.query('DROP FUNCTION nearby_test_fail()');}
  await db.query("UPDATE nearby_job_failures SET next_retry_at=now()-interval '1 minute' WHERE property_id=$1",[propertyId]);
  expect(await new NearbySnapshotService(prisma).generate(propertyId)).toBe(true);
  expect((await db.query('SELECT count(*) FROM nearby_job_failures')).rows[0].count).toBe('0');
  const restored:any=await service.read(slug,query({group:'GROCERIES',page:1}));
  const envelope:any=await lastValueFrom(new ApiEnvelopeInterceptor().intercept({} as ExecutionContext,{handle:()=>of(restored)}));
  // The new pin is ~1.1 km north: only six fixtures remain inside the 1 km grocery radius.
  expect(envelope.meta).toMatchObject({page:1,limit:5,total:6});expect(envelope.data.meta).toBeUndefined();
 });
 it('real Redis enforces shared IP bucket, does not store raw IP and fails closed',async()=>{
  const previous=process.env.REDIS_KEY_PREFIX;const prefix=`nearby-test-${randomUUID()}:`;process.env.REDIS_KEY_PREFIX=prefix;
  const redis=new RedisService();
  try{
   await redis.onModuleInit();const guard=new NearbyRateLimitGuard(redis);
   const context={switchToHttp:()=>({getRequest:()=>({get:()=>undefined,headers:{},socket:{remoteAddress:'192.0.2.1'},ip:'192.0.2.1'})})} as unknown as ExecutionContext;
   for(let i=0;i<60;i++)expect(await guard.canActivate(context)).toBe(true);
   await expect(guard.canActivate(context)).rejects.toMatchObject({status:429});
   const keys=await redis.client.keys(`${prefix}*`);expect(keys).toHaveLength(1);expect(keys[0]).not.toContain('192.0.2.1');
   expect(await redis.client.ttl(keys[0].slice(prefix.length))).toBeGreaterThan(0);
   await redis.client.del(keys[0].slice(prefix.length));await redis.onModuleDestroy();
   await expect(guard.canActivate(context)).rejects.toMatchObject({status:503});
  }finally{await redis.onModuleDestroy();if(previous===undefined)delete process.env.REDIS_KEY_PREFIX;else process.env.REDIS_KEY_PREFIX=previous;}
 });
 it('homestay and hybrid require a public active unit; soft-delete and availability gates are immediate',async()=>{
  const property=await prisma.property.create({data:{hostId,title:'Homestay synthetic',slug:'nearby-homestay-fixture',propertyType:'HOMESTAY',rentalMode:'SHORT_TERM',
   description:'Test only',addressDetail:'Test',provinceCode:'TEST',wardCode:'TEST-WARD',latitude:10.7725,longitude:106.6578,status:'PUBLISHED'}});
  await expect(service.read(property.slug,query())).rejects.toMatchObject({status:404});
  const unit=await prisma.homestayUnit.create({data:{propertyId:property.id,unitName:'Isolated unit',maxAdults:2,maxChildren:0,bedrooms:1,bathrooms:1,
   basePricePerNight:1,cleaningFee:0,checkInTime:new Date('1970-01-01T14:00:00Z'),checkOutTime:new Date('1970-01-01T12:00:00Z'),cancellationPolicy:'FLEXIBLE',instantBook:false,status:'PUBLISHED'}});
  await db.query("UPDATE properties SET updated_at=now()-interval '10 minutes' WHERE id=$1",[property.id]);
  // Groceries are long-term only; a valid homestay with no matching short-term POIs is EMPTY, not an error.
  expect(await worker.generate(property.id)).toBe(true);expect(await service.read(property.slug,query())).toMatchObject({status:'EMPTY',rentalMode:'SHORT_TERM'});
  await prisma.property.update({where:{id:property.id},data:{rentalMode:'HYBRID'}});
  expect(await service.read(property.slug,query())).toMatchObject({status:'PENDING',groups:[]});
  await prisma.property.update({where:{id:property.id},data:{isAvailable:false}});await expect(service.read(property.slug,query())).rejects.toMatchObject({status:404});
  await prisma.property.update({where:{id:property.id},data:{isAvailable:true}});
  for(const state of ['HIDDEN','REJECTED','PENDING_REVIEW']){
   await prisma.homestayUnit.update({where:{id:unit.id},data:{status:state}});await expect(service.read(property.slug,query())).rejects.toMatchObject({status:404});
  }
  await prisma.homestayUnit.update({where:{id:unit.id},data:{status:'PUBLISHED',deletedAt:new Date()}});await expect(service.read(property.slug,query())).rejects.toMatchObject({status:404});
  await prisma.homestayUnit.update({where:{id:unit.id},data:{deletedAt:null}});expect(await service.read(property.slug,query())).toMatchObject({status:'PENDING'});
 });
 it('dataset promotion keeps IDs/overrides stable; rollback is CAS protected, audited and invalidates bad snapshots',async()=>{
  const second=randomUUID();await db.query(`INSERT INTO nearby_imports(id,version,config_version,source_url,source_as_of,extract_sha256,export_sha256,boundary_sha256,feature_count,ignored_count,outside_count)
   SELECT $1,'snapshot-test-next',config_version,source_url,'2026-10-02',extract_sha256,export_sha256,boundary_sha256,feature_count,ignored_count,outside_count FROM nearby_imports WHERE version='snapshot-test'`,[second]);
  await db.query(`INSERT INTO nearby_import_places(import_id,external_type,external_id,source_version,source_updated_at,name,category,tags,location,representative_method)
   SELECT $1,external_type,external_id,source_version,source_updated_at,name,category,tags,location,representative_method FROM nearby_import_places WHERE import_id=(SELECT id FROM nearby_imports WHERE version='snapshot-test')`,[second]);
  const ids=(await db.query('SELECT id FROM nearby_places ORDER BY id')).rows;
  await promoteDataset(db,'snapshot-test-next','Synthetic next generation review',name,{NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL});
  expect((await db.query('SELECT id FROM nearby_places ORDER BY id')).rows).toEqual(ids);
  expect(await worker.generate(propertyId)).toBe(true);
  const active=(await db.query('SELECT active_snapshot_id FROM property_nearby_state WHERE property_id=$1',[propertyId])).rows[0].active_snapshot_id;
  await expect(promoteDataset(db,'snapshot-test','Synthetic rollback',name,{NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL},'wrong-active')).rejects.toThrow('changed');
  expect((await db.query('SELECT active_snapshot_id FROM property_nearby_state WHERE property_id=$1',[propertyId])).rows[0].active_snapshot_id).toBe(active);
  await promoteDataset(db,'snapshot-test','Synthetic rollback',name,{NODE_ENV:'test',DATABASE_URL:process.env.DATABASE_URL},'snapshot-test-next');
  expect((await db.query('SELECT active_snapshot_id FROM property_nearby_state WHERE property_id=$1',[propertyId])).rows[0].active_snapshot_id).toBeNull();
  expect(await service.read(slug,query())).toMatchObject({status:'PENDING',groups:[]});
  expect((await db.query('SELECT version FROM property_nearby_overrides')).rows).toEqual([{version:2}]);
  expect((await db.query("SELECT count(*) FROM nearby_dataset_events WHERE action='ROLLBACK'")).rows[0].count).toBe('1');
  await expect(db.query("DELETE FROM nearby_dataset_events")).rejects.toThrow('append-only');
  expect(await worker.generate(propertyId)).toBe(true);
 });
 it('real BullMQ boot sweep and lifecycle restart recover a due property without another queue',async()=>{
  const previous=process.env.REDIS_KEY_PREFIX;const prefix=`nearby-worker-test-${randomUUID()}:`;process.env.REDIS_KEY_PREFIX=prefix;
  const redis=new RedisService();let running:NearbyWorkerService|undefined;let queue:Queue|undefined;
  const waitForSnapshot=async()=>{
   const deadline=Date.now()+15000;
   while(Date.now()<deadline){if(!(await worker.due()).some(row=>row.id===propertyId))return;await new Promise(done=>setTimeout(done,50));}
   throw new Error('Owned worker did not publish the due fixture');
  };
  try{
   await redis.onModuleInit();const options=redis.client.options;
   queue=new Queue('nearby',{prefix:`${prefix}nearby-queue`,connection:{host:options.host,port:options.port,password:options.password,maxRetriesPerRequest:2}});
   await db.query("UPDATE property_nearby_snapshots SET next_refresh_at=now()-interval '1 minute' WHERE property_id=$1",[propertyId]);
   expect((await worker.due()).some(row=>row.id===propertyId)).toBe(true);
   running=new NearbyWorkerService(redis,worker);await running.onModuleInit();await waitForSnapshot();await running.onModuleDestroy();running=undefined;
   // A due row written while the worker is stopped must be discovered at its next boot, without an enqueue event.
   await db.query("UPDATE properties SET latitude=latitude+0.000001,updated_at=now()-interval '10 minutes' WHERE id=$1",[propertyId]);
   expect(await service.read(slug,query())).toMatchObject({status:'PENDING',groups:[]});
   running=new NearbyWorkerService(redis,new NearbySnapshotService(prisma));await running.onModuleInit();await waitForSnapshot();
   expect(await service.read(slug,query())).toMatchObject({status:'READY'});
   expect((await db.query('SELECT count(*) FROM property_nearby_snapshots WHERE property_id=$1',[propertyId])).rows[0].count).toBe('2');
  }finally{
   await running?.onModuleDestroy();await queue?.obliterate({force:true});await queue?.close();await redis.onModuleDestroy();
   if(previous===undefined)delete process.env.REDIS_KEY_PREFIX;else process.env.REDIS_KEY_PREFIX=previous;
  }
 },30000);
 it('bounded cleanup removes only expired replay rows, not live keys or append-only audit',async()=>{
  const audits=(await db.query('SELECT count(*) FROM nearby_visibility_audit')).rows[0].count;
  await db.query(`INSERT INTO nearby_visibility_requests(actor_id,key,payload_hash,response,created_at)
   SELECT $1,'expired-fixture-'||i,repeat('a',64),'{}',now()-interval '8 days' FROM generate_series(1,101) i`,[adminId]);
  expect(await worker.cleanupRequests()).toBe(100);expect(await worker.cleanupRequests()).toBe(1);expect(await worker.cleanupRequests()).toBe(0);
  expect((await db.query("SELECT count(*) FROM nearby_visibility_requests WHERE key LIKE 'test-%'")).rows[0].count).toBe('2');
  expect((await db.query('SELECT count(*) FROM nearby_visibility_audit')).rows[0].count).toBe(audits);
 });
 it('real HTTP routes enforce roles, DTO validation, envelope, replay and Retry-After',async()=>{
  const previous=process.env.REDIS_KEY_PREFIX;const prefix=`nearby-http-test-${randomUUID()}:`;process.env.REDIS_KEY_PREFIX=prefix;
  const redis=new RedisService();await redis.onModuleInit();
  const module=await Test.createTestingModule({controllers:[NearbyController],providers:[
   {provide:NearbyService,useValue:service},{provide:PrismaService,useValue:prisma},{provide:RedisService,useValue:redis},
   AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard,NearbyRateLimitGuard,
  ]}).compile();
  const app=module.createNestApplication({logger:false});app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
  app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());
  const token=async(id:string)=>new SignJWT({tokenType:'access',sessionVersion:0}).setSubject(id).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
  try{
   await app.listen(0,'127.0.0.1');const base=await app.getUrl();
   const http=async(path:string,bearer?:string,body?:unknown,key?:string)=>{
    const response=await fetch(`${base}/api/v1${path}`,{method:body?'PATCH':'GET',headers:{...(bearer?{authorization:`Bearer ${bearer}`} : {}),...(body?{'content-type':'application/json'}:{}),...(key?{'idempotency-key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,headers:response.headers,body:await response.json()};
   };
   const adminToken=await token(adminId);const path=`/admin/properties/${propertyId}/nearby`;
   expect((await http(path)).status).toBe(401);expect((await http(path,await token(hostId))).status).toBe(403);
   await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[tenantId]);expect((await http(path,await token(tenantId))).status).toBe(403);
   const current=await http(path,adminToken);expect(current.status).toBe(200);expect(current.body.success).toBe(true);
   const row=current.body.data[0];expect(row).toHaveProperty('hidden');expect(JSON.stringify(current.body)).not.toMatch(/password|contactPhone|fullName/);
   expect((await http(`/properties/${slug}/nearby?group=GROCERIES&limit=1&page=2`)).body.meta).toMatchObject({page:2,limit:1});
   const invalid=await http(`/properties/${slug}/nearby?page=21`);expect(invalid.status).toBe(400);expect(invalid.body.errors).toBeInstanceOf(Array);
   const action=`${path}/${row.item.id}/visibility`;const body={hidden:!row.hidden,reason:' HTTP fixture review ',expectedVersion:row.version};
   expect((await http(action,adminToken,{...body,unexpected:true},'http-test-invalid')).status).toBe(400);
   const saved=await http(action,adminToken,body,'http-test-replay');expect(saved.status).toBe(200);expect(saved.body.data.reason).toBe('HTTP fixture review');
   expect((await http(action,adminToken,body,'http-test-replay')).body).toEqual(saved.body);
   expect((await http(action,adminToken,{...body,reason:'changed'},'http-test-replay')).status).toBe(409);
   await db.query("UPDATE users SET status='BLOCKED' WHERE id=$1",[adminId]);expect((await http(path,adminToken)).status).toBe(401);
   await db.query("UPDATE users SET status='ACTIVE' WHERE id=$1",[adminId]);
   let limited;for(let i=0;i<61;i++){const response=await http(`/properties/${slug}/nearby`);if(response.status===429){limited=response;break;}}
   expect(limited?.body.errorCode).toBe('RATE_LIMITED');expect(Number(limited?.headers.get('retry-after'))).toBeGreaterThan(0);
   expect(limited?.headers.get('cache-control')).toBe('no-store');
  }finally{
   const keys=await redis.client.keys(`${prefix}*`);if(keys.length)await redis.client.del(...keys.map(key=>key.slice(prefix.length)));await app.close();await redis.onModuleDestroy();
   if(previous===undefined)delete process.env.REDIS_KEY_PREFIX;else process.env.REDIS_KEY_PREFIX=previous;
  }
 },30000);
});
