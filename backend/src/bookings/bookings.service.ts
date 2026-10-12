import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redlock, { type Lock } from 'redlock';
import { Prisma, type Booking } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { BookingIdempotencyService } from './booking-idempotency.service.js';
import { HomestayAvailabilityService,publishedHomestayUnit } from '../homestays/homestay-availability.service.js';
import { HomestayCalendarService } from '../homestays/homestay-calendar.service.js';
import { signHomestayQuote,verifyHomestayQuote } from '../homestays/homestay-quote.js';
import { stayDates } from './booking-dates.js';
import { assertBookingTransition,bookingDeadline,roomTimestamp,validateBookingPrice } from './booking-lifecycle.js';
import { positiveIntegerEnv } from '../config/environment.js';
import type { HoldBookingDto } from './bookings.dto.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { calculateCancellationRefund,cancellationSnapshot } from './booking-refund.js';
import { signRefundQuote,verifyRefundQuote } from './booking-refund-quote.js';
import { recordPaidCancellation } from '../finance/paid-cancellation.js';
import { bookingPaymentStatus } from './payment-status.js';
import { assertBookingIdempotencyKey } from './booking-idempotency.js';
import { vnpaySandboxConfig } from '../payments/vnpay-config.js';
import { persistVnpaySession } from '../payments/vnpay-session.js';
import { isIP } from 'node:net';
import { readVnpayPaymentProof } from '../payments/vnpay-payment-proof.js';

export function publicBooking(b:Booking,now:Date) {
  return { bookingId:b.id,bookingCode:b.bookingCode,unitId:b.homestayUnitId,
    checkInDate:b.checkInDate.toISOString().slice(0,10),checkOutDate:b.checkOutDate.toISOString().slice(0,10),
    totalNights:b.totalNights,numAdults:b.numAdults,numChildren:b.numChildren,
    guestName:b.guestName,guestPhone:b.guestPhone,guestEmail:b.guestEmail,guestNotes:b.guestNotes,
    nightlyPrices:b.nightlyPrices,baseAmount:b.baseAmount.toNumber(),cleaningFee:b.cleaningFee.toNumber(),
    serviceFee:b.serviceFee.toNumber(),taxAmount:b.taxAmount.toNumber(),totalAmount:b.totalAmount.toNumber(),
    bookingStatus:b.bookingStatus,paymentStatus:b.paymentStatus,version:b.version,
    expiresAt:b.expiresAt.toISOString(),expiresInSeconds:Math.max(0,Math.ceil((b.expiresAt.getTime()-now.getTime())/1000)),
    serverTime:now.toISOString(),payment:null,policy:b.policySnapshot };
}
export async function expireUnit(tx:Prisma.TransactionClient,unitId:string) {
  await tx.$executeRaw`UPDATE bookings SET booking_status=CASE WHEN booking_status='PENDING_HOST_APPROVAL'
    THEN 'CANCELLED_HOST_TIMEOUT' ELSE 'CANCELLED_TIMEOUT' END,version=version+1,updated_at=clock_timestamp()
    WHERE homestay_unit_id=${unitId}::uuid AND booking_status IN ('PENDING_HOST_APPROVAL','PENDING_PAYMENT')
    AND payment_status IN ('NOT_CONFIGURED','PENDING') AND expires_at<=clock_timestamp()`;
}

@Injectable()
export class BookingsService {
  private readonly logger=new Logger(BookingsService.name);
  private readonly redlock:Redlock;
  constructor(private readonly prisma:PrismaService,private readonly redis:RedisService,
    private readonly idempotency:BookingIdempotencyService,private readonly availability:HomestayAvailabilityService,
    private readonly calendar:HomestayCalendarService) {
    // Local Redis is a single-node contention aid; exclusion in PostgreSQL remains authoritative.
    this.redlock=new Redlock([redis.client],{retryCount:0});
    this.redlock.on('error',()=>{});
  }
  private async invalidate(unitId:string) {
    try { await this.calendar.invalidate(unitId); }
    catch { this.logger.warn('Calendar invalidation failed; public cache TTL is 15 seconds, hold rechecks DB.'); }
  }
  async releaseLock(lock:Prisma.JsonValue|null) {
    if(!lock || typeof lock!=='object'||Array.isArray(lock)) return;
    const {value,resources}=lock;
    if(typeof value!=='string'||!Array.isArray(resources)) return;
    try { await Promise.all(resources.filter((r):r is string=>typeof r==='string').map(r=>this.redis.deleteIfValue(r,value))); }
    catch { this.logger.warn('Reservation lock cleanup delayed until its Redis TTL.'); }
  }
  async hold(userId:string,dto:HoldBookingDto,key:string,rawBody:unknown) {
    let acquired:Lock|undefined;
    let changedUnit:string|undefined;
    try {
        const result=await this.idempotency.run(userId,'HOLD',key,rawBody,async tx=>{
          const configured=process.env.VNPAY_SANDBOX_ENABLED==='true';
          if(configured)vnpaySandboxConfig();
          else if(process.env.NODE_ENV==='production' || process.env.BOOKING_ALLOW_UNCONFIGURED_PAYMENT!=='true')
          throw new ServiceUnavailableException({errorCode:'PAYMENT_NOT_CONFIGURED',message:'Chưa kết nối thanh toán; chỉ cho phép giữ phòng thử trong local/dev.'});
        // All inventory writers take the same unit lock before reading price/calendar/bookings.
        await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${dto.unitId}::uuid FOR UPDATE`;
        const unit=await tx.homestayUnit.findFirst({where:{...publishedHomestayUnit,id:dto.unitId},include:{property:{select:{hostId:true}}}});
        if(!unit) throw new NotFoundException({errorCode:'UNIT_NOT_FOUND',message:'Không tìm thấy phòng.'});
        if(unit.property.hostId===userId) throw new BadRequestException({errorCode:'SELF_BOOKING_NOT_ALLOWED',message:'Không thể đặt phòng của chính mình.'});
        // Freeze Host active role and listing visibility across the hold transaction.
        await tx.$queryRaw`SELECT id FROM users WHERE id=${unit.property.hostId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM properties WHERE id=${unit.propertyId}::uuid FOR SHARE`;
        await expireUnit(tx,unit.id);
        const input={unitId:unit.id,checkIn:dto.checkInDate,checkOut:dto.checkOutDate,adults:dto.numAdults,children:dto.numChildren};
        const price=await this.availability.inspectInTransaction(tx,input);
        const verification=await verifyHomestayQuote(dto.quoteToken,input,price,price.quotedAt);
        if(verification.priceChanged) throw new ConflictException({errorCode:'PRICE_CHANGED',message:'Giá đã thay đổi. Vui lòng xác nhận báo giá mới.',data:{
          isAvailable:price.isAvailable,totalNights:price.totalNights,...await signHomestayQuote(input,price,price.quotedAt),
          priceBreakdown:{nightlyPrices:price.nightlyPrices.map(n=>({date:n.date,price:n.price.toNumber()})),baseAmount:price.baseAmount.toNumber(),
            cleaningFee:price.cleaningFee.toNumber(),serviceFee:price.serviceFee.toNumber(),taxAmount:price.taxAmount.toNumber(),totalAmount:price.totalAmount.toNumber()},
        }});
          validateBookingPrice(price,positiveIntegerEnv('BOOKING_MIN_NIGHTLY_PRICE',1));
          if(configured && price.totalAmount.gt('9999999999'))throw new BadRequestException({errorCode:'PAYMENT_AMOUNT_UNSUPPORTED',message:'Số tiền vượt giới hạn VNPay Sandbox.'});
        if(!price.isAvailable) throw new ConflictException({errorCode:'ROOM_ALREADY_LOCKED',message:'Phòng không còn trống trong thời gian đã chọn.'});
        const checkInTime=unit.checkInTime.toISOString().slice(11,19),checkOutTime=unit.checkOutTime.toISOString().slice(11,19);
        const expiresAt=bookingDeadline(price.quotedAt,unit.instantBook,input.checkIn,checkInTime);
        // Release old expired ownership tokens before acquiring per-night resources.
        const expired=await tx.booking.findMany({where:{homestayUnitId:unit.id,checkInDate:{lt:new Date(input.checkOut)},checkOutDate:{gt:new Date(input.checkIn)},bookingStatus:{in:['CANCELLED_TIMEOUT','CANCELLED_HOST_TIMEOUT']},inventoryLock:{not:Prisma.DbNull}},select:{inventoryLock:true}});
        for(const old of expired) await this.releaseLock(old.inventoryLock);
        const resources=[...stayDates(input.checkIn,input.checkOut)].map(date=>`booking:night:${unit.id}:${date}`);
        try { acquired=await this.redlock.acquire(resources,Math.max(1000,expiresAt.getTime()-price.quotedAt.getTime())); }
        catch { throw new ConflictException({errorCode:'ROOM_ALREADY_LOCKED',message:'Phòng đang được giữ chỗ. Vui lòng thử lại.'}); }
        const booking=await tx.booking.create({data:{
          bookingCode:`BK-${randomUUID().replaceAll('-','').slice(0,24).toUpperCase()}`,homestayUnitId:unit.id,guestId:userId,
          checkInDate:new Date(input.checkIn),checkOutDate:new Date(input.checkOut),totalNights:price.totalNights,
          numAdults:dto.numAdults,numChildren:dto.numChildren,guestName:dto.guestName,guestPhone:dto.guestPhone,guestEmail:dto.guestEmail,guestNotes:dto.guestNotes,
          nightlyPrices:price.nightlyPrices.map(n=>({date:n.date,price:n.price.toString()})),
          policySnapshot:{cancellationPolicy:unit.cancellationPolicy,instantBook:unit.instantBook,checkInTime,checkOutTime,maxNights:unit.maxNights,
            maxAdults:unit.maxAdults,maxChildren:unit.maxChildren,maxGuests:unit.maxGuests,sameDayBookingCutoff:unit.sameDayBookingCutoff.toISOString().slice(11,19)},
          inventoryLock:{value:acquired.value,resources},baseAmount:price.baseAmount,cleaningFee:price.cleaningFee,
          serviceFee:price.serviceFee,taxAmount:price.taxAmount,totalAmount:price.totalAmount,
          ...price.rates,commissionAmount:price.commissionAmount,hostPayoutAmount:price.hostPayoutAmount,
            bookingStatus:unit.instantBook?'PENDING_PAYMENT':'PENDING_HOST_APPROVAL',paymentStatus:configured?'PENDING':'NOT_CONFIGURED',expiresAt,
        }});
        changedUnit=unit.id;
        return {status:201,body:JSON.parse(JSON.stringify(publicBooking(booking,price.quotedAt))) as Prisma.InputJsonObject};
      });
      if(changedUnit) await this.invalidate(changedUnit);
      return result.body;
    } catch(error) {
      if(acquired) await acquired.release().catch(()=>undefined);
      if(error instanceof Prisma.PrismaClientKnownRequestError && (error.code==='P2004'||error.code==='P2002'))
        throw new ConflictException({errorCode:'ROOM_ALREADY_LOCKED',message:'Phòng đã được giữ bởi yêu cầu khác.'});
      throw error;
    }
  }
  async action(userId:string,id:string,action:'accept'|'reject'|'cancel'|'check-in'|'complete',version:number,key:string,rawBody:unknown) {
    const operations={accept:'HOST_ACCEPT',reject:'HOST_REJECT',cancel:'GUEST_CANCEL','check-in':'HOST_CHECK_IN',complete:'HOST_COMPLETE'} as const;
    let unitId:string|undefined,release:Prisma.JsonValue|null=null;
    const result=await this.idempotency.run(userId,operations[action],key,{id,body:rawBody},async tx=>{
      const owned=await tx.booking.findFirst({where:{id,...(action==='cancel'?{guestId:userId}:{unit:{property:{hostId:userId}}})}});
      if(!owned) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
      await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${owned.homestayUnitId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM bookings WHERE id=${id}::uuid FOR UPDATE`;
      const booking=await tx.booking.findUniqueOrThrow({where:{id}});
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const policy=booking.policySnapshot as Record<string,Prisma.JsonValue>;
      const checkIn=roomTimestamp(booking.checkInDate.toISOString().slice(0,10),String(policy.checkInTime));
      const checkOut=roomTimestamp(booking.checkOutDate.toISOString().slice(0,10),String(policy.checkOutTime));
      assertBookingTransition(booking,action,version,now,checkIn,checkOut);
      const next={accept:'PENDING_PAYMENT',reject:'REJECTED_BY_HOST',cancel:'CANCELLED_BY_GUEST','check-in':'CHECKED_IN',complete:'COMPLETED'}[action];
      const expiresAt=action==='accept'?bookingDeadline(now,false,booking.checkInDate.toISOString().slice(0,10),String(policy.checkInTime),true):booking.expiresAt;
      const updated=await tx.booking.update({where:{id},data:{bookingStatus:next,expiresAt,version:{increment:1}}});
      unitId=booking.homestayUnitId;
      if(['reject','cancel','complete'].includes(action)) release=booking.inventoryLock;
      return {status:200,body:JSON.parse(JSON.stringify(publicBooking(updated,now))) as Prisma.InputJsonObject};
    });
    if(unitId) {await this.releaseLock(release);await this.invalidate(unitId);}
    return result.body;
  }
  async refundQuote(userId:string,id:string) {
    return this.prisma.$transaction(async tx => {
      const booking=await tx.booking.findFirst({where:{id,guestId:userId}});
      if(!booking) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
      if(booking.paymentStatus!=='PAID' || booking.bookingStatus!=='CONFIRMED')
        throw new ConflictException({errorCode:'PAID_CANCELLATION_NOT_ALLOWED',message:'Đơn chưa đủ điều kiện tự hủy có hoàn tiền.'});
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const snapshot=cancellationSnapshot(booking);
      const refund=calculateCancellationRefund(snapshot,'GUEST',now);
      return signRefundQuote({userId,bookingId:id,version:booking.version},snapshot,refund,now);
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async cancelPaid(userId:string,id:string,actor:'GUEST'|'HOST',version:number,key:string,rawBody:unknown,token?:string,reason?:string) {
    const explanation=reason?.trim() || (actor==='GUEST'?'Khách hủy đơn trước giờ nhận phòng':'');
    if(!explanation || explanation.length>500) throw new BadRequestException({errorCode:'INVALID_CANCELLATION_REASON',message:'Vui lòng nhập lý do hủy (tối đa 500 ký tự).'});
    let unitId:string|undefined,release:Prisma.JsonValue|null=null;
    const result=await this.idempotency.run(userId,actor==='HOST'?'HOST_CANCEL_PAID':'GUEST_CANCEL_PAID',key,{id,body:rawBody},async tx=>{
      const owned=await tx.booking.findFirst({where:{id,...(actor==='GUEST'?{guestId:userId}:{unit:{property:{hostId:userId}}})}});
      if(!owned) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
      await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${owned.homestayUnitId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM bookings WHERE id=${id}::uuid FOR UPDATE`;
      const booking=await tx.booking.findUniqueOrThrow({where:{id},include:{unit:{select:{property:{select:{hostId:true}}}}}});
      if(actor==='HOST' && booking.unit.property.hostId!==userId)
        throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
      if(booking.version!==version) throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
      if(booking.paymentStatus!=='PAID' || booking.bookingStatus!=='CONFIRMED')
        throw new ConflictException({errorCode:'PAID_CANCELLATION_NOT_ALLOWED',message:'Đơn chưa đủ điều kiện tự hủy có hoàn tiền.'});
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const snapshot=cancellationSnapshot(booking),refund=calculateCancellationRefund(snapshot,actor,now);
      const binding={userId,bookingId:id,version:booking.version};
      if(actor==='GUEST' && (await verifyRefundQuote(token!,binding,snapshot,refund,now)).refundChanged)
        throw new ConflictException({errorCode:'REFUND_QUOTE_CHANGED',message:'Số tiền hoàn đã thay đổi. Vui lòng xác nhận lại.',
          data:await signRefundQuote(binding,snapshot,refund,now)});
      const obligation=await recordPaidCancellation(tx,booking,booking.unit.property.hostId,userId,actor,explanation,refund);
      const updated=await tx.booking.update({where:{id,version,bookingStatus:'CONFIRMED',paymentStatus:'PAID'},
        data:{bookingStatus:actor==='GUEST'?'CANCELLED_BY_GUEST':'CANCELLED',version:{increment:1}}});
      unitId=booking.homestayUnitId;release=booking.inventoryLock;
      return {status:200,body:JSON.parse(JSON.stringify({booking:publicBooking(updated,now),refundObligation:obligation,
        message:'Đã hủy đơn. Khoản hoàn (nếu có) đang chờ Admin xử lý, chưa chuyển trả.'})) as Prisma.InputJsonObject};
    });
    if(unitId) {await this.releaseLock(release);await this.invalidate(unitId);}
    return result.body;
  }
  async read(userId:string,id:string,host=false) {
    const booking=await this.prisma.booking.findFirst({where:{id,...(host?{unit:{property:{hostId:userId}}}:{guestId:userId})}});
    if(!booking) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
    const [{now}]=await this.prisma.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    return publicBooking(booking,now);
  }
  async paymentStatus(userId:string,id:string) {
    return this.prisma.$transaction(async tx=>{
      const booking=await tx.booking.findFirst({where:{id,guestId:userId}});
      if(!booking) throw new NotFoundException({errorCode:'BOOKING_NOT_FOUND',message:'Không tìm thấy đơn.'});
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      let providerConnected=false;
      try {vnpaySandboxConfig();providerConnected=true;}catch(error){if(!(error instanceof ServiceUnavailableException))throw error;}
      return {...bookingPaymentStatus(booking,now),providerConnected,payment:await readVnpayPaymentProof(tx,booking)};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async paymentSession(userId:string,id:string,create?:{version:number;key:string},clientIp?:string) {
    if(create) assertBookingIdempotencyKey(create.key);
    const status=await this.paymentStatus(userId,id);
    if(create && process.env.VNPAY_SANDBOX_ENABLED!=='true' && status.version!==create.version) throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
    const config=vnpaySandboxConfig();
    if(!clientIp || !isIP(clientIp))throw new ServiceUnavailableException({errorCode:'PAYMENT_CLIENT_IP_UNAVAILABLE',message:'Chưa có IP khách đã xác minh để tạo liên kết thanh toán.'});
    const result=(session:Awaited<ReturnType<typeof persistVnpaySession>>)=>({provider:'VNPAY_SANDBOX' as const,mode:'REDIRECT' as const,...session});
    if(!create)return this.prisma.$transaction(async tx=>result(await persistVnpaySession(tx,userId,id,status.version,config,clientIp,true)));
    const response=await this.idempotency.run(userId,'PAYMENT_SESSION',create.key,{id,expectedVersion:create.version},async tx=>({status:200,
      body:result(await persistVnpaySession(tx,userId,id,create.version,config,clientIp))}));
    return response.body;
  }
  async list(userId:string,page:number,limit:number,host=false) {
    const where:Prisma.BookingWhereInput=host?{unit:{property:{hostId:userId}}}:{guestId:userId};
    const [rows,total]=await this.prisma.$transaction([this.prisma.booking.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*limit,take:limit}),this.prisma.booking.count({where})],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
    const now=new Date();
    return new PaginatedResult(rows.map(b=>publicBooking(b,now)),{page,limit,total,totalPages:Math.ceil(total/limit)});
  }
}
