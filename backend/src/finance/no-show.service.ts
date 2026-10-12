import { BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { roomTimestamp } from '../bookings/booking-lifecycle.js';
import { verifiedPaymentSource } from './payment-source.js';
import { PaginatedResult } from '../common/paginated-result.js';
import type { NoShowReportDto,ResolveNoShowDto } from './no-show.dto.js';
const text=(v:string)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>500) throw new BadRequestException({errorCode:'INVALID_NO_SHOW_EVIDENCE',message:'Cần lý do/bằng chứng từ 1 đến 500 ký tự.'});return v.trim();};
const missing=()=>new NotFoundException({errorCode:'NO_SHOW_REPORT_NOT_FOUND',message:'Không tìm thấy báo cáo khách không đến.'});
export function assertNoShowTime(booking:{bookingStatus:string;paymentStatus:string},now:Date,checkIn:Date,checkOut:Date,resolve:boolean) {
  if(!Number.isFinite(checkIn.getTime()) || !Number.isFinite(checkOut.getTime()) || booking.bookingStatus!=='CONFIRMED' || booking.paymentStatus!=='PAID'
    || now<(resolve?checkOut:checkIn)) throw new ConflictException({errorCode:'NO_SHOW_NOT_ALLOWED',message:resolve?'Chỉ xác minh khách không đến sau giờ trả phòng, khi đơn vẫn đã trả tiền và chưa nhận phòng.':'Chỉ báo khách không đến từ giờ nhận phòng, khi đơn chưa nhận phòng và đã trả tiền.'});
}
@Injectable()
export class NoShowService {
  constructor(private readonly prisma:PrismaService,private readonly idempotency:BookingIdempotencyService) {}
  private safe(error:unknown):never {
    if(error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError)
      throw new ServiceUnavailableException({errorCode:'NO_SHOW_RECORDING_FAILED',message:'Chưa thể lưu xử lý khách không đến. Thử lại với cùng Idempotency-Key.'});
    throw error;
  }
  private async locked(tx:Prisma.TransactionClient,id:string,version:number,hostId:string|null,resolve:boolean) {
    const owned=await tx.booking.findFirst({where:{id,...(hostId?{unit:{property:{hostId}}}:{})},select:{homestayUnitId:true}});
    if(!owned) throw missing();
    await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${owned.homestayUnitId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM bookings WHERE id=${id}::uuid FOR UPDATE`;
    const booking=await tx.booking.findUniqueOrThrow({where:{id},include:{unit:{select:{property:{select:{hostId:true}}}}}});
    if(hostId && booking.unit.property.hostId!==hostId) throw missing();
    if(booking.version!==version) throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const policy=booking.policySnapshot as Record<string,Prisma.JsonValue>;
    assertNoShowTime(booking,now,roomTimestamp(booking.checkInDate.toISOString().slice(0,10),String(policy.checkInTime)),
      roomTimestamp(booking.checkOutDate.toISOString().slice(0,10),String(policy.checkOutTime)),resolve);
    return booking;
  }
  async report(hostId:string,id:string,dto:NoShowReportDto,key:string,raw:unknown) {
    const reason=text(dto.reason);
    return (await this.idempotency.run(hostId,'HOST_NO_SHOW_REPORT',key,{id,body:raw},async tx=>{
      const booking=await this.locked(tx,id,dto.expectedVersion,hostId,false);
      const existing=await tx.$queryRaw<{id:string}[]>`SELECT id FROM finance_no_show_reports WHERE booking_id=${id}::uuid`;
      if(existing.length) throw new ConflictException({errorCode:'NO_SHOW_ALREADY_REPORTED',message:'Đơn đã có báo cáo khách không đến.'});
      const [report]=await tx.$queryRaw<{id:string;reportedAt:Date}[]>`INSERT INTO finance_no_show_reports (booking_id,host_id,reason)
        VALUES (${id}::uuid,${hostId}::uuid,${reason}) RETURNING id,created_at AS "reportedAt"`;
      await tx.booking.update({where:{id},data:{version:{increment:1}}});
      return {status:201,body:{id:report.id,bookingId:id,bookingVersion:booking.version+1,reason,reportedAt:report.reportedAt.toISOString()}};
    }).catch(e=>this.safe(e))).body;
  }
  async resolve(actorId:string,id:string,dto:ResolveNoShowDto,key:string,raw:unknown) {
    const reason=text(dto.reason),evidence=text(dto.evidenceNote);
    if(dto.decision!=='NO_SHOW') throw new BadRequestException({errorCode:'INVALID_STAY_DECISION',message:'Chưa hỗ trợ quyết định này tại endpoint khách không đến.'});
    return (await this.idempotency.run(actorId,'ADMIN_NO_SHOW_RESOLVE',key,{id,body:raw},async tx=>{
      const booking=await this.locked(tx,id,dto.expectedVersion,null,true);
      const [report]=await tx.$queryRaw<{id:string;hostId:string}[]>`SELECT id,host_id AS "hostId" FROM finance_no_show_reports WHERE booking_id=${id}::uuid`;
      if(!report || report.hostId!==booking.unit.property.hostId) throw missing();
      const resolved=await tx.$queryRaw<{bookingId:string}[]>`SELECT booking_id AS "bookingId" FROM finance_no_show_resolutions WHERE booking_id=${id}::uuid`;
      if(resolved.length) throw new ConflictException({errorCode:'NO_SHOW_ALREADY_RESOLVED',message:'Báo cáo đã được xác minh.'});
      const sourceId=await verifiedPaymentSource(tx,booking,booking.unit.property.hostId);
      const other=await tx.$queryRaw<{id:string}[]>`SELECT id FROM finance_journals WHERE booking_id=${id}::uuid AND kind<>'PAYMENT' LIMIT 1`;
      if(other.length) throw new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Đơn có giao dịch khác cần đối soát trước khi xác minh khách không đến.'});
      const [resolution]=await tx.$queryRaw<{resolvedAt:Date}[]>`INSERT INTO finance_no_show_resolutions (booking_id,report_id,source_journal_id,actor_id,reason,evidence_note)
        VALUES (${id}::uuid,${report.id}::uuid,${sourceId}::uuid,${actorId}::uuid,${reason},${evidence}) RETURNING created_at AS "resolvedAt"`;
      await tx.booking.update({where:{id},data:{version:{increment:1}}});
      return {status:200,body:{bookingId:id,bookingVersion:booking.version+1,decision:'NO_SHOW',refundAmount:'0',
        resolvedAt:resolution.resolvedAt.toISOString(),holdUntil:new Date(resolution.resolvedAt.getTime()+72*3600000).toISOString()}};
    }).catch(e=>this.safe(e))).body;
  }
  async list(page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{id:string;bookingId:string;bookingVersion:number;reason:string;reportedAt:Date;resolved:boolean}[]>`SELECT r.id,r.booking_id AS "bookingId",b.version AS "bookingVersion",r.reason,r.created_at AS "reportedAt",(s.booking_id IS NOT NULL) AS resolved
        FROM finance_no_show_reports r JOIN bookings b ON b.id=r.booking_id LEFT JOIN finance_no_show_resolutions s ON s.booking_id=r.booking_id
        ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;
      const [{total}]=await tx.$queryRaw<{total:bigint}[]>`SELECT count(*) AS total FROM finance_no_show_reports`;
      return new PaginatedResult(rows.map(r=>({...r,reportedAt:r.reportedAt.toISOString()})),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit)});
    },{isolationLevel:'RepeatableRead'});
  }
  async read(id:string) {
    return this.prisma.$transaction(async tx=>{
      const [report]=await tx.$queryRaw<{id:string;bookingId:string;bookingVersion:number;reason:string;reportedAt:Date}[]>`SELECT r.id,r.booking_id AS "bookingId",b.version AS "bookingVersion",r.reason,r.created_at AS "reportedAt"
        FROM finance_no_show_reports r JOIN bookings b ON b.id=r.booking_id WHERE r.id=${id}::uuid`;
      if(!report) throw missing();
      const [resolution]=await tx.$queryRaw<{actorId:string;reason:string;evidenceNote:string;resolvedAt:Date}[]>`SELECT actor_id AS "actorId",reason,evidence_note AS "evidenceNote",created_at AS "resolvedAt" FROM finance_no_show_resolutions WHERE booking_id=${report.bookingId}::uuid`;
      return {...report,reportedAt:report.reportedAt.toISOString(),resolution:resolution?{...resolution,resolvedAt:resolution.resolvedAt.toISOString()}:null};
    },{isolationLevel:'RepeatableRead'});
  }
}
