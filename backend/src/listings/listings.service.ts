import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { SearchListingsDto } from './listings.dto.js';
import { calculateLongTermEstimate, configuredEstimateLimits } from './long-term-estimate.js';
import type { CostEstimateQueryDto } from './long-term-estimate.dto.js';
import { createHash } from 'node:crypto';

const publicSelect = {
  id: true, slug: true, title: true, description: true, videoUrl: true, propertyType: true,
  addressDetail: true, provinceCode: true, districtCode: true, wardCode: true,
  latitude: true, longitude: true, isVerified: true, isAvailable: true, createdAt: true,
  ward: { select: { name: true, province: { select: { name: true } } } },
  host: { select: { fullName: true, avatarUrl: true } },
  images: { orderBy: { position: 'asc' as const }, select: { url: true, position: true } },
  amenities: { orderBy: { amenityId: 'asc' as const }, select: { amenity: { select: { id: true, name: true } } } },
  longTermDetail: { select: {
    monthlyPrice: true, depositAmount: true, areaSqm: true, leaseTermMonths: true,
    electricityCost: true, waterCost: true, waterUnit: true, internetCost: true, garbageCost: true,
    parkingFee: true, allowPets: true,
  } },
} as const;
type PublicRecord = Prisma.PropertyGetPayload<{ select: typeof publicSelect }>;

function present(record: PublicRecord, distanceMeters: number | null = null) {
  const detail = record.longTermDetail!;
  return {
    ...record, images: record.images.map(image => ({ ...image, sortOrder: image.position })), amenities: record.amenities.map(({ amenity }) => amenity),
    longTermDetail: undefined, distanceMeters,
    ...detail,
    monthlyPrice: Number(detail.monthlyPrice), depositAmount: Number(detail.depositAmount),
    areaSqm: Number(detail.areaSqm), electricityCost: Number(detail.electricityCost),
    waterCost: Number(detail.waterCost), internetCost: Number(detail.internetCost), garbageCost: Number(detail.garbageCost), parkingFee: Number(detail.parkingFee),
  };
}

export function searchSql(dto: SearchListingsDto) {
  if (dto.minPrice !== undefined && dto.maxPrice !== undefined && dto.minPrice > dto.maxPrice
    || dto.minArea !== undefined && dto.maxArea !== undefined && dto.minArea > dto.maxArea) {
    throw new BadRequestException({ errorCode: 'INVALID_RANGE', message: 'Giá trị tối thiểu không được lớn hơn tối đa.' });
  }
  const hasCoordinates = dto.lat !== undefined && dto.lng !== undefined;
  if ((dto.lat !== undefined) !== (dto.lng !== undefined) || dto.radius !== undefined && !hasCoordinates
    || dto.sortBy === 'distance_asc' && !hasCoordinates) {
    throw new BadRequestException({ errorCode: 'COORDINATES_REQUIRED', message: 'Cần đầy đủ vĩ độ và kinh độ để tìm theo khoảng cách.' });
  }
  const center = hasCoordinates ? Prisma.sql`ST_SetSRID(ST_MakePoint(${dto.lng},${dto.lat}),4326)::geography` : null;
  const distance = center ? Prisma.sql`ST_Distance(p.location::geography,${center})` : Prisma.sql`NULL::double precision`;
  const conditions = [Prisma.sql`p.status='PUBLISHED'`, Prisma.sql`p.rental_mode='LONG_TERM'`, Prisma.sql`p.deleted_at IS NULL`,
    Prisma.sql`EXISTS (SELECT 1 FROM users h WHERE h.id=p.host_id AND h.role='HOST' AND h.status='ACTIVE')`];
  if (dto.province !== undefined) conditions.push(Prisma.sql`p.province_code=${dto.province}`);
  if (dto.district !== undefined) conditions.push(Prisma.sql`p.district_code=${dto.district}`);
  if (dto.minPrice !== undefined) conditions.push(Prisma.sql`d.monthly_price>=${dto.minPrice}`);
  if (dto.maxPrice !== undefined) conditions.push(Prisma.sql`d.monthly_price<=${dto.maxPrice}`);
  if (dto.minArea !== undefined) conditions.push(Prisma.sql`d.area_sqm>=${dto.minArea}`);
  if (dto.maxArea !== undefined) conditions.push(Prisma.sql`d.area_sqm<=${dto.maxArea}`);
  if (center && dto.radius !== undefined) conditions.push(Prisma.sql`ST_DWithin(p.location::geography,${center},${dto.radius})`);
  const amenityIds = [...new Set(dto.amenities?.split(',') ?? [])];
  // D11 approved: ALL selected amenities must be present (AND), not just any one.
  for (const id of amenityIds) conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM property_amenity_mapping a WHERE a.property_id=p.id AND a.amenity_id=${id}
  )`);
  const where = Prisma.sql`FROM properties p JOIN long_term_details d ON d.property_id=p.id WHERE ${Prisma.join(conditions,' AND ')}`;
  const order = {
    newest: Prisma.sql`p.created_at DESC,p.id DESC`,
    price_asc: Prisma.sql`d.monthly_price ASC,p.id ASC`,
    price_desc: Prisma.sql`d.monthly_price DESC,p.id ASC`,
    distance_asc: Prisma.sql`${distance} ASC,p.id ASC`,
  }[dto.sortBy];
  return {
    rows: Prisma.sql`SELECT p.id,${distance} AS distance_meters ${where} ORDER BY ${order} LIMIT ${dto.limit} OFFSET ${(dto.page-1)*dto.limit}`,
    count: Prisma.sql`SELECT COUNT(*)::integer AS total ${where}`,
  };
}

@Injectable()
export class ListingsService {
  private readonly estimateLimits = configuredEstimateLimits();
  private readonly pendingSearches=new Map<string,Promise<PaginatedResult<ReturnType<typeof present>>>>();
  private readonly memorySearches=new Map<string,{until:number;result:PaginatedResult<ReturnType<typeof present>>}>();
  private readonly memoryRecords=new Map<string,{generation:string;until:number;value:ReturnType<typeof present>}>();
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async search(dto: SearchListingsDto) {
    const sql = searchSql(dto);
    // Every hit validates a DB epoch. Publication/Host/catalog changes bump it
    // atomically; do not scan every matching room or open an interactive TX on hits.
    const generation=await this.prisma.publicSearchGeneration();
    const query=Object.entries(dto).sort(([a],[b])=>a.localeCompare(b));
    const key=`listing:search:v2:${createHash('sha256').update(JSON.stringify(query)).digest('hex')}:${generation}`;
    const local=this.memorySearches.get(key);
    if(local&&local.until>Date.now())return local.result;
    if(local)this.memorySearches.delete(key);
    const cached=await this.redis.client.get(key).catch(()=>null);
    if(cached){try{
      const result=JSON.parse(cached) as PaginatedResult<ReturnType<typeof present>>;
      if(Array.isArray(result.data)&&result.data.length<=dto.limit&&result.meta?.page===dto.page&&result.meta.limit===dto.limit&&Number.isSafeInteger(result.meta.total)&&result.meta.total>=0){
        const page=new PaginatedResult(result.data,result.meta);this.rememberSearch(key,page);return page;
      }
    }catch{/* Malformed cache is not authoritative. */}}
    const pending=this.pendingSearches.get(key);if(pending)return pending;
    const work=this.loadSearch(dto,sql,key,generation);this.pendingSearches.set(key,work);
    try{return await work;}finally{if(this.pendingSearches.get(key)===work)this.pendingSearches.delete(key);}
  }
  private rememberSearch(key:string,result:PaginatedResult<ReturnType<typeof present>>){
    // 04 L1 cache. Every access still validates the authoritative DB epoch.
    // Bounded space/TTL; arbitrary public filters cannot grow process memory forever.
    if(this.memorySearches.size>=128)this.memorySearches.delete(this.memorySearches.keys().next().value!);
    this.memorySearches.set(key,{until:Date.now()+60000,result});
  }
  private async loadSearch(dto:SearchListingsDto,sql:ReturnType<typeof searchSql>,key:string,generation:string){
    const {result,current,byId}=await this.prisma.$transaction(async tx=>{
      const [{generation:current,total}]=await tx.$queryRaw<{generation:string;total:number}[]>(Prisma.sql`
        SELECT epoch.generation::text AS generation,totals.total
        FROM public_search_epoch epoch CROSS JOIN (${sql.count}) totals WHERE epoch.id=1
      `);
      const rows = await tx.$queryRaw<{ id: string; distance_meters: number | null }[]>(sql.rows);
      // IDs, filters, count and distances remain authoritative in this snapshot.
      // Reuse only public projections read under its exact publication/catalog epoch.
      const byId=new Map<string,ReturnType<typeof present>>(),now=Date.now();
      for(const row of rows){const cached=this.memoryRecords.get(row.id);
        if(cached?.generation===current&&cached.until>now)byId.set(row.id,cached.value);
      }
      const missing=rows.filter(row=>!byId.has(row.id)).map(row=>row.id);
      const records=missing.length?await tx.property.findMany({where:{id:{in:missing}},select:publicSelect}):[];
      for(const record of records)byId.set(record.id,present(record));
      const result=new PaginatedResult(rows.map(row => ({...byId.get(row.id)!,distanceMeters:row.distance_meters})), {
        page: dto.page, limit: dto.limit, total, totalPages: Math.ceil(total / dto.limit),
      });
      return {result,current,byId};
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    // Release DB before Redis I/O; failed commit acknowledgements must not publish cache.
    // A concurrent write gets a new epoch key, never this snapshot's old key.
    if(current===generation){
      for(const [id,value]of byId){
        if(!this.memoryRecords.has(id)&&this.memoryRecords.size>=256)this.memoryRecords.delete(this.memoryRecords.keys().next().value!);
        this.memoryRecords.set(id,{generation:current,until:Date.now()+60000,value});
      }
      this.rememberSearch(key,result);await this.redis.client.set(key,JSON.stringify(result),'EX',60).catch(()=>null);
    }
    return result;
  }

  async detail(slug: string) {
    // Check publication on every read, including cache hits: hidden/rejected data must not leak.
    const exists = await this.prisma.property.findFirst({
      where: { slug, status: 'PUBLISHED', rentalMode: 'LONG_TERM', deletedAt: null, host:{role:'HOST',status:'ACTIVE'}, longTermDetail: { isNot: null } },
      select: { id: true, version: true },
    });
    if (!exists) throw new NotFoundException({ errorCode: 'PROPERTY_NOT_FOUND', message: 'Tin trọ không tồn tại hoặc không còn hiển thị.' });
    // Separate projection version: old cache entries contain publicly exposed contact data.
    const key = `listing:public:v2:${exists.id}:v${exists.version}`;
    const cached = await this.redis.client.get(key).catch(() => null);
    if (cached) {
      try { return JSON.parse(cached) as ReturnType<typeof present>; } catch { /* Fetch authoritative data on malformed cache. */ }
    }
    const record = await this.prisma.property.findFirst({
      where: { id: exists.id, status: 'PUBLISHED', rentalMode: 'LONG_TERM', deletedAt: null, host:{role:'HOST',status:'ACTIVE'}, longTermDetail: { isNot: null } }, select: publicSelect,
    });
    if (!record) throw new NotFoundException({ errorCode: 'PROPERTY_NOT_FOUND', message: 'Tin trọ không còn hiển thị.' });
    const result = present(record);
    await this.redis.client.set(key, JSON.stringify(result), 'EX', 300).catch(() => null);
    return result;
  }

  async contact(slug: string) {
    const record = await this.prisma.property.findFirst({
      where: { slug, status: 'PUBLISHED', rentalMode: 'LONG_TERM', deletedAt: null, host:{role:'HOST',status:'ACTIVE'}, longTermDetail: { isNot: null } },
      select: { longTermDetail: { select: { contactPhone: true, contactZalo: true } } },
    });
    if (!record?.longTermDetail) throw new NotFoundException({ errorCode: 'PROPERTY_NOT_FOUND', message: 'Tin trọ không tồn tại hoặc không còn hiển thị.' });
    return record.longTermDetail;
  }

  async amenities() {
    const cached = await this.redis.client.get('catalog:amenities:v1').catch(() => null);
    if (cached) {
      try { return JSON.parse(cached) as { id: string; name: string }[]; } catch { /* Reload catalog. */ }
    }
    const result = await this.prisma.amenity.findMany({ orderBy: { id: 'asc' } });
    await this.redis.client.set('catalog:amenities:v1', JSON.stringify(result), 'EX', 86400).catch(() => null);
    return result;
  }

  async costEstimate(slug: string, usage: CostEstimateQueryDto) {
    // Authoritative publication and prices in one read. No usage/lead storage or
    // result cache: hide/edit is reflected without an invalidation race.
    const record = await this.prisma.property.findFirst({
      where: { slug, status: 'PUBLISHED', rentalMode: 'LONG_TERM', deletedAt: null, host:{role:'HOST',status:'ACTIVE'}, longTermDetail: { isNot: null } },
      select: { longTermDetail: { select: { monthlyPrice: true, depositAmount: true, electricityCost: true, waterCost: true, waterUnit: true, internetCost: true, garbageCost: true, parkingFee: true } } },
    });
    if (!record?.longTermDetail) throw new NotFoundException({ errorCode: 'PROPERTY_NOT_FOUND', message: 'Tin trọ không tồn tại hoặc không còn hiển thị.' });
    const prices = record.longTermDetail;
    if (prices.waterUnit !== 'M3' && prices.waterUnit !== 'PERSON') throw new Error('Unsupported water unit in stored listing');
    return calculateLongTermEstimate({ ...prices, waterUnit: prices.waterUnit }, usage, 'VEHICLE', this.estimateLimits);
  }

}
