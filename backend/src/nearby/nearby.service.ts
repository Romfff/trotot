import {BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {PrismaService} from '../database/prisma.service.js';
import {Prisma} from '../generated/prisma/client.js';
import {coordinateHash,nearbyConfigVersion,nearbyEnabled,nearbyGroups,propertyProjection,publicNearbyWhere,type NearbyProperty} from './nearby-policy.js';
import type {NearbyQueryDto,NearbyVisibilityDto} from './nearby.dto.js';
import {PaginatedResource} from '../common/paginated-resource.js';
const missing=()=>new NotFoundException({errorCode:'PROPERTY_NOT_FOUND',message:'Không tìm thấy tin.'});
type Snapshot={id:string;coordinate_hash:string;last_success_at:Date;next_refresh_at:Date;dataset_version:string;visibility_version:number;status:string};
@Injectable()
export class NearbyService {
 constructor(private readonly prisma:PrismaService){}
 async read(slug:string,query:NearbyQueryDto){
  return this.prisma.$transaction(async tx=>{
   const [property]=await tx.$queryRaw<NearbyProperty[]>(Prisma.sql`SELECT ${propertyProjection} FROM properties p WHERE p.slug=${slug} AND ${publicNearbyWhere}`);
   if(!property)throw missing();
   const base={propertyId:property.id,rentalMode:property.rentalMode,distanceMethod:'GEODESIC',
    attribution:{label:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright'},
    center:{latitude:property.latitude,longitude:property.longitude},stale:false,updatedAt:null as Date|null,
    datasetVersion:null as string|null,snapshotVersion:null as string|null,groups:[] as unknown[]};
   if(!nearbyEnabled())return {...base,status:'UNAVAILABLE'};
   const [snapshot]=await tx.$queryRaw<Snapshot[]>`SELECT s.*,i.version AS dataset_version,state.visibility_version FROM property_nearby_state state
    JOIN property_nearby_snapshots s ON s.id=state.active_snapshot_id JOIN nearby_imports i ON i.id=s.dataset_id
    WHERE state.property_id=${property.id}::uuid AND s.coordinate_hash=${coordinateHash(property)} AND s.last_success_at>now()-interval '30 days'`;
   if(!snapshot){
    // A pagination request must not leave the client displaying POIs for an obsolete pin.
    if(query.snapshotVersion)throw new ConflictException({errorCode:'NEARBY_VERSION_CHANGED',message:'Dữ liệu khu vực đã đổi. Vui lòng tải lại.'});
    const [dataset]=await tx.$queryRaw<{id:string}[]>`SELECT import_id AS id FROM nearby_dataset_state WHERE id=1`;
    const [failure]=await tx.$queryRaw<{property_id:string}[]>`SELECT property_id FROM nearby_job_failures WHERE property_id=${property.id}::uuid
     AND latitude=${property.latitude} AND longitude=${property.longitude} AND rental_mode=${property.rentalMode}
     AND province_code=${property.provinceCode} AND config_version=${nearbyConfigVersion} AND dataset_id=${dataset?.id||null}::uuid`;
    return {...base,status:dataset&&!failure?'PENDING':'UNAVAILABLE'};}
   const version=`${snapshot.id}.${snapshot.visibility_version}`;
   if(query.snapshotVersion&&query.snapshotVersion!==version)throw new ConflictException({errorCode:'NEARBY_VERSION_CHANGED',message:'Dữ liệu khu vực đã đổi. Vui lòng tải lại.'});
   const groups=[];
   for(const [code,definition] of Object.entries(nearbyGroups)){
    if(!definition.modes.includes(property.rentalMode)||['BACH_HOA_XANH','FAMOUS'].includes(code)||query.group&&query.group!==code)continue;
    const items=await tx.$queryRaw<{item:unknown}[]>`SELECT n.item FROM property_nearby_places n
     LEFT JOIN property_nearby_overrides o ON o.property_id=${property.id}::uuid AND o.place_id=n.place_id
     WHERE n.snapshot_id=${snapshot.id}::uuid AND n.group_code=${code} AND coalesce(o.hidden,false)=false
     ORDER BY n.rank LIMIT ${query.limit} OFFSET ${(query.page-1)*query.limit}`;
    const [count]=await tx.$queryRaw<{total:number}[]>`SELECT count(*)::int AS total FROM property_nearby_places n
     LEFT JOIN property_nearby_overrides o ON o.property_id=${property.id}::uuid AND o.place_id=n.place_id
     WHERE n.snapshot_id=${snapshot.id}::uuid AND n.group_code=${code} AND coalesce(o.hidden,false)=false`;
    groups.push({code,label:definition.label,radiusMeters:definition.radiusMeters,items:items.map(row=>row.item),total:count.total,
     hasMore:query.page*query.limit<count.total,truncated:count.total===20});
   }
   if(query.group&&!groups.length)throw new BadRequestException({errorCode:'NEARBY_GROUP_UNAVAILABLE',message:'Nhóm này chưa có dữ liệu được kiểm chứng cho tin.'});
   // No Redis/browser cache: every request reads its authoritative publication and snapshot in one DB view.
   const result={...base,status:groups.some(group=>group.total>0)?'READY':'EMPTY',stale:snapshot.next_refresh_at<new Date(),
    updatedAt:snapshot.last_success_at,datasetVersion:snapshot.dataset_version,snapshotVersion:version,groups};
   if(query.group){const total=groups[0]?.total||0;return new PaginatedResource(result,{page:query.page,limit:query.limit,total,totalPages:Math.ceil(total/query.limit)});}
   return result;
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:10000});
 }
 async adminRead(propertyId:string){
  if(!nearbyEnabled())throw new ServiceUnavailableException({errorCode:'NEARBY_DISABLED',message:'Chức năng khu vực chưa được bật.'});
  if(!await this.prisma.property.findUnique({where:{id:propertyId},select:{id:true}}))throw missing();
  return this.prisma.$queryRaw`SELECT n.item,n.group_code AS "groupCode",coalesce(o.hidden,false) AS hidden,coalesce(o.version,0) AS version,o.reason
   FROM property_nearby_state state JOIN property_nearby_places n ON n.snapshot_id=state.active_snapshot_id
   LEFT JOIN property_nearby_overrides o ON o.property_id=state.property_id AND o.place_id=n.place_id
   WHERE state.property_id=${propertyId}::uuid ORDER BY n.group_code,n.rank`;
 }
 async visibility(actorId:string,propertyId:string,placeId:string,key:string,body:NearbyVisibilityDto){
  if(!nearbyEnabled())throw new ServiceUnavailableException({errorCode:'NEARBY_DISABLED',message:'Chức năng khu vực chưa được bật.'});
  if(typeof key!=='string'||!/^[A-Za-z0-9_-]{8,128}$/u.test(key))throw new BadRequestException({errorCode:'INVALID_IDEMPOTENCY_KEY',message:'Idempotency-Key không hợp lệ.'});
  const hash=createHash('sha256').update(JSON.stringify([propertyId,placeId,body.hidden,body.reason,body.expectedVersion])).digest('hex');
  return this.prisma.$transaction(async tx=>{
   const [{locked}]=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`nearby-request:${actorId}:${key}`},0)) AS locked`;
   if(!locked)throw new ConflictException({errorCode:'IDEMPOTENCY_IN_PROGRESS',message:'Yêu cầu đang được xử lý.'});
   const [saved]=await tx.$queryRaw<{payload_hash:string;response:unknown}[]>`SELECT payload_hash,response FROM nearby_visibility_requests
    WHERE actor_id=${actorId}::uuid AND key=${key} AND created_at>now()-interval '7 days'`;
   if(saved){if(saved.payload_hash!==hash)throw new ConflictException({errorCode:'IDEMPOTENCY_KEY_REUSED',message:'Khóa đã dùng cho nội dung khác.'});return saved.response;}
   await tx.$queryRaw`SELECT property_id FROM property_nearby_state WHERE property_id=${propertyId}::uuid FOR UPDATE`;
   const [pair]=await tx.$queryRaw<{place_id:string}[]>`SELECT n.place_id FROM property_nearby_places n
    JOIN property_nearby_state state ON state.active_snapshot_id=n.snapshot_id
    WHERE state.property_id=${propertyId}::uuid AND n.place_id=${placeId}::uuid LIMIT 1`;
   if(!pair)throw missing();
   const [before]=await tx.$queryRaw<{version:number;hidden:boolean;reason:string}[]>`SELECT version,hidden,reason FROM property_nearby_overrides
    WHERE property_id=${propertyId}::uuid AND place_id=${placeId}::uuid FOR UPDATE`;
   if((before?.version||0)!==body.expectedVersion)throw new ConflictException({errorCode:'STALE_NEARBY_VISIBILITY',message:'Mục này đã đổi. Vui lòng tải lại.'});
   const after={id:placeId,hidden:body.hidden,reason:body.reason,version:body.expectedVersion+1};
   await tx.$executeRaw`INSERT INTO property_nearby_overrides(property_id,place_id,hidden,reason,actor_admin_id,version)
    VALUES(${propertyId}::uuid,${placeId}::uuid,${body.hidden},${body.reason},${actorId}::uuid,${after.version})
    ON CONFLICT(property_id,place_id) DO UPDATE SET hidden=excluded.hidden,reason=excluded.reason,actor_admin_id=excluded.actor_admin_id,version=excluded.version,updated_at=now()`;
   await tx.$executeRaw`UPDATE property_nearby_state SET visibility_version=visibility_version+1 WHERE property_id=${propertyId}::uuid`;
   await tx.$executeRaw`INSERT INTO nearby_visibility_audit(property_id,place_id,actor_id,before_value,after_value)
    VALUES(${propertyId}::uuid,${placeId}::uuid,${actorId}::uuid,${JSON.stringify(before||null)}::jsonb,${JSON.stringify(after)}::jsonb)`;
   await tx.$executeRaw`INSERT INTO nearby_visibility_requests(actor_id,key,payload_hash,response) VALUES(${actorId}::uuid,${key},${hash},${JSON.stringify(after)}::jsonb)
    ON CONFLICT(actor_id,key) DO UPDATE SET payload_hash=excluded.payload_hash,response=excluded.response,created_at=now()`;
   return after;
  },{timeout:10000});
 }
}
