import { createHash } from 'node:crypto';
import policy from './policy.json' with {type:'json'};
import { Prisma } from '../generated/prisma/client.js';
export const nearbyGroups=policy.groups;
export const nearbyConfigVersion=policy.version;
export type NearbyGroup=keyof typeof nearbyGroups;
export const nearbyEnabled=()=>process.env.NEARBY_ENABLED==='true';
export function coordinateHash(property:{latitude:number;longitude:number;rentalMode:string;provinceCode:string}) {
 return createHash('sha256').update(JSON.stringify([property.latitude,property.longitude,property.rentalMode,property.provinceCode,nearbyConfigVersion])).digest('hex');
}
// The same publication gate is used on every read and before snapshot publication.
export const publicNearbyWhere=Prisma.sql`p.status='PUBLISHED' AND p.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM users h WHERE h.id=p.host_id AND h.status='ACTIVE' AND h.role='HOST')
 AND ((p.rental_mode='LONG_TERM' AND EXISTS(SELECT 1 FROM long_term_details d WHERE d.property_id=p.id))
 OR (p.rental_mode IN ('SHORT_TERM','HYBRID') AND p.property_type IN ('HOMESTAY','VILLA') AND p.is_available
 AND EXISTS(SELECT 1 FROM homestay_units u WHERE u.property_id=p.id AND u.status='PUBLISHED' AND u.deleted_at IS NULL)))`;
export type NearbyProperty={id:string;latitude:number;longitude:number;rentalMode:string;provinceCode:string};
export const propertyProjection=Prisma.sql`p.id,p.latitude,p.longitude,p.rental_mode AS "rentalMode",p.province_code AS "provinceCode"`;
