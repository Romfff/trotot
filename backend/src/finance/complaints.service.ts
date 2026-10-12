import { BadRequestException,ConflictException,Injectable,Logger,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import type { CreateAdminLateRefundCaseDto,CreateComplaintDto,RespondComplaintDto,AssignComplaintDto,ResolveComplaintDto } from './complaints.dto.js';
import { FINANCE_HOLD_MS } from './payout-policy.js';
import { recordComplaintRefund,complaintBookingSnapshot } from './complaint-refund.js';
import { HomestayCalendarService } from '../homestays/homestay-calendar.service.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { settlementReview } from './settlement-review.js';
type Complaint={id:string;bookingId:string;guestId:string;hostId:string;reason:string;status:string;assigneeId:string|null;version:number;createdAt:Date;overdue:boolean};
const columns=Prisma.sql`c.id,c.booking_id AS "bookingId",c.guest_id AS "guestId",c.host_id AS "hostId",c.reason,c.status,c.assignee_id AS "assigneeId",c.version,c.created_at AS "createdAt",(c.status='OPEN' AND c.created_at+interval '7 days'<clock_timestamp()) AS overdue`;
const render=(r:Complaint)=>({id:r.id,bookingId:r.bookingId,reason:r.reason,status:r.status,assigneeId:r.assigneeId,version:r.version,createdAt:r.createdAt.toISOString(),overdue:r.overdue});
const text=(value:string)=>{const result=typeof value==='string'?value.trim():'';if(!result || result.length>500) throw new BadRequestException({errorCode:'INVALID_COMPLAINT_TEXT',message:'Nội dung cần từ 1 đến 500 ký tự.'});return result;};
const missing=()=>new NotFoundException({errorCode:'COMPLAINT_NOT_FOUND',message:'Không tìm thấy khiếu nại.'});
export function assertComplaintWindow(booking:{paymentStatus:string;bookingStatus:string;completedAt:Date|null},now:Date) {
  if(booking.paymentStatus!=='PAID' || !['CONFIRMED','CHECKED_IN','COMPLETED'].includes(booking.bookingStatus))
    throw new ConflictException({errorCode:'COMPLAINT_NOT_ALLOWED',message:'Đơn chưa đủ điều kiện mở khiếu nại.'});
  if(booking.bookingStatus==='COMPLETED' && (!booking.completedAt || now.getTime()>=booking.completedAt.getTime()+FINANCE_HOLD_MS))
    throw new ConflictException({errorCode:'COMPLAINT_WINDOW_CLOSED',message:'Đơn thiếu mốc hoàn thành hoặc đã qua thời hạn khiếu nại.'});
}
@Injectable()
export class ComplaintsService {
  private readonly logger=new Logger(ComplaintsService.name);
  constructor(private readonly prisma:PrismaService,private readonly idempotency:BookingIdempotencyService,private readonly calendar:HomestayCalendarService,private readonly bookings:BookingsService) {}
  private safe(error:unknown):never {
    if(error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError)
      throw new ServiceUnavailableException({errorCode:'COMPLAINT_RECORDING_FAILED',message:'Chưa thể lưu khiếu nại. Thử lại với cùng Idempotency-Key.'});
    throw error;
  }
  private async lockBooking(tx:Prisma.TransactionClient,id:string) {
    const initial=await tx.booking.findUnique({where:{id},select:{homestayUnitId:true}});
    if(!initial) throw missing();
    await tx.$queryRaw`SELECT id FROM homestay_units WHERE id=${initial.homestayUnitId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM bookings WHERE id=${id}::uuid FOR UPDATE`;
    return tx.booking.findUniqueOrThrow({where:{id},include:{unit:{select:{property:{select:{hostId:true}}}}}});
  }
  async create(userId:string,bookingId:string,dto:CreateComplaintDto,key:string,raw:unknown) {
    const reason=text(dto.reason);
    return (await this.idempotency.run(userId,'COMPLAINT_CREATE',key,{bookingId,body:raw},async tx=>{
      const booking=await this.lockBooking(tx,bookingId);
      if(booking.guestId!==userId) throw missing();
      if(booking.version!==dto.expectedVersion) throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      assertComplaintWindow(booking,now);
      const existing=await tx.$queryRaw<{id:string}[]>`SELECT id FROM finance_complaints WHERE booking_id=${bookingId}::uuid AND status='OPEN'`;
      if(existing.length) throw new ConflictException({errorCode:'COMPLAINT_ALREADY_OPEN',message:'Đơn đang có khiếu nại mở.'});
      const [row]=await tx.$queryRaw<Complaint[]>(Prisma.sql`WITH inserted AS (INSERT INTO finance_complaints (booking_id,guest_id,host_id,reason)
        VALUES (${bookingId}::uuid,${userId}::uuid,${booking.unit.property.hostId}::uuid,${reason}) RETURNING *) SELECT ${columns} FROM inserted c`);
      await this.event(tx,row.id,userId,'CREATED',reason);
      return {status:201,body:render(row)};
    }).catch(error=>this.safe(error))).body;
  }
  async bookingComplaints(userId:string,bookingId:string) {
    return this.prisma.$transaction(async tx=>{
      if(!await tx.booking.findFirst({where:{id:bookingId,guestId:userId},select:{id:true}})) throw missing();
      const rows=await tx.$queryRaw<Complaint[]>(Prisma.sql`SELECT ${columns} FROM finance_complaints c WHERE c.booking_id=${bookingId}::uuid ORDER BY c.created_at,c.id`);
      return Promise.all(rows.map(row=>this.detail(tx,row)));
    },{isolationLevel:'RepeatableRead'});
  }
  async createAdminLate(actorId:string,bookingId:string,dto:CreateAdminLateRefundCaseDto,key:string,raw:unknown) {
    bookingId=bookingId.toLowerCase();
    const reason=text(dto.reason),evidence=text(dto.evidenceNote);
    return (await this.idempotency.run(actorId,'ADMIN_LATE_REFUND_CREATE',key,{bookingId,body:raw},async tx=>{
      const booking=await this.lockBooking(tx,bookingId);
      if(booking.version!==dto.expectedVersion) throw new ConflictException({errorCode:'STALE_BOOKING_VERSION',message:'Đơn đã thay đổi. Vui lòng tải lại.'});
      const [{eligible}]=await tx.$queryRaw<{eligible:boolean}[]>`SELECT finance_admin_late_case_eligible(booking_status,payment_status,completed_at,clock_timestamp()) AS eligible FROM bookings WHERE id=${bookingId}::uuid`;
      if(!eligible) throw new ConflictException({errorCode:'ADMIN_LATE_REFUND_NOT_ALLOWED',message:'Hồ sơ sau hạn chỉ mở cho đơn đã hoàn thành, đã thanh toán và qua 72 giờ.'});
      const existing=await tx.$queryRaw<{id:string}[]>`SELECT id FROM finance_complaints WHERE booking_id=${bookingId}::uuid AND status='OPEN'`;
      if(existing.length) throw new ConflictException({errorCode:'COMPLAINT_ALREADY_OPEN',message:'Đơn đang có hồ sơ mở.'});
      const [row]=await tx.$queryRaw<Complaint[]>(Prisma.sql`WITH inserted AS (INSERT INTO finance_complaints (booking_id,guest_id,host_id,reason)
        VALUES (${bookingId}::uuid,${booking.guestId}::uuid,${booking.unit.property.hostId}::uuid,${reason}) RETURNING *) SELECT ${columns} FROM inserted c`);
      await this.event(tx,row.id,actorId,'CREATED',reason);
      await tx.$executeRaw`INSERT INTO finance_admin_late_cases (complaint_id,actor_id,evidence_note,booking_version_at_open)
        VALUES (${row.id}::uuid,${actorId}::uuid,${evidence},${booking.version})`;
      return {status:201,body:{...render(row),caseType:'ADMIN_LATE_REFUND',caseLabel:'Admin mở sau hạn'}};
    }).catch(error=>this.safe(error))).body;
  }
  async list(hostId:string|null,page:number,limit:number) {
    const scope=hostId?Prisma.sql`WHERE c.host_id=${hostId}::uuid`:Prisma.empty;
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Complaint[]>(Prisma.sql`SELECT ${columns} FROM finance_complaints c ${scope} ORDER BY c.created_at DESC,c.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
      const [{total}]=await tx.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT count(*) AS total FROM finance_complaints c ${scope}`);
      return new PaginatedResult(rows.map(render),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit)});
    },{isolationLevel:'RepeatableRead'});
  }
  async read(id:string,hostId:string|null) {
    return this.prisma.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<Complaint[]>(Prisma.sql`SELECT ${columns} FROM finance_complaints c WHERE c.id=${id}::uuid ${hostId?Prisma.sql`AND c.host_id=${hostId}::uuid`:Prisma.empty}`);
      if(!row) throw missing();return this.detail(tx,row,hostId===null,hostId!==null);
    },{isolationLevel:'RepeatableRead'});
  }
  private async detail(tx:Prisma.TransactionClient,row:Complaint,admin=false,hostView=false) {
    const review=row.status==='OPEN'&&(admin||hostView)?await settlementReview(tx,row.bookingId,row.hostId):null;
    const reviewFields=review?(admin?{settlementReview:review}:{settlementReviewStatus:'PENDING'}):{};
    const late=admin?await tx.$queryRaw<{actorId:string;evidenceNote:string;bookingVersionAtOpen:number;openedAt:Date}[]>`SELECT actor_id AS "actorId",evidence_note AS "evidenceNote",booking_version_at_open AS "bookingVersionAtOpen",created_at AS "openedAt" FROM finance_admin_late_cases WHERE complaint_id=${row.id}::uuid`:[];
    const events=await tx.$queryRaw<{id:string;action:string;message:string;createdAt:Date}[]>`SELECT id,action,message,created_at AS "createdAt" FROM finance_complaint_events WHERE complaint_id=${row.id}::uuid ORDER BY created_at,id`;
    const [resolution]=await tx.$queryRaw<{decision:'HOST'|'FULL_REFUND'|'PARTIAL_REFUND';reason:string;actorId:string;evidenceNote:string;resolvedAt:Date}[]>`SELECT decision,reason,actor_id AS "actorId",evidence_note AS "evidenceNote",created_at AS "resolvedAt" FROM finance_complaint_resolutions WHERE complaint_id=${row.id}::uuid`;
    const [refund]=await tx.$queryRaw<{id:string;amount:string;status:string;holdStart:Date|null}[]>`SELECT f.id,f.amount::text AS amount,f.status,a.hold_start AS "holdStart"
      FROM finance_refunds f JOIN finance_complaint_refunds a ON a.complaint_id=f.complaint_id WHERE f.complaint_id=${row.id}::uuid`;
    return {...render(row),...reviewFields,...(admin?{bookingSnapshot:await complaintBookingSnapshot(tx,row.bookingId,row.hostId)}:{}),...(late[0]?{lateCase:{...late[0],openedAt:late[0].openedAt.toISOString(),caseType:'ADMIN_LATE_REFUND',caseLabel:'Admin mở sau hạn'}}:{}),events:events.map(e=>({...e,createdAt:e.createdAt.toISOString()})),resolution:resolution?{
      decision:resolution.decision,reason:resolution.reason,resolvedAt:resolution.resolvedAt.toISOString(),
      ...(refund?{refundObligation:{id:refund.id,amount:new Prisma.Decimal(refund.amount).toFixed(0),status:refund.status},
        holdUntil:refund.holdStart?new Date(refund.holdStart.getTime()+FINANCE_HOLD_MS).toISOString():null}:{}),
      ...(admin?{actorId:resolution.actorId,evidenceNote:resolution.evidenceNote}:{}),
    }:null};
  }
  private async event(tx:Prisma.TransactionClient,id:string,actorId:string,action:string,message:string) {
    const [event]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_complaint_events (complaint_id,actor_id,action,message) VALUES (${id}::uuid,${actorId}::uuid,${action},${message}) RETURNING id`;
    return event.id;
  }
  async resolve(actorId:string,id:string,dto:ResolveComplaintDto,key:string,raw:unknown) {
    const reason=text(dto.reason),evidence=text(dto.evidenceNote);
    if(!['HOST','FULL_REFUND','PARTIAL_REFUND'].includes(dto.decision)) throw new BadRequestException({errorCode:'COMPLAINT_DECISION_NOT_SUPPORTED',message:'Quyết định khiếu nại không hợp lệ.'});
    if(dto.decision==='HOST' && (dto.allocation!==undefined || dto.expectedBookingVersion!==undefined)) throw new BadRequestException({errorCode:'INVALID_REFUND_ALLOCATION',message:'Quyết định cho Host không nhận khoản hoàn.'});
    let changedUnit:string|undefined,inventoryLock:Prisma.JsonValue|null=null;
    const result=await this.idempotency.run(actorId,'ADMIN_COMPLAINT_RESOLVE',key,{id,body:raw},async tx=>{
      const [initial]=await tx.$queryRaw<{bookingId:string;hostId:string}[]>`SELECT booking_id AS "bookingId",host_id AS "hostId" FROM finance_complaints WHERE id=${id}::uuid`;
      if(!initial) throw missing();
      if(dto.decision!=='HOST') await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${initial.hostId}`},0))`;
      const booking=await this.lockBooking(tx,initial.bookingId);
      if(booking.unit.property.hostId!==initial.hostId) throw missing();
      const [row]=await tx.$queryRaw<Complaint[]>(Prisma.sql`SELECT ${columns} FROM finance_complaints c WHERE c.id=${id}::uuid FOR UPDATE`);
      if(row.version!==dto.expectedVersion) throw new ConflictException({errorCode:'STALE_COMPLAINT_VERSION',message:'Khiếu nại đã thay đổi. Vui lòng tải lại.'});
      if(row.status!=='OPEN') throw new ConflictException({errorCode:'COMPLAINT_CLOSED',message:'Khiếu nại đã được xử lý.'});
      if(await settlementReview(tx,row.bookingId,row.hostId))throw new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Khoản đã bù và chi trả đang đối soát; chưa có contract chốt xử lý.'});
      const eventId=await this.event(tx,id,actorId,'RESOLVED',reason);
      const [resolution]=await tx.$queryRaw<{resolvedAt:Date}[]>`INSERT INTO finance_complaint_resolutions (complaint_id,event_id,actor_id,decision,version_before,reason,evidence_note)
        VALUES (${id}::uuid,${eventId}::uuid,${actorId}::uuid,${dto.decision},${row.version},${reason},${evidence}) RETURNING created_at AS "resolvedAt"`;
      const refund=dto.decision==='HOST'?null:await recordComplaintRefund(tx,booking,initial.hostId,id,actorId,dto,resolution.resolvedAt);
      if(refund?.cancelled) {changedUnit=booking.homestayUnitId;inventoryLock=booking.inventoryLock;}
      const updated=await tx.$executeRaw`UPDATE finance_complaints SET status='RESOLVED',version=version+1 WHERE id=${id}::uuid AND status='OPEN' AND version=${dto.expectedVersion}`;
      if(updated!==1) throw new ConflictException({errorCode:'STALE_COMPLAINT_VERSION',message:'Khiếu nại đã thay đổi. Vui lòng tải lại.'});
      return {status:200,body:{...render(row),status:'RESOLVED',version:row.version+1,overdue:false,
        resolution:{decision:dto.decision,reason,resolvedAt:resolution.resolvedAt.toISOString(),
          ...(refund?{refundObligation:refund.refundObligation,holdUntil:refund.holdUntil}:{})}}};
    }).catch(error=>this.safe(error));
    if(changedUnit) {
      await this.bookings.releaseLock(inventoryLock);
      await this.calendar.invalidate(changedUnit).catch(()=>this.logger.warn('Calendar invalidation delayed until TTL; booking rechecks DB.'));
    }
    return result.body;
  }
  async act(actorId:string,id:string,action:'RESPOND'|'ASSIGN',dto:RespondComplaintDto|AssignComplaintDto,key:string,raw:unknown) {
    const message=text(action==='RESPOND'?(dto as RespondComplaintDto).message:(dto as AssignComplaintDto).reason);
    return (await this.idempotency.run(actorId,action==='RESPOND'?'HOST_COMPLAINT_RESPOND':'ADMIN_COMPLAINT_ASSIGN',key,{id,body:raw},async tx=>{
      const [initial]=await tx.$queryRaw<{bookingId:string;hostId:string}[]>`SELECT booking_id AS "bookingId",host_id AS "hostId" FROM finance_complaints WHERE id=${id}::uuid`;
      if(!initial || action==='RESPOND' && initial.hostId!==actorId) throw missing();
      await this.lockBooking(tx,initial.bookingId);
      const [row]=await tx.$queryRaw<Complaint[]>(Prisma.sql`SELECT ${columns} FROM finance_complaints c WHERE c.id=${id}::uuid FOR UPDATE`);
      if(row.version!==dto.expectedVersion) throw new ConflictException({errorCode:'STALE_COMPLAINT_VERSION',message:'Khiếu nại đã thay đổi. Vui lòng tải lại.'});
      if(row.status!=='OPEN') throw new ConflictException({errorCode:'COMPLAINT_CLOSED',message:'Khiếu nại đã được xử lý.'});
      let assigneeId=row.assigneeId;
      if(action==='ASSIGN') {
        assigneeId=(dto as AssignComplaintDto).assigneeId;
        const [user]=await tx.$queryRaw<{role:string;status:string}[]>`SELECT role,status FROM users WHERE id=${assigneeId}::uuid FOR SHARE`;
        if(!user || user.role!=='ADMIN' || user.status!=='ACTIVE') throw new BadRequestException({errorCode:'INVALID_COMPLAINT_ASSIGNEE',message:'Người nhận xử lý phải là Admin đang hoạt động.'});
      }
      await tx.$executeRaw`UPDATE finance_complaints SET assignee_id=${assigneeId}::uuid,version=version+1 WHERE id=${id}::uuid AND version=${dto.expectedVersion}`;
      await this.event(tx,id,actorId,action==='RESPOND'?'RESPONDED':'ASSIGNED',message);
      return {status:200,body:{...render(row),assigneeId,version:row.version+1}};
    }).catch(error=>this.safe(error))).body;
  }
}
