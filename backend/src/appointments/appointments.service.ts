import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ViewingAppointment } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { bookingRequestHash, BOOKING_IDEMPOTENCY_MS } from '../bookings/booking-idempotency.js';
import { appointmentPolicy, appointmentTimestamp, appointmentTransition, validateAppointmentTime, type AppointmentAction } from './appointment-policy.js';
import type { AppointmentActionDto, AppointmentPageDto, CreateAppointmentDto } from './appointments.dto.js';
import type { ListingsPageDto } from '../listings/listings.dto.js';

const include = {property:{select:{title:true,hostId:true}}} as const;
type Row = ViewingAppointment & {property:{title:string;hostId:string}};
const missing = () => new NotFoundException({errorCode:'APPOINTMENT_NOT_FOUND',message:'Không tìm thấy lịch hẹn.'});
const stale = (status:string) => new ConflictException({errorCode:'STALE_APPOINTMENT_STATUS',message:'Lịch hẹn đã đổi trạng thái. Hãy tải lại.',data:{currentStatus:status}});

function display(row:Row,host=false,simultaneousAppointments=0) {
  return {id:row.id,propertyId:row.propertyId,title:row.property.title,
    scheduledDate:row.scheduledDate.toISOString().slice(0,10),scheduledTime:row.scheduledTime.toISOString().slice(11,19),
    status:row.status,reason:row.reason,notes:row.notes,cancelledBy:row.cancelledBy,
    createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString(),
    ...(host?{tenantName:row.tenantName,tenantPhone:row.tenantPhone,simultaneousAppointments}:{})};
}

@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma:PrismaService) {}
  private async now(tx:Prisma.TransactionClient) {return (await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now;}
  private async actor(tx:Prisma.TransactionClient,id:string,role:string,exclusive=false) {
    const rows=exclusive ? await tx.$queryRaw<{role:string;status:string}[]>`SELECT role,status FROM users WHERE id=${id}::uuid FOR UPDATE`
      : await tx.$queryRaw<{role:string;status:string}[]>`SELECT role,status FROM users WHERE id=${id}::uuid FOR SHARE`;
    if (!rows[0] || rows[0].role!==role || rows[0].status!=='ACTIVE') throw new ForbiddenException({errorCode:'APPOINTMENT_ACTOR_NOT_ALLOWED',message:'Tài khoản không được thực hiện thao tác này.'});
  }
  private async notify(tx:Prisma.TransactionClient,row:Row,type:string,recipientId:string) {
    const messages:Record<string,string>={CREATED:'Có yêu cầu xem phòng mới.',ACCEPTED:'Chủ nhà đã xác nhận lịch xem phòng.',REJECTED:'Chủ nhà đã từ chối lịch xem phòng.',
      TENANT_CANCELLED:'Khách đã hủy lịch xem phòng.',HOST_CANCELLED:'Chủ nhà đã hủy lịch xem phòng.',COMPLETED:'Lịch xem phòng đã hoàn thành.',SYSTEM_CANCELLED:'Lịch xem phòng đã hủy do chủ nhà không phản hồi.'};
    // Fixed text avoids leaking guest contact/notes or phone numbers entered in listing titles.
    await tx.appointmentNotification.create({data:{recipientId,appointmentId:row.id,type,message:messages[type]}});
  }
  async create(userId:string,dto:CreateAppointmentDto,key:string,rawBody:unknown) {
    if (typeof key!=='string' || !/^[\x21-\x7e]{1,128}$/.test(key)) throw new BadRequestException({errorCode:'INVALID_IDEMPOTENCY_KEY',message:'Idempotency-Key không hợp lệ.'});
    const requestHash=bookingRequestHash(rawBody),operation='POST /appointments';
    try {return await this.prisma.$transaction(async tx=>{
      const scope=JSON.stringify([userId,operation,key]);
      const [{locked}]=await tx.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${scope},0)) AS locked`;
      if(!locked) throw new ConflictException({errorCode:'IDEMPOTENCY_IN_PROGRESS',message:'Yêu cầu này đang được xử lý. Vui lòng thử lại với cùng khóa.'});
      // Serialize all creates by this Tenant, then by listing: both quotas remain correct under concurrency.
      await this.actor(tx,userId,'TENANT',true);
      const now=await this.now(tx);
      const existing=await tx.appointmentIdempotency.findUnique({where:{userId_operation_key:{userId,operation,key}}});
      if(existing && existing.expiresAt>now) {
        if(existing.requestHash!==requestHash) throw new ConflictException({errorCode:'IDEMPOTENCY_KEY_REUSED',message:'Idempotency-Key đã dùng cho nội dung khác.'});
        return existing.responseBody;
      }
      if(existing) await tx.appointmentIdempotency.delete({where:{id:existing.id}});
      const candidate=await tx.property.findUnique({where:{id:dto.propertyId},select:{hostId:true}});
      if(!candidate) throw new NotFoundException({errorCode:'PROPERTY_NOT_FOUND',message:'Không tìm thấy tin trọ.'});
      await tx.$queryRaw`SELECT id FROM users WHERE id=${candidate.hostId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM properties WHERE id=${dto.propertyId}::uuid FOR UPDATE`;
      const property=await tx.property.findFirst({where:{id:dto.propertyId,rentalMode:'LONG_TERM',status:'PUBLISHED',deletedAt:null,isAvailable:true,host:{role:'HOST',status:'ACTIVE'}}});
      if(!property) throw new ConflictException({errorCode:'PROPERTY_NOT_ACCEPTING_APPOINTMENTS',message:'Tin này hiện không nhận lịch xem phòng.'});
      if(property.hostId===userId) throw new BadRequestException({errorCode:'SELF_APPOINTMENT_NOT_ALLOWED',message:'Không thể hẹn xem tin của chính mình.'});
      validateAppointmentTime(dto.scheduledDate,dto.scheduledTime,await this.now(tx));
      if(await tx.viewingAppointment.count({where:{tenantId:userId,propertyId:property.id,status:{in:['PENDING','ACCEPTED']}}}))
        throw new ConflictException({errorCode:'APPOINTMENT_ALREADY_EXISTS',message:'Bạn đã có lịch đang chờ hoặc đã xác nhận cho tin này.'});
      const policy=appointmentPolicy();
      if(await tx.viewingAppointment.count({where:{tenantId:userId,status:'PENDING'}})>=policy.tenantPending)
        throw new ConflictException({errorCode:'TENANT_APPOINTMENT_LIMIT',message:'Bạn đã đạt giới hạn lịch đang chờ.'});
      if(await tx.viewingAppointment.count({where:{propertyId:property.id,status:'PENDING'}})>=policy.propertyPending)
        throw new ConflictException({errorCode:'PROPERTY_APPOINTMENT_LIMIT',message:'Tin này đã đạt giới hạn lịch đang chờ.'});
      const row=await tx.viewingAppointment.create({data:{propertyId:property.id,tenantId:userId,tenantName:dto.tenantName,tenantPhone:dto.tenantPhone,
        scheduledDate:new Date(dto.scheduledDate),scheduledTime:new Date(`1970-01-01T${dto.scheduledTime}Z`),notes:dto.notes},include});
      await this.notify(tx,row,'CREATED',property.hostId);
      const response=JSON.parse(JSON.stringify(display(row))) as Prisma.InputJsonObject;
      await tx.appointmentIdempotency.create({data:{userId,operation,key,requestHash,responseBody:response,expiresAt:new Date((await this.now(tx)).getTime()+BOOKING_IDEMPOTENCY_MS)}});
      return response;
    },{maxWait:15000,timeout:15000});} catch(error) {
      if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==='P2002') throw new ConflictException({errorCode:'APPOINTMENT_ALREADY_EXISTS',message:'Bạn đã có lịch đang hoạt động cho tin này.'});
      throw error;
    }
  }
  async action(userId:string,id:string,action:AppointmentAction,dto:AppointmentActionDto,host=false) {
    if(host && action==='cancel' && !dto.reason?.trim()) throw new BadRequestException({errorCode:'CANCELLATION_REASON_REQUIRED',message:'Chủ nhà cần nhập lý do hủy.'});
    return this.prisma.$transaction(async tx=>{
      await this.actor(tx,userId,host?'HOST':'TENANT');
      const owned=await tx.viewingAppointment.findFirst({where:{id,...(host?{property:{hostId:userId}}:{tenantId:userId})},include});
      if(!owned) throw missing();
      // Match listing hide/delete lock order; old appointments still work on hidden listings.
      await tx.$queryRaw`SELECT id FROM properties WHERE id=${owned.propertyId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM viewing_appointments WHERE id=${id}::uuid FOR UPDATE`;
      const row=await tx.viewingAppointment.findUniqueOrThrow({where:{id},include});
      const now=await this.now(tx),at=appointmentTimestamp(row.scheduledDate.toISOString().slice(0,10),row.scheduledTime.toISOString().slice(11,19));
      const status=appointmentTransition(row.status,dto.expectedStatus,action,host,at,now,dto.reason);
      const update=await tx.viewingAppointment.updateMany({where:{id,status:dto.expectedStatus},data:{status,reason:dto.reason?.trim()||null,cancelledBy:action==='cancel'?(host?'HOST':'TENANT'):null}});
      if(update.count!==1) throw stale((await tx.viewingAppointment.findUniqueOrThrow({where:{id}})).status);
      const updated=await tx.viewingAppointment.findUniqueOrThrow({where:{id},include});
      await this.notify(tx,updated,action==='cancel'?(host?'HOST_CANCELLED':'TENANT_CANCELLED'):status,host?row.tenantId:row.property.hostId);
      return display(updated,host,host?await this.collisions(tx,updated):0);
    },{maxWait:15000,timeout:15000});
  }
  private collisions(tx:Prisma.TransactionClient,row:Row) {
    return tx.viewingAppointment.count({where:{id:{not:row.id},propertyId:row.propertyId,scheduledDate:row.scheduledDate,scheduledTime:row.scheduledTime,status:{in:['PENDING','ACCEPTED']}}});
  }
  async read(userId:string,id:string,host=false) {
    return this.prisma.$transaction(async tx=>{
      const row=await tx.viewingAppointment.findFirst({where:{id,...(host?{property:{hostId:userId}}:{tenantId:userId})},include});
      if(!row) throw missing();
      return display(row,host,host?await this.collisions(tx,row):0);
    },{isolationLevel:'RepeatableRead'});
  }
  async list(userId:string,query:AppointmentPageDto,host=false) {
    return this.prisma.$transaction(async tx=>{
      const where={...(host?{property:{hostId:userId}}:{tenantId:userId}),...(query.status?{status:query.status}:{})};
      const total=await tx.viewingAppointment.count({where});
      const rows=await tx.viewingAppointment.findMany({where,include,orderBy:[{scheduledDate:'asc'},{scheduledTime:'asc'},{id:'asc'}],skip:(query.page-1)*query.limit,take:query.limit});
      const data=await Promise.all(rows.map(async row=>display(row,host,host?await this.collisions(tx,row):0)));
      return new PaginatedResult(data,{page:query.page,limit:query.limit,total,totalPages:Math.ceil(total/query.limit)});
    },{isolationLevel:'RepeatableRead'});
  }
  async notifications(userId:string,query:ListingsPageDto) {
    return this.prisma.$transaction(async tx=>{
      const where={recipientId:userId},total=await tx.appointmentNotification.count({where});
      const unreadCount=await tx.appointmentNotification.count({where:{...where,readAt:null}});
      const data=await tx.appointmentNotification.findMany({where,select:{id:true,appointmentId:true,type:true,message:true,readAt:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:query.limit,skip:(query.page-1)*query.limit});
      return new PaginatedResult(data,{page:query.page,limit:query.limit,total,totalPages:Math.ceil(total/query.limit),unreadCount});
    },{isolationLevel:'RepeatableRead'});
  }
  async markRead(userId:string,id:string) {
    return this.prisma.$transaction(async tx=>{
      if(!await tx.appointmentNotification.findFirst({where:{id,recipientId:userId}})) throw new NotFoundException({errorCode:'NOTIFICATION_NOT_FOUND',message:'Không tìm thấy thông báo.'});
      await tx.appointmentNotification.updateMany({where:{id,recipientId:userId,readAt:null},data:{readAt:await this.now(tx)}});
      return tx.appointmentNotification.findUniqueOrThrow({where:{id},select:{id:true,appointmentId:true,type:true,message:true,readAt:true,createdAt:true}});
    });
  }
  async expirePending():Promise<number> {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM viewing_appointments WHERE status='PENDING'
        AND (scheduled_date+scheduled_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'<=clock_timestamp()
        ORDER BY scheduled_date,scheduled_time,id LIMIT 100 FOR UPDATE SKIP LOCKED`;
      for(const {id} of rows) {
        const changed=await tx.viewingAppointment.updateMany({where:{id,status:'PENDING'},data:{status:'CANCELLED',reason:'chủ nhà không phản hồi',cancelledBy:'SYSTEM'}});
        if(changed.count===1) {const row=await tx.viewingAppointment.findUniqueOrThrow({where:{id},include});await this.notify(tx,row,'SYSTEM_CANCELLED',row.tenantId);}
      }
      return rows.length;
    },{maxWait:15000,timeout:15000});
  }
}
