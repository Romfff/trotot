import { BadRequestException,ConflictException,Injectable,NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { BookingIdempotencyService } from '../bookings/booking-idempotency.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { weeklyPayoutCutoff } from './payout-policy.js';
import { planHostPayout } from './payout-allocation.js';
import { persistPayoutDraft } from './payout-drafts.js';
import { appendFinancialJournal } from './finance-journal.js';
import { reverseDebtOffsets } from './debt-offsets.js';

const text=(v:string)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>500)throw new BadRequestException({errorCode:'SETTLEMENT_REASON_REQUIRED',message:'Cần lý do từ 1 đến 500 ký tự.'});return v.trim();};
@Injectable()
export class DebtSettlementsService {
  constructor(private readonly prisma:PrismaService,private readonly idempotency:BookingIdempotencyService) {}
  private async lock(tx:Prisma.TransactionClient,hostId:string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`bank:${hostId}`},0))`;
    // Same stable lock order as payout/refund; no inventory state changes.
    await tx.$queryRaw`SELECT u.id FROM homestay_units u JOIN properties p ON p.id=u.property_id WHERE p.host_id=${hostId}::uuid ORDER BY u.id FOR UPDATE OF u`;
    await tx.$queryRaw`SELECT b.id FROM bookings b JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id WHERE p.host_id=${hostId}::uuid ORDER BY b.id FOR UPDATE OF b`;
  }
  async create(actorId:string,hostId:string,reason:string,key:string,raw:unknown) {
    hostId=hostId.toLowerCase();reason=text(reason);
    return (await this.idempotency.run(actorId,'ADMIN_DEBT_SETTLEMENT',key,raw,async tx=>{
      if(!await tx.user.findFirst({where:{id:hostId,role:'HOST',status:'ACTIVE'},select:{id:true}}))throw new NotFoundException({errorCode:'SETTLEMENT_HOST_NOT_FOUND',message:'Không tìm thấy Host đang hoạt động.'});
      await this.lock(tx,hostId);
      const [{unknown}]=await tx.$queryRaw<{unknown:boolean}[]>`SELECT EXISTS(SELECT 1 FROM finance_journals j JOIN finance_entries e ON e.journal_id=j.id
        WHERE j.host_id=${hostId}::uuid AND ((e.account='HOST_DEBT' AND NOT finance_debt_journal_verified(j.id))
          OR(j.kind='ADJUSTMENT' AND NOT finance_offset_journal_verified(j.id)) OR(j.kind='PAYOUT' AND NOT finance_payout_journal_verified(j.id)))) AS unknown`;
      if(unknown)throw new ConflictException({errorCode:'FINANCIAL_REVIEW_REQUIRED',message:'Ghi sổ chưa có bằng chứng; cần đối soát.'});
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const cutoff=weeklyPayoutCutoff(now);
      const earnings=await tx.$queryRaw<{id:string;hostId:string;amount:string;eligibleAt:Date;sourceJournalId:string}[]>`
        SELECT b.id,p.host_id AS "hostId",finance_earning_balance(b.id)::text AS amount,
          finance_payout_hold_start(b.id)+interval '72 hours' AS "eligibleAt",j.id AS "sourceJournalId"
        FROM bookings b JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
        JOIN finance_journals j ON j.booking_id=b.id AND j.kind='PAYMENT'
        WHERE p.host_id=${hostId}::uuid AND finance_earning_valid(b.id,${hostId}::uuid)
          AND finance_payout_hold_start(b.id)+interval '72 hours'<=${cutoff}
          AND finance_earning_balance(b.id)>0
          AND NOT EXISTS(SELECT 1 FROM finance_complaints c WHERE c.booking_id=b.id AND c.status='OPEN')
          AND NOT EXISTS(SELECT 1 FROM finance_payout_items i WHERE i.booking_id=b.id AND i.status='ACTIVE')
        ORDER BY finance_payout_hold_start(b.id),b.id`;
      if(!earnings.length)throw new ConflictException({errorCode:'SETTLEMENT_NO_ELIGIBLE_ITEMS',message:'Chưa có khoản đủ điều kiện chưa phân bổ.'});
      const debts=await tx.$queryRaw<{id:string;hostId:string;amount:string;createdAt:Date}[]>`SELECT refund_id AS id,host_id AS "hostId",finance_debt_remaining(refund_id)::text AS amount,created_at AS "createdAt"
        FROM finance_host_debts WHERE host_id=${hostId}::uuid AND finance_debt_remaining(refund_id)>0 ORDER BY created_at,refund_id`;
      const plan=planHostPayout(hostId,cutoff,earnings,debts),id=randomUUID();
      if(plan.netPayout!=='0'&&!plan.meetsThreshold)throw new ConflictException({errorCode:'PAYOUT_BELOW_THRESHOLD',message:'Số thực trả dưới ngưỡng và chưa đủ 60 ngày; chưa ghi bù dở dang.'});
      const write=async(batchId:string|null)=>{
        await tx.$executeRaw`INSERT INTO finance_debt_settlements(id,host_id,actor_id,cutoff,reason,gross_eligible,debt_offset,net_payout,batch_id)
          VALUES (${id}::uuid,${hostId}::uuid,${actorId}::uuid,${cutoff},${reason},${plan.grossEligible}::numeric,${plan.debtOffset}::numeric,${plan.netPayout}::numeric,${batchId}::uuid)`;
        for(const [index,o] of plan.offsets.entries()) {
          const journal=await appendFinancialJournal(tx,{eventKey:`debt-offset:${id}:${index}`,kind:'ADJUSTMENT',bookingId:o.earningId,hostId,actorId,reason,
            lines:[{account:'HOST_PAYABLE',side:'DEBIT',amount:o.amount},{account:'HOST_DEBT',side:'CREDIT',amount:o.amount}]});
          await tx.$executeRaw`INSERT INTO finance_debt_offsets(settlement_id,refund_id,booking_id,journal_id,amount)
            VALUES (${id}::uuid,${o.debtId}::uuid,${o.earningId}::uuid,${journal.journalId}::uuid,${o.amount}::numeric)`;
        }
      };
      let batchId:string|null=null;
      if(plan.netPayout==='0')await write(null);
      else {
        const items=plan.remainingEarnings.filter(r=>r.amount!=='0').map(r=>{const e=earnings.find(e=>e.id===r.id)!;return {bookingId:e.id,sourceJournalId:e.sourceJournalId,amount:r.amount,eligibleAt:e.eligibleAt};});
        batchId=(await persistPayoutDraft(tx,hostId,actorId,cutoff,reason,items,id=>write(id))).id;
      }
      return {status:201,body:{id,hostId,cutoff:cutoff.toISOString(),grossEligible:plan.grossEligible,debtOffset:plan.debtOffset,netPayout:plan.netPayout,batchId}};
    })).body;
  }
  async reverse(actorId:string,id:string,reason:string,key:string,raw:unknown) {
    id=id.toLowerCase();reason=text(reason);
    return (await this.idempotency.run(actorId,'ADMIN_DEBT_REVERSE',key,{id,body:raw},async tx=>{
      const [s]=await tx.$queryRaw<{hostId:string;batchId:string|null}[]>`SELECT host_id AS "hostId",batch_id AS "batchId" FROM finance_debt_settlements WHERE id=${id}::uuid`;
      if(!s)throw new NotFoundException({errorCode:'SETTLEMENT_NOT_FOUND',message:'Không tìm thấy quyết toán.'});
      if(s.batchId)throw new ConflictException({errorCode:'SETTLEMENT_USE_BATCH_CANCEL',message:'Quyết toán thuộc lô; chỉ hủy lô chưa trả để đảo bù.'});
      await this.lock(tx,s.hostId);
      const count=await reverseDebtOffsets(tx,actorId,reason,{settlementId:id});
      if(!count)throw new ConflictException({errorCode:'SETTLEMENT_ALREADY_REVERSED',message:'Quyết toán đã được đảo.'});
      return {status:200,body:{id,status:'REVERSED',reversedOffsets:count}};
    })).body;
  }
  async list(hostId:string,kind:'debts'|'settlements',page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const where=Prisma.sql`host_id=${hostId}::uuid`,table=kind==='debts'?Prisma.sql`finance_host_debts`:Prisma.sql`finance_debt_settlements`;
      const [{total}]=await tx.$queryRaw<{total:bigint}[]>(Prisma.sql`SELECT count(*) AS total FROM ${table} WHERE ${where}`);
      const rows=kind==='debts'?await tx.$queryRaw<object[]>`SELECT refund_id AS id,booking_id AS "bookingId",amount::text AS amount,finance_debt_remaining(refund_id)::text AS "remainingAmount",created_at AS "createdAt"
        FROM finance_host_debts WHERE host_id=${hostId}::uuid ORDER BY created_at DESC,refund_id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`:
        await tx.$queryRaw<object[]>`SELECT s.id,s.cutoff,s.gross_eligible::text AS "grossEligible",s.debt_offset::text AS "debtOffset",s.net_payout::text AS "netPayout",s.batch_id AS "batchId",s.created_at AS "createdAt",
          CASE WHEN EXISTS(SELECT 1 FROM finance_debt_offsets o WHERE o.settlement_id=s.id) AND NOT EXISTS(SELECT 1 FROM finance_debt_offsets o WHERE o.settlement_id=s.id AND NOT EXISTS(SELECT 1 FROM finance_debt_offset_reversals r WHERE r.offset_id=o.id)) THEN 'REVERSED'
          WHEN EXISTS(SELECT 1 FROM finance_payout_batches b WHERE b.id=s.batch_id AND b.status='CANCELLED') THEN 'REVERSED'
          WHEN s.batch_id IS NULL THEN 'OFFSET' ELSE 'ALLOCATED' END AS status FROM finance_debt_settlements s WHERE s.host_id=${hostId}::uuid ORDER BY s.created_at DESC,s.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;
      return new PaginatedResult(JSON.parse(JSON.stringify(rows)),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit)});
    },{isolationLevel:'RepeatableRead'});
  }
}
