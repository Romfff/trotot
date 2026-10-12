import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { FINANCE_HOLD_MS } from './payout-policy.js';
import { paymentSourcesSql } from './payment-source.js';

export function financeBucket(row:{valid:boolean;openComplaint:boolean;bookingStatus:string;completedAt:Date|null;noShowResolvedAt?:Date|null;payoutHoldStart?:Date|null},now:Date) {
  if(!row.valid || row.bookingStatus==='COMPLETED' && !row.completedAt) return 'REVIEW';
  if(row.openComplaint) return 'frozen';
  const holdStart=row.payoutHoldStart!==undefined?row.payoutHoldStart:(row.bookingStatus==='COMPLETED'?row.completedAt:row.noShowResolvedAt);
  if(!holdStart) return 'waitingCompletion';
  return now.getTime()<holdStart.getTime()+FINANCE_HOLD_MS?'pendingHold':'eligibleBeforeDeductions';
}
@Injectable()
export class HostFinanceService {
  constructor(private readonly prisma:PrismaService) {}
  async revenue(hostId:string,year:number) {
    if(!Number.isInteger(year) || year<2000 || year>2100)
      throw new BadRequestException({errorCode:'INVALID_REVENUE_YEAR',message:'Năm phải là số nguyên từ 2000 đến 2100.'});
    // Aggregate all posted journals, not a page of history or current booking status.
    // Existing domain proofs are mandatory; unknown adjustments remain visible as incomplete.
    const rows=await this.prisma.$queryRaw<{month:number;roomAndCleaning:string;commission:string;refundRecognized:string;hostEarned:string;paidOut:string;reviewCount:bigint}[]>`
      WITH sources AS (
        ${paymentSourcesSql(hostId)}
      ), posted AS (
        SELECT j.*,b.base_amount+b.cleaning_fee AS gross,
          coalesce(s.verified AND (j.kind='PAYMENT' OR finance_offset_journal_verified(j.id) OR (j.kind='PAYOUT' AND finance_payout_journal_verified(j.id))
            OR (j.kind='REFUND' AND (
              EXISTS(SELECT 1 FROM finance_cancellations c WHERE c.booking_id=j.booking_id AND c.source_journal_id=s.id AND c.reversal_journal_id=j.id)
              OR EXISTS(SELECT 1 FROM finance_refund_confirmations f JOIN finance_refunds r ON r.id=f.refund_id
                JOIN finance_cancellations c ON c.id=r.cancellation_id WHERE f.journal_id=j.id AND c.booking_id=j.booking_id AND c.source_journal_id=s.id)
              OR finance_complaint_journal_verified(j.id)
            ))),false) AS verified
        FROM finance_journals j LEFT JOIN bookings b ON b.id=j.booking_id
          LEFT JOIN sources s ON s.booking_id=j.booking_id AND s.verified
        WHERE j.host_id=${hostId}::uuid
          AND j.created_at >= (make_date(${year}::int,1,1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND j.created_at < (make_date(${year+1}::int,1,1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      ), amounts AS (
        SELECT j.id,extract(month FROM j.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS month,j.kind,j.gross,j.verified,
          coalesce(sum(CASE WHEN e.account='PLATFORM_COMMISSION' THEN CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0) AS commission,
          coalesce(sum(CASE WHEN e.account='HOST_PAYABLE' OR(j.kind='REFUND' AND e.account='HOST_DEBT') THEN CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0) AS host,
          coalesce(sum(e.amount) FILTER(WHERE e.account='REFUND_PAYABLE' AND e.side='CREDIT'),0) AS refund,
          coalesce(sum(e.amount) FILTER(WHERE e.account='CASH_CLEARING' AND e.side='CREDIT'),0) AS paid
        FROM posted j LEFT JOIN finance_entries e ON e.journal_id=j.id GROUP BY j.id,j.created_at,j.kind,j.gross,j.verified
      ) SELECT month,
        coalesce(sum(gross) FILTER(WHERE verified AND kind='PAYMENT'),0)::text AS "roomAndCleaning",
        coalesce(sum(commission) FILTER(WHERE verified AND kind<>'PAYOUT'),0)::text AS commission,
        coalesce(sum(refund) FILTER(WHERE verified AND kind='REFUND'),0)::text AS "refundRecognized",
        coalesce(sum(host) FILTER(WHERE verified AND kind IN('PAYMENT','REFUND')),0)::text AS "hostEarned",
        coalesce(sum(paid) FILTER(WHERE verified AND kind='PAYOUT'),0)::text AS "paidOut",
        count(*) FILTER(WHERE NOT verified) AS "reviewCount"
        FROM amounts GROUP BY month ORDER BY month`;
    const byMonth=new Map(rows.map(row=>[row.month,row]));
    return {year,timeZone:'Asia/Ho_Chi_Minh',basis:'LEDGER_POSTED',currency:'VND',months:Array.from({length:12},(_,index)=>{
      const row=byMonth.get(index+1),reviewCount=Number(row?.reviewCount??0);
      return {month:`${year}-${String(index+1).padStart(2,'0')}`,
        roomAndCleaning:new Prisma.Decimal(row?.roomAndCleaning??0).toFixed(0),commission:new Prisma.Decimal(row?.commission??0).toFixed(0),
        refundRecognized:new Prisma.Decimal(row?.refundRecognized??0).toFixed(0),hostEarned:new Prisma.Decimal(row?.hostEarned??0).toFixed(0),
        paidOut:new Prisma.Decimal(row?.paidOut??0).toFixed(0),reviewCount,isComplete:reviewCount===0};
    })};
  }
  async summary(hostId:string) {
    return this.prisma.$transaction(async tx=>{
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      const [{verified}]=await tx.$queryRaw<{verified:boolean}[]>`SELECT EXISTS(SELECT 1 FROM finance_bank_states s
        JOIN finance_bank_accounts a ON a.id=s.account_id AND a.host_id=s.host_id WHERE s.host_id=${hostId}::uuid AND a.status='VERIFIED') AS verified`;
      // One aggregate query, not one source/ledger request per booking. No contact or bank data is selected.
      const rows=await tx.$queryRaw<{valid:boolean;openComplaint:boolean;bookingStatus:string;completedAt:Date|null;noShowResolvedAt:Date|null;payoutHoldStart:Date|null;balance:string}[]>`
        WITH owned AS (
          SELECT b.* FROM bookings b JOIN homestay_units u ON u.id=b.homestay_unit_id JOIN properties p ON p.id=u.property_id
          WHERE p.host_id=${hostId}::uuid AND (b.payment_status IN ('PAID','REFUNDED') OR EXISTS(SELECT 1 FROM finance_journals j WHERE j.booking_id=b.id))
        ), sources AS (
          SELECT j.booking_id,count(DISTINCT j.id) AS n,bool_and(j.host_id=${hostId}::uuid) AS own,
            bool_and((e.side='DEBIT' AND e.account='CASH_CLEARING') OR (e.side='CREDIT' AND e.account IN ('HOST_PAYABLE','PLATFORM_COMMISSION','PLATFORM_SERVICE','TAX_PAYABLE'))) AS accounts,
            sum(e.amount) FILTER(WHERE e.side='DEBIT' AND e.account='CASH_CLEARING') AS cash,
            sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='HOST_PAYABLE') AS host,
            sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='PLATFORM_COMMISSION') AS commission,
            sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='PLATFORM_SERVICE') AS service,
            sum(e.amount) FILTER(WHERE e.side='CREDIT' AND e.account='TAX_PAYABLE') AS tax
          FROM finance_journals j JOIN finance_entries e ON e.journal_id=j.id JOIN owned b ON b.id=j.booking_id WHERE j.kind='PAYMENT' GROUP BY j.booking_id
        ), ledger AS (
          SELECT j.booking_id,coalesce(sum(CASE WHEN e.account='HOST_PAYABLE' THEN CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0) AS balance,
            bool_and(j.host_id=${hostId}::uuid AND (j.kind='PAYMENT' OR finance_offset_journal_verified(j.id) OR (j.kind='PAYOUT' AND finance_payout_journal_verified(j.id)) OR (j.kind='REFUND' AND (
              EXISTS(SELECT 1 FROM finance_cancellations c WHERE c.booking_id=j.booking_id AND c.reversal_journal_id=j.id)
              OR EXISTS(SELECT 1 FROM finance_refund_confirmations f JOIN finance_refunds r ON r.id=f.refund_id JOIN finance_cancellations c ON c.id=r.cancellation_id WHERE f.journal_id=j.id AND c.booking_id=j.booking_id)
              OR finance_complaint_journal_verified(j.id)
            )))) AS supported
          FROM finance_journals j JOIN finance_entries e ON e.journal_id=j.id JOIN owned b ON b.id=j.booking_id GROUP BY j.booking_id
        ) SELECT b.booking_status AS "bookingStatus",b.completed_at AS "completedAt",n.created_at AS "noShowResolvedAt",finance_payout_hold_start(b.id) AS "payoutHoldStart",coalesce(l.balance,0)::text AS balance,
          EXISTS(SELECT 1 FROM finance_complaints c WHERE c.booking_id=b.id AND c.status='OPEN') AS "openComplaint",
          coalesce(s.n=1 AND s.own AND s.accounts AND s.cash=b.total_amount AND coalesce(s.host,0)=b.host_payout_amount
            AND coalesce(s.commission,0)=b.commission_amount AND coalesce(s.service,0)=b.service_fee AND coalesce(s.tax,0)=b.tax_amount
            AND l.supported AND l.balance>=0 AND l.balance<=b.host_payout_amount AND b.payment_status IN ('PAID','REFUNDED'),false) AS valid
          FROM owned b LEFT JOIN sources s ON s.booking_id=b.id LEFT JOIN ledger l ON l.booking_id=b.id LEFT JOIN finance_no_show_resolutions n ON n.booking_id=b.id`;
      const balances={waitingCompletion:new Prisma.Decimal(0),pendingHold:new Prisma.Decimal(0),eligibleBeforeDeductions:new Prisma.Decimal(0),frozen:new Prisma.Decimal(0)};
      let reviewCount=0;
      for(const row of rows) {
        const bucket=financeBucket(row,now);
        if(bucket==='REVIEW') reviewCount++;else balances[bucket]=balances[bucket].plus(row.balance);
      }
      return {currency:'VND',source:'LEDGER',serverTime:now.toISOString(),holdHours:72,bankVerified:verified,payoutOperationsReady:false,
        balances:Object.fromEntries(Object.entries(balances).map(([k,v])=>[k,v.toFixed(0)])),reviewCount};
    },{isolationLevel:'RepeatableRead'});
  }
  async transactions(hostId:string,page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<{id:string;bookingId:string|null;kind:string;createdAt:Date;entries:{account:string;side:string;amount:string}[]}[]>`
        SELECT j.id,j.booking_id AS "bookingId",j.kind,j.created_at AS "createdAt",
          (SELECT jsonb_agg(jsonb_build_object('account',e.account,'side',e.side,'amount',e.amount::text) ORDER BY e.line_number)
            FROM finance_entries e WHERE e.journal_id=j.id) AS entries
        FROM finance_journals j WHERE j.host_id=${hostId}::uuid ORDER BY j.created_at DESC,j.id DESC LIMIT ${limit} OFFSET ${(page-1)*limit}`;
      const [{total}]=await tx.$queryRaw<{total:bigint}[]>`SELECT count(*) AS total FROM finance_journals WHERE host_id=${hostId}::uuid`;
      return new PaginatedResult(rows.map(r=>({...r,createdAt:r.createdAt.toISOString()})),{page,limit,total:Number(total),totalPages:Math.ceil(Number(total)/limit)});
    },{isolationLevel:'RepeatableRead'});
  }
}
