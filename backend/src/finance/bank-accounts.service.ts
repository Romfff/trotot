import { BadRequestException,ConflictException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import type { SubmitBankDto,ReviewBankDto } from './bank-accounts.dto.js';
type BankRow={id:string;hostId:string;bankCode:string;accountNumber:string;accountName:string;status:string;createdAt:Date};
const columns=Prisma.sql`a.id,a.host_id AS "hostId",a.bank_code AS "bankCode",a.account_number AS "accountNumber",a.account_name AS "accountName",a.status,a.created_at AS "createdAt"`;
const render=(r:BankRow)=>({id:r.id,hostId:r.hostId,bankCode:r.bankCode,accountNumber:r.accountNumber,accountName:r.accountName,status:r.status,createdAt:r.createdAt.toISOString()});
type BankNotice={id:string;accountId:string;type:string;readAt:Date|null;createdAt:Date};
const noticeColumns=Prisma.sql`e.id,e.account_id AS "accountId",e.action AS type,r.read_at AS "readAt",e.created_at AS "createdAt"`;
const noticeMessage:Record<string,string>={SUBMITTED:'Bạn đã gửi tài khoản ngân hàng mới. Các khoản chưa trả chờ Admin xác minh.',VERIFIED:'Tài khoản ngân hàng đã được Admin xác minh.',REJECTED:'Tài khoản ngân hàng chưa được chấp nhận. Vui lòng kiểm tra và gửi lại thông tin.'};
const renderNotice=(r:BankNotice)=>({...r,message:noticeMessage[r.type],readAt:r.readAt?.toISOString()??null,createdAt:r.createdAt.toISOString()});
@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma:PrismaService,private readonly idempotency:BookingIdempotencyService) {}
  async notifications(hostId:string,page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<BankNotice[]>(Prisma.sql`SELECT ${noticeColumns} FROM finance_bank_events e
        JOIN finance_bank_accounts a ON a.id=e.account_id LEFT JOIN finance_bank_notification_reads r ON r.event_id=e.id
        WHERE a.host_id=${hostId}::uuid ORDER BY e.created_at DESC,e.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
      const [{total,unread}]=await tx.$queryRaw<{total:bigint;unread:bigint}[]>`SELECT count(*) AS total,count(*) FILTER (WHERE r.event_id IS NULL) AS unread
        FROM finance_bank_events e JOIN finance_bank_accounts a ON a.id=e.account_id
        LEFT JOIN finance_bank_notification_reads r ON r.event_id=e.id WHERE a.host_id=${hostId}::uuid`;
      return new PaginatedResult(rows.map(renderNotice),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit),unreadCount:Number(unread)});
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async markNotificationRead(hostId:string,id:string) {
    return this.prisma.$transaction(async tx=>{
      const [owned]=await tx.$queryRaw<{id:string}[]>`SELECT e.id FROM finance_bank_events e
        JOIN finance_bank_accounts a ON a.id=e.account_id WHERE e.id=${id}::uuid AND a.host_id=${hostId}::uuid`;
      if(!owned) throw new NotFoundException({errorCode:'NOTIFICATION_NOT_FOUND',message:'Không tìm thấy thông báo.'});
      await tx.$executeRaw`INSERT INTO finance_bank_notification_reads (event_id) VALUES (${id}::uuid) ON CONFLICT DO NOTHING`;
      const [row]=await tx.$queryRaw<BankNotice[]>(Prisma.sql`SELECT ${noticeColumns} FROM finance_bank_events e
        JOIN finance_bank_notification_reads r ON r.event_id=e.id WHERE e.id=${id}::uuid`);
      return renderNotice(row);
    });
  }
  async own(hostId:string) {
    const [row]=await this.prisma.$queryRaw<(BankRow&{version:number})[]>(Prisma.sql`SELECT ${columns},s.version FROM finance_bank_states s
      JOIN finance_bank_accounts a ON a.id=s.account_id WHERE s.host_id=${hostId}::uuid`);
    return row?{version:row.version,account:render(row),payoutReady:row.status==='VERIFIED'}:{version:0,account:null,payoutReady:false};
  }
  async read(id:string) {
    return this.prisma.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<(BankRow&{version:number;isCurrent:boolean})[]>(Prisma.sql`SELECT ${columns},s.version,(s.account_id=a.id) AS "isCurrent"
        FROM finance_bank_accounts a JOIN finance_bank_states s ON s.host_id=a.host_id WHERE a.id=${id}::uuid`);
      if(!row) throw new NotFoundException({errorCode:'BANK_ACCOUNT_NOT_FOUND',message:'Không tìm thấy tài khoản ngân hàng.'});
      const events=await tx.$queryRaw<{id:string;actorId:string;action:string;reason:string;evidenceNote:string;createdAt:Date}[]>`
        SELECT id,actor_id AS "actorId",action,reason,evidence_note AS "evidenceNote",created_at AS "createdAt" FROM finance_bank_events
        WHERE account_id=${id}::uuid ORDER BY created_at,id`;
      return {...render(row),version:row.version,isCurrent:row.isCurrent,events:events.map(e=>({...e,createdAt:e.createdAt.toISOString()}))};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async list(page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<(Omit<BankRow,'accountName'> & {version:number;isCurrent:boolean})[]>(Prisma.sql`
        SELECT a.id,a.host_id AS "hostId",a.bank_code AS "bankCode",('****'||right(a.account_number,4)) AS "accountNumber",
        a.status,a.created_at AS "createdAt",s.version,(s.account_id=a.id) AS "isCurrent"
        FROM finance_bank_accounts a JOIN finance_bank_states s ON s.host_id=a.host_id ORDER BY a.created_at DESC,a.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`);
      const [{total}]=await tx.$queryRaw<{total:bigint}[]>`SELECT count(*) AS total FROM finance_bank_accounts`;
      return new PaginatedResult(rows.map(r=>({...r,createdAt:r.createdAt.toISOString()})),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit)});
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  private safe(error:unknown):never {
    if(error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError)
      throw new ServiceUnavailableException({errorCode:'BANK_RECORDING_FAILED',message:'Chưa thể lưu thay đổi ngân hàng. Thử lại với cùng Idempotency-Key.'});
    throw error;
  }
  async submit(hostId:string,dto:SubmitBankDto,key:string,rawBody:unknown) {
    const code=dto.bankCode?.trim().toUpperCase(),number=dto.accountNumber?.trim(),name=dto.accountName?.trim();
    if(!/^[A-Z0-9_-]{1,20}$/.test(code||'') || !/^[A-Za-z0-9]{1,50}$/.test(number||'') || !name || name.length>150)
      throw new BadRequestException({errorCode:'INVALID_BANK_DETAILS',message:'Thông tin ngân hàng không hợp lệ.'});
    try {return (await this.idempotency.run(hostId,'HOST_BANK_SUBMIT',key,rawBody,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${hostId}`},0))`;
      const [state]=await tx.$queryRaw<{version:number}[]>`SELECT version FROM finance_bank_states WHERE host_id=${hostId}::uuid FOR UPDATE`;
      if((state?.version||0)!==dto.expectedVersion) throw new ConflictException({errorCode:'STALE_BANK_VERSION',message:'Thông tin ngân hàng đã thay đổi. Vui lòng tải lại.'});
      const [row]=await tx.$queryRaw<BankRow[]>(Prisma.sql`INSERT INTO finance_bank_accounts AS a (host_id,bank_code,account_number,account_name)
        VALUES (${hostId}::uuid,${code},${number},${name}) RETURNING ${columns}`);
      const version=(state?.version||0)+1;
      await tx.$executeRaw`INSERT INTO finance_bank_states (host_id,account_id,version) VALUES (${hostId}::uuid,${row.id}::uuid,${version})
        ON CONFLICT (host_id) DO UPDATE SET account_id=EXCLUDED.account_id,version=EXCLUDED.version`;
      await tx.$executeRaw`INSERT INTO finance_bank_events (account_id,actor_id,action,reason,evidence_note)
        VALUES (${row.id}::uuid,${hostId}::uuid,'SUBMITTED','Host gửi phiên bản ngân hàng mới','Chờ Admin xác minh thủ công')`;
      return {status:200,body:{version,account:render(row),payoutReady:false}};
    })).body;} catch(error) {return this.safe(error);}
  }
  async review(actorId:string,id:string,action:'VERIFY'|'REJECT',dto:ReviewBankDto,key:string,rawBody:unknown) {
    const reason=dto.reason?.trim(),evidence=dto.evidenceNote?.trim();
    if(!reason || reason.length>500 || !evidence || evidence.length>500) throw new BadRequestException({errorCode:'BANK_EVIDENCE_REQUIRED',message:'Cần lý do và bằng chứng xác minh.'});
    try {return (await this.idempotency.run(actorId,action==='VERIFY'?'ADMIN_BANK_VERIFY':'ADMIN_BANK_REJECT',key,{id,body:rawBody},async tx=>{
      const [row]=await tx.$queryRaw<BankRow[]>(Prisma.sql`SELECT ${columns} FROM finance_bank_accounts a WHERE a.id=${id}::uuid`);
      if(!row) throw new NotFoundException({errorCode:'BANK_ACCOUNT_NOT_FOUND',message:'Không tìm thấy tài khoản ngân hàng.'});
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${row.hostId}`},0))`;
      const [state]=await tx.$queryRaw<{version:number;accountId:string}[]>`SELECT version,account_id AS "accountId" FROM finance_bank_states WHERE host_id=${row.hostId}::uuid FOR UPDATE`;
      if(state.accountId!==id) throw new ConflictException({errorCode:'BANK_SUPERSEDED',message:'Host đã gửi tài khoản mới. Không thể duyệt bản cũ.'});
      if(state.version!==dto.expectedVersion) throw new ConflictException({errorCode:'STALE_BANK_VERSION',message:'Thông tin ngân hàng đã thay đổi. Vui lòng tải lại.'});
      const [current]=await tx.$queryRaw<{status:string}[]>`SELECT status FROM finance_bank_accounts WHERE id=${id}::uuid FOR UPDATE`;
      if(current.status!=='PENDING') throw new ConflictException({errorCode:'BANK_ALREADY_REVIEWED',message:'Tài khoản này đã được xử lý.'});
      const status=action==='VERIFY'?'VERIFIED':'REJECTED',version=state.version+1;
      await tx.$executeRaw`UPDATE finance_bank_accounts SET status=${status} WHERE id=${id}::uuid AND status='PENDING'`;
      await tx.$executeRaw`UPDATE finance_bank_states SET version=${version} WHERE host_id=${row.hostId}::uuid`;
      await tx.$executeRaw`INSERT INTO finance_bank_events (account_id,actor_id,action,reason,evidence_note) VALUES (${id}::uuid,${actorId}::uuid,${status},${reason},${evidence})`;
      return {status:200,body:{id,version,status,payoutReady:status==='VERIFIED'}};
    })).body;} catch(error) {return this.safe(error);}
  }
}
