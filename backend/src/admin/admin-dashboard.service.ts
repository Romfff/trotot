import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { dateEpoch } from '../bookings/booking-dates.js';
import { paymentSourcesSql } from '../finance/payment-source.js';
export function dashboardRange(from:string,to:string) {
  const bad=()=>new BadRequestException({errorCode:'INVALID_DASHBOARD_RANGE',message:'Chọn khoảng ngày hợp lệ, từ ngày không sau đến ngày, tối đa 366 ngày.'});
  let start:number,end:number;
  try{start=dateEpoch(from);end=dateEpoch(to);}catch{throw bad();}
  if(end<start||(end-start)/86400000+1>366)throw bad();
  return {start:new Date(start-7*3600000),end:new Date(end+86400000-7*3600000)};
}
@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma:PrismaService) {}
  async read(from:string,to:string) {
    const {start,end}=dashboardRange(from,to);
    return this.prisma.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<{gmv:string;refundApproved:string;refundTransferred:string;refundPendingTransfer:string;commissionRecognized:string;reviewCount:bigint}[]>`
        WITH sources AS (${paymentSourcesSql()}), posted AS (
          SELECT j.*,coalesce(s.verified AND (j.kind='PAYMENT' OR
            (j.kind='REFUND' AND finance_refund_journal_supported(j.id))),false) AS verified
          FROM finance_journals j LEFT JOIN sources s ON s.booking_id=j.booking_id AND s.verified
          WHERE j.kind IN('PAYMENT','REFUND')
        ), amounts AS (
          SELECT j.id,j.kind,j.created_at,j.verified,
            coalesce(sum(e.amount) FILTER(WHERE e.account='CASH_CLEARING' AND e.side='DEBIT' AND j.kind='PAYMENT'),0) AS gross,
            coalesce(sum(e.amount) FILTER(WHERE e.account='PLATFORM_COMMISSION' AND e.side='CREDIT' AND j.kind='PAYMENT'),0) AS commission,
            coalesce(sum(e.amount) FILTER(WHERE e.account='REFUND_PAYABLE' AND e.side='CREDIT'),0) AS approved,
            coalesce(sum(e.amount) FILTER(WHERE e.account='CASH_CLEARING' AND e.side='CREDIT' AND j.kind='REFUND'),0) AS transferred,
            coalesce(sum(CASE WHEN e.account='REFUND_PAYABLE' THEN CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0) AS pending
          FROM posted j LEFT JOIN finance_entries e ON e.journal_id=j.id GROUP BY j.id,j.kind,j.created_at,j.verified
        ) SELECT
          coalesce(sum(gross) FILTER(WHERE verified AND created_at>=${start} AND created_at<${end}),0)::text AS gmv,
          coalesce(sum(commission) FILTER(WHERE verified AND created_at>=${start} AND created_at<${end}),0)::text AS "commissionRecognized",
          coalesce(sum(approved) FILTER(WHERE verified AND created_at>=${start} AND created_at<${end}),0)::text AS "refundApproved",
          coalesce(sum(transferred) FILTER(WHERE verified AND created_at>=${start} AND created_at<${end}),0)::text AS "refundTransferred",
          coalesce(sum(pending) FILTER(WHERE verified),0)::text AS "refundPendingTransfer",
          count(*) FILTER(WHERE NOT verified) AS "reviewCount" FROM amounts`;
      const listings=await tx.property.groupBy({by:['status'],where:{deletedAt:null},_count:{_all:true}});
      const deletedListings=await tx.property.count({where:{deletedAt:{not:null}}});
      const users=await tx.user.groupBy({by:['role','status'],_count:{_all:true},orderBy:[{role:'asc'},{status:'asc'}]});
      const reviewCount=Number(row.reviewCount);
      return {from,to,timeZone:'Asia/Ho_Chi_Minh',currency:'VND',serverTime:new Date().toISOString(),
        money:{gmv:new Prisma.Decimal(row.gmv).toFixed(0),refundApproved:new Prisma.Decimal(row.refundApproved).toFixed(0),
          refundTransferred:new Prisma.Decimal(row.refundTransferred).toFixed(0),refundPendingTransfer:new Prisma.Decimal(row.refundPendingTransfer).toFixed(0),
          commissionRecognized:new Prisma.Decimal(row.commissionRecognized).toFixed(0),gmvLessApprovedRefunds:new Prisma.Decimal(row.gmv).minus(row.refundApproved).toFixed(0)},
        listings:Object.fromEntries(listings.map(x=>[x.status,x._count._all])),deletedListings,
        users:users.map(x=>({role:x.role,status:x.status,count:x._count._all})),reviewCount,isComplete:reviewCount===0};
    },{isolationLevel:'RepeatableRead'});
  }
}
