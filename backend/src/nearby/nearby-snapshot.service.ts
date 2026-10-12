import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { coordinateHash, nearbyConfigVersion, nearbyEnabled, nearbyGroups, propertyProjection, publicNearbyWhere, type NearbyProperty } from './nearby-policy.js';

@Injectable()
export class NearbySnapshotService {
 constructor(private readonly prisma:PrismaService){}
 async cleanupRequests(){
  if(!nearbyEnabled())return 0;
  return this.prisma.$executeRaw`DELETE FROM nearby_visibility_requests WHERE (actor_id,key) IN
   (SELECT actor_id,key FROM nearby_visibility_requests WHERE created_at<=now()-interval '7 days'
    ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)`;
 }
 async due() {
  if(!nearbyEnabled())return [];
  return this.prisma.$queryRaw<{id:string}[]>(Prisma.sql`SELECT p.id FROM properties p
   JOIN nearby_dataset_state dataset ON dataset.id=1
   LEFT JOIN property_nearby_state state ON state.property_id=p.id
   LEFT JOIN property_nearby_snapshots s ON s.id=state.active_snapshot_id
   LEFT JOIN nearby_job_failures f ON f.property_id=p.id AND f.latitude=p.latitude AND f.longitude=p.longitude
    AND f.rental_mode=p.rental_mode AND f.province_code=p.province_code AND f.dataset_id=dataset.import_id AND f.config_version=${nearbyConfigVersion}
   WHERE ${publicNearbyWhere} AND p.updated_at<=now()-interval '5 minutes'
   AND (f.property_id IS NULL OR f.next_retry_at<=now())
   AND (s.id IS NULL OR s.latitude<>p.latitude OR s.longitude<>p.longitude OR s.rental_mode<>p.rental_mode
    OR s.province_code<>p.province_code
    OR s.dataset_id<>dataset.import_id OR s.config_version<>${nearbyConfigVersion} OR s.next_refresh_at<=now())
   ORDER BY s.next_refresh_at NULLS FIRST,p.id LIMIT 100`);
 }
 async generate(id:string) {
  if(!nearbyEnabled())return false;
  let context:{property:NearbyProperty;datasetId:string}|undefined;
  try {return await this.prisma.$transaction(async tx=>{
   const [{locked}]=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`nearby:${id}`},0)) AS locked`;
   if(!locked)return false;
   const [property]=await tx.$queryRaw<NearbyProperty[]>(Prisma.sql`SELECT ${propertyProjection} FROM properties p
    WHERE p.id=${id}::uuid AND ${publicNearbyWhere} AND p.updated_at<=now()-interval '5 minutes' FOR SHARE OF p`);
   if(!property)return false;
   const [dataset]=await tx.$queryRaw<{id:string}[]>`SELECT import_id AS id FROM nearby_dataset_state WHERE id=1 FOR SHARE`;
   if(!dataset)return false;
   context={property,datasetId:dataset.id};
   const [blocked]=await tx.$queryRaw<{property_id:string}[]>`SELECT property_id FROM nearby_job_failures WHERE property_id=${id}::uuid
    AND latitude=${property.latitude} AND longitude=${property.longitude} AND rental_mode=${property.rentalMode} AND province_code=${property.provinceCode}
    AND dataset_id=${dataset.id}::uuid AND config_version=${nearbyConfigVersion} AND next_retry_at>now()`;
   if(blocked)return false;
   const hash=coordinateHash(property);
   const refreshJitter=parseInt(hash.slice(0,8),16)%3600;
   const generation=createHash('sha256').update(`${hash}:${dataset.id}`).digest('hex');
   const [existing]=await tx.$queryRaw<{id:string}[]>`SELECT s.id FROM property_nearby_snapshots s
    JOIN property_nearby_state state ON state.active_snapshot_id=s.id
    WHERE s.property_id=${id}::uuid AND s.generation=${generation} AND s.next_refresh_at>now()`;
   if(existing)return false;
   const snapshotId=randomUUID();
   // Lock the authoritative row; an approved coordinate write cannot overtake this transaction.
   await tx.$executeRaw`INSERT INTO property_nearby_snapshots(id,property_id,coordinate_hash,dataset_id,config_version,generation,latitude,longitude,rental_mode,province_code,status)
    VALUES(${snapshotId}::uuid,${id}::uuid,${hash},${dataset.id}::uuid,${nearbyConfigVersion},${generation},${property.latitude},${property.longitude},${property.rentalMode},${property.provinceCode},'EMPTY')
    ON CONFLICT(property_id,generation) DO UPDATE SET next_refresh_at=now()+interval '7 days'`;
   const [snapshot]=await tx.$queryRaw<{id:string}[]>`SELECT id FROM property_nearby_snapshots WHERE property_id=${id}::uuid AND generation=${generation}`;
   await tx.$executeRaw`DELETE FROM property_nearby_places WHERE snapshot_id=${snapshot.id}::uuid`;
   let count=0;
   for(const [code,group] of Object.entries(nearbyGroups)){
    // Brand/airport/famous data awaits reviewed evidence, never infer it from a name.
    if(!group.modes.includes(property.rentalMode)||['BACH_HOA_XANH','FAMOUS'].includes(code))continue;
    const inserted=await tx.$executeRaw(Prisma.sql`INSERT INTO property_nearby_places(snapshot_id,place_id,group_code,rank,distance_meters,item)
     SELECT ${snapshot.id}::uuid,place.id,${code},row_number() OVER(ORDER BY distance,name,external_type,external_id)::int,distance,
      jsonb_build_object('id',place.id,'name',name,'category',category,'source',source,
       'point',jsonb_build_object('latitude',ST_Y(location::geometry),'longitude',ST_X(location::geometry)),
       'distanceMeters',distance,'representativeMethod',representative_method)
     FROM (SELECT n.*,ST_Distance(n.location,ST_SetSRID(ST_MakePoint(${property.longitude},${property.latitude}),4326)::geography) AS distance
      FROM nearby_places n WHERE n.dataset_id=${dataset.id}::uuid AND n.retired_at IS NULL AND n.category=${code}
       AND ST_DWithin(n.location,ST_SetSRID(ST_MakePoint(${property.longitude},${property.latitude}),4326)::geography,${group.radiusMeters})
      ORDER BY distance,n.name,n.external_type,n.external_id LIMIT 20) place`);
    count+=inserted;
   }
   // A Host ban committed during calculation must also prevent publication.
   const [stillPublic]=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT p.id FROM properties p WHERE p.id=${id}::uuid AND ${publicNearbyWhere}`);
   if(!stillPublic)throw new Error('Publication changed during nearby calculation');
   await tx.$executeRaw`UPDATE property_nearby_snapshots SET status=${count?'READY':'EMPTY'},last_success_at=now(),next_refresh_at=now()+interval '7 days'+${refreshJitter}*interval '1 second' WHERE id=${snapshot.id}::uuid`;
   await tx.$executeRaw`INSERT INTO property_nearby_state(property_id,active_snapshot_id) VALUES(${id}::uuid,${snapshot.id}::uuid)
    ON CONFLICT(property_id) DO UPDATE SET active_snapshot_id=excluded.active_snapshot_id`;
   await tx.$executeRaw`DELETE FROM nearby_job_failures WHERE property_id=${id}::uuid`;
   await tx.$executeRaw`DELETE FROM property_nearby_snapshots WHERE property_id=${id}::uuid AND id NOT IN
    (SELECT id FROM property_nearby_snapshots WHERE property_id=${id}::uuid ORDER BY last_success_at DESC,id LIMIT 2)`;
   return true;
  },{timeout:30000,isolationLevel:Prisma.TransactionIsolationLevel.ReadCommitted});
  }catch(error){
   if(context){const {property,datasetId}=context;
    const reset=Prisma.sql`nearby_job_failures.updated_at<now()-interval '7 days' OR nearby_job_failures.dataset_id<>excluded.dataset_id
      OR nearby_job_failures.latitude<>excluded.latitude OR nearby_job_failures.longitude<>excluded.longitude
      OR nearby_job_failures.rental_mode<>excluded.rental_mode OR nearby_job_failures.province_code<>excluded.province_code
      OR nearby_job_failures.config_version<>excluded.config_version`;
    // Durable backoff survives Redis failure/restart. After three retries, wait for the next weekly cycle.
    await this.prisma.$executeRaw(Prisma.sql`INSERT INTO nearby_job_failures(property_id,latitude,longitude,rental_mode,province_code,dataset_id,config_version,next_retry_at)
     VALUES(${id}::uuid,${property.latitude},${property.longitude},${property.rentalMode},${property.provinceCode},${datasetId}::uuid,${nearbyConfigVersion},now()+interval '1 minute')
     ON CONFLICT(property_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude,rental_mode=excluded.rental_mode,
      province_code=excluded.province_code,dataset_id=excluded.dataset_id,config_version=excluded.config_version,
      attempts=CASE WHEN ${reset} THEN 1 ELSE nearby_job_failures.attempts+1 END,
      next_retry_at=now()+CASE WHEN ${reset} THEN interval '1 minute' WHEN nearby_job_failures.attempts=1 THEN interval '5 minutes'
       WHEN nearby_job_failures.attempts=2 THEN interval '30 minutes' ELSE interval '7 days' END,updated_at=now()`).catch(()=>undefined);
   }throw error;
  }
 }
}
