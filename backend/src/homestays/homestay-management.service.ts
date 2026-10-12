import { BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { Prisma,type HomestayUnit } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { dateEpoch,parseStay,vietnamToday } from '../bookings/booking-dates.js';
import { roomTimestamp } from '../bookings/booking-lifecycle.js';
import { publishedHomestayUnit } from './homestay-availability.service.js';
import { HomestayCalendarService,calendarMonthDates } from './homestay-calendar.service.js';
import { calculateNightPrice } from '../bookings/booking-pricing.js';
import { expireUnit } from '../bookings/bookings.service.js';
import { HomestayPropertyDto,HomestayUnitDto } from './homestay-management.dto.js';
import type { CreateHomestayDto,UpdateHomestayDto,UpdateHomestayUnitDto,HomestaySearchDto,HomestayCalendarPricingDto,HomestayCalendarBlockDto,HomestayFeeDto } from './homestay-management.dto.js';
import type { ListingsPageDto } from '../listings/listings.dto.js';
import { positiveIntegerEnv } from '../config/environment.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';

const privateInclude={homestayUnits:{where:{deletedAt:null}},images:{orderBy:{position:'asc' as const}},amenities:true,revision:true} as const;
function conflict(code:string,message:string):never {throw new ConflictException({errorCode:code,message});}
function missing():never {throw new NotFoundException({errorCode:'HOMESTAY_NOT_FOUND',message:'Không tìm thấy homestay.'});}
function unitFields(dto:HomestayUnitDto) {
  return {unitName:dto.unitName,maxAdults:dto.maxAdults,maxChildren:dto.maxChildren,maxGuests:dto.maxGuests??null,maxNights:dto.maxNights,
    bedrooms:dto.bedrooms,bathrooms:dto.bathrooms,basePricePerNight:dto.basePricePerNight,weekendPricePerNight:dto.weekendPricePerNight??null,
    cleaningFee:dto.cleaningFee,checkInTime:new Date(`1970-01-01T${dto.checkInTime}Z`),checkOutTime:new Date(`1970-01-01T${dto.checkOutTime}Z`),
    sameDayBookingCutoff:new Date(`1970-01-01T${dto.sameDayBookingCutoff}Z`),cancellationPolicy:dto.cancellationPolicy,instantBook:dto.instantBook};
}
function propertyFields(dto:HomestayPropertyDto) {
  return {title:dto.title,description:dto.description,propertyType:dto.propertyType,addressDetail:dto.addressDetail,provinceCode:dto.provinceCode,
    wardCode:dto.wardCode,latitude:dto.latitude,longitude:dto.longitude,videoUrl:dto.videoUrl??null};
}
function publicUnit(unit:HomestayUnit) {
  const {id,unitName,maxAdults,maxChildren,maxGuests,maxNights,bedrooms,bathrooms,cancellationPolicy,instantBook}=unit;
  return {id,unitName,maxAdults,maxChildren,maxGuests,maxNights,bedrooms,bathrooms,cancellationPolicy,instantBook,
    checkInTime:unit.checkInTime.toISOString().slice(11,19),checkOutTime:unit.checkOutTime.toISOString().slice(11,19),
    sameDayBookingCutoff:unit.sameDayBookingCutoff.toISOString().slice(11,19),basePricePerNight:unit.basePricePerNight.toNumber(),
    weekendPricePerNight:unit.weekendPricePerNight?.toNumber()??null,cleaningFee:unit.cleaningFee.toNumber()};
}
@Injectable()
export class HomestayManagementService {
  constructor(private readonly prisma:PrismaService,private readonly calendar:HomestayCalendarService,private readonly idempotency:BookingIdempotencyService) {}
  private async validateCatalog(tx:Prisma.TransactionClient,dto:HomestayPropertyDto) {
    if(!await tx.addressWard.findFirst({where:{code:dto.wardCode,provinceCode:dto.provinceCode}})) {
      if(await tx.addressWard.count()===0) throw new ServiceUnavailableException({errorCode:'ADDRESS_CATALOG_NOT_READY',message:'Danh mục địa chỉ chưa sẵn sàng.'});
      throw new BadRequestException({errorCode:'INVALID_ADDRESS',message:'Phường/xã không thuộc tỉnh đã chọn.'});
    }
    if(await tx.amenity.count({where:{id:{in:dto.amenityIds}}})!==dto.amenityIds.length) throw new BadRequestException({errorCode:'INVALID_AMENITY',message:'Tiện ích không tồn tại.'});
    if(dto.imageUrls.length) throw new ServiceUnavailableException({errorCode:'MEDIA_SERVER_NOT_CONFIGURED',message:'Server ảnh riêng chưa được kết nối.'});
  }
  private async content(tx:Prisma.TransactionClient,id:string,dto:HomestayPropertyDto) {
    await this.validateCatalog(tx,dto);
    await tx.property.update({where:{id},data:propertyFields(dto)});
    await tx.propertyAmenityMapping.deleteMany({where:{propertyId:id}});
    if(dto.amenityIds.length) await tx.propertyAmenityMapping.createMany({data:dto.amenityIds.map(amenityId=>({propertyId:id,amenityId}))});
  }
  private async propertyLock(tx:Prisma.TransactionClient,id:string,hostId?:string) {
    // Match hold ordering: unit(s), then property. Deterministic ordering avoids cross-unit deadlocks.
    await tx.$queryRaw`SELECT id FROM homestay_units WHERE property_id=${id}::uuid ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM properties WHERE id=${id}::uuid FOR UPDATE`;
    if(hostId) {
      await tx.$queryRaw`SELECT id FROM users WHERE id=${hostId}::uuid FOR SHARE`;
      if(!await tx.user.findFirst({where:{id:hostId,role:'HOST',status:'ACTIVE'}})) missing();
    }
    const p=await tx.property.findFirst({where:{id,deletedAt:null,rentalMode:{in:['SHORT_TERM','HYBRID']},propertyType:{in:['HOMESTAY','VILLA']},...(hostId?{hostId}:{})}});
    if(!p) missing();return p;
  }
  private version(actual:number,expected:number) {if(actual!==expected) conflict('STALE_HOMESTAY_VERSION','Nội dung đã thay đổi. Hãy tải lại.');}
  private async active(tx:Prisma.TransactionClient,unitIds:string[]) {
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const candidates=await tx.booking.findMany({where:{homestayUnitId:{in:unitIds},OR:[{bookingStatus:'CHECKED_IN'},
      {bookingStatus:'CONFIRMED',checkOutDate:{gte:new Date(vietnamToday(now))}},
      {bookingStatus:{in:['PENDING_PAYMENT','PENDING_HOST_APPROVAL']},expiresAt:{gt:now}}]},select:{id:true,bookingStatus:true,checkOutDate:true,policySnapshot:true}});
    return candidates.find(b=>b.bookingStatus!=='CONFIRMED'||roomTimestamp(b.checkOutDate.toISOString().slice(0,10),String((b.policySnapshot as Record<string,unknown>).checkOutTime))>now);
  }
  async create(hostId:string,dto:CreateHomestayDto) {
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${hostId}::uuid FOR SHARE`;
      const host=await tx.user.findFirst({where:{id:hostId,role:'HOST',status:'ACTIVE'}});if(!host) missing();
      await this.validateCatalog(tx,dto);
      const property=await tx.property.create({data:{hostId,slug:`homestay-${randomUUID()}`,rentalMode:'SHORT_TERM',status:'PENDING_REVIEW',...propertyFields(dto)}});
      await this.content(tx,property.id,dto);
      for(const unit of dto.units) await tx.homestayUnit.create({data:{propertyId:property.id,...unitFields(unit)}});
      return tx.property.findUniqueOrThrow({where:{id:property.id},include:privateInclude});
    });
  }
  async list(query:ListingsPageDto,hostId?:string) {
    const where:Prisma.PropertyWhereInput={deletedAt:null,rentalMode:{in:['SHORT_TERM','HYBRID']},propertyType:{in:['HOMESTAY','VILLA']},
      ...(hostId?{hostId}:{OR:[{status:'PENDING_REVIEW'},{revision:{is:{status:'PENDING_REVIEW'}}},{homestayUnits:{some:{deletedAt:null,OR:[{status:'PENDING_REVIEW'},{pendingRevision:{not:Prisma.DbNull}}]}}}]})};
    return this.prisma.$transaction(async tx=>{
      const total=await tx.property.count({where});const rows=await tx.property.findMany({where,include:privateInclude,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(query.page-1)*query.limit,take:query.limit});
      return new PaginatedResult(rows,{page:query.page,limit:query.limit,total,totalPages:Math.ceil(total/query.limit)});
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async own(id:string,hostId?:string) {
    const p=await this.prisma.property.findFirst({where:{id,deletedAt:null,rentalMode:{in:['SHORT_TERM','HYBRID']},propertyType:{in:['HOMESTAY','VILLA']},...(hostId?{hostId}:{})},include:privateInclude});
    if(!p) missing();return p;
  }
  async update(hostId:string,id:string,dto:UpdateHomestayDto) {
    return this.prisma.$transaction(async tx=>{
      const p=await this.propertyLock(tx,id,hostId);this.version(p.version,dto.expectedVersion);await this.validateCatalog(tx,dto);
      const {expectedVersion:_version,...snapshot}=dto;
      if(['PUBLISHED','HIDDEN'].includes(p.status)) await tx.propertyRevision.upsert({where:{propertyId:id},create:{propertyId:id,content:snapshot as unknown as Prisma.InputJsonObject},update:{content:snapshot as unknown as Prisma.InputJsonObject,status:'PENDING_REVIEW'}});
      else if(['PENDING_REVIEW','REJECTED'].includes(p.status)) {await this.content(tx,id,dto);await tx.property.update({where:{id},data:{status:'PENDING_REVIEW'}});}
      else conflict('INVALID_STATE','Không thể sửa trạng thái này.');
      return tx.property.update({where:{id},data:{version:{increment:1}},include:privateInclude});
    });
  }
  async unit(hostId:string,id:string,unitId:string|undefined,dto:UpdateHomestayUnitDto) {
    return this.prisma.$transaction(async tx=>{
      const p=await this.propertyLock(tx,id,hostId);
      if(!unitId) {this.version(p.version,dto.expectedVersion);await tx.property.update({where:{id},data:{version:{increment:1}}});return tx.homestayUnit.create({data:{propertyId:id,...unitFields(dto)}});}
      const u=await tx.homestayUnit.findFirst({where:{id:unitId,propertyId:id,deletedAt:null}});if(!u) missing();this.version(u.version,dto.expectedVersion);
      const {expectedVersion:_version,...snapshot}=dto;
      const data=['PUBLISHED','HIDDEN'].includes(u.status)?{pendingRevision:snapshot as unknown as Prisma.InputJsonObject}:{...unitFields(dto),status:'PENDING_REVIEW'};
      await tx.property.update({where:{id},data:{version:{increment:1}}});
      return tx.homestayUnit.update({where:{id:unitId},data:{...data,version:{increment:1}}});
    });
  }
  async visibility(hostId:string,id:string,version:number,status:'PUBLISHED'|'HIDDEN') {
    return this.prisma.$transaction(async tx=>{const p=await this.propertyLock(tx,id,hostId);this.version(p.version,version);
      if(!['PUBLISHED','HIDDEN'].includes(p.status)) conflict('INVALID_STATE','Chỉ ẩn/hiện tin đã duyệt.');
      return tx.property.update({where:{id},data:{status,version:{increment:1}},select:{id:true,status:true,version:true}});});
  }
  async remove(hostId:string,id:string,version:number,unitId?:string) {
    return this.prisma.$transaction(async tx=>{
      const p=await this.propertyLock(tx,id,hostId);const units=await tx.homestayUnit.findMany({where:{propertyId:id,deletedAt:null,...(unitId?{id:unitId}:{})}});
      if(unitId && !units.length) missing();this.version(unitId?units[0].version:p.version,version);
      if(await this.active(tx,units.map(u=>u.id))) conflict('ACTIVE_BOOKINGS','Còn đơn đặt phòng có hiệu lực; chỉ được ẩn tin.');
      if(unitId) {await tx.property.update({where:{id},data:{version:{increment:1}}});return tx.homestayUnit.update({where:{id:unitId},data:{deletedAt:new Date(),version:{increment:1}},select:{id:true,version:true,deletedAt:true}});}
      return tx.property.update({where:{id},data:{deletedAt:new Date(),version:{increment:1}},select:{id:true,version:true,deletedAt:true}});
    });
  }
  async review(actorId:string,id:string,version:number,approved:boolean) {
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId}::uuid FOR SHARE`;
      if(!await tx.user.findFirst({where:{id:actorId,role:'ADMIN',status:'ACTIVE'}})) missing();
      const p=await this.propertyLock(tx,id);this.version(p.version,version);
      const revision=await tx.propertyRevision.findUnique({where:{propertyId:id}});
      const units=await tx.homestayUnit.findMany({where:{propertyId:id,deletedAt:null}});
      if(p.status!=='PENDING_REVIEW' && revision?.status!=='PENDING_REVIEW' && !units.some(u=>u.status==='PENDING_REVIEW'||u.pendingRevision)) conflict('INVALID_STATE','Không có nội dung chờ duyệt.');
      if(revision?.status==='PENDING_REVIEW') {
        if(approved) {const dto=plainToInstance(HomestayPropertyDto,revision.content);if((await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).length) conflict('INVALID_REVISION','Bản sửa không hợp lệ.');await this.content(tx,id,dto);await tx.propertyRevision.delete({where:{propertyId:id}});}
        else await tx.propertyRevision.update({where:{propertyId:id},data:{status:'REJECTED'}});
      }
      for(const u of units) {
        if(u.pendingRevision) {
          const dto=plainToInstance(HomestayUnitDto,u.pendingRevision);
          if((await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).length) conflict('INVALID_REVISION','Bản sửa phòng không hợp lệ.');
          await tx.homestayUnit.update({where:{id:u.id},data:{...(approved?unitFields(dto):{}),pendingRevision:Prisma.DbNull,version:{increment:1}}});
        } else if(u.status==='PENDING_REVIEW') await tx.homestayUnit.update({where:{id:u.id},data:{status:approved?'PUBLISHED':'REJECTED',version:{increment:1}}});
      }
      const updated=await tx.property.update({where:{id},data:{...(p.status==='PENDING_REVIEW'?{status:approved?'PUBLISHED':'REJECTED'}:{}),version:{increment:1}},select:{id:true,status:true,version:true}});
      await tx.listingModerationEvent.create({data:{actorId,propertyId:id,action:approved?'APPROVE':'REJECT',target:p.status==='PENDING_REVIEW'?'LISTING':'REVISION',reviewedVersion:p.version,resultVersion:updated.version,statusBefore:p.status,statusAfter:updated.status}});
      return updated;
    });
  }
  async detail(slug:string) {
    const p=await this.prisma.property.findFirst({where:{slug,status:'PUBLISHED',deletedAt:null,isAvailable:true,rentalMode:{in:['SHORT_TERM','HYBRID']},propertyType:{in:['HOMESTAY','VILLA']},host:{status:'ACTIVE',role:'HOST'}},
      include:{homestayUnits:{where:{status:'PUBLISHED',deletedAt:null}},images:{orderBy:{position:'asc'}},amenities:{include:{amenity:true}},ward:true}});
    if(!p || !p.homestayUnits.length) missing();
    return {id:p.id,slug:p.slug,title:p.title,description:p.description,address:{addressDetail:p.addressDetail,provinceCode:p.provinceCode,wardCode:p.wardCode,wardName:p.ward.name},
      media:p.images.map(i=>({url:i.url,sortOrder:i.position})),videoUrl:p.videoUrl,amenities:p.amenities.map(a=>({id:a.amenity.id,name:a.amenity.name})),units:p.homestayUnits.map(publicUnit)};
  }
  async search(q:HomestaySearchDto) {
    const any=[q.checkIn,q.checkOut,q.adults,q.children].some(v=>v!==undefined);
    if(any && [q.checkIn,q.checkOut,q.adults,q.children].some(v=>v===undefined)) throw new BadRequestException({errorCode:'INVALID_SEARCH_DATES',message:'Nhập đủ ngày nhận/trả phòng và số người lớn/trẻ em.'});
    return this.prisma.$transaction(async tx=>{
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const where:Prisma.HomestayUnitWhereInput={...publishedHomestayUnit,property:{...(publishedHomestayUnit.property as Prisma.PropertyWhereInput),
        ...(q.provinceCode?{provinceCode:q.provinceCode}:{}),...(q.q?{OR:[{title:{contains:q.q,mode:'insensitive'}},{addressDetail:{contains:q.q,mode:'insensitive'}}]}:{})}};
      if(any) {
        const stay=parseStay(q.checkIn!,q.checkOut!),today=vietnamToday(now);
        if(stay.totalNights>90||stay.checkIn<today) throw new BadRequestException({errorCode:'INVALID_DATE_RANGE',message:'Ngày hoặc số đêm không hợp lệ.'});
        const start=new Date(stay.checkIn),end=new Date(stay.checkOut);
        const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Ho_Chi_Minh',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(now);
        Object.assign(where,{maxAdults:{gte:q.adults},maxChildren:{gte:q.children},maxNights:{gte:stay.totalNights},AND:[{OR:[{maxGuests:null},{maxGuests:{gte:q.adults!+q.children!}}]}],
          ...(stay.checkIn===today?{instantBook:true,sameDayBookingCutoff:{gt:new Date(`1970-01-01T${localTime}Z`)}}:{}),
          calendar:{none:{date:{gte:start,lt:end},status:{not:'AVAILABLE'}}},
          bookings:{none:{checkInDate:{lt:end},checkOutDate:{gt:start},OR:[{bookingStatus:{in:['CONFIRMED','CHECKED_IN']}},{bookingStatus:{in:['PENDING_PAYMENT','PENDING_HOST_APPROVAL']},expiresAt:{gt:now}}]}}});
      }
      const total=await tx.homestayUnit.count({where});const units=await tx.homestayUnit.findMany({where,include:{property:{include:{images:{orderBy:{position:'asc'},take:1},ward:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(q.page-1)*q.limit,take:q.limit});
      return new PaginatedResult(units.map(u=>({...publicUnit(u),propertyId:u.propertyId,slug:u.property.slug,title:u.property.title,address:u.property.addressDetail,media:u.property.images.map(i=>({url:i.url,sortOrder:i.position}))})),{page:q.page,limit:q.limit,total,totalPages:Math.ceil(total/q.limit)});
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async calendarWrite(hostId:string,unitId:string,dto:HomestayCalendarPricingDto|HomestayCalendarBlockDto,key:string,rawBody:unknown) {
    const result=await this.idempotency.run(hostId,'isBlocked' in dto?'HOST_CALENDAR_BLOCK':'HOST_CALENDAR_PRICE',key,{unitId,body:rawBody},async tx=>{
      await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${unitId}::uuid FOR UPDATE`;
      const unit=await tx.homestayUnit.findFirst({where:{id:unitId,deletedAt:null,property:{hostId,deletedAt:null}}});if(!unit) missing();this.version(unit.version,dto.expectedVersion);
      for(const date of dto.dates) dateEpoch(date);
      await expireUnit(tx,unitId);
      if('isBlocked' in dto && dto.isBlocked) {
        for(const date of dto.dates) if(await tx.booking.findFirst({where:{homestayUnitId:unitId,bookingStatus:{in:['PENDING_PAYMENT','PENDING_HOST_APPROVAL','CONFIRMED','CHECKED_IN']},checkInDate:{lte:new Date(date)},checkOutDate:{gt:new Date(date)}}})) conflict('INVENTORY_CONFLICT','Không thể khóa đè đơn đặt phòng có hiệu lực.');
      }
      if('customPrice' in dto && dto.customPrice!=null && dto.customPrice<positiveIntegerEnv('BOOKING_MIN_NIGHTLY_PRICE',1)) throw new BadRequestException({errorCode:'NIGHTLY_PRICE_TOO_LOW',message:'Giá đêm chưa đạt mức tối thiểu.'});
      for(const date of dto.dates) {
        const data='isBlocked' in dto?{status:dto.isBlocked?'BLOCKED':'AVAILABLE'}:{customPrice:dto.customPrice??null};
        const existing=await tx.calendarPricing.findUnique({where:{homestayUnitId_date:{homestayUnitId:unitId,date:new Date(date)}}});
        if('isBlocked' in dto && existing?.status==='BOOKED') conflict('INVENTORY_CONFLICT','Không đổi trạng thái ngày đã đặt.');
        await tx.calendarPricing.upsert({where:{homestayUnitId_date:{homestayUnitId:unitId,date:new Date(date)}},create:{homestayUnitId:unitId,date:new Date(date),...data},update:data});
      }
      await tx.homestayUnit.update({where:{id:unitId},data:{version:{increment:1}}});
      return {status:200,body:{version:dto.expectedVersion+1,updatedDates:dto.dates}};
    });
    await this.calendar.invalidate(unitId);
    return result.body;
  }
  async hostCalendar(hostId:string,unitId:string,month:string) {
    const dates=calendarMonthDates(month),unit=await this.prisma.homestayUnit.findFirst({where:{id:unitId,deletedAt:null,property:{hostId,deletedAt:null}}});if(!unit) missing();
    const start=new Date(dates[0]),end=new Date(new Date(dates.at(-1)!).getTime()+86400000);
    const calendar=await this.prisma.calendarPricing.findMany({where:{homestayUnitId:unitId,date:{gte:start,lt:end}}});
    const bookings=await this.prisma.booking.findMany({where:{homestayUnitId:unitId,bookingStatus:{in:['PENDING_PAYMENT','PENDING_HOST_APPROVAL','CONFIRMED','CHECKED_IN']},checkInDate:{lt:end},checkOutDate:{gt:start}}});
    const now=new Date(),customPrices=new Map(calendar.filter(c=>c.customPrice!==null).map(c=>[c.date.toISOString().slice(0,10),c.customPrice!]));
    return {unitId,month,timeZone:'Asia/Ho_Chi_Minh',version:unit.version,days:dates.map(date=>{
      const c=calendar.find(c=>c.date.toISOString().slice(0,10)===date),b=bookings.find(b=>b.checkInDate<=new Date(date)&&b.checkOutDate>new Date(date)&&(!b.bookingStatus.startsWith('PENDING_')||b.expiresAt>now));
      return {date,status:b?(b.bookingStatus==='PENDING_HOST_APPROVAL'?'PENDING_HOST_APPROVAL':b.bookingStatus==='PENDING_PAYMENT'?'HELD':'BOOKED'):c?.status??'AVAILABLE',price:calculateNightPrice(date,{...unit,customPrices}).toNumber(),...(b?{bookingId:b.id}:{})};
    })};
  }
  async fees(actorId:string,unitId:string,dto:HomestayFeeDto) {
    if(process.env.NODE_ENV==='production'&&(dto.serviceFeeRate!==0||dto.taxRate!==0)) throw new ServiceUnavailableException({errorCode:'PRICING_POLICY_NOT_CONFIGURED',message:'Chưa chốt chính sách thuế trên môi trường thật.'});
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM users WHERE id=${actorId}::uuid FOR SHARE`;
      if(!await tx.user.findFirst({where:{id:actorId,role:'ADMIN',status:'ACTIVE'}})) missing();
      await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${unitId}::uuid FOR UPDATE`;
      const u=await tx.homestayUnit.findUnique({where:{id:unitId}});if(!u) missing();this.version(u.version,dto.expectedVersion);
      const oldValues={serviceFeeRate:u.serviceFeeRate.toString(),taxRate:u.taxRate.toString(),commissionRate:u.commissionRate.toString()};
      const newValues={serviceFeeRate:String(dto.serviceFeeRate),taxRate:String(dto.taxRate),commissionRate:String(dto.commissionRate)};
      await tx.$executeRaw`INSERT INTO homestay_policy_audit(unit_id,actor_id,old_values,new_values) VALUES(${unitId}::uuid,${actorId}::uuid,${JSON.stringify(oldValues)}::jsonb,${JSON.stringify(newValues)}::jsonb)`;
      return tx.homestayUnit.update({where:{id:unitId},data:{serviceFeeRate:dto.serviceFeeRate,taxRate:dto.taxRate,commissionRate:dto.commissionRate,version:{increment:1}},select:{id:true,version:true}});
    });
  }
}
