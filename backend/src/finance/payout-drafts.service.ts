import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { persistPayoutDraft, cancelPayoutDraft, approvePayoutDraft } from './payout-drafts.js';
import { meetsPayoutThreshold, weeklyPayoutCutoff } from './payout-policy.js';
import type { CreatePayoutDraftDto, CancelPayoutDraftDto } from './payout-drafts.dto.js';
import { payoutCsv } from './payout-csv.js';
import { recordManualPayout, type PayoutTransferEvidence } from './payout-manual-proof.js';

@Injectable()
export class PayoutDraftsService {
  constructor(private readonly prisma: PrismaService, private readonly idempotency: BookingIdempotencyService) {}
  private safe(error: unknown, operation:'write'|'export'|'confirm'='write'): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientInitializationError)
      throw new ServiceUnavailableException(operation==='export'
        ? {errorCode:'PAYOUT_EXPORT_FAILED',message:'Chưa thể xuất lô. Vui lòng thử lại.'}
        : operation==='confirm' ? {errorCode:'PAYOUT_RECORDING_FAILED',message:'Chưa có kết quả ghi sổ. Thử lại với cùng Idempotency-Key; không chuyển tiền ngân hàng lần nữa.'}
        : { errorCode: 'PAYOUT_RECORDING_FAILED', message: 'Chưa thể lưu lô. Thử lại với cùng Idempotency-Key.' });
    throw error;
  }
  async create(actorId: string, dto: CreatePayoutDraftDto, key: string, raw: unknown) {
    const hostId=dto.hostId.toLowerCase(); // UUID spellings must share the bank lock; raw idempotency body stays untouched.
    return (await this.idempotency.run(actorId, 'ADMIN_PAYOUT_DRAFT', key, raw, async tx => {
      const host = await tx.user.findUnique({ where: { id: hostId }, select: { id: true } });
      if (!host) throw new NotFoundException({ errorCode: 'PAYOUT_HOST_NOT_FOUND', message: 'Không tìm thấy chủ khoản chi trả.' });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${hostId}`},0))`;
      const [{ debt }] = await tx.$queryRaw<{ debt: boolean }[]>`SELECT EXISTS(SELECT 1 FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id
        WHERE j.host_id=${hostId}::uuid AND (e.account='HOST_DEBT' OR j.kind='ADJUSTMENT'
          OR (j.kind='PAYOUT' AND NOT finance_payout_journal_verified(j.id)))) AS debt`;
      if (debt) throw new ConflictException({ errorCode: 'FINANCIAL_REVIEW_REQUIRED', message: 'Công nợ cần có chứng cứ bù trừ trước khi lập lô.' });
      // ponytail: lock own units in stable order; narrow to candidate units if Host inventory scale makes contention measurable.
      await tx.$queryRaw`SELECT u.id FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE p.host_id=${hostId}::uuid ORDER BY u.id FOR UPDATE OF u`;
      const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const cutoff = weeklyPayoutCutoff(now);
      const rows = await tx.$queryRaw<{ bookingId: string; sourceJournalId: string; amount: string; eligibleAt: Date }[]>`
        WITH candidates AS (
          SELECT b.id,finance_payout_hold_start(b.id)+interval '72 hours' AS eligible_at
          FROM bookings b JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
          WHERE p.host_id=${hostId}::uuid AND b.payment_status IN('PAID','REFUNDED')
            AND NOT EXISTS(SELECT 1 FROM finance_complaints c WHERE c.booking_id=b.id AND c.status='OPEN')
            AND NOT EXISTS(SELECT 1 FROM finance_payout_items i WHERE i.booking_id=b.id AND i.status='ACTIVE')
        ) SELECT c.id AS "bookingId",j.id AS "sourceJournalId",c.eligible_at AS "eligibleAt",
          (SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0)::text
            FROM finance_entries e JOIN finance_journals l ON l.id=e.journal_id WHERE l.booking_id=c.id AND e.account='HOST_PAYABLE') AS amount
          FROM candidates c JOIN finance_journals j ON j.booking_id=c.id AND j.kind='PAYMENT'
          WHERE c.eligible_at<=${cutoff} ORDER BY c.eligible_at,c.id`;
      const items = rows.filter(row => new Prisma.Decimal(row.amount).gt(0));
      if (rows.some(row=>new Prisma.Decimal(row.amount).lt(0)) || new Set(rows.map(row=>row.bookingId)).size!==rows.length)
        throw new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Nguồn tiền trùng hoặc số dư âm cần được đối soát.'});
      if (!items.length) throw new ConflictException({ errorCode: 'PAYOUT_NO_ELIGIBLE_ITEMS', message: 'Chưa có khoản đủ điều kiện và chưa được phân bổ ở cutoff tuần này.' });
      const total = items.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)).toFixed(0);
      if(new Prisma.Decimal(total).gte('1000000000000000000')) throw new BadRequestException({errorCode:'PAYOUT_AMOUNT_TOO_LARGE',message:'Tổng tiền vượt giới hạn sổ.'});
      if (!meetsPayoutThreshold(total, items[0].eligibleAt, cutoff)) throw new ConflictException({ errorCode: 'PAYOUT_BELOW_THRESHOLD', message: 'Số tiền dưới ngưỡng chi trả và chưa tới ngoại lệ 60 ngày.' });
      return { status: 201, body: await persistPayoutDraft(tx, hostId, actorId, cutoff, dto.reason, items) };
    }).catch(error => this.safe(error))).body;
  }
  async cancel(actorId: string, id: string, dto: CancelPayoutDraftDto, key: string, raw: unknown) {
    id=id.toLowerCase(); // The route UUID identifies one batch regardless of spelling; preserve raw body.
    return (await this.idempotency.run(actorId, 'ADMIN_PAYOUT_CANCEL', key, { id, body: raw }, async tx => {
      const initial = await tx.financePayoutBatch.findUnique({ where: { id }, select: { hostId: true } });
      if (!initial) throw new NotFoundException({ errorCode: 'PAYOUT_NOT_FOUND', message: 'Không tìm thấy lô chi trả.' });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${initial.hostId}`},0))`;
      await tx.$queryRaw`SELECT u.id FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE p.host_id=${initial.hostId}::uuid ORDER BY u.id FOR UPDATE OF u`;
      await tx.$queryRaw`SELECT b.id FROM bookings b JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id WHERE p.host_id=${initial.hostId}::uuid ORDER BY b.id FOR UPDATE OF b`;
      return { status: 200, body: await cancelPayoutDraft(tx, actorId, id, dto.expectedVersion, dto.reason) };
    }).catch(error => this.safe(error))).body;
  }
  async approve(actorId: string, id: string, dto: CancelPayoutDraftDto, key: string, raw: unknown) {
    id=id.toLowerCase();
    return (await this.idempotency.run(actorId,'ADMIN_PAYOUT_APPROVE',key,{id,body:raw},async tx=>{
      const initial=await tx.financePayoutBatch.findUnique({where:{id},select:{hostId:true}});
      if (!initial) throw new NotFoundException({errorCode:'PAYOUT_NOT_FOUND',message:'Không tìm thấy lô chi trả.'});
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${initial.hostId}`},0))`;
      // Same order as creation and booking/complaint mutations; prevent late
      // refund or complaint writes from racing this approval snapshot.
      await tx.$queryRaw`SELECT u.id FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE p.host_id=${initial.hostId}::uuid ORDER BY u.id FOR UPDATE OF u`;
      await tx.$queryRaw`SELECT b.id FROM bookings b JOIN finance_payout_items i ON i.booking_id=b.id WHERE i.batch_id=${id}::uuid ORDER BY b.id FOR UPDATE OF b`;
      return {status:200,body:await approvePayoutDraft(tx,actorId,id,dto.expectedVersion,dto.reason)};
    }).catch(error=>this.safe(error))).body;
  }
  async list(hostId: string | null, page: number, limit: number) {
    return this.prisma.$transaction(async tx => {
      const where = hostId ? { hostId } : {};
      const rows = await tx.financePayoutBatch.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit, skip: (page-1)*limit,
        select: { id: true, hostId: true, amount: true, status: true, version: true, cutoff: true, createdAt: true, bankCode: true, accountNumber: true } });
      const total = await tx.financePayoutBatch.count({ where });
      return new PaginatedResult(rows.map(row => ({ ...row, amount: row.amount.toFixed(0), accountNumber: `****${row.accountNumber.slice(-4)}`,
        cutoff: row.cutoff.toISOString(), createdAt: row.createdAt.toISOString() })), { page, limit, total, totalPages: Math.ceil(total/limit) });
    }, { isolationLevel: 'RepeatableRead' });
  }
  async confirmPaid(actorId:string,id:string,dto:PayoutTransferEvidence,key:string,raw:unknown) {
    return (await this.idempotency.run(actorId,'ADMIN_PAYOUT_PAID',key,{id:id.toLowerCase(),body:raw},async tx=>({
      status:200,body:await recordManualPayout(tx,actorId,id,dto),
    })).catch(error=>this.safe(error,'confirm'))).body;
  }
  async exportCsv(actorId:string,id:string) {
    return this.prisma.$transaction(async tx=>{
      const [actor]=await tx.$queryRaw<{role:string;status:string}[]>`SELECT role,status FROM users WHERE id=${actorId}::uuid FOR SHARE`;
      if (!actor || actor.role!=='ADMIN' || actor.status!=='ACTIVE')
        throw new ForbiddenException({errorCode:'PAYOUT_EXPORT_FORBIDDEN',message:'Tài khoản không được xuất lô chi trả.'});
      const initial=await tx.financePayoutBatch.findUnique({where:{id},select:{hostId:true}});
      if (!initial) throw new NotFoundException({errorCode:'PAYOUT_NOT_FOUND',message:'Không tìm thấy lô chi trả.'});
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${initial.hostId}`},0))`;
      await tx.$queryRaw`SELECT u.id FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE p.host_id=${initial.hostId}::uuid ORDER BY u.id FOR UPDATE OF u`;
      await tx.$queryRaw`SELECT b.id FROM bookings b JOIN finance_payout_items i ON i.booking_id=b.id WHERE i.batch_id=${id}::uuid ORDER BY b.id FOR UPDATE OF b`;
      await tx.$queryRaw`SELECT id FROM finance_payout_batches WHERE id=${id}::uuid FOR UPDATE`;
      const row=await tx.financePayoutBatch.findUniqueOrThrow({where:{id},select:{
        id:true,hostId:true,status:true,version:true,cutoff:true,bankCode:true,accountNumber:true,accountName:true,amount:true,
        items:{where:{status:'ACTIVE'},select:{bookingId:true},orderBy:{bookingId:'asc'}},
      }});
      if (row.status!=='APPROVED') throw new ConflictException({errorCode:'PAYOUT_NOT_APPROVED',message:'Chỉ xuất lô đã được duyệt.'});
      const [{ready}]=await tx.$queryRaw<{ready:boolean}[]>`SELECT finance_payout_ready(${id}::uuid) AS ready`;
      if (!ready) throw new ConflictException({errorCode:'PAYOUT_REVIEW_REQUIRED',message:'Điều kiện chi trả đã thay đổi. Hãy đối soát và lập lại lô.'});
      return {filename:`payout-${row.id}-v${row.version}.csv`,encoding:'UTF-8',csv:payoutCsv({
        ...row,amount:row.amount.toFixed(0),cutoff:row.cutoff.toISOString(),bookingIds:row.items.map(i=>i.bookingId),
      })};
    }).catch(error=>this.safe(error,'export'));
  }
  async read(id: string, hostId: string | null) {
    return this.prisma.$transaction(async tx => {
      const row = await tx.financePayoutBatch.findFirst({ where: { id, ...(hostId ? { hostId } : {}) }, include: {
        items: { orderBy: [{ eligibleAt: 'asc' }, { bookingId: 'asc' }] }, events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        confirmation: {select:{createdAt:true,actorId:true,bankReference:true,evidenceNote:true,reason:true}},
      } });
      if (!row) throw new NotFoundException({ errorCode: 'PAYOUT_NOT_FOUND', message: 'Không tìm thấy lô chi trả.' });
      const unpaid=row.status==='DRAFT' || row.status==='APPROVED';
      // An observation for Admin UI, not authorization: every action rechecks under locks.
      const ready=!hostId && unpaid
        ? (await tx.$queryRaw<{ready:boolean}[]>`SELECT finance_payout_ready(${id}::uuid) AS ready`)[0].ready : false;
      const writable=row.version<2147483647;
      return { id: row.id, hostId: row.hostId, amount: row.amount.toFixed(0), status: row.status, version: row.version,
        cutoff: row.cutoff.toISOString(), createdAt: row.createdAt.toISOString(), bankCode: row.bankCode,
        accountNumber: hostId ? `****${row.accountNumber.slice(-4)}` : row.accountNumber,
        ...(hostId ? {} : { accountName: row.accountName, bankAccountId: row.bankAccountId, bankVersion: row.bankVersion }),
        ...(hostId ? {} : {operations:{canApprove:row.status==='DRAFT' && ready && writable,
          canExport:row.status==='APPROVED' && ready,canConfirmPaid:row.status==='APPROVED' && ready && writable,
          canCancel:unpaid && writable,reviewRequired:unpaid && !ready}}),
        items: row.items.map(i => ({ bookingId: i.bookingId, amount: i.amount.toFixed(0), eligibleAt: i.eligibleAt.toISOString(), status: i.status })),
        events: row.events.map(e => ({ action: e.action, createdAt: e.createdAt.toISOString(), ...(hostId ? {} : { actorId: e.actorId, reason: e.reason }) })),
        confirmation: row.confirmation ? {confirmedAt:row.confirmation.createdAt.toISOString(),...(hostId?{}:{
          actorId:row.confirmation.actorId,bankReference:row.confirmation.bankReference,evidenceNote:row.confirmation.evidenceNote,reason:row.confirmation.reason,
        })} : null,
      };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
