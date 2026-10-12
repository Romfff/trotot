import '../src/config/load-env.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFile,spawn } from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import bcrypt from 'bcrypt';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { appendFinancialJournal, type FinancialJournalInput } from '../src/finance/finance-journal.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { BookingIdempotencyService } from '../src/bookings/booking-idempotency.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import type { HomestayAvailabilityService } from '../src/homestays/homestay-availability.service.js';
import type { HomestayCalendarService } from '../src/homestays/homestay-calendar.service.js';
import { calculateCancellationRefund,cancellationSnapshot } from '../src/bookings/booking-refund.js';
import * as refundCalculator from '../src/bookings/booking-refund.js';
import { signRefundQuote } from '../src/bookings/booking-refund-quote.js';
import { ManualRefundsService } from '../src/finance/manual-refunds.service.js';
import { BankAccountsService } from '../src/finance/bank-accounts.service.js';
import { ComplaintsService } from '../src/finance/complaints.service.js';
import { HostFinanceService } from '../src/finance/host-finance.service.js';
import { AdminDashboardService } from '../src/admin/admin-dashboard.service.js';
import { NoShowService } from '../src/finance/no-show.service.js';
import { ComplaintNotificationsService } from '../src/finance/complaint-notifications.service.js';
import { weeklyPayoutCutoff } from '../src/finance/payout-policy.js';
import { persistPayoutDraft,cancelPayoutDraft } from '../src/finance/payout-drafts.js';
import { PayoutDraftsService } from '../src/finance/payout-drafts.service.js';
import { PayoutNotificationsService } from '../src/finance/payout-notifications.service.js';
import { recordManualPayout } from '../src/finance/payout-manual-proof.js';
import { recordPaidCancellation } from '../src/finance/paid-cancellation.js';
import { roomTimestamp } from '../src/bookings/booking-lifecycle.js';
import { persistVnpaySession } from '../src/payments/vnpay-session.js';
import { consumeVnpayIpn } from '../src/payments/vnpay-ipn.js';
import { PaymentReviewsService } from '../src/finance/payment-reviews.service.js';
import { verifiedPaymentSource } from '../src/finance/payment-source.js';
import { complaintBookingSnapshot } from '../src/finance/complaint-refund.js';
import { BookingExpiryService } from '../src/bookings/booking-expiry.service.js';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule,DocumentBuilder } from '@nestjs/swagger';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module.js';
import { ApiEnvelopeInterceptor } from '../src/common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';

// Real PostgreSQL, synthetic accounts/journals. No live booking, provider or bank transfer.
describe.skipIf(process.env.FINANCE_INTEGRATION !== '1')('S4 append-only balanced financial journal', () => {
  const databaseName = `trotot_finance_test_${randomUUID().replaceAll('-', '')}`;
  const originalUrl = process.env.DATABASE_URL;
  let admin: Pool, db: Pool, prisma: PrismaService, hostId: string;
  let created = false;
  let tenantId:string,otherHostId:string,bookings:BookingsService;
  let adminId:string,refunds:ManualRefundsService;
  let banks:BankAccountsService;
  let complaints:ComplaintsService;
  const releasedComplaintInventory=vi.fn(async (_lock:Prisma.JsonValue|null)=>{});
  let hostFinance:HostFinanceService;
  let noShow:NoShowService;
  let financeNotices:ComplaintNotificationsService;
  let payoutDrafts:PayoutDraftsService;
  let payoutNotices:PayoutNotificationsService;
  const input = (): FinancialJournalInput => ({ eventKey: `fixture:${randomUUID()}`, kind: 'PAYMENT', bookingId: null,
    hostId, actorId: null, reason: 'Synthetic integration journal; no real money',
    lines: [{ account: 'CASH_CLEARING', side: 'DEBIT', amount: '100' },
      { account: 'HOST_PAYABLE', side: 'CREDIT', amount: '90' }, { account: 'PLATFORM_COMMISSION', side: 'CREDIT', amount: '10' }] });
  beforeAll(async () => {
    vi.stubEnv('HOMESTAY_QUOTE_SECRET','finance-test-only-independent-quote-secret-12345');
    const source = new URL(originalUrl!);
    if (process.env.NODE_ENV === 'production' || !['localhost','127.0.0.1','[::1]'].includes(source.hostname)) throw new Error('Only isolated local finance DB is allowed');
    admin = new Pool({ connectionString: source.toString() });
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    source.pathname = `/${databaseName}`; process.env.DATABASE_URL = source.toString();
    for (let i = 0; i < 2; i++) await promisify(execFile)(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, timeout: 60_000 });
    db = new Pool({ connectionString: source.toString() }); prisma = new PrismaService(); await prisma.$connect();
    hostId = (await prisma.user.create({ data: { phone: '0990000000', fullName: 'Synthetic finance fixture', role: 'HOST', passwordHash: 'not-a-real-password' } })).id;
    tenantId=(await prisma.user.create({data:{phone:'0990000001',fullName:'Synthetic guest',role:'TENANT',passwordHash:'not-a-real-password'}})).id;
    otherHostId=(await prisma.user.create({data:{phone:'0990000002',fullName:'Synthetic other Host',role:'HOST',passwordHash:'not-a-real-password'}})).id;
    adminId=(await prisma.user.create({data:{phone:'0990000003',fullName:'Synthetic Admin',role:'ADMIN',passwordHash:'not-a-real-password'}})).id;
    refunds=new ManualRefundsService(prisma,new BookingIdempotencyService(prisma));
    banks=new BankAccountsService(prisma,new BookingIdempotencyService(prisma));
    complaints=new ComplaintsService(prisma,new BookingIdempotencyService(prisma),{invalidate:async()=>{}} as unknown as HomestayCalendarService,
      {releaseLock:releasedComplaintInventory} as unknown as BookingsService);
    hostFinance=new HostFinanceService(prisma);
    noShow=new NoShowService(prisma,new BookingIdempotencyService(prisma));
    financeNotices=new ComplaintNotificationsService(prisma);
    payoutDrafts=new PayoutDraftsService(prisma,new BookingIdempotencyService(prisma));
    payoutNotices=new PayoutNotificationsService(prisma);
    await prisma.addressProvince.create({data:{code:'79',name:'Synthetic province'}});
    await prisma.addressWard.create({data:{code:'26740',provinceCode:'79',name:'Synthetic ward'}});
    // DB/idempotency/crypto are real; calendar cache cleanup is a no-op here, separately tested with Redis/BFF.
    bookings=new BookingsService(prisma,{client:{}} as unknown as RedisService,new BookingIdempotencyService(prisma),
      {} as HomestayAvailabilityService,{invalidate:async()=>{}} as unknown as HomestayCalendarService);
  }, 120_000);
  afterAll(async () => {
    await prisma?.$disconnect(); await db?.end();
    if (created && /^trotot_finance_test_[a-f0-9]{32}$/.test(databaseName)) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    await admin?.end(); process.env.DATABASE_URL = originalUrl;vi.unstubAllEnvs();
  });
  const append = (data: FinancialJournalInput) => prisma.$transaction(tx => appendFinancialJournal(tx, data));
  async function paidBooking(policy='FLEXIBLE',hours=240,source=true,ownerId=hostId,pending=false,guestId=tenantId) {
    const hostId=ownerId;
    const property=await prisma.property.create({data:{hostId,slug:`finance-${randomUUID()}`,title:'Synthetic homestay',description:'Isolated test only',
      propertyType:'HOMESTAY',rentalMode:'SHORT_TERM',addressDetail:'Fixture',provinceCode:'79',wardCode:'26740',latitude:10.7,longitude:106.6,status:'PUBLISHED'}});
    const unit=await prisma.homestayUnit.create({data:{propertyId:property.id,unitName:'Fixture unit',maxAdults:2,maxChildren:1,
      bedrooms:1,bathrooms:1,basePricePerNight:500,cleaningFee:100,status:'PUBLISHED',instantBook:true,
      checkInTime:new Date('1970-01-01T14:00:00Z'),checkOutTime:new Date('1970-01-01T12:00:00Z'),cancellationPolicy:policy}});
    const local=new Date(Date.now()+hours*3600000+7*3600000).toISOString(),checkIn=local.slice(0,10),checkInTime=local.slice(11,19);
    const checkout=new Date(new Date(checkIn).getTime()+2*86400000).toISOString().slice(0,10);
    const secondNight=new Date(new Date(checkIn).getTime()+86400000).toISOString().slice(0,10);
    const booking=await prisma.booking.create({data:{bookingCode:`FIX-${randomUUID().replaceAll('-','').slice(0,24)}`,homestayUnitId:unit.id,guestId,
      checkInDate:new Date(checkIn),checkOutDate:new Date(checkout),totalNights:2,numAdults:1,numChildren:0,guestName:'Fixture guest',guestPhone:'0990000001',
      nightlyPrices:[{date:checkIn,price:'500'},{date:secondNight,price:'500'}],policySnapshot:{cancellationPolicy:policy,checkInTime,checkOutTime:'12:00:00'},
      baseAmount:1000,cleaningFee:100,serviceFee:0,taxAmount:0,totalAmount:1100,serviceFeeRate:0,taxRate:0,commissionRate:10,
      commissionAmount:110,hostPayoutAmount:990,bookingStatus:pending?'PENDING_PAYMENT':'CONFIRMED',paymentStatus:pending?'PENDING':'PAID',expiresAt:new Date(Date.now()+60000)}});
    if(source) await append({eventKey:`fixture:paid:${booking.id}`,kind:'PAYMENT',bookingId:booking.id,hostId,actorId:null,reason:'Synthetic payment journal; no provider/no real money',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'990'},{account:'PLATFORM_COMMISSION',side:'CREDIT',amount:'110'}]});
    return booking;
  }
  async function guestCancellation(booking:Awaited<ReturnType<typeof paidBooking>>,key=randomUUID()) {
    const quote=await bookings.refundQuote(tenantId,booking.id);
    const body={expectedVersion:booking.version,refundQuoteToken:quote.refundQuoteToken};
    return {body,key,run:()=>bookings.cancelPaid(tenantId,booking.id,'GUEST',booking.version,key,body,quote.refundQuoteToken)};
  }
  it('late Admin eligibility has exact 72h boundaries and no maximum; incomplete source stays closed',async()=>{
    const completed=new Date('2026-01-01T00:00:00Z');
    for(const [offset,expected] of [[72*3600000-1,false],[72*3600000,true],[72*3600000+1,true],[400*86400000,true]] as const) {
      const result=await db.query("SELECT finance_admin_late_case_eligible('COMPLETED','PAID',$1,$2) AS eligible",[completed,new Date(completed.getTime()+offset)]);
      expect(result.rows[0].eligible).toBe(expected);
    }
    for(const [state,payment,time] of [['CONFIRMED','PAID',completed],['COMPLETED','REFUNDED',completed],['COMPLETED','PAID',null]]) {
      expect((await db.query('SELECT finance_admin_late_case_eligible($1,$2,$3,clock_timestamp()) AS eligible',[state,payment,time])).rows[0].eligible).toBe(false);
    }
  });
  it('Admin late intake rejects early legacy stale and wrong actors without changing booking or opening Guest rights',async()=>{
    const b=await paidBooking(),input={expectedVersion:1,reason:'Synthetic late case',evidenceNote:'Private synthetic evidence'};
    const before=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});
    await expect(complaints.createAdminLate(adminId,b.id,input,randomUUID(),input)).rejects.toMatchObject({response:{errorCode:'ADMIN_LATE_REFUND_NOT_ALLOWED'}});
    for(const actor of [tenantId,hostId])await expect(complaints.createAdminLate(actor,b.id,input,randomUUID(),input)).rejects.toMatchObject({status:403});
    const stale={...input,expectedVersion:2};await expect(complaints.createAdminLate(adminId,b.id,stale,randomUUID(),stale)).rejects.toMatchObject({response:{errorCode:'STALE_BOOKING_VERSION'}});
    const completed=await prisma.booking.update({where:{id:b.id},data:{bookingStatus:'COMPLETED'}});
    await expect(complaints.createAdminLate(adminId,b.id,input,randomUUID(),input)).rejects.toMatchObject({response:{errorCode:'ADMIN_LATE_REFUND_NOT_ALLOWED'}});
    expect(await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).toEqual(completed);
    expect(before.nightlyPrices).toEqual(completed.nightlyPrices);
    expect((await db.query('SELECT count(*)::int AS count FROM finance_complaints WHERE booking_id=$1',[b.id])).rows[0].count).toBe(0);
    expect((await db.query('SELECT count(*)::int AS count FROM finance_admin_late_cases')).rows[0].count).toBe(0);
  });
  it('late intake proof cannot be forged by a Host or by Admin before expiry, and rollback removes provisional case and event',async()=>{
    const b=await paidBooking();
    for(const actor of [hostId,adminId])await expect(prisma.$transaction(async tx=>{
      const [c]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_complaints (booking_id,guest_id,host_id,reason) VALUES (${b.id}::uuid,${tenantId}::uuid,${hostId}::uuid,'Synthetic proof guard') RETURNING id`;
      await tx.$executeRaw`INSERT INTO finance_complaint_events (complaint_id,actor_id,action,message) VALUES (${c.id}::uuid,${actor}::uuid,'CREATED','Synthetic proof guard')`;
      await tx.$executeRaw`INSERT INTO finance_admin_late_cases (complaint_id,actor_id,evidence_note,booking_version_at_open) VALUES (${c.id}::uuid,${actor}::uuid,'Synthetic private evidence',1)`;
    })).rejects.toThrow();
    expect((await db.query('SELECT count(*)::int AS count FROM finance_complaints WHERE booking_id=$1',[b.id])).rows[0].count).toBe(0);
    expect(await prisma.financeJournal.count({where:{bookingId:b.id}})).toBe(1);
  });
  it('late Admin intake HTTP checks role evidence version key and expired-window requirement without disabling rate limits',async()=>{
    const b=await paidBooking(),secret='late-intake-http-fixture-secret-32chars';
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('JWT_ACCESS_SECRET',secret);vi.stubEnv('REDIS_KEY_PREFIX',`late-http:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const base=await app.getUrl(),input={expectedVersion:1,reason:'Synthetic late case',evidenceNote:'Private synthetic evidence'};
      const token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(secret));
      const adminToken=await token(adminId,'ADMIN');
      const http=async(body:unknown=input,auth?:string,key?:string)=>{
        const response=await fetch(`${base}/api/v1/admin/finance/bookings/${b.id}/late-refund-cases`,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:`Bearer ${auth}`}:{ }),...(key?{'idempotency-key':key}:{})},body:JSON.stringify(body)});
        return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
      };
      for(const [id,role] of [[tenantId,'TENANT'],[hostId,'HOST'],[otherHostId,'HOST']])expect((await http(input,await token(id,role),randomUUID())).status).toBe(403);
      expect((await http()).status).toBe(401);
      for(const invalid of [{...input,evidenceNote:' '},{...input,reason:' '},{...input,expectedVersion:0},{...input,amount:'1'}])expect((await http(invalid,adminToken,randomUUID())).status).toBe(400);
      expect((await http(input,adminToken)).status).toBe(400);
      expect(await http(input,adminToken,randomUUID())).toMatchObject({status:409,cache:'no-store',body:{errorCode:'ADMIN_LATE_REFUND_NOT_ALLOWED'}});
    } finally {await app.close();}
  });
  const vnpayConfig={tmnCode:'FIXTURE1',hashSecret:'fixture-only-vnpay-secret-not-a-credential-12345',returnUrl:'https://trotot.example/payment/return'};
  const pendingBooking=()=>paidBooking('FLEXIBLE',240,false,hostId,true);
  const session=(id:string,guest=tenantId,version=1,config=vnpayConfig)=>prisma.$transaction(tx=>persistVnpaySession(tx,guest,id,version,config,'127.0.0.1'));
  const providerDate=(date:Date)=>new Date(date.getTime()+7*3600000).toISOString().slice(0,19).replace(/[-T:]/g,'');
  const providerTransaction=()=>String(BigInt('0x'+randomUUID().replaceAll('-','').slice(0,12))%99_999_999_999_999n+1n);
  function signedIpn(values:Record<string,string>) {
    const data=new URLSearchParams(Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0)).toString().replace(/\*/g,'%2A');
    return `${data}&vnp_SecureHash=${createHmac('sha512',vnpayConfig.hashSecret).update(data).digest('hex')}`;
  }
  async function ipnFixture() {
    const b=await pendingBooking(),s=await session(b.id);
    const values:Record<string,string>={vnp_TmnCode:'FIXTURE1',vnp_Amount:'110000',vnp_TxnRef:s.transactionRef,
      vnp_BankCode:'NCB',vnp_OrderInfo:'Synthetic isolated DB payment',vnp_TransactionNo:providerTransaction(),
      vnp_PayDate:providerDate(new Date()),vnp_ResponseCode:'00',vnp_TransactionStatus:'00'};
    return {b,s,values,apply:(patch:Record<string,string>={})=>consumeVnpayIpn(prisma,vnpayConfig,signedIpn({...values,...patch}))};
  }
  it('payment review reads preserve receipt snapshots, exclude APPLIED and do not change financial state',async()=>{
    const service=new PaymentReviewsService(prisma),f=await ipnFixture(),result=await f.apply({vnp_Amount:'109900'});
    await prisma.booking.update({where:{id:f.b.id},data:{bookingStatus:'CANCELLED',version:{increment:1}}});
    const before=await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}});
    const receipt=await prisma.vnpayIpnReceipt.findUniqueOrThrow({where:{id:result.eventId}});
    const row=await service.read(result.eventId!);
    expect(row).toMatchObject({id:result.eventId,sessionId:f.s.sessionId,bookingId:f.b.id,bookingCode:f.b.bookingCode,
      expectedAmount:'1100',receivedAmount:'1099',reasonCode:'AMOUNT_MISMATCH',sessionBookingVersion:1,bookingVersion:2,
      bookingStatus:'CANCELLED',paymentStatus:'PENDING',sessionExpiresAt:f.s.expiresAt,provider:'VNPAY_SANDBOX'});
    expect(row.payDate).toBe(receipt.payDate!.toISOString());expect(row.receivedAt).toBe(receipt.receivedAt.toISOString());
    const page=await service.list(1,1);expect(page.data).toEqual([row]);expect(page.meta).toMatchObject({page:1,limit:1,total:1,totalPages:1});
    expect((await service.list(2,1)).data).toEqual([]);
    const exact=await ipnFixture(),applied=await exact.apply();
    await expect(service.read(applied.eventId!)).rejects.toMatchObject({response:{errorCode:'PAYMENT_REVIEW_NOT_FOUND'}});
    await expect(service.read(randomUUID())).rejects.toMatchObject({response:{errorCode:'PAYMENT_REVIEW_NOT_FOUND'}});
    expect(await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).toEqual(before);
    expect(await prisma.vnpayIpnReceipt.findUniqueOrThrow({where:{id:result.eventId}})).toEqual(receipt);
    expect(await prisma.financeJournal.count({where:{bookingId:f.b.id}})).toBe(0);
    for(const field of ['payloadHash','merchantCode','guestName','guestPhone','hashSecret','journalId'])expect(row).not.toHaveProperty(field);
  });
  it('payment review HTTP allows only active Admin and validates pagination UUID envelope and OpenAPI',async()=>{
    const f=await ipnFixture(),review=await f.apply({vnp_Amount:'110100'}),accessSecret='payment-review-fixture-secret-32chars';
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('JWT_ACCESS_SECRET',accessSecret);vi.stubEnv('REDIS_KEY_PREFIX',`review-http:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const base=await app.getUrl(),document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      const token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(accessSecret));
      const bearer=await token(adminId,'ADMIN');
      const http=async(path:string,auth?:string)=>{
        const res=await fetch(`${base}/api/v1/admin/finance/payment-reviews${path}`,{headers:auth?{authorization:`Bearer ${auth}`}:{}});
        return {status:res.status,cache:res.headers.get('cache-control'),body:await res.json()};
      };
      expect((await http('')).status).toBe(401);
      for(const [id,role] of [[tenantId,'TENANT'],[hostId,'HOST'],[tenantId,'ADMIN']])expect((await http('',await token(id,role))).status).toBe(403);
      const detail=await http(`/${review.eventId}`,bearer);expect(detail).toMatchObject({status:200,cache:'no-store',body:{success:true,data:{id:review.eventId,receivedAmount:'1101',expectedAmount:'1100'}}});
      const list=await http('?page=1&limit=1',bearer);expect(list).toMatchObject({status:200,cache:'no-store',body:{success:true,meta:{page:1,limit:1}}});expect(list.body.data).toEqual([detail.body.data]);
      for(const path of ['?page=0','?limit=101','?page=1.5','?unknown=1','/invalid'])expect((await http(path,bearer)).status).toBe(400);
      expect((await http(`/${randomUUID()}`,bearer)).status).toBe(404);
      expect(document.paths['/api/v1/admin/finance/payment-reviews'].get!.responses['200']).toHaveProperty('content.application/json.schema.properties.meta');
      expect(document.paths['/api/v1/admin/finance/payment-reviews/{id}'].get).toBeDefined();
      expect(document.components!.schemas!.PaymentReviewDto.required).toEqual(expect.arrayContaining(Object.keys(detail.body.data)));
      const schema=document.components!.schemas!.PaymentReviewDto;
      expect(schema.properties).toMatchObject({
        bookingCode:{minLength:1,maxLength:32},transactionNo:{pattern:'^[1-9][0-9]{0,14}$'},
        expectedAmount:{type:'string',pattern:'^[1-9][0-9]{0,9}$'},receivedAmount:{type:'string',pattern:'^[1-9][0-9]{0,9}$'},
        sessionBookingVersion:{type:'integer',minimum:1,maximum:2147483647},bookingVersion:{type:'integer',minimum:1,maximum:2147483647},
        bookingStatus:{enum:['PENDING_HOST_APPROVAL','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','CANCELLED_BY_GUEST','REJECTED_BY_HOST','CANCELLED_HOST_TIMEOUT','CANCELLED_TIMEOUT']},
        paymentStatus:{enum:['NOT_CONFIGURED','PENDING','PAID','REFUNDED']},
        payDate:{type:'string',format:'date-time',nullable:true},
      });
      const count=await prisma.vnpayIpnReceipt.count();expect(await http(`/${review.eventId}`,bearer)).toEqual(detail);expect(await prisma.vnpayIpnReceipt.count()).toBe(count);
      await prisma.user.update({where:{id:adminId},data:{status:'BANNED'}});
      expect((await http('',bearer)).status).toBe(401);
    } finally {await prisma.user.update({where:{id:adminId},data:{status:'ACTIVE'}});await app.close();}
  });
  it.skipIf(process.env.S4_PAYMENT_REVIEW_BFF!=='1')('payment review real Next BFF preserves Admin guards and read-only evidence',async()=>{
    const f=await ipnFixture(),review=await f.apply({vnp_Amount:'109900'}),before=await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}});
    const accessSecret='payment-review-bff-fixture-secret-32chars';
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('JWT_ACCESS_SECRET',accessSecret);
    vi.stubEnv('BFF_PROXY_SECRET','payment-review-bff-proxy-fixture-secret-32chars');vi.stubEnv('REDIS_KEY_PREFIX',`review-bff:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let frontend:ReturnType<typeof spawn>|undefined;
    let browser:{close():Promise<void>}|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const base=await app.getUrl(),socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
      const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
      frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
        cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++) {if(frontend.exitCode!==null)throw new Error('Owned review frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}
      expect(ready).toBe(true);
      const token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(accessSecret));
      const bearer=await token(adminId,'ADMIN'),url=origin+'/api/management/admin/finance/payment-reviews';
      const http=async(suffix:string,auth?:string,method='GET')=>{
        const r=await fetch(url+suffix,{method,headers:{cookie:'fixture-private-not-a-credential',...(auth?{authorization:`Bearer ${auth}`}:{})}});
        return {status:r.status,cache:r.headers.get('cache-control'),body:await r.json()};
      };
      expect((await http('')).status).toBe(401);
      expect((await http('',await token(tenantId,'ADMIN'))).status).toBe(403);
      const detail=await http(`/${review.eventId}`,bearer);expect(detail).toMatchObject({status:200,cache:'no-store',body:{success:true,data:{id:review.eventId,receivedAmount:'1099',expectedAmount:'1100'}}});
      const page=await http('?page=1&limit=100',bearer);expect(page.body.data).toContainEqual(detail.body.data);expect(page.body.meta.limit).toBe(100);
      expect((await http('?page=0',bearer)).status).toBe(400);expect((await http(`/${randomUUID()}`,bearer)).status).toBe(404);
      expect((await http(`/${review.eventId}/resolve`,bearer,'POST')).status).toBe(404);
      expect((await http('',bearer,'POST')).status).toBe(404);
      if(process.env.S4_PAYMENT_REVIEW_BROWSER==='1') {
        // Actual login, HttpOnly refresh recovery, BFF and PostgreSQL. The receipt
        // remains a locally signed fixture, not a real provider transaction.
        const password='ReviewBrowserFixture123!';
        const user=await prisma.user.create({data:{phone:'0990000096',fullName:'Synthetic review Admin',role:'ADMIN',isPhoneVerified:true,passwordHash:await bcrypt.hash(password,4)}});
        const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
        const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
        const context=await launched.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
        const methods:string[]=[];page.on('request',(request:{url():string;method():string})=>{
          if(request.url().includes('/api/management/admin/finance/payment-reviews'))methods.push(request.method());
        });
        await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(user.phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
        await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
        await page.goto(origin+'/admin/finance/payment-reviews');await page.getByRole('button',{name:`Xem giao dịch ${detail.body.data.transactionNo}`,exact:true}).click();
        const panel=page.locator('#payment-review-detail');await panel.getByText('1.099đ',{exact:true}).waitFor();
        await panel.getByText('1.100đ',{exact:true}).waitFor();await panel.getByText('Số tiền không khớp',{exact:true}).waitFor();
        expect(await panel.getByText(f.b.bookingCode,{exact:true}).count()).toBe(1);expect(await page.getByRole('form').count()).toBe(0);
        const evidence=resolve('../.tmp/s4-payment-review-real');await mkdir(evidence,{recursive:true});
        for(const width of [375,1440]) {
          await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await page.screenshot({path:resolve(evidence,`detail-${width}.png`),fullPage:true});
        }
        await page.reload();await page.getByRole('button',{name:`Xem giao dịch ${detail.body.data.transactionNo}`,exact:true}).click();
        await page.locator('#payment-review-detail').getByText('1.099đ',{exact:true}).waitFor();
        expect(methods.length).toBeGreaterThanOrEqual(4);expect(methods.every(method=>method==='GET')).toBe(true);
        expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(detail.body.data.transactionNo);
        if(process.env.S4_PAYOUT_NOTIFICATION_BROWSER==='1') {
          // Existing notification UI, real login/BFF/DB. No API interception and
          // no transfer: only a read receipt may change after fixture setup.
          const {fixture,draft}=await historicalPayoutDraft();
          const approve={expectedVersion:1,reason:'Synthetic notice browser approval'};
          await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
          const host=await prisma.user.update({where:{id:fixture.owner},data:{phone:'0990000095',isPhoneVerified:true,passwordHash:await bcrypt.hash(password,4)}});
          const beforeBatch=await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}});
          const beforeJournals=await prisma.financeJournal.count({where:{hostId:host.id}});
          const beforeEvents=await prisma.financePayoutEvent.count({where:{batchId:draft.id}});
          const notices=await payoutNotices.list(host.id,1,20),approved=notices.data.find(row=>row.type==='APPROVED')!;
          expect(notices.meta.unreadCount).toBe(2);
          const hostContext=await launched.newContext({viewport:{width:1440,height:1000}}),hostPage=await hostContext.newPage();
          const requests:{method:string;path:string;body:string|null}[]=[];
          hostPage.on('request',(request:{url():string;method():string;postData():string|null})=>{
            if(request.url().includes('/api/management/host/payout-notifications'))requests.push({method:request.method(),path:new URL(request.url()).pathname,body:request.postData()});
          });
          await hostPage.goto(origin+'/login');await hostPage.getByLabel('Số điện thoại',{exact:true}).fill(host.phone);
          await hostPage.getByLabel('Mật khẩu',{exact:true}).fill(password);await hostPage.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();
          await hostPage.waitForURL(origin+'/account');await hostPage.goto(origin+'/host/finance');
          const region=hostPage.getByRole('region',{name:'Thông báo chi trả'});
          await region.getByText('2 chưa đọc',{exact:true}).waitFor();await region.getByText(approved.message,{exact:true}).waitFor();
          await region.getByRole('button',{name:'Đánh dấu đã đọc: Lô đã được duyệt',exact:true}).click();
          await region.getByText('1 chưa đọc',{exact:true}).waitFor();
          await region.getByRole('button',{name:'Đã đọc: Lô đã được duyệt',exact:true}).waitFor();
          const receipt=await payoutNotices.markRead(host.id,approved.id);expect(receipt.readAt).not.toBeNull();
          await hostPage.reload();await region.getByText('1 chưa đọc',{exact:true}).waitFor();
          await region.getByRole('button',{name:'Đã đọc: Lô đã được duyệt',exact:true}).waitFor();
          expect((await payoutNotices.markRead(host.id,approved.id)).readAt).toBe(receipt.readAt);
          const evidence=resolve('../.tmp/s4-payout-notification-real');await mkdir(evidence,{recursive:true});
          for(const width of [375,1440]) {
            await hostPage.setViewportSize({width,height:1000});expect(await hostPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
            await hostPage.screenshot({path:resolve(evidence,`notices-${width}.png`),fullPage:true});
          }
          expect(requests.filter(row=>row.method==='POST')).toEqual([{method:'POST',path:`/api/management/host/payout-notifications/${approved.id}/read`,body:'{}'}]);
          expect(requests.every(row=>row.method==='GET'||row.method==='POST')).toBe(true);
          expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}})).toEqual(beforeBatch);
          expect(await prisma.financeJournal.count({where:{hostId:host.id}})).toBe(beforeJournals);
          expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id}})).toBe(beforeEvents);
          expect((await db.query('SELECT count(*)::int AS n FROM finance_payout_notification_reads WHERE recipient_id=$1',[host.id])).rows[0].n).toBe(1);
          expect(await hostPage.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(approved.id);
          await hostContext.close();
        }
      }
      expect(await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).toEqual(before);
      expect(await prisma.financeJournal.count({where:{bookingId:f.b.id}})).toBe(0);
    }finally {try{await browser?.close();}finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'exit');frontend.kill();await closed;}await app.close();}}
  },120_000);
  it('S4 realtime real WebSocket enforces Origin/session/ownership and hints only after signed IPN commit',async()=>{
    vi.stubEnv('REALTIME_ENABLED','true');vi.stubEnv('CORS_ORIGINS','http://localhost:3000');
    const secret='realtime-fixture-only-access-secret-32chars';vi.stubEnv('JWT_ACCESS_SECRET',secret);
    const f=await ipnFixture(),{app,http}=await ipnHttpApp();
    const {io}=createRequire(resolve('../frontend/package.json'))('socket.io-client');
    const sockets:Array<ReturnType<typeof io>>=[];
    const token=(id:string,role:string,expires=300)=>new SignJWT({tokenType:'access',role,sessionVersion:0}).setProtectedHeader({alg:'HS256'}).setSubject(id).setExpirationTime(Math.floor(Date.now()/1000)+expires).sign(new TextEncoder().encode(secret));
    const connect=(access:string,origin='http://localhost:3000',query?:Record<string,string>)=>{
      const socket=io(`${app.getHttpServer().address().address==='127.0.0.1'?'http://127.0.0.1':'http://localhost'}:${app.getHttpServer().address().port}/payments`,
        {transports:['websocket'],auth:{token:access},extraHeaders:{Origin:origin},reconnection:false,timeout:2000,query});sockets.push(socket);return socket;
    };
    const opened=(socket:ReturnType<typeof io>)=>new Promise<void>((done,fail)=>{socket.once('connect',done);socket.once('connect_error',fail);});
    const join=(socket:ReturnType<typeof io>,id:string)=>new Promise<unknown>((done,fail)=>socket.timeout(2000).emit('joinBooking',{bookingId:id},(err:unknown,ack:unknown)=>err?fail(err):done(ack)));
    try {
      const guest=connect(await token(tenantId,'TENANT'));await opened(guest);
      const host=connect(await token(hostId,'HOST'));await opened(host);
      const calendar=connect(await token(hostId,'HOST'));await opened(calendar);
      const other=connect(await token(otherHostId,'HOST'));await opened(other);
      expect(await join(guest,f.b.id)).toEqual({ok:true});expect(await join(host,f.b.id)).toEqual({ok:true});
      expect(await join(other,f.b.id)).toEqual({ok:false,errorCode:'BOOKING_NOT_FOUND'});
      const joinUnit=(socket:ReturnType<typeof io>,unitId:string)=>new Promise(done=>socket.emit('joinUnit',{unitId},done));
      expect(await joinUnit(calendar,f.b.homestayUnitId)).toEqual({ok:true});
      expect(await joinUnit(guest,f.b.homestayUnitId)).toEqual({ok:false,errorCode:'UNIT_NOT_FOUND'});
      expect(await joinUnit(other,f.b.homestayUnitId)).toEqual({ok:false,errorCode:'UNIT_NOT_FOUND'});
      expect(await join(guest,'not-uuid')).toEqual({ok:false,errorCode:'INVALID_BOOKING_ID'});
      await expect(opened(connect(await token(tenantId,'TENANT'),'https://untrusted.example'))).rejects.toBeDefined();
      await expect(opened(connect(await token(tenantId,'TENANT'),'http://localhost:3000',{token:'forbidden-url-token'}))).rejects.toBeDefined();
      await expect(opened(connect(await token(tenantId,'TENANT',-1)))).rejects.toBeDefined();
      const guestEvents:unknown[]=[],hostEvents:unknown[]=[],otherEvents:unknown[]=[];
      guest.on('PAYMENT_SUCCESS',(value:unknown)=>guestEvents.push(value));host.on('CALENDAR_UPDATED',(value:unknown)=>hostEvents.push(value));other.on('PAYMENT_SUCCESS',(value:unknown)=>otherEvents.push(value));
      const calendarEvents:unknown[]=[];calendar.on('CALENDAR_UPDATED',(value:unknown)=>calendarEvents.push(value));
      expect((await http(signedIpn(f.values))).body.RspCode).toBe('00');
      await vi.waitFor(()=>expect(guestEvents).toEqual([{bookingId:f.b.id}]));await vi.waitFor(()=>expect(hostEvents).toEqual([{bookingId:f.b.id}]));
      await vi.waitFor(()=>expect(calendarEvents).toEqual([{unitId:f.b.homestayUnitId}]));
      expect(otherEvents).toEqual([]);expect(await prisma.financeJournal.count({where:{bookingId:f.b.id,kind:'PAYMENT'}})).toBe(1);
      expect(JSON.stringify(guestEvents)).not.toMatch(/amount|phone|guestName|signature|transactionNo/);
      // An existing live connection must lose access after server-side revocation.
      await prisma.user.update({where:{id:otherHostId},data:{sessionVersion:{increment:1}}});
      const disconnected=new Promise<void>(done=>other.once('disconnect',()=>done()));other.emit('joinBooking',{bookingId:f.b.id});await disconnected;
      await prisma.user.update({where:{id:otherHostId},data:{sessionVersion:0}});
    } finally {for(const socket of sockets)socket.disconnect();await app.close();vi.stubEnv('REALTIME_ENABLED','false');vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');}
  },30_000);
  it.skipIf(process.env.S4_PAYMENT_UI_BROWSER!=='1')('S4 payment screen and monthly chart use real login BFF DB and never trust return parameters',async()=>{
    const password='PaymentUiFixture123!',hash=await bcrypt.hash(password,4);
    const guest=await prisma.user.create({data:{phone:'0990000088',fullName:'Synthetic payment guest',role:'TENANT',isPhoneVerified:true,passwordHash:hash}});
    const owner=await prisma.user.create({data:{phone:'0990000089',fullName:'Synthetic chart Host',role:'HOST',isPhoneVerified:true,passwordHash:hash}});
    const booking=await paidBooking('FLEXIBLE',240,false,owner.id,true,guest.id);
    await prisma.booking.update({where:{id:booking.id},data:{expiresAt:new Date(Date.now()+600000)}});
    vi.stubEnv('JWT_ACCESS_SECRET','payment-ui-fixture-access-secret-32chars');
    vi.stubEnv('BFF_PROXY_SECRET','payment-ui-fixture-proxy-secret-32chars');
    vi.stubEnv('REALTIME_ENABLED','false');
    const {app,http}=await ipnHttpApp();let frontend:ReturnType<typeof spawn>|undefined;
    let browser:{close():Promise<void>}|undefined;
    try {
      const base=await app.getUrl(),socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
      const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
      frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
        cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:'x-fixture-client-ip'},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned payment frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const evidence=resolve('../.tmp/s4-payment-chart-real');await mkdir(evidence,{recursive:true});
      const context=await launched.newContext({viewport:{width:1440,height:1000},extraHTTPHeaders:{'x-fixture-client-ip':'127.0.0.1'}}),page=await context.newPage();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(guest.phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
      await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.goto(`${origin}/bookings/${booking.id}/payment`);await page.getByText('Chờ thanh toán qua VNPay Sandbox. Chưa có xác nhận từ cổng.',{exact:true}).waitFor();
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,`pending-${width}.png`),fullPage:true});}
      await page.getByRole('button',{name:'Chuẩn bị phiên VNPay Sandbox',exact:true}).click();await page.getByRole('button',{name:'Mở VNPay Sandbox',exact:true}).waitFor();
      const saved=await prisma.paymentSession.findFirstOrThrow({where:{bookingId:booking.id}});
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
      await page.goto(origin+'/payment/return?vnp_ResponseCode=00&vnp_TransactionStatus=00');
      expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).paymentStatus).toBe('PENDING');
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
      await page.goto(`${origin}/bookings/${booking.id}/payment`);
      const raw=signedIpn({vnp_TmnCode:'FIXTURE1',vnp_Amount:'110000',vnp_TxnRef:saved.transactionRef,vnp_BankCode:'NCB',vnp_OrderInfo:'Synthetic UI fixture only',vnp_TransactionNo:providerTransaction(),vnp_PayDate:providerDate(new Date()),vnp_ResponseCode:'00',vnp_TransactionStatus:'00'});
      expect((await http(raw)).body.RspCode).toBe('00');await page.getByRole('button',{name:'Kiểm tra lại',exact:true}).click();
      await page.getByText('Máy chủ đã xác minh thanh toán VNPay Sandbox.',{exact:true}).waitFor();
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,`verified-fixture-${width}.png`),fullPage:true});}
      const hostContext=await launched.newContext({viewport:{width:1440,height:1000},extraHTTPHeaders:{'x-fixture-client-ip':'127.0.0.1'}}),hostPage=await hostContext.newPage();
      await hostPage.goto(origin+'/login');await hostPage.getByLabel('Số điện thoại',{exact:true}).fill(owner.phone);await hostPage.getByLabel('Mật khẩu',{exact:true}).fill(password);
      await hostPage.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await hostPage.waitForURL(origin+'/account');
      await hostPage.goto(origin+'/host/finance');const chart=hostPage.getByRole('region',{name:'Tài chính theo tháng ghi sổ',exact:true});
      await chart.getByText('990đ',{exact:true}).waitFor();await chart.getByRole('button',{name:'Đã chi trả thủ công',exact:true}).click();
      expect(await chart.getByText('0đ',{exact:true}).count()).toBe(12);
      await chart.getByRole('button',{name:'Thu nhập ghi sổ',exact:true}).click();
      for(const width of [375,1440]){await hostPage.setViewportSize({width,height:1000});expect(await hostPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await hostPage.screenshot({path:resolve(evidence,`revenue-${width}.png`),fullPage:true});}
      await chart.getByRole('button',{name:'Năm trước',exact:true}).click();await chart.getByText(/Chưa có thu nhập ghi sổ trong năm/).waitFor();
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id,kind:'PAYMENT'}})).toBe(1);
      // Real Auth/BFF/PostgreSQL, but the IPN and trusted proxy header are synthetic fixtures. No gateway or money transfer.
    }finally{await browser?.close();if(frontend && frontend.exitCode===null){const stopped=once(frontend,'exit');frontend.kill();await stopped;}await app.close();}
  },90_000);
  async function ipnHttpApp() {
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('REDIS_KEY_PREFIX',`vnpay-http:${randomUUID()}:`);
    vi.stubEnv('VNPAY_SANDBOX_ENABLED','true');vi.stubEnv('VNPAY_TMN_CODE',vnpayConfig.tmnCode);vi.stubEnv('VNPAY_HASH_SECRET',vnpayConfig.hashSecret);vi.stubEnv('VNPAY_RETURN_URL',vnpayConfig.returnUrl);vi.stubEnv('VNPAY_IPN_IP_LIMIT_PER_MINUTE','240');
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});
    app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
    const base=await app.getUrl();
    return {app,http:async(raw:string)=>{
      const res=await fetch(`${base}/api/v1/payments/vnpay/ipn?${raw}`);
      return {status:res.status,cache:res.headers.get('cache-control'),retry:res.headers.get('retry-after'),body:await res.json()};
    }};
  }
  it('S4 VNPay public IPN HTTP uses provider JSON not API envelope and commits once before ACK',async()=>{
    const f=await ipnFixture(),{app,http}=await ipnHttpApp(),raw=signedIpn(f.values);
    try {
      expect(await http(raw.replace(/.$/,'z'))).toMatchObject({status:200,cache:'no-store',body:{RspCode:'97'}});
      expect(await prisma.vnpayIpnReceipt.count({where:{sessionId:f.s.sessionId}})).toBe(0);
      const [a,b]=await Promise.all([http(raw),http(raw)]);expect(a).toEqual(b);expect(a).toMatchObject({status:200,cache:'no-store',body:{RspCode:'00',Message:'Notification received'}});
      expect(Object.keys(a.body).sort()).toEqual(['Message','RspCode']);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).toMatchObject({paymentStatus:'PAID',bookingStatus:'CONFIRMED',version:2});
      expect(await prisma.financeJournal.count({where:{bookingId:f.b.id,kind:'PAYMENT'}})).toBe(1);
      expect(await prisma.vnpayIpnReceipt.count({where:{sessionId:f.s.sessionId}})).toBe(1);
      expect((await http(signedIpn({...f.values,vnp_Amount:'109900'}))).body.RspCode).toBe('99');
      expect(await prisma.financeJournal.count({where:{bookingId:f.b.id}})).toBe(1);
      const document=SwaggerModule.createDocument(app,new DocumentBuilder().build());
      expect(document.paths['/api/v1/payments/vnpay/ipn'].get!.responses['200']).toHaveProperty('content.application/json.schema.properties.RspCode');
      expect(document.paths['/api/v1/payments/vnpay/ipn'].get!.security).toBeUndefined();
    } finally {await app.close();vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');}
  });
  it('S4 VNPay public IPN HTTP keeps mismatched late failed notifications out of booking earnings and locks missing configuration',async()=>{
    const under=await ipnFixture(),over=await ipnFixture(),late=await ipnFixture(),failed=await ipnFixture(),{app,http}=await ipnHttpApp();
    try {
      for(const [f,amount] of [[under,'109900'],[over,'110100']] as const) {
        expect((await http(signedIpn({...f.values,vnp_Amount:amount}))).body.RspCode).toBe('04');
        expect(await prisma.vnpayIpnReceipt.findFirst({where:{sessionId:f.s.sessionId}})).toMatchObject({outcome:'REVIEW',reasonCode:'AMOUNT_MISMATCH',journalId:null});
      }
      await prisma.booking.update({where:{id:late.b.id},data:{bookingStatus:'CANCELLED_TIMEOUT',version:{increment:1}}});
      const before=await prisma.booking.findUniqueOrThrow({where:{id:late.b.id}});
      expect((await http(signedIpn(late.values))).body.RspCode).toBe('00'); // Durable receipt ACK, NOT booking payment success.
      expect(await prisma.booking.findUniqueOrThrow({where:{id:late.b.id}})).toEqual(before);
      expect(await prisma.vnpayIpnReceipt.findFirst({where:{sessionId:late.s.sessionId}})).toMatchObject({outcome:'REVIEW',reasonCode:'BOOKING_NOT_PAYABLE',journalId:null});
      expect((await http(signedIpn({...failed.values,vnp_ResponseCode:'24'}))).body.RspCode).toBe('00');
      for(const f of [under,over,late,failed])expect(await prisma.financeJournal.count({where:{bookingId:f.b.id}})).toBe(0);
      expect(await prisma.vnpayIpnReceipt.count({where:{sessionId:failed.s.sessionId}})).toBe(0);
      expect((await http(signedIpn({...failed.values,vnp_TxnRef:randomUUID().replaceAll('-','')}))).body.RspCode).toBe('01');
      expect((await http(signedIpn(failed.values)+'&vnp_Amount=1')).body.RspCode).toBe('99');
      vi.stubEnv('VNPAY_IPN_IP_LIMIT_PER_MINUTE','1');expect(await http(signedIpn(failed.values))).toMatchObject({status:429,retry:'60',body:{RspCode:'99'}});
      vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');expect(await http(signedIpn(failed.values))).toMatchObject({status:503,body:{RspCode:'99'}});
      expect(await prisma.financeJournal.count({where:{bookingId:failed.b.id}})).toBe(0);
    } finally {await app.close();vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');vi.stubEnv('VNPAY_IPN_IP_LIMIT_PER_MINUTE','240');}
  });
  it('S4 VNPay public IPN HTTP never ACKs success on DB rollback and safely accepts the identical retry',async()=>{
    const f=await ipnFixture(),{app,http}=await ipnHttpApp(),raw=signedIpn(f.values);
    try {
      await db.query("CREATE FUNCTION ipn_http_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic IPN HTTP rollback'; END $$");
      await db.query('CREATE TRIGGER ipn_http_fixture_fail BEFORE INSERT ON vnpay_ipn_receipts FOR EACH ROW EXECUTE FUNCTION ipn_http_fixture_fail()');
      try {
        expect(await http(raw)).toMatchObject({status:503,body:{RspCode:'99'}});
        expect(await prisma.financeJournal.count({where:{bookingId:f.b.id}})).toBe(0);
        expect(await prisma.vnpayIpnReceipt.count({where:{sessionId:f.s.sessionId}})).toBe(0);
        expect(await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).toMatchObject({paymentStatus:'PENDING',bookingStatus:'PENDING_PAYMENT',version:1});
      } finally {await db.query('DROP TRIGGER ipn_http_fixture_fail ON vnpay_ipn_receipts');await db.query('DROP FUNCTION ipn_http_fixture_fail()');}
      expect((await http(raw)).body.RspCode).toBe('00');expect(await prisma.financeJournal.count({where:{bookingId:f.b.id}})).toBe(1);
    } finally {await app.close();vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');}
  });
  it('S4 VNPay payment session HTTP creates and recovers only own pending sessions with exact seven-day replay and Swagger',async()=>{
    const secret='session-http-fixture-access-secret-32chars';vi.stubEnv('JWT_ACCESS_SECRET',secret);
    const b=await pendingBooking(),other=await pendingBooking(),{app}=await ipnHttpApp();
    try {
      const base=await app.getUrl(),token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(secret));
      const bearer=await token(tenantId,'TENANT'),key=randomUUID(),body={expectedVersion:1};
      const http=async(id:string,method='GET',auth:string|null=bearer,input:unknown=body,retryKey:string|null=key)=>{
        const res=await fetch(`${base}/api/v1/bookings/${id}/payment-session`,{method,headers:{...(auth?{authorization:`Bearer ${auth}`}:{ }),...(method==='POST'?{'content-type':'application/json',...(retryKey?{'idempotency-key':retryKey}:{})}:{})},...(method==='POST'?{body:JSON.stringify(input)}:{})});
        return {status:res.status,cache:res.headers.get('cache-control'),body:await res.json()};
      };
      expect((await http(b.id,'GET',null)).status).toBe(401);
      expect((await http(b.id,'GET',await token(adminId,'ADMIN'))).status).toBe(403);
      expect((await http(b.id,'GET',await token(otherHostId,'HOST'))).status).toBe(404);
      expect((await http(b.id)).body.errorCode).toBe('PAYMENT_SESSION_NOT_FOUND');expect(await prisma.paymentSession.count({where:{bookingId:b.id}})).toBe(0);
      expect((await http(b.id,'POST',bearer,body,null)).status).toBe(400);
      expect((await http(b.id,'POST',bearer,{expectedVersion:2},randomUUID())).body.errorCode).toBe('STALE_BOOKING_VERSION');
      expect((await http(b.id,'POST',bearer,{...body,amountVnd:'1'})).status).toBe(400);
      const [a,c]=await Promise.all([http(b.id,'POST'),http(b.id,'POST')]);expect(a).toEqual(c);expect(a).toMatchObject({status:200,cache:'no-store',body:{success:true,data:{provider:'VNPAY_SANDBOX',mode:'REDIRECT',bookingId:b.id,amountVnd:'1100',expiresAt:b.expiresAt.toISOString()}}});
      const url=new URL(a.body.data.redirectUrl);expect(url.origin+url.pathname).toBe('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html');expect(url.searchParams.get('vnp_Amount')).toBe('110000');
      expect((await http(b.id)).body.data).toEqual(a.body.data);
      expect(await prisma.paymentSession.count({where:{bookingId:b.id}})).toBe(1);
      expect((await http(other.id,'POST')).body.errorCode).toBe('IDEMPOTENCY_CONFLICT');
      expect((await http(b.id,'POST',bearer,{expectedVersion:2})).body.errorCode).toBe('IDEMPOTENCY_CONFLICT');
      const record=await prisma.bookingIdempotency.findFirstOrThrow({where:{userId:tenantId,operation:'PAYMENT_SESSION',key}});
      expect(record.expiresAt.getTime()-record.createdAt.getTime()).toBe(7*86400000);
      const values={vnp_TmnCode:'FIXTURE1',vnp_Amount:'110000',vnp_TxnRef:a.body.data.transactionRef,vnp_BankCode:'NCB',vnp_OrderInfo:'Synthetic session HTTP payment',vnp_TransactionNo:providerTransaction(),vnp_PayDate:providerDate(new Date()),vnp_ResponseCode:'00',vnp_TransactionStatus:'00'};
      await consumeVnpayIpn(prisma,vnpayConfig,signedIpn(values));
      expect(await http(b.id,'POST')).toEqual(a);expect((await http(b.id)).body.errorCode).toBe('BOOKING_NOT_PAYABLE');
      const doc=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      expect(doc.components!.schemas!.BookingPaymentSessionDto.required).toEqual(expect.arrayContaining(Object.keys(a.body.data)));
      expect(doc.paths['/api/v1/bookings/{id}/payment-session'].post!.responses['200']).toHaveProperty('content.application/json.schema.properties.data');
    } finally {await app.close();vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');}
  });
  it('VNPay IPN consumer atomically confirms exact signed payment once with snapshot commission and durable replay',async()=>{
    const f=await ipnFixture(),before=await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}});
    const [a,b]=await Promise.all([f.apply(),f.apply()]);expect(a).toEqual(b);expect(a).toMatchObject({outcome:'APPLIED',reasonCode:'MATCHED',bookingId:f.b.id});
    const current=await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}});
    expect(current).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',version:before.version+1});
    expect(current.expiresAt).toEqual(before.expiresAt);expect(current.nightlyPrices).toEqual(before.nightlyPrices);expect(current.policySnapshot).toEqual(before.policySnapshot);
    const journal=await prisma.$transaction(tx=>verifiedPaymentSource(tx,current,hostId));
    const entries=(await db.query('SELECT account,side,amount::text AS amount FROM finance_entries WHERE journal_id=$1 ORDER BY line_number',[journal])).rows;
    expect(entries).toEqual([{account:'CASH_CLEARING',side:'DEBIT',amount:'1100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'990'},{account:'PLATFORM_COMMISSION',side:'CREDIT',amount:'110'}]);
    const receipt=(await db.query('SELECT * FROM vnpay_ipn_receipts WHERE id=$1',[a.eventId])).rows[0];
    expect(receipt.journal_id).toBe(journal);expect(receipt.amount_vnd).toBe('1100');expect(receipt).not.toHaveProperty('raw_query');expect(receipt).not.toHaveProperty('secure_hash');
    expect(await f.apply()).toEqual(a);
    expect(await new BookingExpiryService(prisma).expire(f.b.id)).toBe(false);
    const cancel=await guestCancellation(current);await cancel.run();
    expect(await f.apply()).toEqual(a); // replay after later cancellation cannot resurrect inventory
    expect((await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).bookingStatus).toBe('CANCELLED_BY_GUEST');
  });
  it('S4 configured hold HTTP quotes reserves awaits Host and creates one session without fake payment',async()=>{
    const secret='configured-hold-fixture-access-secret-32chars';vi.stubEnv('JWT_ACCESS_SECRET',secret);
    const {app,http:ipn}=await ipnHttpApp();vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT','false');
    try {
      const base=await app.getUrl(),token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(secret));
      const guest=await token(tenantId,'TENANT'),host=await token(hostId,'HOST');
      const post=async(path:string,body:unknown,auth=guest,key=randomUUID())=>{
        const res=await fetch(`${base}/api/v1/${path}`,{method:'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json','idempotency-key':key},body:JSON.stringify(body)});
        return {status:res.status,body:await res.json()};
      };
      for(const instantBook of [true,false]) {
        const old=await pendingBooking();await prisma.homestayUnit.update({where:{id:old.homestayUnitId},data:{instantBook}});
        const checkIn=new Date(old.checkOutDate.getTime()+7*86400000).toISOString().slice(0,10),checkOut=new Date(old.checkOutDate.getTime()+9*86400000).toISOString().slice(0,10);
        const query=new URLSearchParams({unitId:old.homestayUnitId,checkIn,checkOut,adults:'1',children:'0'});
        const quoteRes=await fetch(`${base}/api/v1/homestays/check-availability?${query}`);expect(quoteRes.status).toBe(200);
        const quote=(await quoteRes.json()).data;expect(quote.isAvailable).toBe(true);
        const input={unitId:old.homestayUnitId,checkInDate:checkIn,checkOutDate:checkOut,numAdults:1,numChildren:0,guestName:'Synthetic hold guest',guestPhone:'0990000001',quoteToken:quote.quoteToken};
        const key=randomUUID();
        vi.stubEnv('VNPAY_HASH_SECRET','');vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT','true');
        expect((await post('bookings/hold',input,guest,key)).body.errorCode).toBe('PAYMENT_NOT_CONFIGURED');
        expect(await prisma.booking.count({where:{homestayUnitId:old.homestayUnitId,checkInDate:new Date(checkIn)}})).toBe(0);
        vi.stubEnv('VNPAY_HASH_SECRET',vnpayConfig.hashSecret);vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT','false');
        expect((await post('bookings/hold',input,host)).body.errorCode).toBe('SELF_BOOKING_NOT_ALLOWED');
        const a=await post('bookings/hold',input,guest,key);expect(a).toMatchObject({status:201,body:{success:true,data:{bookingStatus:instantBook?'PENDING_PAYMENT':'PENDING_HOST_APPROVAL',paymentStatus:'PENDING',payment:null,totalAmount:quote.priceBreakdown.totalAmount}}});
        expect(await post('bookings/hold',input,guest,key)).toEqual(a);
        const id=a.body.data.bookingId;expect(await prisma.financeJournal.count({where:{bookingId:id}})).toBe(0);expect(await prisma.paymentSession.count({where:{bookingId:id}})).toBe(0);
        expect((await post('bookings/hold',input)).body.errorCode).toBe('ROOM_ALREADY_LOCKED');
        let version=1;
        if(!instantBook) {
          expect((await post(`bookings/${id}/payment-session`,{expectedVersion:1})).body.errorCode).toBe('BOOKING_NOT_PAYABLE');
          expect((await post(`host/bookings/${id}/accept`,{expectedVersion:1},host)).body.data).toMatchObject({bookingStatus:'PENDING_PAYMENT',paymentStatus:'PENDING',version:2,payment:null});version=2;
        }
        const session=await post(`bookings/${id}/payment-session`,{expectedVersion:version});expect(session.status).toBe(200);
        expect(session.body.data.amountVnd).toBe(String(quote.priceBreakdown.totalAmount));
        expect((await prisma.booking.findUniqueOrThrow({where:{id}})).paymentStatus).toBe('PENDING');
        const values={vnp_TmnCode:'FIXTURE1',vnp_Amount:String(quote.priceBreakdown.totalAmount*100),vnp_TxnRef:session.body.data.transactionRef,vnp_BankCode:'NCB',vnp_OrderInfo:'Synthetic configured hold',vnp_TransactionNo:providerTransaction(),vnp_PayDate:providerDate(new Date()),vnp_ResponseCode:'00',vnp_TransactionStatus:'00'};
        expect((await ipn(signedIpn(values))).body.RspCode).toBe('00');
        expect(await prisma.booking.findUniqueOrThrow({where:{id}})).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',version:version+1});
        expect(await prisma.financeJournal.count({where:{bookingId:id,kind:'PAYMENT'}})).toBe(1);
        expect(await prisma.booking.findUniqueOrThrow({where:{id:old.id}})).toMatchObject({paymentStatus:'PENDING',version:1});
      }
    } finally {await app.close();vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');vi.stubEnv('BOOKING_ALLOW_UNCONFIGURED_PAYMENT','true');}
  });
  it('VNPay IPN consumer rejects invalid signature before DB and does not apply a signed failure',async()=>{
    const f=await ipnFixture(),calls=vi.fn();
    await expect(consumeVnpayIpn({$transaction:calls} as unknown as PrismaService,vnpayConfig,signedIpn(f.values).replace(/.$/,'z'))).rejects.toMatchObject({response:{errorCode:'INVALID_VNPAY_SIGNATURE'}});
    expect(calls).not.toHaveBeenCalled();
    expect(await f.apply({vnp_ResponseCode:'24'})).toEqual({outcome:'NOT_SUCCESS'});
    expect(await f.apply({vnp_TransactionStatus:'02'})).toEqual({outcome:'NOT_SUCCESS'});
    expect((await db.query('SELECT count(*)::int AS count FROM vnpay_ipn_receipts WHERE session_id=$1',[f.s.sessionId])).rows[0].count).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).paymentStatus).toBe('PENDING');
  });
  it('S4 payment status HTTP requires immutable provider proof and keeps historical receipt private',async()=>{
    const secret='payment-proof-fixture-access-secret-32chars';vi.stubEnv('JWT_ACCESS_SECRET',secret);
    const f=await ipnFixture(),legacy=await paidBooking(),review=await ipnFixture(),{app}=await ipnHttpApp();
    try {
      const token=await new SignJWT({tokenType:'access',sessionVersion:0,role:'TENANT'}).setProtectedHeader({alg:'HS256'}).setSubject(tenantId).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(secret));
      const base=await app.getUrl(),read=async(id:string)=>{
        const res=await fetch(`${base}/api/v1/bookings/${id}/payment-status`,{headers:{authorization:`Bearer ${token}`}});
        expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');return (await res.json()).data;
      };
      expect(await read(f.b.id)).toMatchObject({providerConnected:true,paymentStatus:'PENDING',payment:null});
      expect(await read(legacy.id)).toMatchObject({providerConnected:true,paymentStatus:'PAID',payment:null});
      await review.apply({vnp_Amount:'109900'});expect((await read(review.b.id)).payment).toBeNull();
      const applied=await f.apply(),receipt=await prisma.vnpayIpnReceipt.findUniqueOrThrow({where:{id:applied.eventId}});
      const expected={provider:'VNPAY_SANDBOX',verified:true,sessionId:f.s.sessionId,amountVnd:'1100',paidAt:receipt.payDate!.toISOString()};
      expect(await read(f.b.id)).toMatchObject({providerConnected:true,paymentStatus:'PAID',bookingStatus:'CONFIRMED',payment:expected});
      const cancel=await guestCancellation(await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}}));await cancel.run();
      vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');
      const status=await read(f.b.id);expect(status).toMatchObject({providerConnected:false,bookingStatus:'CANCELLED_BY_GUEST',payment:expected,reservationExpiresAt:null});
      for(const field of ['guestPhone','guestName','hashSecret','transactionNo','merchantCode','journalId'])expect(status).not.toHaveProperty(field);
      expect(Object.keys(status.payment).sort()).toEqual(['amountVnd','paidAt','provider','sessionId','verified']);
      expect(await prisma.vnpayIpnReceipt.findUniqueOrThrow({where:{id:receipt.id}})).toEqual(receipt);
      const doc=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      expect(doc.components!.schemas!.BookingPaymentStatusDto).toMatchObject({properties:{providerConnected:{type:'boolean'}}});
      expect(doc.components!.schemas!.BookingVerifiedPaymentDto.required).toHaveLength(5);
    }finally{await app.close();vi.stubEnv('VNPAY_SANDBOX_ENABLED','false');}
  });
  it('VNPay IPN consumer stores under/over as review evidence without summing them or posting Host money',async()=>{
    const f=await ipnFixture();
    for(const vnp_Amount of ['109900','110100']) {
      const result=await f.apply({vnp_Amount,vnp_TransactionNo:providerTransaction()});
      expect(result).toMatchObject({outcome:'REVIEW',reasonCode:'AMOUNT_MISMATCH'});
    }
    expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE booking_id=$1',[f.b.id])).rows[0].count).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}}))).toMatchObject({bookingStatus:'PENDING_PAYMENT',paymentStatus:'PENDING',version:1});
    expect((await db.query('SELECT count(*)::int AS count FROM vnpay_ipn_receipts WHERE session_id=$1 AND outcome=$2',[f.s.sessionId,'REVIEW'])).rows[0].count).toBe(2);
  });
  it('VNPay IPN consumer stores expired/cancelled payment for review and never restores room availability',async()=>{
    for(const cancelled of [false,true]) {
      const f=await ipnFixture();
      if(cancelled) await prisma.booking.update({where:{id:f.b.id},data:{bookingStatus:'CANCELLED_BY_GUEST',version:{increment:1}}});
      else {await prisma.booking.update({where:{id:f.b.id},data:{expiresAt:new Date(Date.now()-1000)}});await new BookingExpiryService(prisma).expire(f.b.id);}
      const before=await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}});
      expect(await f.apply()).toMatchObject({outcome:'REVIEW',reasonCode:'BOOKING_NOT_PAYABLE'});
      const after=await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}});
      expect(after.bookingStatus).toBe(before.bookingStatus);expect(after.expiresAt).toEqual(before.expiresAt);expect(after.version).toBe(before.version);expect(after.paymentStatus).toBe('PENDING');
    }
  });
  it('VNPay IPN consumer fails closed on missing/early/future payment time and stale session',async()=>{
    for(const time of [null,'20200101000000',providerDate(new Date(Date.now()+3600000))]) {
      const f=await ipnFixture();if(time===null)delete f.values.vnp_PayDate;else f.values.vnp_PayDate=time;
      expect(await f.apply()).toMatchObject({outcome:'REVIEW',reasonCode:'PAYMENT_TIME_INVALID'});
    }
    const f=await ipnFixture();await prisma.booking.update({where:{id:f.b.id},data:{version:{increment:1}}});
    expect(await f.apply()).toMatchObject({outcome:'REVIEW',reasonCode:'SESSION_CHANGED'});
  });
  it('VNPay IPN consumer keeps provider identity permanent and rejects altered payload or reused identity across sessions',async()=>{
    const f=await ipnFixture(),original=await f.apply();
    await expect(f.apply({vnp_Amount:'110100'})).rejects.toMatchObject({response:{errorCode:'PAYMENT_EVENT_CONFLICT'}});
    const other=await ipnFixture();
    await expect(other.apply({vnp_TransactionNo:f.values.vnp_TransactionNo})).rejects.toMatchObject({response:{errorCode:'PAYMENT_EVENT_CONFLICT'}});
    expect(await f.apply()).toEqual(original);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:other.b.id}})).paymentStatus).toBe('PENDING');
    await expect(f.apply({vnp_TransactionNo:'0'+f.values.vnp_TransactionNo})).rejects.toMatchObject({response:{errorCode:'PAYMENT_EVENT_CONFLICT'}});
  });
  it('VNPay IPN consumer concurrent distinct transactions yield only one payment journal, the second remains review',async()=>{
    const f=await ipnFixture();
    const results=await Promise.all([f.apply(),f.apply({vnp_TransactionNo:providerTransaction()})]);
    expect(results.map(r=>r.outcome).sort()).toEqual(['APPLIED','REVIEW']);
    expect((await db.query("SELECT count(*)::int AS count FROM finance_journals WHERE booking_id=$1 AND kind='PAYMENT'",[f.b.id])).rows[0].count).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).version).toBe(2);
  });
  it('VNPay IPN consumer does not invent an unknown session or silently replace an unsupported payment source',async()=>{
    const f=await ipnFixture();
    await expect(f.apply({vnp_TxnRef:'UNKNOWNREFERENCE'})).rejects.toMatchObject({status:404});
    await append({eventKey:'fixture:preexisting:'+randomUUID(),kind:'PAYMENT',bookingId:f.b.id,hostId,actorId:null,reason:'Synthetic unsupported prior payment',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'1'}]});
    expect(await f.apply()).toMatchObject({outcome:'REVIEW',reasonCode:'SOURCE_EXISTS'});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}})).paymentStatus).toBe('PENDING');
  });
  it('VNPay IPN DB requires journal and booking confirmation together; partial writes roll back and retry remains possible',async()=>{
    const f=await ipnFixture();
    await expect(prisma.$transaction(async tx=>{
      const journal=await appendFinancialJournal(tx,{eventKey:`vnpay-paid:FIXTURE1:${f.values.vnp_TransactionNo}`,kind:'PAYMENT',bookingId:f.b.id,hostId,actorId:null,reason:'Synthetic partial proof',
        lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'990'},{account:'PLATFORM_COMMISSION',side:'CREDIT',amount:'110'}]});
      await tx.$executeRaw`INSERT INTO vnpay_ipn_receipts(session_id,merchant_code,transaction_no,payload_hash,amount_vnd,pay_date,outcome,reason_code,journal_id)
        VALUES(${f.s.sessionId}::uuid,'FIXTURE1',${f.values.vnp_TransactionNo},${'a'.repeat(64)},1100,date_trunc('second',clock_timestamp()),'APPLIED','MATCHED',${journal.journalId}::uuid)`;
      // Intentionally omit booking transition; deferred DB proof, not app code, must reject commit.
    })).rejects.toThrow('VNPay receipt requires atomic exact payment journal and booking confirmation');
    expect((await db.query('SELECT count(*)::int AS count FROM vnpay_ipn_receipts WHERE session_id=$1',[f.s.sessionId])).rows[0].count).toBe(0);
    expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE booking_id=$1',[f.b.id])).rows[0].count).toBe(0);
    expect(await f.apply()).toMatchObject({outcome:'APPLIED'});
  });
  it('VNPay IPN receipt DB is append-only and rejects a forged merchant',async()=>{
    const f=await ipnFixture(),result=await f.apply();
    await expect(db.query("UPDATE vnpay_ipn_receipts SET reason_code='SOURCE_EXISTS' WHERE id=$1",[result.eventId])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM vnpay_ipn_receipts WHERE id=$1',[result.eventId])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE vnpay_ipn_receipts')).rejects.toThrow('append-only');
    await expect(db.query(`INSERT INTO vnpay_ipn_receipts(session_id,merchant_code,transaction_no,payload_hash,amount_vnd,outcome,reason_code)
      VALUES($1,'FIXTURE2',$2,$3,1100,'REVIEW','SOURCE_EXISTS')`,[f.s.sessionId,providerTransaction(),'b'.repeat(64)])).rejects.toThrow('matching merchant session');
  });
  it('VNPay IPN DB rechecks entry and booking writes even after constraints are forced early',async()=>{
    for(const tamper of ['entries','booking','second-source']) {
      const f=await ipnFixture();
      await expect(prisma.$transaction(async tx=>{
        const journal=await appendFinancialJournal(tx,{eventKey:`vnpay-paid:FIXTURE1:${f.values.vnp_TransactionNo}`,kind:'PAYMENT',bookingId:f.b.id,hostId,actorId:null,reason:'Synthetic early constraint proof',
          lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'990'},{account:'PLATFORM_COMMISSION',side:'CREDIT',amount:'110'}]});
        await tx.$executeRaw`INSERT INTO vnpay_ipn_receipts(session_id,merchant_code,transaction_no,payload_hash,amount_vnd,pay_date,outcome,reason_code,journal_id)
          VALUES(${f.s.sessionId}::uuid,'FIXTURE1',${f.values.vnp_TransactionNo},${'a'.repeat(64)},1100,date_trunc('second',clock_timestamp()),'APPLIED','MATCHED',${journal.journalId}::uuid)`;
        await tx.$executeRaw`UPDATE bookings SET booking_status='CONFIRMED',payment_status='PAID',version=version+1 WHERE id=${f.b.id}::uuid`;
        await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
        if(tamper==='entries') await tx.$executeRaw`INSERT INTO finance_entries(journal_id,line_number,account,side,amount)
          VALUES(${journal.journalId}::uuid,4,'CASH_CLEARING','DEBIT',1),(${journal.journalId}::uuid,5,'HOST_PAYABLE','CREDIT',1)`;
        else if(tamper==='booking') await tx.$executeRaw`UPDATE bookings SET booking_status='CANCELLED_BY_GUEST',version=version+1 WHERE id=${f.b.id}::uuid`;
        else {
          // Keep only the general balance check deferred so the second source
          // reaches VNPay provenance validation, not an unrelated empty-journal error.
          await tx.$executeRaw`SET CONSTRAINTS finance_journal_balanced,finance_entries_balanced DEFERRED`;
          await appendFinancialJournal(tx,{eventKey:`fixture:second-ipn-source:${randomUUID()}`,kind:'PAYMENT',bookingId:f.b.id,hostId,actorId:null,reason:'Synthetic extra source',
            lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'1'}]});
        }
      })).rejects.toThrow('VNPay receipt requires atomic exact payment journal and booking confirmation');
      expect((await prisma.booking.findUniqueOrThrow({where:{id:f.b.id}}))).toMatchObject({bookingStatus:'PENDING_PAYMENT',paymentStatus:'PENDING',version:1});
      expect(await f.apply()).toMatchObject({outcome:'APPLIED'});
    }
  });
  it('VNPay session stores exact DB booking snapshot and concurrent calls reuse one durable session',async()=>{
    const b=await pendingBooking();
    const [a,c]=await Promise.all([session(b.id),session(b.id.toUpperCase(),tenantId.toUpperCase())]);
    expect(a).toEqual(c);expect(a).toMatchObject({bookingId:b.id,amountVnd:'1100',expiresAt:b.expiresAt.toISOString()});
    expect(a.transactionRef).toBe(a.sessionId.replaceAll('-',''));
    expect(new URL(a.redirectUrl).searchParams.get('vnp_Amount')).toBe('110000');
    const rows=(await db.query('SELECT * FROM payment_sessions WHERE booking_id=$1',[b.id])).rows;
    expect(rows).toHaveLength(1);expect(rows[0].created_at.toISOString()).toBe(a.createdAt);
    expect(rows[0]).not.toHaveProperty('hash_secret');expect(rows[0]).not.toHaveProperty('redirect_url');
    expect(await session(b.id)).toEqual(a); // reconnect/retry reads durable session, not process memory
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});
    expect(current.bookingStatus).toBe('PENDING_PAYMENT');expect(current.paymentStatus).toBe('PENDING');expect(current.version).toBe(b.version);
    expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE booking_id=$1',[b.id])).rows[0].count).toBe(0);
  });
  it('VNPay session denies wrong ownership/role/version and never promotes NOT_CONFIGURED or pending Host approval',async()=>{
    const b=await pendingBooking();
    await expect(session(b.id,otherHostId)).rejects.toMatchObject({status:404});
    await expect(session(b.id,adminId)).rejects.toMatchObject({status:403});
    await expect(session(b.id,tenantId,2)).rejects.toMatchObject({response:{errorCode:'STALE_BOOKING_VERSION'}});
    await prisma.booking.update({where:{id:b.id},data:{paymentStatus:'NOT_CONFIGURED'}});
    await expect(session(b.id)).rejects.toMatchObject({response:{errorCode:'BOOKING_NOT_PAYABLE'}});
    await prisma.booking.update({where:{id:b.id},data:{paymentStatus:'PENDING',bookingStatus:'PENDING_HOST_APPROVAL'}});
    await expect(session(b.id)).rejects.toMatchObject({response:{errorCode:'BOOKING_NOT_PAYABLE'}});
    expect((await db.query('SELECT count(*)::int AS count FROM payment_sessions WHERE booking_id=$1',[b.id])).rows[0].count).toBe(0);
  });
  it('VNPay session rollback removes the session; invalid config/IP cannot persist a link',async()=>{
    const b=await pendingBooking();
    await expect(prisma.$transaction(async tx=>{await persistVnpaySession(tx,tenantId,b.id,1,vnpayConfig,'127.0.0.1');throw new Error('synthetic session rollback');})).rejects.toThrow('synthetic session rollback');
    await expect(session(b.id,tenantId,1,{...vnpayConfig,hashSecret:''})).rejects.toMatchObject({status:503});
    await expect(prisma.$transaction(tx=>persistVnpaySession(tx,tenantId,b.id,1,vnpayConfig,'invalid-ip'))).rejects.toMatchObject({status:400});
    expect((await db.query('SELECT count(*)::int AS count FROM payment_sessions WHERE booking_id=$1',[b.id])).rows[0].count).toBe(0);
    expect((await session(b.id)).amountVnd).toBe('1100');
  });
  it('VNPay session cannot change merchant or silently reuse a changed booking snapshot',async()=>{
    const b=await pendingBooking();await session(b.id);
    await expect(session(b.id,tenantId,1,{...vnpayConfig,tmnCode:'FIXTURE2'})).rejects.toMatchObject({response:{errorCode:'PAYMENT_SESSION_REVIEW_REQUIRED'}});
    await prisma.booking.update({where:{id:b.id},data:{version:{increment:1}}});
    await expect(session(b.id,tenantId,2)).rejects.toMatchObject({response:{errorCode:'PAYMENT_SESSION_REVIEW_REQUIRED'}});
    expect((await db.query('SELECT count(*)::int AS count FROM payment_sessions WHERE booking_id=$1',[b.id])).rows[0].count).toBe(1);
  });
  it('VNPay session DB independently rejects forged ownership/version/money/deadline/ref snapshots',async()=>{
    const b=await pendingBooking();
    const insert=(patch:{guest?:string;version?:number;amount?:string;expiry?:Date;ref?:string}={})=>{
      const id=randomUUID();return db.query(`INSERT INTO payment_sessions(id,provider,booking_id,guest_id,booking_version,merchant_code,transaction_ref,amount_vnd,expires_at)
        VALUES($1,'VNPAY_SANDBOX',$2,$3,$4,'FIXTURE1',$5,$6,$7)`,[id,b.id,patch.guest??tenantId,patch.version??1,patch.ref??id.replaceAll('-',''),patch.amount??'1100',patch.expiry??b.expiresAt]);
    };
    for(const patch of [{guest:otherHostId},{guest:adminId},{version:2},{amount:'1101'},{expiry:new Date(b.expiresAt.getTime()+1000)},{ref:'forgedreference'}])
      await expect(insert(patch)).rejects.toThrow('Payment session requires current own unpaid booking snapshot');
    await expect(insert({amount:'1100.5'})).rejects.toThrow();
    await prisma.booking.update({where:{id:b.id},data:{expiresAt:new Date(Date.now()-1000)}});
    await expect(insert({expiry:new Date(Date.now()-1000)})).rejects.toThrow();
    expect((await db.query('SELECT count(*)::int AS count FROM payment_sessions WHERE booking_id=$1',[b.id])).rows[0].count).toBe(0);
  });
  it('VNPay session DB is append-only and raw duplicate reservations cannot create two sessions',async()=>{
    const b=await pendingBooking(),s=await session(b.id);
    await expect(db.query("UPDATE payment_sessions SET merchant_code='FIXTURE2' WHERE id=$1",[s.sessionId])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM payment_sessions WHERE id=$1',[s.sessionId])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE payment_sessions')).rejects.toThrow('foreign key constraint');
    await expect(db.query('TRUNCATE payment_sessions,vnpay_ipn_receipts')).rejects.toThrow('append-only');
    const id=randomUUID();
    await expect(db.query(`INSERT INTO payment_sessions(id,provider,booking_id,guest_id,booking_version,merchant_code,transaction_ref,amount_vnd,expires_at)
      VALUES($1,'VNPAY_SANDBOX',$2,$3,1,'FIXTURE1',$4,1100,$5)`,[id,b.id,tenantId,id.replaceAll('-',''),b.expiresAt])).rejects.toThrow('unique');
  });
  it('VNPay session snapshots merchant config before asynchronous DB work and rejects a newly expired booking',async()=>{
    const b=await pendingBooking(),cfg={...vnpayConfig};
    const result=await prisma.$transaction(async tx=>{
      const pending=persistVnpaySession(tx,tenantId,b.id,1,cfg,'127.0.0.1');
      cfg.tmnCode='FIXTURE2';cfg.hashSecret='changed-fixture-only-secret-1234567890';
      return pending;
    });
    expect(new URL(result.redirectUrl).searchParams.get('vnp_TmnCode')).toBe('FIXTURE1');
    expect((await db.query('SELECT merchant_code FROM payment_sessions WHERE id=$1',[result.sessionId])).rows[0].merchant_code).toBe('FIXTURE1');
    await prisma.booking.update({where:{id:b.id},data:{expiresAt:new Date(Date.now()-1000)}});
    await expect(session(b.id)).rejects.toMatchObject({response:{errorCode:'BOOKING_NOT_PAYABLE'}});
    expect((await db.query('SELECT expires_at FROM payment_sessions WHERE id=$1',[result.sessionId])).rows[0].expires_at.toISOString()).toBe(b.expiresAt.toISOString());
  });
  it('DB records completion once with its own clock; legacy completion is not guessed from updatedAt',async()=>{
    const booking=await paidBooking();
    expect(booking.completedAt).toBeNull();
    const [{now:before}]=(await db.query('SELECT clock_timestamp() AS now')).rows;
    const completed=await prisma.booking.update({where:{id:booking.id},data:{bookingStatus:'COMPLETED'}});
    const [{now:after}]=(await db.query('SELECT clock_timestamp() AS now')).rows;
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(completed.completedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime()-1);
    expect(completed.completedAt!.getTime()).toBeLessThanOrEqual(after.getTime()+1);
    await prisma.booking.update({where:{id:booking.id},data:{version:{increment:1}}});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).completedAt).toEqual(completed.completedAt);
    await expect(db.query('UPDATE bookings SET completed_at=completed_at-interval \'3 days\' WHERE id=$1',[booking.id])).rejects.toThrow('immutable');
    await expect(db.query('UPDATE bookings SET completed_at=NULL WHERE id=$1',[booking.id])).rejects.toThrow('immutable');
    const legacy=await paidBooking();
    const {id:_id,createdAt:_created,updatedAt:_updated,...data}=legacy;
    const old=await prisma.booking.create({data:{...data,bookingCode:`LEGACY-${randomUUID().slice(0,20)}`,bookingStatus:'COMPLETED',completedAt:null}});
    expect(old.completedAt).toBeNull();
    await expect(db.query('UPDATE bookings SET completed_at=updated_at WHERE id=$1',[old.id])).rejects.toThrow('immutable');
    await expect(prisma.booking.create({data:{...data,bookingCode:`FORGED-${randomUUID().slice(0,20)}`,bookingStatus:'COMPLETED',completedAt:new Date()}})).rejects.toThrow();
  });
  it('writes balanced integer entries atomically and replays the same event permanently', async () => {
    const data = input(), first = await append(data), second = await append(data);
    expect(first.replayed).toBe(false); expect(second).toEqual({ ...first, replayed: true });
    const stored = await db.query('SELECT side,sum(amount)::text AS amount FROM finance_entries WHERE journal_id=$1 GROUP BY side ORDER BY side', [first.journalId]);
    expect(stored.rows).toEqual([{ side: 'CREDIT', amount: '100' }, { side: 'DEBIT', amount: '100' }]);
  });
  it('accepts a 256-character key while app and DB reject invalid key boundaries', async () => {
    const data=input();data.eventKey='x'.repeat(256);
    expect((await append(data)).replayed).toBe(false);
    await expect(append({...data,eventKey:'x'.repeat(257)})).rejects.toThrow();
    await expect(prisma.$transaction(tx=>tx.$executeRaw`INSERT INTO finance_journals (event_key,request_hash,kind,host_id,reason)
      VALUES ('bad key',${'a'.repeat(64)},'PAYMENT',${hostId}::uuid,'Invalid event fixture')`)).rejects.toThrow('finance_journals_event_key_check');
  });
  it('two concurrent requests produce exactly one journal', async () => {
    const data = input(), results = await Promise.all([append(data), append(data)]);
    expect(results[0].journalId).toBe(results[1].journalId);
    expect(results.map(r => r.replayed).sort()).toEqual([false, true]);
  });
  it('same event with different amount/content fails without changing the original', async () => {
    const data = input(); await append(data);
    await expect(append({ ...data, reason: 'Changed event content' })).rejects.toThrow('Mã giao dịch');
    expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE event_key=$1', [data.eventKey])).rows[0].count).toBe(1);
  });
  it('outer rollback undoes journal and permits a retry', async () => {
    const data = input();
    await expect(prisma.$transaction(async tx => { await appendFinancialJournal(tx, data); throw new Error('fixture rollback'); })).rejects.toThrow('fixture rollback');
    expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE event_key=$1', [data.eventKey])).rows[0].count).toBe(0);
    expect((await append(data)).replayed).toBe(false);
  });
  it('adjustment DB guard allows only active Admin and rolls back unauthorized journals', async () => {
    const data={...input(),kind:'ADJUSTMENT' as const,actorId:adminId};
    expect((await append(data)).replayed).toBe(false);
    for (const actorId of [null,tenantId,otherHostId]) {
      const eventKey=`fixture:adjustment-denied:${randomUUID()}`;
      await expect(append({...data,eventKey,actorId})).rejects.toThrow('Financial adjustment requires active Admin');
      expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE event_key=$1',[eventKey])).rows[0].count).toBe(0);
    }
    const inactive=await prisma.user.create({data:{phone:'0990000099',fullName:'Synthetic inactive Admin',role:'ADMIN',status:'BANNED',passwordHash:'not-a-real-password'}});
    await expect(append({...data,eventKey:`fixture:adjustment-inactive:${randomUUID()}`,actorId:inactive.id})).rejects.toThrow('Financial adjustment requires active Admin');
  });
  it('adjustment DB guard shares canonical Host payout lock, not a global lock', async () => {
    const payout=await db.connect(),adjustment=await db.connect();
    const eventKey=`fixture:adjustment-serialized:${randomUUID()}`;
    try {
      await payout.query('BEGIN');
      await payout.query("SELECT pg_advisory_xact_lock(hashtextextended('bank:'||$1::uuid::text,0))",[hostId]);
      await adjustment.query('BEGIN');
      await adjustment.query("SET LOCAL lock_timeout='200ms'");
      // Insert the journal directly, bypassing the application helper: DB must
      // block before any entries could race the payout readiness check.
      await expect(adjustment.query(`INSERT INTO finance_journals(event_key,request_hash,kind,host_id,actor_id,reason)
        VALUES($1,$2,'ADJUSTMENT',$3::uuid,$4::uuid,'Synthetic lock test')`,[eventKey,'a'.repeat(64),hostId.toUpperCase(),adminId]))
        .rejects.toMatchObject({code:'55P03'});
      await adjustment.query('ROLLBACK');
      expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE event_key=$1',[eventKey])).rows[0].count).toBe(0);
      // Another Host's adjustment can commit while this Host remains locked.
      expect((await append({...input(),kind:'ADJUSTMENT',hostId:otherHostId,actorId:adminId})).replayed).toBe(false);
      await payout.query('COMMIT');
      const data={...input(),eventKey,kind:'ADJUSTMENT' as const,actorId:adminId};
      expect((await append(data)).replayed).toBe(false);
      expect((await append(data)).replayed).toBe(true);
    } finally {
      await adjustment.query('ROLLBACK');await payout.query('ROLLBACK');
      adjustment.release();payout.release();
    }
  });
  it('an uncommitted adjustment holds payout lock until rollback without leaving money behind', async () => {
    const adjustment=await db.connect(),payout=await db.connect();
    const eventKey=`fixture:adjustment-rollback-lock:${randomUUID()}`;
    try {
      await adjustment.query('BEGIN');
      await adjustment.query(`INSERT INTO finance_journals(event_key,request_hash,kind,host_id,actor_id,reason)
        VALUES($1,$2,'ADJUSTMENT',$3::uuid,$4::uuid,'Synthetic rollback lock test')`,[eventKey,'b'.repeat(64),hostId,adminId]);
      await payout.query('BEGIN');await payout.query("SET LOCAL lock_timeout='200ms'");
      await expect(payout.query("SELECT pg_advisory_xact_lock(hashtextextended('bank:'||$1::uuid::text,0))",[hostId]))
        .rejects.toMatchObject({code:'55P03'});
      await payout.query('ROLLBACK');await adjustment.query('ROLLBACK');
      await payout.query('BEGIN');await payout.query("SET LOCAL lock_timeout='200ms'");
      await payout.query("SELECT pg_advisory_xact_lock(hashtextextended('bank:'||$1::uuid::text,0))",[hostId]);
      await payout.query('COMMIT');
      expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE event_key=$1',[eventKey])).rows[0].count).toBe(0);
    } finally {
      await payout.query('ROLLBACK');await adjustment.query('ROLLBACK');
      payout.release();adjustment.release();
    }
  });
  it.each(['0', '-1', 'NaN', 'Infinity', '0.5', '1000000000000000000'])('rejects invalid integer amount %s', async amount => {
    const data = input(); data.lines[0].amount = amount;
    await expect(append(data)).rejects.toThrow();
    expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE event_key=$1', [data.eventKey])).rows[0].count).toBe(0);
  });
  it('rejects unbalanced totals in application code', async () => {
    const data = input(); data.lines[0].amount = '101'; await expect(append(data)).rejects.toThrow();
  });
  it('retains exact amounts beyond JS safe integer without a floating point conversion', async () => {
    const data = input(); data.lines = [
      { account: 'CASH_CLEARING', side: 'DEBIT', amount: '9007199254740993' },
      { account: 'HOST_PAYABLE', side: 'CREDIT', amount: '9007199254740993' } ];
    const result = await append(data);
    expect((await db.query('SELECT amount::text AS amount FROM finance_entries WHERE journal_id=$1', [result.journalId])).rows.map(r => r.amount)).toEqual(['9007199254740993','9007199254740993']);
  });
  it('DB independently rejects an empty or unbalanced journal at commit', async () => {
    for (const mode of ['empty', 'unbalanced']) {
      await expect(prisma.$transaction(async tx => {
        const [row] = await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_journals (event_key,request_hash,kind,host_id,reason)
          VALUES (${`fixture:${randomUUID()}`},${'a'.repeat(64)},'PAYMENT',${hostId}::uuid,'DB invariant fixture') RETURNING id`;
        if (mode === 'unbalanced') await tx.$executeRaw`INSERT INTO finance_entries (journal_id,line_number,account,side,amount)
          VALUES (${row.id}::uuid,1,'CASH_CLEARING','DEBIT',100),(${row.id}::uuid,2,'HOST_PAYABLE','CREDIT',99)`;
      })).rejects.toThrow('Financial journal must balance');
    }
  });
  it('DB rejects update/delete on both journals and entries', async () => {
    const result = await append(input());
    await expect(db.query('UPDATE finance_journals SET reason=$1 WHERE id=$2', ['overwrite',result.journalId])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM finance_journals WHERE id=$1', [result.journalId])).rejects.toThrow('append-only');
    await expect(db.query('UPDATE finance_entries SET amount=1 WHERE journal_id=$1', [result.journalId])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM finance_entries WHERE journal_id=$1', [result.journalId])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE finance_entries')).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE finance_journals CASCADE')).rejects.toThrow('append-only');
  });
  it('DB rejects adding even balanced lines to a committed journal', async () => {
    const result = await append(input());
    await expect(db.query(`INSERT INTO finance_entries (journal_id,line_number,account,side,amount)
      VALUES ($1,4,'CASH_CLEARING','DEBIT',1),($1,5,'HOST_PAYABLE','CREDIT',1)`, [result.journalId])).rejects.toThrow('previously committed');
  });
  it('DB rejects fractional input without implicitly rounding into integer money', async () => {
    await expect(prisma.$transaction(async tx => {
      const [row] = await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_journals (event_key,request_hash,kind,host_id,reason)
        VALUES (${`fixture:${randomUUID()}`},${'b'.repeat(64)},'PAYMENT',${hostId}::uuid,'Fraction fixture') RETURNING id`;
      await tx.$executeRaw`INSERT INTO finance_entries (journal_id,line_number,account,side,amount)
        VALUES (${row.id}::uuid,1,'CASH_CLEARING','DEBIT',1.4),(${row.id}::uuid,2,'HOST_PAYABLE','CREDIT',1.4)`;
    })).rejects.toThrow('finance_entries_amount_check');
  });
  it('DB balance remains enforced after a caller forces deferred checks early', async () => {
    await expect(prisma.$transaction(async tx => {
      const result = await appendFinancialJournal(tx, input());
      await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
      await tx.$executeRaw`INSERT INTO finance_entries (journal_id,line_number,account,side,amount)
        VALUES (${result.journalId}::uuid,4,'CASH_CLEARING','DEBIT',1)`;
    })).rejects.toThrow('Financial journal must balance');
  });
  it('paid Guest cancellation atomically releases inventory, records obligation and leaves PAID until money returned',async()=>{
    const booking=await paidBooking(),request=await guestCancellation(booking),result=await request.run();
    expect(result).toMatchObject({booking:{bookingStatus:'CANCELLED_BY_GUEST',paymentStatus:'PAID',version:2},refundObligation:{amount:1100,status:'PENDING'}});
    expect(await request.run()).toEqual(result);
    const audits=await db.query('SELECT id,refund_amount::text AS amount FROM finance_cancellations WHERE booking_id=$1',[booking.id]);
    expect(audits.rows).toHaveLength(1);expect(audits.rows[0].amount).toBe('1100');
    expect((await db.query('SELECT count(*)::int AS count FROM finance_refunds WHERE cancellation_id=$1',[audits.rows[0].id])).rows[0].count).toBe(1);
    const replacement=await paidBooking();
    await prisma.booking.create({data:{...replacement,id:randomUUID(),bookingCode:`FIX-${randomUUID().slice(0,24)}`,homestayUnitId:booking.homestayUnitId,
      checkInDate:booking.checkInDate,checkOutDate:booking.checkOutDate,nightlyPrices:booking.nightlyPrices!}});
  });
  it('concurrent same key replays one cancellation; changed payload conflicts',async()=>{
    const booking=await paidBooking(),request=await guestCancellation(booking);
    const [a,b]=await Promise.all([request.run(),request.run()]);expect(a).toEqual(b);
    await expect(bookings.cancelPaid(tenantId,booking.id,'GUEST',1,request.key,{...request.body,reason:'different'},request.body.refundQuoteToken,'different'))
      .rejects.toMatchObject({response:{errorCode:'IDEMPOTENCY_CONFLICT'}});
  });
  it('concurrent different keys serialize state; exactly one succeeds',async()=>{
    const booking=await paidBooking(),a=await guestCancellation(booking),b=await guestCancellation(booking);
    const outcomes=await Promise.allSettled([a.run(),b.run()]);expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'STALE_BOOKING_VERSION'}}});
  });
  it.each([['STRICT',240,550],['FLEXIBLE',2,0]] as const)('policy %s cancellation records exact refund %i hours / %i VND',async(policy,hours,amount)=>{
    const booking=await paidBooking(policy,hours),request=await guestCancellation(booking),result=await request.run();
    expect(result.refundObligation).toMatchObject({amount,status:amount?'PENDING':'NOT_REQUIRED'});
    const rows=await db.query('SELECT calculation,refund_amount::text AS amount FROM finance_cancellations WHERE booking_id=$1',[booking.id]);
    expect(rows.rows[0].amount).toBe(String(amount));
    expect(rows.rows[0].calculation.retainedHostPayout).toBe(amount?'495':'990');
  });
  it('Host must own booking and provide reason; Host cancellation always returns full amount',async()=>{
    const booking=await paidBooking('STRICT',2),body={expectedVersion:1,reason:'Host cannot provide the room'};
    await expect(bookings.cancelPaid(otherHostId,booking.id,'HOST',1,randomUUID(),body,undefined,body.reason)).rejects.toMatchObject({status:404});
    await expect(bookings.cancelPaid(hostId,booking.id,'HOST',1,randomUUID(),{expectedVersion:1})).rejects.toMatchObject({status:400});
    const result=await bookings.cancelPaid(hostId,booking.id,'HOST',1,randomUUID(),body,undefined,body.reason);
    expect(result).toMatchObject({booking:{bookingStatus:'CANCELLED',paymentStatus:'PAID'},refundObligation:{amount:1100,status:'PENDING'}});
  });
  it('legacy PAID without source journal is not invented; cancellation rolls back completely',async()=>{
    const booking=await paidBooking('FLEXIBLE',240,false),request=await guestCancellation(booking);
    await expect(request.run()).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).version).toBe(1);
    expect((await db.query('SELECT count(*)::int AS count FROM finance_cancellations WHERE booking_id=$1',[booking.id])).rows[0].count).toBe(0);
    expect((await prisma.bookingIdempotency.count({where:{userId:tenantId,key:request.key}}))).toBe(0);
  });
  it('rejects wrong guest, stale version, altered quote and wrong role without cancelling',async()=>{
    const booking=await paidBooking(),request=await guestCancellation(booking);
    await expect(bookings.cancelPaid(otherHostId,booking.id,'GUEST',1,randomUUID(),request.body,request.body.refundQuoteToken)).rejects.toMatchObject({status:404});
    await expect(bookings.cancelPaid(tenantId,booking.id,'GUEST',2,randomUUID(),{...request.body,expectedVersion:2},request.body.refundQuoteToken)).rejects.toMatchObject({response:{errorCode:'STALE_BOOKING_VERSION'}});
    await expect(bookings.cancelPaid(tenantId,booking.id,'GUEST',1,randomUUID(),{...request.body,refundQuoteToken:'bad'},'bad')).rejects.toMatchObject({response:{errorCode:'INVALID_REFUND_QUOTE'}});
    await expect(bookings.cancelPaid(tenantId,booking.id,'HOST',1,randomUUID(),{expectedVersion:1,reason:'Invalid actor'},undefined,'Invalid actor')).rejects.toMatchObject({status:403});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).bookingStatus).toBe('CONFIRMED');
  });
  it('crossing refund cutoff returns a new signed preview, no cancellation until confirmed',async()=>{
    const booking=await paidBooking('FLEXIBLE',24-1/60),snapshot=cancellationSnapshot(booking);
    const cutoff=new Date(`${snapshot.checkInDate}T${snapshot.checkInTime}+07:00`);cutoff.setTime(cutoff.getTime()-24*3600000);
    const oldRefund=calculateCancellationRefund(snapshot,'GUEST',cutoff),quote=await signRefundQuote({userId:tenantId,bookingId:booking.id,version:1},snapshot,oldRefund,cutoff);
    const body={expectedVersion:1,refundQuoteToken:quote.refundQuoteToken};
    await expect(bookings.cancelPaid(tenantId,booking.id,'GUEST',1,randomUUID(),body,quote.refundQuoteToken)).rejects.toMatchObject({response:{errorCode:'REFUND_QUOTE_CHANGED',data:{refundPercent:0,refund:{total:0}}}});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).bookingStatus).toBe('CONFIRMED');
  });
  it('a DB failure after posting reversal rolls back journal, obligation, booking and idempotency together',async()=>{
    const booking=await paidBooking(),request=await guestCancellation(booking);
    await db.query(`CREATE FUNCTION finance_fixture_fail_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected booking update failure'; END; $$`);
    await db.query('CREATE TRIGGER finance_fixture_fail_update BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION finance_fixture_fail_update()');
    try {
      await expect(request.run()).rejects.toThrow('Injected booking update failure');
      expect((await db.query('SELECT count(*)::int AS count FROM finance_journals WHERE booking_id=$1 AND kind=\'REFUND\'',[booking.id])).rows[0].count).toBe(0);
      expect(await prisma.financeCancellation.count({where:{bookingId:booking.id}})).toBe(0);
      expect(await prisma.bookingIdempotency.count({where:{userId:tenantId,key:request.key}})).toBe(0);
      expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).version).toBe(1);
    } finally {
      await db.query('DROP TRIGGER finance_fixture_fail_update ON bookings');await db.query('DROP FUNCTION finance_fixture_fail_update()');
    }
    expect((await request.run()).refundObligation).toMatchObject({status:'PENDING'});
  });
  it('immutable cancellation audit and obligation amount cannot be rewritten at DB level',async()=>{
    const booking=await paidBooking(),result=await (await guestCancellation(booking)).run();
    await expect(db.query('UPDATE finance_cancellations SET reason=$1 WHERE booking_id=$2',['overwrite',booking.id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM finance_cancellations WHERE booking_id=$1',[booking.id])).rejects.toThrow('append-only');
    const obligation=result.refundObligation as {id:string};
    await expect(db.query('UPDATE finance_refunds SET amount=1 WHERE id=$1',[obligation.id])).rejects.toThrow('immutable');
    await expect(db.query('DELETE FROM finance_refunds WHERE id=$1',[obligation.id])).rejects.toThrow('append-only');
    const audit=await prisma.financeCancellation.findUniqueOrThrow({where:{bookingId:booking.id}});
    await expect(db.query('INSERT INTO finance_refunds (cancellation_id,amount) VALUES ($1,1)',[audit.id])).rejects.toThrow('must match cancellation amount');
  });
  it.each(['wrong-total','duplicate-source'])('mismatched incoming money (%s) requires reconciliation',async mode=>{
    const booking=await paidBooking('FLEXIBLE',240,false);
    await append({eventKey:`fixture:bad-source:${booking.id}`,kind:'PAYMENT',bookingId:booking.id,hostId,actorId:null,reason:'Synthetic bad-source fixture',
      lines:mode==='wrong-total'?[{account:'CASH_CLEARING',side:'DEBIT',amount:'1000'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'1000'}]:
        [{account:'CASH_CLEARING',side:'DEBIT',amount:'1100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'990'},{account:'PLATFORM_COMMISSION',side:'CREDIT',amount:'110'}]});
    if(mode==='duplicate-source') await append({eventKey:`fixture:duplicate-source:${booking.id}`,kind:'PAYMENT',bookingId:booking.id,hostId,actorId:null,reason:'Synthetic duplicate fixture',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'1'}]});
    await expect((await guestCancellation(booking)).run()).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).bookingStatus).toBe('CONFIRMED');
  });
  it('after check-in requires Admin review rather than self cancellation',async()=>{
    const booking=await paidBooking('FLEXIBLE',-2);
    await expect(bookings.cancelPaid(hostId,booking.id,'HOST',1,randomUUID(),{expectedVersion:1,reason:'late'},undefined,'late'))
      .rejects.toMatchObject({response:{errorCode:'MANUAL_REFUND_REVIEW_REQUIRED'}});
    expect(await prisma.financeCancellation.count({where:{bookingId:booking.id}})).toBe(0);
  });
  it('hiding a listing does not strand an existing Guest refund, but banned actors cannot mutate',async()=>{
    const booking=await paidBooking(),request=await guestCancellation(booking);
    const unit=await prisma.homestayUnit.findUniqueOrThrow({where:{id:booking.homestayUnitId}});
    await prisma.property.update({where:{id:unit.propertyId},data:{status:'HIDDEN'}});
    await prisma.user.update({where:{id:tenantId},data:{status:'BANNED'}});
    try {await expect(request.run()).rejects.toMatchObject({status:403});}
    finally {await prisma.user.update({where:{id:tenantId},data:{status:'ACTIVE'}});}
    expect((await request.run()).refundObligation).toMatchObject({amount:1100,status:'PENDING'});
  });
  async function obligation(policy='FLEXIBLE') {
    const booking=await paidBooking(policy),cancel=await (await guestCancellation(booking)).run();
    return {booking,id:(cancel.refundObligation as {id:string}).id};
  }
  const evidence=()=>({expectedVersion:1,bankReference:`FIXTUREBANK:${randomUUID()}`,evidenceNote:'Synthetic confirmation; no real transfer',reason:'Isolated manual refund test'});
  it('Admin full manual confirmation atomically posts cash return, audit, REFUNDED and exact replay',async()=>{
    const {booking,id}=await obligation(),dto=evidence(),key=randomUUID();
    const first=await refunds.confirm(adminId,id,dto,key,dto);
    expect(first).toMatchObject({id,amount:'1100',status:'PAID',version:2});
    expect(await refunds.confirm(adminId,id,dto,key,dto)).toEqual(first);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).paymentStatus).toBe('REFUNDED');
    expect(await prisma.financeRefundConfirmation.count({where:{refundId:id}})).toBe(1);
    expect(await refunds.read(id)).toMatchObject({amount:'1100',status:'PAID',confirmation:{actorId:adminId,bankReference:dto.bankReference,evidenceNote:dto.evidenceNote}});
    await expect(refunds.confirm(adminId,id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'STALE_REFUND_VERSION'}});
    await expect(db.query('DELETE FROM finance_refund_confirmations WHERE refund_id=$1',[id])).rejects.toThrow('append-only');
  });
  it('partial policy refund confirms only its obligation and leaves payment PAID',async()=>{
    const {booking,id}=await obligation('STRICT'),dto=evidence();
    expect(await refunds.confirm(adminId,id,dto,randomUUID(),dto)).toMatchObject({amount:'550',status:'PAID'});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).paymentStatus).toBe('PAID');
  });
  it('parallel confirmation with one key posts one transfer record; changed payload cannot reuse key',async()=>{
    const {id}=await obligation(),dto=evidence(),key=randomUUID();
    const [a,b]=await Promise.all([refunds.confirm(adminId,id,dto,key,dto),refunds.confirm(adminId,id,dto,key,dto)]);expect(a).toEqual(b);
    await expect(refunds.confirm(adminId,id,{...dto,reason:'Changed'},key,{...dto,reason:'Changed'})).rejects.toMatchObject({response:{errorCode:'IDEMPOTENCY_CONFLICT'}});
  });
  it('a bank reference cannot confirm another obligation, including case changes',async()=>{
    const a=await obligation(),b=await obligation(),dto=evidence();
    await refunds.confirm(adminId,a.id,dto,randomUUID(),dto);
    await expect(refunds.confirm(adminId,b.id,{...dto,bankReference:dto.bankReference.toLowerCase()},randomUUID(),{...dto,bankReference:dto.bankReference.toLowerCase()}))
      .rejects.toMatchObject({response:{errorCode:'REFUND_REFERENCE_REUSED'}});
    expect((await prisma.financeRefund.findUniqueOrThrow({where:{id:b.id}})).status).toBe('PENDING');
  });
  it('Host/Tenant cannot confirm transfers; missing evidence and unknown ids fail safely',async()=>{
    const {id}=await obligation(),dto=evidence();
    for(const actor of [hostId,tenantId]) await expect(refunds.confirm(actor,id,dto,randomUUID(),dto)).rejects.toMatchObject({status:403});
    await expect(refunds.confirm(adminId,id,{...dto,evidenceNote:''},randomUUID(),dto)).rejects.toMatchObject({status:400});
    await expect(refunds.confirm(adminId,randomUUID(),dto,randomUUID(),dto)).rejects.toMatchObject({status:404});
  });
  it('DB rejects PAID status without immutable evidence/journal and leaves PENDING',async()=>{
    const {id}=await obligation();
    await expect(db.query('UPDATE finance_refunds SET status=\'PAID\',version=version+1 WHERE id=$1',[id])).rejects.toThrow('matching immutable confirmation');
    expect((await prisma.financeRefund.findUniqueOrThrow({where:{id}})).status).toBe('PENDING');
  });
  it('failure after cash-return journal rolls back confirmation, status and idempotency',async()=>{
    const {id}=await obligation(),dto=evidence(),key=randomUUID();
    await db.query(`CREATE FUNCTION finance_fixture_fail_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Injected refund update failure'; END; $$`);
    await db.query('CREATE TRIGGER finance_fixture_fail_refund BEFORE UPDATE ON finance_refunds FOR EACH ROW EXECUTE FUNCTION finance_fixture_fail_refund()');
    try {
      await expect(refunds.confirm(adminId,id,dto,key,dto)).rejects.toMatchObject({response:{errorCode:'REFUND_RECORDING_FAILED'}});
      expect(await prisma.financeRefundConfirmation.count({where:{refundId:id}})).toBe(0);
      expect(await prisma.financeJournal.count({where:{eventKey:`refund-paid:${id}`}})).toBe(0);
      expect(await prisma.bookingIdempotency.count({where:{userId:adminId,key}})).toBe(0);
    } finally {await db.query('DROP TRIGGER finance_fixture_fail_refund ON finance_refunds');await db.query('DROP FUNCTION finance_fixture_fail_refund()');}
    expect(await refunds.confirm(adminId,id,dto,key,dto)).toMatchObject({status:'PAID'});
  });
  const bankInput=(expectedVersion:number)=>({expectedVersion,bankCode:'FIXTUREBANK',accountNumber:'1234567890',accountName:'Synthetic bank fixture'});
  const bankReview=(expectedVersion:number)=>({expectedVersion,reason:'Synthetic review only',evidenceNote:'No real bank verification'});
  const bankHost=async()=> (await prisma.user.create({data:{phone:`F${randomUUID().replaceAll('-','').slice(0,14)}`,fullName:'Synthetic isolated bank Host',role:'HOST',passwordHash:'not-a-real-password'}})).id;
  it('Host bank submit/replay then Admin verify records audit without changing KYC',async()=>{
    const hostId=await bankHost();
    expect(await banks.own(hostId)).toEqual({version:0,account:null,payoutReady:false});
    const before=await prisma.user.findUniqueOrThrow({where:{id:hostId}}),dto=bankInput(0),key=randomUUID();
    const first=await banks.submit(hostId,dto,key,dto);expect(first).toMatchObject({version:1,payoutReady:false,account:{status:'PENDING'}});
    expect(await banks.submit(hostId,dto,key,dto)).toEqual(first);
    const id=(first.account as {id:string}).id,review=bankReview(1);
    expect(await banks.review(adminId,id,'VERIFY',review,randomUUID(),review)).toMatchObject({version:2,status:'VERIFIED',payoutReady:true});
    expect((await banks.read(id)).events.map(e=>e.action)).toEqual(['SUBMITTED','VERIFIED']);
    expect(await prisma.user.findUniqueOrThrow({where:{id:hostId}})).toEqual(before);
    expect(JSON.stringify((await banks.list(1,20)).data)).not.toContain('1234567890');
  });
  it('new bank blocks ready state, preserves old verified version and refuses review of superseded bank',async()=>{
    const hostId=await bankHost(),initial=bankInput(0);
    const seeded=await banks.submit(hostId,initial,randomUUID(),initial),approval=bankReview(1);
    await banks.review(adminId,(seeded.account as {id:string}).id,'VERIFY',approval,randomUUID(),approval);
    const old=await banks.own(hostId),dto=bankInput(old.version);
    const next=await banks.submit(hostId,{...dto,accountNumber:'9876543210'},randomUUID(),{...dto,accountNumber:'9876543210'});
    expect(next).toMatchObject({payoutReady:false,account:{status:'PENDING'}});
    expect((await banks.read(old.account!.id)).status).toBe('VERIFIED');
    const review=bankReview(next.version as number);
    await expect(banks.review(adminId,old.account!.id,'VERIFY',review,randomUUID(),review)).rejects.toMatchObject({response:{errorCode:'BANK_SUPERSEDED'}});
    const id=(next.account as {id:string}).id;
    await banks.review(adminId,id,'REJECT',review,randomUUID(),review);
    expect((await banks.own(hostId)).payoutReady).toBe(false);
  });
  it('concurrent Host edits serialize, and roles/evidence/stale keys are enforced',async()=>{
    const otherHostId=await bankHost();
    const state=await banks.own(otherHostId),dto=bankInput(state.version);
    const results=await Promise.allSettled([banks.submit(otherHostId,dto,randomUUID(),dto),banks.submit(otherHostId,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'STALE_BANK_VERSION'}}});
    await expect(banks.submit(tenantId,bankInput(0),randomUUID(),bankInput(0))).rejects.toMatchObject({status:403});
    const account=(await banks.own(otherHostId)).account!,review=bankReview(1);
    await expect(banks.review(otherHostId,account.id,'VERIFY',review,randomUUID(),review)).rejects.toMatchObject({status:403});
    await expect(banks.review(adminId,account.id,'VERIFY',{...review,evidenceNote:''},randomUUID(),review)).rejects.toMatchObject({status:400});
    const key=randomUUID();await banks.review(adminId,account.id,'VERIFY',review,key,review);
    expect(await banks.review(adminId,account.id,'VERIFY',review,key,review)).toMatchObject({status:'VERIFIED'});
    await expect(banks.review(adminId,account.id,'VERIFY',{...review,reason:'changed'},key,{...review,reason:'changed'})).rejects.toMatchObject({response:{errorCode:'IDEMPOTENCY_CONFLICT'}});
  });
  it('bank details/audit are immutable in DB; state cannot point to another Host account',async()=>{
    const hostId=await bankHost(),otherHostId=await bankHost(),initial=bankInput(0);
    await banks.submit(hostId,initial,randomUUID(),initial);
    await banks.submit(otherHostId,initial,randomUUID(),initial);
    const account=(await banks.own(hostId)).account!,other=(await banks.own(otherHostId)).account!;
    await expect(db.query('UPDATE finance_bank_accounts SET account_number=\'1\' WHERE id=$1',[account.id])).rejects.toThrow('immutable');
    await expect(db.query('DELETE FROM finance_bank_events WHERE account_id=$1',[account.id])).rejects.toThrow('append-only');
    await expect(db.query('UPDATE finance_bank_states SET account_id=$1 WHERE host_id=$2',[other.id,hostId])).rejects.toThrow();
  });
  it('bank notifications are atomic event feeds, private, paginated and idempotently read',async()=>{
    const hostId=await bankHost(),otherId=await bankHost(),dto=bankInput(0),key=randomUUID();
    const created=await banks.submit(hostId,dto,key,dto);
    await banks.submit(hostId,dto,key,dto);
    let feed=await banks.notifications(hostId,1,20);
    expect(feed.meta).toMatchObject({total:1,unreadCount:1});
    const notice=feed.data[0];
    expect(notice).toMatchObject({accountId:(created.account as {id:string}).id,type:'SUBMITTED',readAt:null});
    expect(JSON.stringify(feed)).not.toContain(dto.accountNumber);
    expect(JSON.stringify(feed)).not.toContain(dto.accountName);
    expect((await banks.notifications(otherId,1,20)).meta.total).toBe(0);
    await expect(banks.markNotificationRead(otherId,notice.id)).rejects.toMatchObject({status:404});
    const reads=await Promise.all([banks.markNotificationRead(hostId,notice.id),banks.markNotificationRead(hostId,notice.id)]);
    expect(reads[0].readAt).not.toBeNull();expect(reads[0]).toEqual(reads[1]);
    expect((await banks.notifications(hostId,1,20)).meta.unreadCount).toBe(0);
    const review=bankReview(1),reviewKey=randomUUID(),id=(created.account as {id:string}).id;
    await banks.review(adminId,id,'VERIFY',review,reviewKey,review);
    await banks.review(adminId,id,'VERIFY',review,reviewKey,review);
    feed=await banks.notifications(hostId,1,1);
    expect(feed.meta).toMatchObject({total:2,totalPages:2,unreadCount:1});
    expect(feed.data[0].type).toBe('VERIFIED');
    expect((await banks.notifications(hostId,2,1)).data[0].id).toBe(notice.id);
    expect(JSON.stringify(feed)).not.toContain(review.evidenceNote);
    expect(JSON.stringify(feed)).not.toContain(review.reason);
    await expect(banks.review(adminId,id,'REJECT',bankReview(2),randomUUID(),bankReview(2))).rejects.toMatchObject({status:409});
    expect((await banks.notifications(hostId,1,20)).meta.total).toBe(2);
    const replacement=bankInput(2),next=await banks.submit(hostId,replacement,randomUUID(),replacement),reject=bankReview(3);
    await banks.review(adminId,(next.account as {id:string}).id,'REJECT',reject,randomUUID(),reject);
    const rejected=await banks.notifications(hostId,1,20);
    expect(rejected.meta).toMatchObject({total:4,unreadCount:3});
    expect(rejected.data[0].type).toBe('REJECTED');
    expect(JSON.stringify(rejected)).not.toContain(reject.reason);
  });
  const complaintInput=(version=1)=>({expectedVersion:version,reason:'Synthetic complaint, no real guest data'});
  it('complaint intake/replay, Host response and Admin assignment stay OPEN with immutable audit',async()=>{
    const b=await paidBooking(),dto=complaintInput(),key=randomUUID();
    const created=await complaints.create(tenantId,b.id,dto,key,dto),id=String(created.id);
    expect(created).toMatchObject({bookingId:b.id,status:'OPEN',version:1,overdue:false});
    expect(await complaints.create(tenantId,b.id,dto,key,dto)).toEqual(created);
    expect((await complaints.bookingComplaints(tenantId,b.id))[0].events).toHaveLength(1);
    const response={expectedVersion:1,message:'Synthetic Host response'};
    await complaints.act(hostId,id,'RESPOND',response,randomUUID(),response);
    const assignment={expectedVersion:2,reason:'Synthetic assignment',assigneeId:adminId},assignKey=randomUUID();
    expect(await complaints.act(adminId,id,'ASSIGN',assignment,assignKey,assignment)).toMatchObject({status:'OPEN',version:3,assigneeId:adminId});
    expect(await complaints.act(adminId,id,'ASSIGN',assignment,assignKey,assignment)).toMatchObject({version:3});
    const read=await complaints.read(id,hostId);expect(read.events.map(e=>e.action)).toEqual(['CREATED','RESPONDED','ASSIGNED']);
    expect(JSON.stringify(read)).not.toMatch(/guestPhone|guestName|accountNumber/);
    await expect(db.query('UPDATE finance_complaints SET reason=\'tamper\' WHERE id=$1',[id])).rejects.toThrow('immutable');
    await expect(db.query('DELETE FROM finance_complaint_events WHERE complaint_id=$1',[id])).rejects.toThrow('append-only');
    expect((await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).bookingStatus).toBe('CONFIRMED');
    expect((await db.query('SELECT count(*)::int AS n FROM finance_journals WHERE booking_id=$1',[b.id])).rows[0].n).toBe(1);
  });
  it('complaint ownership, roles, unpaid/legacy completion and invalid assignment fail closed',async()=>{
    const b=await paidBooking(),dto=complaintInput();
    await expect(complaints.create(otherHostId,b.id,dto,randomUUID(),dto)).rejects.toMatchObject({status:404});
    const created=await complaints.create(tenantId,b.id,dto,randomUUID(),dto),id=String(created.id);
    await expect(complaints.read(id,otherHostId)).rejects.toMatchObject({status:404});
    await expect(complaints.bookingComplaints(otherHostId,b.id)).rejects.toMatchObject({status:404});
    expect((await complaints.list(otherHostId,1,20)).meta.total).toBe(0);
    await expect(complaints.act(tenantId,id,'RESPOND',{expectedVersion:1,message:'bad'},randomUUID(),{})).rejects.toMatchObject({status:403});
    await expect(complaints.act(otherHostId,id,'RESPOND',{expectedVersion:1,message:'bad'},randomUUID(),{})).rejects.toMatchObject({status:404});
    await expect(complaints.act(adminId,id,'ASSIGN',{expectedVersion:1,reason:'test',assigneeId:hostId},randomUUID(),{})).rejects.toMatchObject({status:400});
    expect((await complaints.read(id,null)).version).toBe(1);
    const unpaid=await paidBooking('FLEXIBLE',240,false);await prisma.booking.update({where:{id:unpaid.id},data:{paymentStatus:'NOT_CONFIGURED',bookingStatus:'PENDING_PAYMENT'}});
    await expect(complaints.create(tenantId,unpaid.id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'COMPLAINT_NOT_ALLOWED'}});
    const legacy=await paidBooking(),{id:_id,createdAt:_created,updatedAt:_updated,...data}=legacy;
    const completed=await prisma.booking.create({data:{...data,bookingCode:`LEGACY-${randomUUID().slice(0,20)}`,bookingStatus:'COMPLETED',completedAt:null}});
    await expect(complaints.create(tenantId,completed.id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'COMPLAINT_WINDOW_CLOSED'}});
  });
  it('concurrent complaints cannot open twice; stale response cannot overwrite assignment',async()=>{
    const b=await paidBooking(),dto=complaintInput();
    const results=await Promise.allSettled([complaints.create(tenantId,b.id,dto,randomUUID(),dto),complaints.create(tenantId,b.id,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'COMPLAINT_ALREADY_OPEN'}}});
    const [created]=await complaints.bookingComplaints(tenantId,b.id),id=created.id;
    const reply={expectedVersion:1,message:'response'},assign={expectedVersion:1,assigneeId:adminId,reason:'assign'};
    const updates=await Promise.allSettled([complaints.act(hostId,id,'RESPOND',reply,randomUUID(),reply),complaints.act(adminId,id,'ASSIGN',assign,randomUUID(),assign)]);
    expect(updates.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(updates.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'STALE_COMPLAINT_VERSION'}}});
    expect((await complaints.read(id,null)).events).toHaveLength(2);
    await expect(db.query('INSERT INTO finance_complaints(booking_id,guest_id,host_id,reason) VALUES ($1,$2,$3,\'duplicate\')',[b.id,tenantId,hostId])).rejects.toThrow();
  });
  it('failed complaint audit rolls back intake/action and does not save an idempotency success',async()=>{
    const b=await paidBooking(),dto=complaintInput(),key=randomUUID();
    // Inject failure at the audit boundary; booking/complaint/idempotency transactions are real PostgreSQL.
    const spy=vi.spyOn(complaints as unknown as {event:()=>Promise<void>},'event').mockRejectedValueOnce(new Error('Synthetic audit failure'));
    try {await expect(complaints.create(tenantId,b.id,dto,key,dto)).rejects.toThrow('Synthetic audit failure');} finally {spy.mockRestore();}
    expect(await complaints.bookingComplaints(tenantId,b.id)).toEqual([]);
    expect(await prisma.bookingIdempotency.count({where:{userId:tenantId,operation:'COMPLAINT_CREATE',key}})).toBe(0);
    const created=await complaints.create(tenantId,b.id,dto,key,dto),id=String(created.id);
    const reply={expectedVersion:1,message:'Synthetic reply'},replyKey=randomUUID();
    const replySpy=vi.spyOn(complaints as unknown as {event:()=>Promise<void>},'event').mockRejectedValueOnce(new Error('Synthetic audit failure'));
    try {await expect(complaints.act(hostId,id,'RESPOND',reply,replyKey,reply)).rejects.toThrow('Synthetic audit failure');} finally {replySpy.mockRestore();}
    expect((await complaints.read(id,hostId)).version).toBe(1);
    expect((await complaints.read(id,hostId)).events).toHaveLength(1);
    expect(await prisma.bookingIdempotency.count({where:{userId:hostId,operation:'HOST_COMPLAINT_RESPOND',key:replyKey}})).toBe(0);
    expect(await complaints.act(hostId,id,'RESPOND',reply,replyKey,reply)).toMatchObject({version:2});
  });
  it('Host finance recognizes only exact ledger sources and a DB-recorded completion hold',async()=>{
    const owner=await bankHost();
    await paidBooking('FLEXIBLE',240,false,owner);
    await paidBooking('FLEXIBLE',240,true,owner);
    const completed=await paidBooking('FLEXIBLE',240,true,owner);
    await prisma.booking.update({where:{id:completed.id},data:{bookingStatus:'COMPLETED'}});
    expect(await hostFinance.summary(owner)).toMatchObject({source:'LEDGER',bankVerified:false,payoutOperationsReady:false,reviewCount:1,
      balances:{waitingCompletion:'990',pendingHold:'990',eligibleBeforeDeductions:'0',frozen:'0'}});
    const dto=bankInput(0),created=await banks.submit(owner,dto,randomUUID(),dto),review=bankReview(1);
    await banks.review(adminId,(created.account as {id:string}).id,'VERIFY',review,randomUUID(),review);
    expect((await hostFinance.summary(owner)).bankVerified).toBe(true);
    const replacement=bankInput(2);await banks.submit(owner,replacement,randomUUID(),replacement);
    expect((await hostFinance.summary(owner)).bankVerified).toBe(false);
  });
  it('Host finance freezes only the complained booking, never the whole Host or another Host',async()=>{
    const owner=await bankHost(),other=await bankHost();
    const disputed=await paidBooking('FLEXIBLE',240,true,owner);
    await paidBooking('FLEXIBLE',240,true,owner);await paidBooking('FLEXIBLE',240,true,other);
    const dto=complaintInput();await complaints.create(tenantId,disputed.id,dto,randomUUID(),dto);
    expect((await hostFinance.summary(owner)).balances).toMatchObject({waitingCompletion:'990',frozen:'990'});
    expect((await hostFinance.summary(other)).balances).toMatchObject({waitingCompletion:'990',frozen:'0'});
  });
  const complaintResolution=(version=1)=>({expectedVersion:version,decision:'HOST' as const,reason:'Synthetic Admin decision for Host',evidenceNote:'Synthetic private evidence, no personal data'});
  async function payoutBank() {
    const owner=await bankHost(),input=bankInput(0),submitted=await banks.submit(owner,input,randomUUID(),input),review=bankReview(1);
    await banks.review(adminId,(submitted.account as {id:string}).id,'VERIFY',review,randomUUID(),review);
    const current=await banks.own(owner);return {owner,bank:current.account!,version:current.version};
  }
  async function historicalPayoutDraft(existingFixture?:Awaited<ReturnType<typeof payoutBank>>) {
    // Isolated synthetic past-stay fixture. No clock override, live provider or transfer.
    const fixture=existingFixture??await payoutBank(),b=await paidBooking('FLEXIBLE',-2400,true,fixture.owner),snapshot=cancellationSnapshot(b);
    const calculation=calculateCancellationRefund(snapshot,'GUEST',new Date(roomTimestamp(snapshot.checkInDate,snapshot.checkInTime).getTime()-3600000));
    await prisma.$transaction(async tx=>{
      await recordPaidCancellation(tx,b,fixture.owner,tenantId,'GUEST','Synthetic historical retained fixture',calculation);
      await tx.booking.update({where:{id:b.id},data:{bookingStatus:'CANCELLED_BY_GUEST',version:{increment:1}}});
    });
    const dto={hostId:fixture.owner,reason:'Synthetic historical draft'};
    return {fixture,b,draft:await payoutDrafts.create(adminId,dto,randomUUID(),dto)};
  }
  it.skipIf(process.env.S4_ADMIN_PAYOUT_BROWSER!=='1')('S4 Admin payout UI through real Auth BFF DB approves exports and replays paid recording',async()=>{
    // Synthetic historical proceeds and evidence, never a real payment or bank transfer.
    const fixture=await historicalPayoutDraft(),password='PayoutBrowserFixture123!';
    const user=await prisma.user.create({data:{phone:'0990000094',fullName:'Synthetic payout browser Admin',role:'ADMIN',isPhoneVerified:true,passwordHash:await bcrypt.hash(password,4)}});
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('REDIS_KEY_PREFIX',`finance-payout-browser:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});
    let browser:{close():Promise<void>}|undefined,frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const base=await app.getUrl(),socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
      const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
      frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
        cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++) {if(frontend.exitCode!==null)throw new Error('Owned payout frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}
      expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await context.newPage();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(user.phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
      await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.goto(origin+'/admin/finance/payouts');await page.getByRole('listitem').filter({hasText:fixture.draft.id}).getByRole('button',{name:'Xem chi tiết',exact:true}).click();
      const form=page.getByRole('form',{name:'Thao tác lô chi trả'});await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic browser approval');
      await form.getByRole('button',{name:'Duyệt lô, chưa chuyển tiền'}).click();await form.getByRole('button',{name:'Xác nhận đã chuyển tiền'}).waitFor();
      expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:fixture.draft.id}})).toMatchObject({status:'APPROVED',version:2});
      expect(await prisma.financePayoutConfirmation.count({where:{batchId:fixture.draft.id}})).toBe(0);
      const downloading=page.waitForEvent('download');await form.getByRole('button',{name:'Xuất CSV',exact:true}).click();expect((await downloading).suggestedFilename()).toBe(`payout-${fixture.draft.id}-v2.csv`);
      expect(await prisma.financePayoutConfirmation.count({where:{batchId:fixture.draft.id}})).toBe(0);
      const writes:{body:unknown;key:string|undefined}[]=[];
      await page.route(`**/api/management/admin/finance/payouts/${fixture.draft.id}/confirm-paid`,async route=>{
        writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});const response=await route.fetch();
        expect(response.status()).toBe(200);
        if(writes.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'PAYOUT_RECORDING_FAILED',message:'Synthetic lost delivery after actual commit'}});
        return route.fulfill({response});
      });
      await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic payout recording, no bank transfer');await form.getByLabel('Mã giao dịch ngân hàng',{exact:true}).fill('FIXTURE:'+randomUUID());
      await form.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Synthetic only; no money transferred');await form.getByRole('button',{name:'Xác nhận đã chuyển tiền'}).click();
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();expect(await prisma.financePayoutConfirmation.count({where:{batchId:fixture.draft.id}})).toBe(1);
      expect(await page.getByRole('button',{name:'Đóng chi tiết',exact:true}).isDisabled()).toBe(true);
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByText('Admin đã ghi nhận chi trả thủ công',{exact:true}).waitFor();
      expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(await prisma.financePayoutConfirmation.count({where:{batchId:fixture.draft.id}})).toBe(1);
      expect(await prisma.financePayoutEvent.count({where:{batchId:fixture.draft.id,action:'PAID'}})).toBe(1);
      expect(await prisma.financeJournal.count({where:{bookingId:fixture.b.id,kind:'PAYOUT'}})).toBe(1);
      expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:fixture.draft.id}})).toMatchObject({status:'PAID',version:3});
      const evidence=resolve('../.tmp/s4-admin-payout-real');await mkdir(evidence,{recursive:true});
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,`paid-${width}.png`),fullPage:true});}
      expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('Synthetic only; no money transferred');
    }finally {try{await browser?.close();}finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}await app.close();}}
  },120000);
  it.skipIf(process.env.S4_ADMIN_REFUND_BROWSER!=='1')('S4 Admin refund UI through real Auth BFF DB replays one manual refund recording',async()=>{
    // Real local DB/Auth/BFF, synthetic payment journal and external transfer evidence.
    const booking=await paidBooking(),request=await guestCancellation(booking),cancelled=await request.run();
    const id=cancelled.refundObligation!.id,password='RefundBrowserFixture123!';
    const user=await prisma.user.create({data:{phone:'0990000098',fullName:'Synthetic refund browser Admin',role:'ADMIN',isPhoneVerified:true,passwordHash:await bcrypt.hash(password,4)}});
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('REDIS_KEY_PREFIX',`finance-refund-browser:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let browser:{close():Promise<void>}|undefined,frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');const base=await app.getUrl();
      const document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      expect(document.paths['/api/v1/admin/finance/refunds'].get!.responses['200']).toHaveProperty('content.application/json.schema.properties.meta');
      expect(document.components!.schemas!.RefundDetailDto.properties.confirmation).toHaveProperty('nullable',true);
      expect(document.paths['/api/v1/admin/finance/refunds/{id}/confirm-paid'].post!.responses['200']).toHaveProperty('content.application/json.schema.properties.data.allOf');
      const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
      frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
        cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned refund frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(user.phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
      await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.goto(origin+'/admin/finance/refunds');const refundButton=page.getByRole('listitem').filter({hasText:id}).getByRole('button',{name:'Xem khoản hoàn',exact:true});await refundButton.click();
      const form=page.getByRole('form',{name:'Xác nhận khoản hoàn'});await form.getByRole('button',{name:'Xác nhận đã chuyển trả',exact:true}).click();
      expect(await prisma.financeRefundConfirmation.count({where:{refundId:id}})).toBe(0);
      const writes:{body:unknown;key:string|undefined}[]=[];
      await page.route(`**/api/management/admin/finance/refunds/${id}/confirm-paid`,async route=>{
        writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});const response=await route.fetch();expect(response.status()).toBe(200);
        if(writes.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'REFUND_RECORDING_FAILED',message:'Synthetic delivery lost after actual commit'}});
        return route.fulfill({response});
      });
      await form.getByLabel('Lý do xác nhận',{exact:true}).fill('Synthetic manual refund recording');await form.getByLabel('Mã giao dịch ngân hàng',{exact:true}).fill('FIXTURE:'+randomUUID());await form.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Synthetic only, no bank refund executed');
      await form.getByRole('button',{name:'Xác nhận đã chuyển trả',exact:true}).click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();
      expect(await prisma.financeRefundConfirmation.count({where:{refundId:id}})).toBe(1);expect(await refundButton.isDisabled()).toBe(true);
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByRole('heading',{name:'Chứng cứ chuyển trả'}).waitFor();
      expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(await prisma.financeRefundConfirmation.count({where:{refundId:id}})).toBe(1);
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id,kind:'REFUND',eventKey:`cancellation:${booking.id}`}})).toBe(1);
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id,kind:'REFUND',eventKey:`refund-paid:${id}`}})).toBe(1);
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id,kind:'REFUND'}})).toBe(2); // Obligation reversal + one actual transfer recording.
      expect(await prisma.financeRefund.findUniqueOrThrow({where:{id}})).toMatchObject({status:'PAID',version:2});
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toMatchObject({paymentStatus:'REFUNDED',bookingStatus:'CANCELLED_BY_GUEST'});
      const evidence=resolve('../.tmp/s4-admin-refund-real');await mkdir(evidence,{recursive:true});
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,`paid-${width}.png`),fullPage:true});}
      expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('Synthetic only, no bank refund executed');
    }finally{try{await browser?.close();}finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}await app.close();}}
  },120000);
  it.skipIf(process.env.S4_COMPLAINT_BFF_HTTP!=='1')('S4 complaint Next BFF HTTP forwards ownership, evidence privacy and stable replay through real DB',async()=>{
    // Synthetic paid state, real Next/Nest/PostgreSQL/Redis; not a provider or browser UI test.
    const owner=await bankHost(),booking=await paidBooking('FLEXIBLE',240,false,owner);
    const accessSecret='complaint-bff-fixture-access-secret-32chars';
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('JWT_ACCESS_SECRET',accessSecret);vi.stubEnv('REDIS_KEY_PREFIX',`complaint-bff:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');const base=await app.getUrl();
      const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
      frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
        cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned complaint frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(accessSecret));
      const guest=await token(tenantId,'TENANT'),host=await token(owner,'HOST'),other=await token(otherHostId,'HOST'),reviewer=await token(adminId,'ADMIN');
      const http=async(path:string,auth:string,body?:unknown,key?:string,source=origin)=>{
        const response=await fetch(`${origin}/api/management${path}`,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${auth}`,origin:source,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
        expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('set-cookie')).toBeNull();return {status:response.status,body:await response.json()};
      };
      const create={expectedVersion:booking.version,reason:' Synthetic guest complaint '},createKey=randomUUID(),bookingPath=`/bookings/${booking.id}/complaints`;
      expect((await http(bookingPath,guest,create,createKey,'https://evil.test')).status).toBe(403);
      expect((await http(bookingPath,guest,{...create,amount:1},createKey)).status).toBe(400);
      expect((await http(bookingPath,guest,create)).status).toBe(400);
      const created=await http(bookingPath,guest,create,createKey);expect(created.status).toBe(201);expect(created.body.data).toMatchObject({status:'OPEN',version:1,reason:create.reason.trim()});
      expect(await http(bookingPath,guest,create,createKey)).toEqual(created);
      expect((await http(bookingPath,guest,{...create,reason:'Changed payload'},createKey)).status).toBe(409);
      const id=created.body.data.id,hostPath=`/host/finance/complaints/${id}`,adminPath=`/admin/finance/complaints/${id}`;
      expect((await http('/host/finance/complaints',guest)).status).toBe(403);expect((await http(adminPath,host)).status).toBe(403);
      expect((await http(hostPath,other)).status).toBe(404);expect((await http(bookingPath,host)).status).toBe(404);
      for(const [path,auth] of [['/host/finance/complaints',host],['/admin/finance/complaints',reviewer]]) {
        const total=auth===host?1:(await db.query('SELECT count(*)::int AS n FROM finance_complaints')).rows[0].n;
        const result=await http(`${path}?page=1&limit=20`,auth);expect(result.status).toBe(200);expect(result.body.meta).toMatchObject({page:1,limit:20,total,totalPages:Math.ceil(total/20)});expect(result.body.data).toEqual(expect.arrayContaining([expect.objectContaining({id})]));
      }
      const respond={expectedVersion:1,message:' Synthetic Host response '},respondKey=randomUUID();
      const responded=await http(hostPath+'/respond',host,respond,respondKey);expect(responded.body.data).toMatchObject({status:'OPEN',version:2});expect(await http(hostPath+'/respond',host,respond,respondKey)).toEqual(responded);
      const assign={expectedVersion:2,assigneeId:adminId,reason:' Synthetic assignment '},assignKey=randomUUID();
      const assigned=await http(adminPath+'/assign',reviewer,assign,assignKey);expect(assigned.body.data).toMatchObject({status:'OPEN',version:3,assigneeId:adminId});expect(await http(adminPath+'/assign',reviewer,assign,assignKey)).toEqual(assigned);
      const resolveBody={expectedVersion:3,decision:'HOST',reason:' Synthetic decision ',evidenceNote:'Private synthetic BFF evidence'},resolveKey=randomUUID();
      expect((await http(adminPath+'/resolve',reviewer,{...resolveBody,decision:'FULL_REFUND'},randomUUID())).status).toBe(400);
      const resolved=await http(adminPath+'/resolve',reviewer,resolveBody,resolveKey);expect(resolved.status).toBe(200);expect(resolved.body.data).toMatchObject({status:'RESOLVED',version:4,resolution:{decision:'HOST'}});expect(await http(adminPath+'/resolve',reviewer,resolveBody,resolveKey)).toEqual(resolved);
      const guestDetail=await http(bookingPath,guest),hostDetail=await http(hostPath,host),adminDetail=await http(adminPath,reviewer);
      expect(guestDetail.status).toBe(200);expect(hostDetail.status).toBe(200);expect(adminDetail.status).toBe(200);
      expect(JSON.stringify(guestDetail.body)).not.toContain(resolveBody.evidenceNote);expect(JSON.stringify(hostDetail.body)).not.toContain(resolveBody.evidenceNote);
      expect(guestDetail.body.data[0].resolution).not.toHaveProperty('actorId');expect(hostDetail.body.data.resolution).not.toHaveProperty('evidenceNote');expect(adminDetail.body.data.resolution).toMatchObject({actorId:adminId,evidenceNote:resolveBody.evidenceNote});
      expect((await http(adminPath+'/resolve',reviewer,resolveBody,randomUUID())).body.errorCode).toBe('STALE_COMPLAINT_VERSION');
      expect((await db.query('SELECT count(*)::int AS n FROM finance_complaint_events WHERE complaint_id=$1',[id])).rows[0].n).toBe(4);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(booking);expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
    }finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}await app.close();}
  },120000);
  it.skipIf(process.env.S4_ADMIN_COMPLAINT_BROWSER!=='1')('S4 Admin complaint UI real Auth BFF DB preserves one decision after lost delivery',async()=>{
    // Synthetic paid booking, real login/Next/Nest/DB. No provider or money movement.
    const owner=await bankHost(),booking=await paidBooking('FLEXIBLE',240,false,owner);
    const input={expectedVersion:booking.version,reason:'Synthetic guest complaint'},created=await complaints.create(tenantId,booking.id,input,randomUUID(),input),id=String(created.id);
    const password='ComplaintBrowserFixture123!',user=await prisma.user.create({data:{phone:'0990000097',fullName:'Synthetic complaint browser Admin',role:'ADMIN',isPhoneVerified:true,passwordHash:await bcrypt.hash(password,4)}});
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('REDIS_KEY_PREFIX',`complaint-browser:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let browser:{close():Promise<void>}|undefined,frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');const base=await app.getUrl();
      const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
      frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned complaint frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright'),launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(user.phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.goto(origin+'/admin/finance/complaints');await page.getByRole('listitem').filter({hasText:id}).getByRole('button',{name:'Xem khiếu nại',exact:true}).click();const form=page.getByRole('form',{name:'Xử lý khiếu nại'});
      await form.getByRole('button',{name:'Phân công',exact:true}).click();expect((await db.query('SELECT count(*)::int AS n FROM finance_complaint_events WHERE complaint_id=$1',[id])).rows[0].n).toBe(1);
      await form.getByLabel('UUID Admin phụ trách (khi phân công)',{exact:true}).fill(user.id);await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic assignment');await form.getByRole('button',{name:'Phân công',exact:true}).click();await form.getByText('Máy chủ đã ghi nhận thao tác.',{exact:false}).waitFor();
      const writes:{body:unknown;key:string|undefined}[]=[];
      await page.route(`**/api/management/admin/finance/complaints/${id}/resolve`,async route=>{writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});const response=await route.fetch();expect(response.status()).toBe(200);if(writes.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_DELIVERY_LOST',message:'Synthetic lost delivery after actual commit'}});return route.fulfill({response});});
      await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic decision for Host');await form.getByLabel('Ghi chú chứng cứ (khi chốt quyết định)',{exact:true}).fill('Private synthetic complaint evidence');await form.getByRole('button',{name:'Chốt quyết định cho chủ nhà',exact:true}).click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();
      expect((await db.query('SELECT count(*)::int AS n FROM finance_complaint_resolutions WHERE complaint_id=$1',[id])).rows[0].n).toBe(1);
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await page.getByRole('heading',{name:'Quyết định cho chủ nhà',exact:true}).waitFor();expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
      expect((await db.query('SELECT count(*)::int AS n FROM finance_complaint_resolutions WHERE complaint_id=$1',[id])).rows[0].n).toBe(1);expect((await db.query('SELECT count(*)::int AS n FROM finance_complaint_events WHERE complaint_id=$1',[id])).rows[0].n).toBe(3);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(booking);expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
      const evidence=resolve('../.tmp/s4-admin-complaint-real');await mkdir(evidence,{recursive:true});for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(evidence,`resolved-${width}.png`),fullPage:true});}
      expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('Private synthetic complaint evidence');
    }finally{try{await browser?.close();}finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}await app.close();}}
  },120000);
  it.skipIf(process.env.S4_GUEST_HOST_COMPLAINT_BROWSER!=='1')('S4 Guest Host complaint UI real Auth BFF DB creates and responds once after lost delivery',async()=>{
    // Synthetic paid state, actual local Auth/Next/Nest/PostgreSQL/Redis. No gateway.
    const owner=await bankHost(),booking=await paidBooking('FLEXIBLE',240,false,owner),password='ComplaintGuestHostFixture123!';
    const passwordHash=await bcrypt.hash(password,4);await prisma.user.update({where:{id:tenantId},data:{passwordHash,isPhoneVerified:true}});await prisma.user.update({where:{id:owner},data:{phone:'0990000093',passwordHash,isPhoneVerified:true}});
    const guest=await prisma.user.findUniqueOrThrow({where:{id:tenantId}}),host=await prisma.user.findUniqueOrThrow({where:{id:owner}});
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('REDIS_KEY_PREFIX',`complaint-guest-host-browser:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let browser:{close():Promise<void>}|undefined,frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');const base=await app.getUrl();
      const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned guest Host frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright'),launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const guestContext=await launched.newContext({viewport:{width:1440,height:1000}}),hostContext=await launched.newContext({viewport:{width:1440,height:1000}}),guestPage=await guestContext.newPage(),hostPage=await hostContext.newPage();
      const login=async(page:typeof guestPage,phone:string)=>{await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');};
      await login(guestPage,guest.phone);await guestPage.goto(`${origin}/bookings/${booking.id}/complaints`);const createForm=guestPage.getByRole('form',{name:'Tạo khiếu nại'});
      await createForm.getByRole('button',{name:'Gửi khiếu nại',exact:true}).click();expect((await db.query('SELECT count(*)::int AS n FROM finance_complaints WHERE booking_id=$1',[booking.id])).rows[0].n).toBe(0);
      const createWrites:{body:unknown;key:string|undefined}[]=[],replyWrites:{body:unknown;key:string|undefined}[]=[];
      await guestPage.route(`**/api/management/bookings/${booking.id}/complaints`,async route=>{if(route.request().method()==='GET')return route.continue();createWrites.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});const response=await route.fetch();expect(response.status()).toBe(201);if(createWrites.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_LOST',message:'Synthetic delivery lost after actual create'}});return route.fulfill({response});});
      await createForm.getByLabel('Nội dung khiếu nại',{exact:true}).fill(' Synthetic complaint from real browser ');await createForm.getByRole('button',{name:'Gửi khiếu nại',exact:true}).click();await createForm.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await guestPage.getByText('Đơn đang có khiếu nại mở.',{exact:false}).waitFor();expect(createWrites).toHaveLength(2);expect(createWrites[1]).toEqual(createWrites[0]);expect(createWrites[0].body).toMatchObject({expectedVersion:booking.version});
      const [{id}]=(await db.query('SELECT id FROM finance_complaints WHERE booking_id=$1',[booking.id])).rows;
      await login(hostPage,host.phone);await hostPage.goto(origin+'/host/finance/complaints');await hostPage.getByRole('button',{name:'Xem khiếu nại',exact:true}).click();const replyForm=hostPage.getByRole('form',{name:'Gửi phản hồi khiếu nại'});
      await hostPage.route(`**/api/management/host/finance/complaints/${id}/respond`,async route=>{replyWrites.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});const response=await route.fetch();expect(response.status()).toBe(200);if(replyWrites.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_LOST',message:'Synthetic delivery lost after actual reply'}});return route.fulfill({response});});
      await replyForm.getByLabel('Nội dung phản hồi',{exact:true}).fill(' Synthetic Host response from real browser ');await replyForm.getByRole('button',{name:'Gửi phản hồi',exact:true}).click();await replyForm.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await hostPage.getByText('Chủ nhà phản hồi',{exact:true}).waitFor();expect(replyWrites).toHaveLength(2);expect(replyWrites[1]).toEqual(replyWrites[0]);expect(replyWrites[0].body).toMatchObject({expectedVersion:1});
      expect((await db.query('SELECT status,version FROM finance_complaints WHERE id=$1',[id])).rows[0]).toEqual({status:'OPEN',version:2});expect((await db.query('SELECT count(*)::int AS n FROM finance_complaint_events WHERE complaint_id=$1',[id])).rows[0].n).toBe(2);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(booking);expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
      await guestPage.reload();await guestPage.getByText('Chủ nhà phản hồi',{exact:true}).waitFor();
      const evidence=resolve('../.tmp/s4-guest-host-complaint-real');await mkdir(evidence,{recursive:true});for(const [label,page] of [['guest',guestPage],['host',hostPage]] as const)for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:resolve(evidence,`${label}-${width}.png`),fullPage:true});expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('real browser');}
    }finally{try{await browser?.close();}finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}await app.close();}}
  },120000);
  it('payout notifications derive atomic audit events, retain first read and exclude private evidence',async()=>{
    const {fixture,draft}=await historicalPayoutDraft(),owner=fixture.owner;
    const before=await payoutNotices.list(owner,1,20);
    expect(before.meta).toMatchObject({total:1,unreadCount:1});expect(before.data[0]).toMatchObject({batchId:draft.id,type:'CREATED',readAt:null});
    const approve={expectedVersion:1,reason:'Private synthetic approval'},key=randomUUID();
    await payoutDrafts.approve(adminId,draft.id,approve,key,approve);await payoutDrafts.approve(adminId,draft.id,approve,key,approve);
    const approved=await payoutNotices.list(owner,1,1);expect(approved.meta).toMatchObject({total:2,totalPages:2,unreadCount:2});expect(approved.data[0].type).toBe('APPROVED');
    expect(JSON.stringify(approved)).not.toMatch(/Private|reason|actorId|accountNumber|bankReference|evidenceNote|amount/);
    const event=approved.data[0].id;
    const reads=await Promise.all([payoutNotices.markRead(owner,event),payoutNotices.markRead(owner,event)]);
    expect(reads[1]).toEqual(reads[0]);expect(reads[0].readAt).not.toBeNull();
    const restarted=new PayoutNotificationsService(prisma);expect(await restarted.markRead(owner,event)).toEqual(reads[0]);
    expect((await restarted.list(owner,2,1)).data[0].type).toBe('CREATED');expect((await restarted.list(owner,1,20)).meta.unreadCount).toBe(1);
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Private synthetic evidence, no transfer',reason:'Private synthetic paid reason'};
    await payoutDrafts.confirmPaid(adminId,draft.id,evidence,randomUUID(),evidence);
    const paid=await restarted.list(owner,1,20);expect(paid.meta).toMatchObject({total:3,unreadCount:2});expect(paid.data[0].type).toBe('PAID');expect(paid.data[0].message).toContain('Hệ thống không thực hiện chuyển tiền');
    expect((await restarted.list(otherHostId,1,20)).data.some(row=>row.batchId===draft.id)).toBe(false);
    await expect(restarted.markRead(otherHostId,event)).rejects.toMatchObject({status:404});
    await expect(db.query('INSERT INTO finance_payout_notification_reads(event_id,recipient_id) VALUES($1,$2)',[event,otherHostId])).rejects.toThrow('another recipient');
    await expect(db.query('UPDATE finance_payout_notification_reads SET read_at=clock_timestamp() WHERE event_id=$1',[event])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM finance_payout_notification_reads WHERE event_id=$1',[event])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE finance_payout_notification_reads')).rejects.toThrow('append-only');
  });
  it('payout notification cancellation is durable but rolled back transitions leave no notification',async()=>{
    const {fixture,draft}=await historicalPayoutDraft();
    await expect(prisma.$transaction(async tx=>{
      await cancelPayoutDraft(tx,adminId,draft.id,1,'Synthetic rollback');throw new Error('Synthetic notice rollback');
    })).rejects.toThrow('Synthetic notice rollback');
    expect((await payoutNotices.list(fixture.owner,1,20)).meta.total).toBe(1);
    const body={expectedVersion:1,reason:'Private cancel reason'},key=randomUUID();
    await payoutDrafts.cancel(adminId,draft.id,body,key,body);await payoutDrafts.cancel(adminId,draft.id,body,key,body);
    const list=await payoutNotices.list(fixture.owner,1,20);expect(list.meta.total).toBe(2);expect(list.data[0].type).toBe('CANCELLED');expect(JSON.stringify(list)).not.toContain(body.reason);
  });
  it('payout notifications HTTP enforces Host ownership, empty body, pagination and OpenAPI',async()=>{
    const {fixture,draft}=await historicalPayoutDraft(),accessSecret='payout-notification-fixture-secret-32chars';
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('JWT_ACCESS_SECRET',accessSecret);vi.stubEnv('REDIS_KEY_PREFIX',`payout-notice-http:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const base=await app.getUrl(),document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      const token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(accessSecret));
      const own=await token(fixture.owner,'HOST'),other=await token(otherHostId,'HOST');
      const http=async(path:string,bearer?:string,body?:unknown)=>{
        const response=await fetch(`${base}/api/v1/host/payout-notifications${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(bearer?{authorization:`Bearer ${bearer}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
        return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
      };
      expect((await http('')).status).toBe(401);expect((await http('',await token(tenantId,'TENANT'))).status).toBe(403);expect((await http('',await token(adminId,'ADMIN'))).status).toBe(403);
      const list=await http('?page=1&limit=1',own);expect(list).toMatchObject({status:200,cache:'no-store',body:{success:true,meta:{page:1,limit:1,total:1,totalPages:1,unreadCount:1}}});
      const id=list.body.data[0].id;expect(list.body.data[0].batchId).toBe(draft.id);
      expect((await http(`/${id}/read`,other,{})).status).toBe(404);expect((await http(`/${randomUUID()}/read`,own,{})).status).toBe(404);
      for(const body of [null,[],{recipientId:fixture.owner},{readAt:'2026-01-01'}])expect((await http(`/${id}/read`,own,body)).status).toBe(400);
      expect((await http('/invalid/read',own,{})).status).toBe(400);expect((await http('?page=0',own)).status).toBe(400);
      const read=await http(`/${id}/read`,own,{});expect(read).toMatchObject({status:200,cache:'no-store'});expect(await http(`/${id}/read`,own,{})).toEqual(read);
      expect((await http('',own)).body.meta.unreadCount).toBe(0);
      expect(document.paths['/api/v1/host/payout-notifications'].get!.responses['200']).toHaveProperty('content.application/json.schema.properties.meta');
      expect(document.components!.schemas!.PayoutNotificationDto.required).toEqual(expect.arrayContaining(['id','batchId','type','message','readAt','createdAt']));
      expect(document.paths['/api/v1/host/payout-notifications/{id}/read'].post!.requestBody).toHaveProperty('content.application/json.schema.additionalProperties',false);
    } finally {await app.close();}
  });
  it('Admin payout readiness tracks current gates without changing immutable snapshots or granting Host operations',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft();
    const before=await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}});
    expect((await payoutDrafts.read(draft.id,null)).operations).toEqual({canApprove:true,canExport:false,canConfirmPaid:false,canCancel:true,reviewRequired:false});
    expect(await payoutDrafts.read(draft.id,fixture.owner)).not.toHaveProperty('operations');
    expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}})).toEqual(before);
    const approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    expect((await payoutDrafts.read(draft.id,null)).operations).toEqual({canApprove:false,canExport:true,canConfirmPaid:true,canCancel:true,reviewRequired:false});
    const replacement=bankInput(fixture.version);
    await banks.submit(fixture.owner,replacement,randomUUID(),replacement);
    expect((await payoutDrafts.read(draft.id,null)).operations).toEqual({canApprove:false,canExport:false,canConfirmPaid:false,canCancel:true,reviewRequired:true});
    // A prior ready=true observation cannot authorize a transfer recording after gates change.
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic no transfer',reason:'Synthetic stale readiness'};
    await expect(payoutDrafts.confirmPaid(adminId,draft.id,evidence,randomUUID(),evidence)).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    await expect(payoutDrafts.exportCsv(adminId,draft.id)).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    const cancel={expectedVersion:2,reason:'Synthetic invalid bank snapshot cancellation'};
    await payoutDrafts.cancel(adminId,draft.id,cancel,randomUUID(),cancel);
    expect((await payoutDrafts.read(draft.id,null)).operations).toEqual({canApprove:false,canExport:false,canConfirmPaid:false,canCancel:false,reviewRequired:false});
    expect((await payoutDrafts.read(draft.id,null)).bankAccountId).toBe(fixture.bank.id);
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(0);
  });
  it('manual payout proof atomically debits retained proceeds once and cannot be rewritten or paid without proof',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only; no transfer',reason:'Synthetic paid proof'};
    await expect(db.query("UPDATE finance_payout_batches SET status='PAID',version=version+1 WHERE id=$1",[draft.id])).rejects.toThrow();
    await expect(prisma.$transaction(tx=>recordManualPayout(tx,fixture.owner,draft.id,evidence))).rejects.toMatchObject({status:403});
    const result=await prisma.$transaction(tx=>recordManualPayout(tx,adminId,draft.id,evidence));
    expect(result).toMatchObject({id:draft.id,status:'PAID',version:3,amount:'990'});
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(1);
    const balance=await db.query("SELECT sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END)::text AS net FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.booking_id=$1 AND e.account='HOST_PAYABLE'",[b.id]);
    expect(balance.rows[0].net).toBe('0');
    await expect(prisma.$transaction(tx=>recordManualPayout(tx,adminId,draft.id,evidence))).rejects.toMatchObject({response:{errorCode:'STALE_PAYOUT_VERSION'}});
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(1);
    await expect(db.query("UPDATE finance_payout_confirmations SET evidence_note='changed' WHERE batch_id=$1",[draft.id])).rejects.toThrow();
    await expect(db.query('DELETE FROM finance_payout_paid_items WHERE batch_id=$1',[draft.id])).rejects.toThrow();
    expect((await payoutDrafts.read(draft.id,fixture.owner)).events.at(-1)).toMatchObject({action:'PAID'});
  });
  it('payout evidence alone cannot commit and changed bank blocks manual confirmation without a journal',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    await expect(db.query("INSERT INTO finance_payout_confirmations(batch_id,actor_id,version_before,bank_reference,reference_key,evidence_note,reason) VALUES($1,$2,2,'FIXTURE-ONLY','FIXTURE-ONLY','Synthetic','Synthetic')",[draft.id,adminId])).rejects.toThrow();
    const replacement=bankInput(fixture.version);await banks.submit(fixture.owner,replacement,randomUUID(),replacement);
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic',reason:'Synthetic'};
    await expect(prisma.$transaction(tx=>recordManualPayout(tx,adminId,draft.id,evidence))).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM finance_payout_confirmations WHERE batch_id=$1',[draft.id])).rows[0].n).toBe(0);
  });
  it('concurrent manual paid confirmations only consume one approved version and one source',async()=>{
    const {b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic'};
    const results=await Promise.allSettled([1,2].map(()=>prisma.$transaction(tx=>recordManualPayout(tx,adminId,draft.id,evidence))));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(1);
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id,action:'PAID'}})).toBe(1);
  });
  it('bank-qualified manual payout reference cannot be reused with another batch, including case changes',async()=>{
    const first=await historicalPayoutDraft(),second=await historicalPayoutDraft();
    const approve={expectedVersion:1,reason:'Synthetic approval'};
    for(const item of [first,second]) await payoutDrafts.approve(adminId,item.draft.id,approve,randomUUID(),approve);
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic'};
    await prisma.$transaction(tx=>recordManualPayout(tx,adminId,first.draft.id,evidence));
    await expect(prisma.$transaction(tx=>recordManualPayout(tx,adminId,second.draft.id,{...evidence,bankReference:evidence.bankReference.toLowerCase()})))
      .rejects.toMatchObject({response:{errorCode:'PAYOUT_REFERENCE_REUSED'}});
    expect(await prisma.financeJournal.count({where:{bookingId:second.b.id,kind:'PAYOUT'}})).toBe(0);
    expect((await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:second.draft.id}})).status).toBe('APPROVED');
  });
  it('fault after payout ledger writes rolls evidence, journals and audit back together, then retry succeeds',async()=>{
    const {b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic'},key=randomUUID();
    await db.query("CREATE FUNCTION payout_fixture_fail_paid() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='PAID' THEN RAISE EXCEPTION 'synthetic paid fault'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER payout_fixture_fail_paid BEFORE UPDATE ON finance_payout_batches FOR EACH ROW EXECUTE FUNCTION payout_fixture_fail_paid()');
    try {await expect(payoutDrafts.confirmPaid(adminId,draft.id,evidence,key,evidence)).rejects.toMatchObject({status:503,response:{errorCode:'PAYOUT_RECORDING_FAILED'}});}
    finally {await db.query('DROP TRIGGER payout_fixture_fail_paid ON finance_payout_batches');await db.query('DROP FUNCTION payout_fixture_fail_paid()');}
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(0);
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id,action:'PAID'}})).toBe(0);
    expect((await db.query('SELECT count(*)::int AS n FROM finance_payout_confirmations WHERE batch_id=$1',[draft.id])).rows[0].n).toBe(0);
    expect(await prisma.bookingIdempotency.count({where:{userId:adminId,key,operation:'ADMIN_PAYOUT_PAID'}})).toBe(0);
    expect((await payoutDrafts.confirmPaid(adminId,draft.id,evidence,key,evidence)).status).toBe('PAID');
  });
  it('deferred paid proof rejects a late unsupported debt write in the same transaction',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const evidence={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic'};
    await expect(prisma.$transaction(async tx=>{
      await recordManualPayout(tx,adminId,draft.id,evidence);
      await appendFinancialJournal(tx,{eventKey:'fixture:'+randomUUID(),kind:'ADJUSTMENT',bookingId:b.id,hostId:fixture.owner,actorId:adminId,reason:'Synthetic unsupported late debt',
        lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1'},{account:'HOST_DEBT',side:'CREDIT',amount:'1'}]});
    })).rejects.toThrow();
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(0);
    expect((await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}})).status).toBe('APPROVED');
  });
  it('manual payout domain caches the exact successful response seven days and concurrent same-key retries never debit twice',async()=>{
    const {b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const dto={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic'},raw={...dto,reason:' Synthetic '},key=randomUUID();
    const [first,second]=await Promise.all([payoutDrafts.confirmPaid(adminId,draft.id,dto,key,raw),payoutDrafts.confirmPaid(adminId,draft.id,dto,key,raw)]);
    expect(second).toEqual(first);expect(first).toMatchObject({status:'PAID',version:3,amount:'990'});
    expect(await payoutDrafts.confirmPaid(adminId,draft.id.toUpperCase(),dto,key,raw)).toEqual(first);
    await expect(payoutDrafts.confirmPaid(adminId,draft.id,dto,key,dto)).rejects.toMatchObject({response:{errorCode:'IDEMPOTENCY_CONFLICT'}});
    await expect(payoutDrafts.confirmPaid(adminId,randomUUID(),dto,key,raw)).rejects.toMatchObject({response:{errorCode:'IDEMPOTENCY_CONFLICT'}});
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(1);
    const saved=await prisma.bookingIdempotency.findFirstOrThrow({where:{operation:'ADMIN_PAYOUT_PAID',userId:adminId,key}});
    expect(saved.responseBody).toEqual(first);expect(saved.expiresAt.getTime()-saved.createdAt.getTime()).toBe(7*86400000);
    const own=await payoutDrafts.read(draft.id,(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}})).hostId);
    expect(Object.keys(own.confirmation!)).toEqual(['confirmedAt']);
  });
  it('verified paid history permits another batch for the same Host without repaying the first booking',async()=>{
    const first=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    const evidence=()=>({expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only, no bank transfer',reason:'Synthetic'});
    await payoutDrafts.approve(adminId,first.draft.id,approve,randomUUID(),approve);
    const firstProof=evidence();await payoutDrafts.confirmPaid(adminId,first.draft.id,firstProof,randomUUID(),firstProof);
    const journal=await prisma.financeJournal.findFirstOrThrow({where:{bookingId:first.b.id,kind:'PAYOUT'}});
    expect((await db.query('SELECT finance_payout_journal_verified($1) AS verified',[journal.id])).rows[0].verified).toBe(true);
    expect(await hostFinance.summary(first.fixture.owner)).toMatchObject({reviewCount:0,balances:{eligibleBeforeDeductions:'0'}});
    const second=await historicalPayoutDraft(first.fixture);
    expect(second.draft).toMatchObject({hostId:first.fixture.owner,amount:'990',status:'DRAFT'});
    expect((await payoutDrafts.read(second.draft.id,first.fixture.owner)).items.map(i=>i.bookingId)).toEqual([second.b.id]);
    await payoutDrafts.approve(adminId,second.draft.id,approve,randomUUID(),approve);
    const secondProof=evidence();await payoutDrafts.confirmPaid(adminId,second.draft.id,secondProof,randomUUID(),secondProof);
    expect(await prisma.financeJournal.count({where:{hostId:first.fixture.owner,kind:'PAYOUT'}})).toBe(2);
    expect(await hostFinance.summary(first.fixture.owner)).toMatchObject({reviewCount:0,balances:{eligibleBeforeDeductions:'0'}});
    const dto={hostId:first.fixture.owner,reason:'Synthetic no more sources'};
    await expect(payoutDrafts.create(adminId,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'PAYOUT_NO_ELIGIBLE_ITEMS'}});
  });
  it('changing bank does not erase historical paid proof or turn already paid money into an eligible balance',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const proof={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic'};
    await payoutDrafts.confirmPaid(adminId,draft.id,proof,randomUUID(),proof);
    const journal=await prisma.financeJournal.findFirstOrThrow({where:{bookingId:b.id,kind:'PAYOUT'}});
    const replacement=bankInput(fixture.version),submitted=await banks.submit(fixture.owner,replacement,randomUUID(),replacement);
    expect((await db.query('SELECT finance_payout_journal_verified($1) AS verified',[journal.id])).rows[0].verified).toBe(true);
    expect(await hostFinance.summary(fixture.owner)).toMatchObject({bankVerified:false,reviewCount:0,balances:{eligibleBeforeDeductions:'0'}});
    expect((await payoutDrafts.read(draft.id,fixture.owner)).status).toBe('PAID');
    expect((await payoutDrafts.read(draft.id,null)).bankAccountId).toBe(fixture.bank.id);
    const review=bankReview(3);await banks.review(adminId,(submitted.account as {id:string}).id,'VERIFY',review,randomUUID(),review);
    const next=await historicalPayoutDraft(fixture),nextDetail=await payoutDrafts.read(next.draft.id,null);
    expect(nextDetail.bankAccountId).toBe((submitted.account as {id:string}).id);
    expect(nextDetail.bankAccountId).not.toBe(fixture.bank.id);
  });
  it('Admin refund snapshot recognizes immutable PAID payout without rewriting paid history or granting refund permission',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic snapshot approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const proof={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic snapshot payout'};
    await payoutDrafts.confirmPaid(adminId,draft.id,proof,randomUUID(),proof);
    const before=await payoutDrafts.read(draft.id,null);
    const snapshot=await prisma.$transaction(tx=>complaintBookingSnapshot(tx,b.id,fixture.owner));
    expect(snapshot).toMatchObject({reviewRequired:false,remainingRefundableAmounts:{baseAmount:'1000',cleaningFee:'100',serviceFee:'0',taxAmount:'0'}});
    expect(await payoutDrafts.read(draft.id,null)).toEqual(before);
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id,action:'PAID'}})).toBe(1);
    // A read projection is not authorization to create a post-payout refund/debt.
    expect((await db.query('SELECT count(*)::int AS count FROM finance_complaint_refunds WHERE booking_id=$1',[b.id])).rows[0].count).toBe(0);
  });
  it('Admin refund snapshot keeps unsupported payout-shaped journal under review even on a booking with legitimate PAID proof',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic snapshot approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const proof={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic snapshot payout'};
    await payoutDrafts.confirmPaid(adminId,draft.id,proof,randomUUID(),proof);
    await append({eventKey:'fixture:'+randomUUID(),kind:'PAYOUT',bookingId:b.id,hostId:fixture.owner,actorId:adminId,reason:'Synthetic unproven payout',
      lines:[{account:'HOST_PAYABLE',side:'DEBIT',amount:'1'},{account:'CASH_CLEARING',side:'CREDIT',amount:'1'}]});
    const snapshot=await prisma.$transaction(tx=>complaintBookingSnapshot(tx,b.id,fixture.owner));
    expect(snapshot).toMatchObject({reviewRequired:true,remainingRefundableAmounts:null});
    expect(await payoutDrafts.read(draft.id,null)).toMatchObject({status:'PAID',version:3,amount:'990'});
  });
  it('a payout-shaped journal without immutable confirmation remains unsupported even after a legitimate paid batch',async()=>{
    const {fixture,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    const proof={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic only',reason:'Synthetic'};
    await payoutDrafts.confirmPaid(adminId,draft.id,proof,randomUUID(),proof);
    const forged=await append({eventKey:'fixture:'+randomUUID(),kind:'PAYOUT',bookingId:null,hostId:fixture.owner,actorId:adminId,reason:'Synthetic unsupported journal',
      lines:[{account:'HOST_PAYABLE',side:'DEBIT',amount:'1'},{account:'CASH_CLEARING',side:'CREDIT',amount:'1'}]});
    expect((await db.query('SELECT finance_payout_journal_verified($1) AS verified',[forged.journalId])).rows[0].verified).toBe(false);
    const dto={hostId:fixture.owner,reason:'Synthetic blocked by unsupported provenance'};
    await expect(payoutDrafts.create(adminId,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
  });
  it('bank change blocks approval of the old snapshot, without stale-bank fallback or success replay',async()=>{
    const {fixture,b,draft}=await historicalPayoutDraft(),replacement=bankInput(fixture.version);
    await banks.submit(fixture.owner,replacement,randomUUID(),replacement);
    const dto={expectedVersion:1,reason:'Synthetic blocked approval'},key=randomUUID();
    await expect(payoutDrafts.approve(adminId,draft.id,dto,key,dto)).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    expect(await prisma.bookingIdempotency.count({where:{userId:adminId,operation:'ADMIN_PAYOUT_APPROVE',key}})).toBe(0);
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id,action:'APPROVED'}})).toBe(0);
    expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}})).toMatchObject({status:'DRAFT',version:1,bankAccountId:fixture.bank.id});
    await payoutDrafts.cancel(adminId,draft.id,dto,randomUUID(),dto);
    expect(await prisma.financePayoutItem.count({where:{bookingId:b.id,status:'ACTIVE'}})).toBe(0);
  });
  it('CSV requires current approved bank/ledger gates and is read-only, including after bank change or cancellation',async()=>{
    const {fixture,draft}=await historicalPayoutDraft(),dto={expectedVersion:1,reason:'Synthetic CSV approval'};
    await expect(payoutDrafts.exportCsv(fixture.owner,draft.id)).rejects.toMatchObject({status:403});
    await expect(payoutDrafts.exportCsv(adminId,draft.id)).rejects.toMatchObject({response:{errorCode:'PAYOUT_NOT_APPROVED'}});
    await payoutDrafts.approve(adminId,draft.id,dto,randomUUID(),dto);
    const before=await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}}),audits=await prisma.financePayoutEvent.count({where:{batchId:draft.id}}),journals=await prisma.financeJournal.count();
    const csv=await payoutDrafts.exportCsv(adminId,draft.id);
    expect(csv).toMatchObject({filename:`payout-${draft.id}-v2.csv`,encoding:'UTF-8'});
    expect(csv.csv).toContain(fixture.bank.accountNumber);
    expect(csv.csv).toContain('"990"');expect(csv.csv.split('\r\n')).toHaveLength(3);
    expect(await payoutDrafts.exportCsv(adminId,draft.id)).toEqual(csv);
    expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}})).toEqual(before);
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id}})).toBe(audits);expect(await prisma.financeJournal.count()).toBe(journals);
    const replacement=bankInput(fixture.version);await banks.submit(fixture.owner,replacement,randomUUID(),replacement);
    await expect(payoutDrafts.exportCsv(adminId,draft.id)).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    const cancel={expectedVersion:2,reason:'Synthetic CSV outdated bank cancellation'};await payoutDrafts.cancel(adminId,draft.id,cancel,randomUUID(),cancel);
    await expect(payoutDrafts.exportCsv(adminId,draft.id)).rejects.toMatchObject({response:{errorCode:'PAYOUT_NOT_APPROVED'}});
    await expect(payoutDrafts.exportCsv(adminId,randomUUID())).rejects.toMatchObject({status:404});
  });
  it('new unsupported financial adjustment blocks approval, including direct SQL with an audit',async()=>{
    const {fixture,draft}=await historicalPayoutDraft();
    await append({eventKey:`fixture:post-draft-adjustment:${randomUUID()}`,kind:'ADJUSTMENT',bookingId:null,hostId:fixture.owner,actorId:adminId,reason:'Synthetic adjustment requires review',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'1'}]});
    const dto={expectedVersion:1,reason:'Synthetic blocked approval'};
    await expect(payoutDrafts.approve(adminId,draft.id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    await expect(prisma.$transaction(async tx=>{
      await tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason) VALUES(${draft.id}::uuid,${adminId}::uuid,'APPROVED',1,'Synthetic direct approval')`;
      await tx.$executeRaw`UPDATE finance_payout_batches SET status='APPROVED',version=2 WHERE id=${draft.id}::uuid`;
    })).rejects.toThrow('current verified financial gates');
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id,action:'APPROVED'}})).toBe(0);
  });
  it('concurrent approve/cancel cannot overwrite the same version; every committed transition has one audit',async()=>{
    const {draft}=await historicalPayoutDraft(),dto={expectedVersion:1,reason:'Synthetic competing actions'};
    const results=await Promise.allSettled([payoutDrafts.approve(adminId,draft.id,dto,randomUUID(),dto),payoutDrafts.cancel(adminId,draft.id,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'STALE_PAYOUT_VERSION'}}});
    const batch=await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}});
    expect(batch.version).toBe(2);
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id}})).toBe(2);
  });
  it('a newly OPEN complaint blocks approval of that batch without freezing another Host batch',async()=>{
    const disputed=await historicalPayoutDraft(),other=await historicalPayoutDraft();
    // Defensive persisted OPEN-complaint fixture, not authorization to open
    // a new complaint for a cancelled booking through the public endpoint.
    await prisma.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_complaints(booking_id,guest_id,host_id,reason)
        VALUES(${disputed.b.id}::uuid,${tenantId}::uuid,${disputed.fixture.owner}::uuid,'Synthetic defensive OPEN fixture') RETURNING id`;
      await tx.$executeRaw`INSERT INTO finance_complaint_events(complaint_id,actor_id,action,message)
        VALUES(${row.id}::uuid,${tenantId}::uuid,'CREATED','Synthetic defensive complaint')`;
    });
    const dto={expectedVersion:1,reason:'Synthetic approval'};
    await expect(payoutDrafts.approve(adminId,disputed.draft.id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'PAYOUT_REVIEW_REQUIRED'}});
    expect(await payoutDrafts.approve(adminId,other.draft.id,dto,randomUUID(),dto)).toMatchObject({status:'APPROVED'});
    expect(await prisma.financePayoutEvent.count({where:{batchId:disputed.draft.id,action:'APPROVED'}})).toBe(0);
  });
  it('failure after approval audit rolls back version, audit and success replay; same-key retry works',async()=>{
    const {draft}=await historicalPayoutDraft(),dto={expectedVersion:1,reason:'Synthetic fault approval'},key=randomUUID();
    await db.query("CREATE FUNCTION payout_fixture_fail_approve() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='APPROVED' THEN RAISE EXCEPTION 'Synthetic approval failure'; END IF; RETURN NEW; END; $$");
    await db.query('CREATE TRIGGER payout_fixture_fail_approve BEFORE UPDATE ON finance_payout_batches FOR EACH ROW EXECUTE FUNCTION payout_fixture_fail_approve()');
    try {
      await expect(payoutDrafts.approve(adminId,draft.id,dto,key,dto)).rejects.toMatchObject({status:503});
    } finally {
      await db.query('DROP TRIGGER payout_fixture_fail_approve ON finance_payout_batches');
      await db.query('DROP FUNCTION payout_fixture_fail_approve()');
    }
    expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id:draft.id}})).toMatchObject({status:'DRAFT',version:1});
    expect(await prisma.financePayoutEvent.count({where:{batchId:draft.id,action:'APPROVED'}})).toBe(0);
    expect(await prisma.bookingIdempotency.count({where:{userId:adminId,operation:'ADMIN_PAYOUT_APPROVE',key}})).toBe(0);
    expect(await payoutDrafts.approve(adminId,draft.id,dto,key,dto)).toMatchObject({status:'APPROVED',version:2});
  });
  async function insertDraft(tx:Prisma.TransactionClient,fixture:Awaited<ReturnType<typeof payoutBank>>,overrides:{cutoff?:Date;amount?:string;bankVersion?:number;bankAccountId?:string}={}) {
    const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
    const cutoff=overrides.cutoff??weeklyPayoutCutoff(now),accountId=overrides.bankAccountId??fixture.bank.id,version=overrides.bankVersion??fixture.version,amount=overrides.amount??'200000';
    const [row]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_payout_batches(host_id,bank_account_id,bank_version,bank_code,account_number,account_name,cutoff,amount)
      VALUES(${fixture.owner}::uuid,${accountId}::uuid,${version},${fixture.bank.bankCode},${fixture.bank.accountNumber},${fixture.bank.accountName},${cutoff},${amount}::numeric) RETURNING id`;
    return row.id;
  }
  const draftAudit=(tx:Prisma.TransactionClient,id:string,actor=adminId)=>tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason)
    VALUES(${id}::uuid,${actor}::uuid,'CREATED',0,'Synthetic draft audit; no transfer')`;
  it('payout domain selection does not turn PAID flags or recent completion into an eligible draft/replay',async()=>{
    const fixture=await payoutBank(),b=await paidBooking('FLEXIBLE',240,true,fixture.owner),dto={hostId:fixture.owner,reason:'Synthetic draft'},key=randomUUID();
    await paidBooking('FLEXIBLE',240,false,fixture.owner);
    await prisma.booking.update({where:{id:b.id},data:{bookingStatus:'COMPLETED'}});
    await expect(payoutDrafts.create(adminId,dto,key,dto)).rejects.toMatchObject({response:{errorCode:'PAYOUT_NO_ELIGIBLE_ITEMS'}});
    expect(await prisma.bookingIdempotency.count({where:{operation:'ADMIN_PAYOUT_DRAFT',userId:adminId,key}})).toBe(0);
    expect(await prisma.financePayoutBatch.count({where:{hostId:fixture.owner}})).toBe(0);
    await expect(payoutDrafts.create(fixture.owner,dto,randomUUID(),dto)).rejects.toMatchObject({status:403});
    await expect(payoutDrafts.create(adminId,{...dto,hostId:randomUUID()},randomUUID(),dto)).rejects.toMatchObject({status:404});
  });
  it('payout domain rejects unproven adjustment/debt even if no booking is currently eligible',async()=>{
    const fixture=await payoutBank(),dto={hostId:fixture.owner,reason:'Synthetic draft'};
    await append({eventKey:`fixture:unsupported-adjustment:${randomUUID()}`,kind:'ADJUSTMENT',bookingId:null,hostId:fixture.owner,actorId:adminId,reason:'Synthetic unsupported adjustment',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'1'}]});
    await expect(payoutDrafts.create(adminId,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
  });
  it.each([['STRICT',240,550],['FLEXIBLE',2,0]] as const)('retained %s cancellation hold uses snapshot checkout, not cancellation clock',async(policy,hours,amount)=>{
    const b=await paidBooking(policy,hours),request=await guestCancellation(b);
    await request.run();
    const [{start}]=(await db.query('SELECT finance_payout_hold_start($1) AS start',[b.id])).rows;
    expect(start).toEqual(roomTimestamp(b.checkOutDate.toISOString().slice(0,10),'12:00:00'));
    await prisma.homestayUnit.update({where:{id:b.homestayUnitId},data:{checkOutTime:new Date('1970-01-01T17:00:00Z')}});
    expect((await db.query('SELECT finance_payout_hold_start($1) AS start',[b.id])).rows[0].start).toEqual(start);
    expect((await db.query('SELECT refund_amount::text AS amount FROM finance_cancellations WHERE booking_id=$1',[b.id])).rows[0].amount).toBe(String(amount));
    expect((await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).completedAt).toBeNull();
  });
  it('full refund and cancellation without paid provenance cannot invent a payout hold',async()=>{
    const full=await paidBooking(),request=await guestCancellation(full);await request.run();
    expect((await db.query('SELECT finance_payout_hold_start($1) AS start',[full.id])).rows[0].start).toBeNull();
    const unproven=await paidBooking('STRICT',240,false);
    await prisma.booking.update({where:{id:unproven.id},data:{bookingStatus:'CANCELLED_BY_GUEST'}});
    expect((await db.query('SELECT finance_payout_hold_start($1) AS start',[unproven.id])).rows[0].start).toBeNull();
  });
  it('historical synthetic retained proceeds support durable draft, replay, concurrent reservation and release without bypassing guards',async()=>{
    // Synthetic historical stay and internal cancellation fixture, NOT a public payment
    // simulator, clock backdating or an actual bank/provider transaction.
    const fixture=await payoutBank(),b=await paidBooking('FLEXIBLE',-2400,true,fixture.owner);
    const snapshot=cancellationSnapshot(b);
    const calculation=calculateCancellationRefund(snapshot,'GUEST',new Date(roomTimestamp(snapshot.checkInDate,snapshot.checkInTime).getTime()-3600000));
    await prisma.$transaction(async tx=>{
      await recordPaidCancellation(tx,b,fixture.owner,tenantId,'GUEST','Synthetic historical cancellation',calculation);
      await tx.booking.update({where:{id:b.id},data:{bookingStatus:'CANCELLED_BY_GUEST',version:{increment:1}}});
    });
    const dto={hostId:fixture.owner,reason:'Synthetic historical payout draft'},key=randomUUID();
    const source=await prisma.financeJournal.findFirstOrThrow({where:{bookingId:b.id,kind:'PAYMENT'}});
    const [{start}]=(await db.query('SELECT finance_payout_hold_start($1) AS start',[b.id])).rows;
    const item={bookingId:b.id,sourceJournalId:source.id,amount:'990',eligibleAt:new Date(start.getTime()+72*3600000)};
    await expect(prisma.$transaction(async tx=>{
      await persistPayoutDraft(tx,fixture.owner,adminId,weeklyPayoutCutoff(new Date()),'Synthetic fault rollback',[item]);
      throw new Error('Synthetic fault after allocation');
    })).rejects.toThrow('Synthetic fault after allocation');
    expect(await prisma.financePayoutItem.count({where:{bookingId:b.id}})).toBe(0);
    expect(await prisma.financePayoutBatch.count({where:{hostId:fixture.owner}})).toBe(0);
    const first=await payoutDrafts.create(adminId,dto,key,dto);
    expect(first).toMatchObject({status:'DRAFT',amount:'990',version:1});
    expect(await payoutDrafts.create(adminId,dto,key,dto)).toEqual(first);
    expect(await prisma.financePayoutItem.count({where:{bookingId:b.id,status:'ACTIVE'}})).toBe(1);
    await expect(prisma.$transaction(tx=>persistPayoutDraft(tx,fixture.owner,adminId,weeklyPayoutCutoff(new Date()),'Synthetic direct duplicate',[item])))
      .rejects.toThrow('finance_payout_items_active_booking');
    await expect(payoutDrafts.create(adminId,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'PAYOUT_NO_ELIGIBLE_ITEMS'}});
    await expect(db.query("UPDATE finance_payout_batches SET status='APPROVED',version=2 WHERE id=$1",[first.id])).rejects.toThrow('same transaction audit');
    const approval={expectedVersion:1,reason:'Synthetic approval'},approvalKey=randomUUID();
    await expect(payoutDrafts.approve(fixture.owner,first.id,approval,randomUUID(),approval)).rejects.toMatchObject({status:403});
    const approved=await payoutDrafts.approve(adminId,first.id,approval,approvalKey,approval);
    expect(approved).toEqual({id:first.id,status:'APPROVED',version:2});
    expect(await payoutDrafts.approve(adminId,first.id,approval,approvalKey,approval)).toEqual(approved);
    expect(await payoutDrafts.approve(adminId,first.id.toUpperCase(),approval,approvalKey,approval)).toEqual(approved);
    expect(await prisma.financePayoutEvent.count({where:{batchId:first.id,action:'APPROVED'}})).toBe(1);
    expect(await prisma.financePayoutItem.count({where:{bookingId:b.id,status:'ACTIVE'}})).toBe(1);
    await expect(payoutDrafts.approve(adminId,first.id,approval,randomUUID(),approval)).rejects.toMatchObject({response:{errorCode:'STALE_PAYOUT_VERSION'}});
    expect(await prisma.financeJournal.count({where:{bookingId:b.id,kind:'PAYOUT'}})).toBe(0);
    const cancel={expectedVersion:2,reason:'Synthetic release'},cancelKey=randomUUID();
    const cancelled=await payoutDrafts.cancel(adminId,first.id,cancel,cancelKey,cancel);
    expect(cancelled).toMatchObject({status:'CANCELLED',version:3});
    expect(await payoutDrafts.cancel(adminId,first.id,cancel,cancelKey,cancel)).toEqual(cancelled);
    expect(await payoutDrafts.cancel(adminId,first.id.toUpperCase(),cancel,cancelKey,cancel)).toEqual(cancelled);
    expect(await prisma.financePayoutEvent.count({where:{batchId:first.id,action:'CANCELLED'}})).toBe(1);
    expect(await prisma.financePayoutItem.count({where:{bookingId:b.id,status:'RELEASED'}})).toBe(1);
    const results=await Promise.allSettled([payoutDrafts.create(adminId,dto,randomUUID(),dto),payoutDrafts.create(adminId,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'PAYOUT_NO_ELIGIBLE_ITEMS'}}});
    expect(await prisma.financePayoutItem.count({where:{bookingId:b.id,status:'ACTIVE'}})).toBe(1);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).bookingStatus).toBe('CANCELLED_BY_GUEST');
  });
  it('payout draft rejects empty allocations at commit without leaving an audit or bank snapshot',async()=>{
    const fixture=await payoutBank();
    await expect(prisma.$transaction(async tx=>{const id=await insertDraft(tx,fixture);await draftAudit(tx,id);})).rejects.toThrow('current verified financial gates');
    expect(await prisma.financePayoutBatch.count({where:{hostId:fixture.owner}})).toBe(0);
  });
  it('payout draft requires current verified bank and a past Monday 09 Vietnam cutoff',async()=>{
    const fixture=await payoutBank(),other=await payoutBank();
    for(const input of [{bankVersion:fixture.version-1},{bankAccountId:other.bank.id},{cutoff:new Date('2099-01-05T02:00:00Z')},{cutoff:new Date('2026-10-01T02:00:00Z')}]) {
      await expect(prisma.$transaction(tx=>insertDraft(tx,fixture,input))).rejects.toThrow();
    }
    const replacement=bankInput(fixture.version);await banks.submit(fixture.owner,replacement,randomUUID(),replacement);
    await expect(prisma.$transaction(tx=>insertDraft(tx,fixture))).rejects.toThrow('verified bank snapshot');
    expect(await prisma.financePayoutBatch.count({where:{hostId:fixture.owner}})).toBe(0);
  });
  it('payout cannot reserve a paid booking before its completion/no-show holding deadline',async()=>{
    const fixture=await payoutBank(),b=await paidBooking('FLEXIBLE',240,true,fixture.owner);
    await prisma.booking.update({where:{id:b.id},data:{bookingStatus:'COMPLETED'}});
    const source=await prisma.financeJournal.findFirstOrThrow({where:{bookingId:b.id,kind:'PAYMENT'}});
    await expect(prisma.$transaction(async tx=>{
      const booking=await tx.booking.findUniqueOrThrow({where:{id:b.id}});
      const [{now}]=await tx.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`;
      await persistPayoutDraft(tx,fixture.owner,adminId,weeklyPayoutCutoff(now),'Synthetic held draft test',
        [{bookingId:b.id,sourceJournalId:source.id,amount:'990',eligibleAt:new Date(booking.completedAt!.getTime()+72*3600000)}]);
    })).rejects.toThrow('held or disputed');
    expect(await prisma.financePayoutItem.count({where:{bookingId:b.id}})).toBe(0);
  });
  it('payout draft blocks a Host debt journal rather than silently paying without settlement provenance',async()=>{
    const fixture=await payoutBank();
    await append({eventKey:`fixture:debt:${randomUUID()}`,kind:'ADJUSTMENT',bookingId:null,hostId:fixture.owner,actorId:adminId,reason:'Synthetic debt; no real bank transfer',
      lines:[{account:'HOST_DEBT',side:'DEBIT',amount:'1'},{account:'CASH_CLEARING',side:'CREDIT',amount:'1'}]});
    await expect(prisma.$transaction(tx=>insertDraft(tx,fixture))).rejects.toThrow('debt settlement requires');
  });
  it('payout audit rejects non-Admin and cancellation cannot commit without changing draft state',async()=>{
    const fixture=await payoutBank();
    await expect(prisma.$transaction(async tx=>{const id=await insertDraft(tx,fixture);await draftAudit(tx,id,fixture.owner);})).rejects.toThrow('active Admin');
    await expect(prisma.$transaction(async tx=>{
      const id=await insertDraft(tx,fixture);await draftAudit(tx,id);
      await tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason) VALUES(${id}::uuid,${adminId}::uuid,'CANCELLED',1,'Synthetic cancel')`;
    })).rejects.toThrow();
    expect(await prisma.financePayoutBatch.count({where:{hostId:fixture.owner}})).toBe(0);
  });
  it('cancelled draft preserves immutable bank snapshot and audit; cannot become PAID or reopen',async()=>{
    const fixture=await payoutBank();
    const id=await prisma.$transaction(async tx=>{
      const id=await insertDraft(tx,fixture);await draftAudit(tx,id);
      await cancelPayoutDraft(tx,adminId,id,1,'Synthetic cancelled draft; no transfer');
      return id;
    });
    expect(await prisma.financePayoutBatch.findUniqueOrThrow({where:{id}})).toMatchObject({status:'CANCELLED',version:2,bankAccountId:fixture.bank.id});
    expect(await prisma.financePayoutEvent.count({where:{batchId:id}})).toBe(2);
    await expect(prisma.$transaction(tx=>cancelPayoutDraft(tx,adminId,id,1,'Synthetic stale'))).rejects.toMatchObject({response:{errorCode:'STALE_PAYOUT_VERSION'}});
    await expect(prisma.$transaction(tx=>cancelPayoutDraft(tx,adminId,id,2,'Synthetic closed'))).rejects.toMatchObject({response:{errorCode:'PAYOUT_NOT_DRAFT'}});
    await expect(prisma.$transaction(tx=>cancelPayoutDraft(tx,adminId,randomUUID(),1,'Synthetic missing'))).rejects.toMatchObject({status:404});
    await expect(db.query("UPDATE finance_payout_batches SET status='PAID',version=3 WHERE id=$1",[id])).rejects.toThrow();
    await expect(db.query("UPDATE finance_payout_batches SET status='DRAFT',version=3 WHERE id=$1",[id])).rejects.toThrow('immutable');
    await expect(db.query("UPDATE finance_payout_batches SET account_number='changed' WHERE id=$1",[id])).rejects.toThrow('immutable');
    await expect(db.query('DELETE FROM finance_payout_batches WHERE id=$1',[id])).rejects.toThrow('append-only');
    await expect(db.query("UPDATE finance_payout_events SET reason='changed' WHERE batch_id=$1",[id])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE finance_payout_events')).rejects.toThrow('foreign key constraint');
    await expect(db.query('TRUNCATE finance_payout_events, finance_payout_notification_reads')).rejects.toThrow('append-only');
    expect((await db.query("SELECT indexdef FROM pg_indexes WHERE indexname='finance_payout_items_active_booking'")).rows[0].indexdef).toMatch(/UNIQUE.*WHERE.*ACTIVE/);
  });
  it('complaint notifications derive once from committed audit with fixed messages and independent read receipts',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',240,true,owner),input=complaintInput(),key=randomUUID();
    const created=await complaints.create(tenantId,b.id,input,key,input),id=String(created.id);
    await complaints.create(tenantId,b.id,input,key,input);
    let host=await financeNotices.list(owner,1,20);
    expect(host.meta).toMatchObject({total:1,unreadCount:1});
    expect(host.data[0]).toMatchObject({complaintId:id,bookingId:b.id,type:'CREATED',readAt:null});
    expect((await financeNotices.list(tenantId,1,100)).data.filter(r=>r.complaintId===id)).toEqual([]);
    const read=await financeNotices.markRead(owner,host.data[0].id);
    expect(read.readAt).not.toBeNull();expect(await financeNotices.markRead(owner,read.id)).toEqual(read);
    expect((await financeNotices.list(owner,1,20)).meta.unreadCount).toBe(0);
    const reply={expectedVersion:1,message:'Synthetic private Host note must not appear in notification'};
    await complaints.act(owner,id,'RESPOND',reply,randomUUID(),reply);
    const assignment={expectedVersion:2,assigneeId:adminId,reason:'Synthetic private assignment'};
    await complaints.act(adminId,id,'ASSIGN',assignment,randomUUID(),assignment);
    const resolution=complaintResolution(3);await complaints.resolve(adminId,id,resolution,randomUUID(),resolution);
    host=await financeNotices.list(owner,1,20);
    expect(host.meta).toMatchObject({total:2,unreadCount:1});
    const guest=(await financeNotices.list(tenantId,1,100)).data.filter(r=>r.complaintId===id);
    expect(guest.map(r=>r.type)).toEqual(['RESOLVED','RESPONDED']);
    expect(JSON.stringify(guest)).not.toContain(reply.message);expect(JSON.stringify(host)).not.toContain(resolution.evidenceNote);
    expect(host.data[0]).not.toHaveProperty('recipientId');expect(guest[0]).not.toHaveProperty('accountNumber');
    await financeNotices.markRead(owner,host.data[0].id);
    expect((await financeNotices.list(tenantId,1,100)).data.find(r=>r.id===host.data[0].id)!.readAt).toBeNull();
  });
  it('complaint notification DB and service reject another recipient and protect read timestamps',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',240,true,owner),input=complaintInput();
    await complaints.create(tenantId,b.id,input,randomUUID(),input);
    const notice=(await financeNotices.list(owner,1,20)).data[0];
    for(const actor of [otherHostId,tenantId]) await expect(financeNotices.markRead(actor,notice.id)).rejects.toMatchObject({status:404});
    await expect(financeNotices.markRead(owner,randomUUID())).rejects.toMatchObject({status:404});
    await expect(db.query('INSERT INTO finance_complaint_notification_reads(event_id,recipient_id) VALUES($1,$2)',[notice.id,otherHostId])).rejects.toThrow('another recipient');
    const rows=await Promise.all([financeNotices.markRead(owner,notice.id),financeNotices.markRead(owner,notice.id)]);
    expect(rows[0]).toEqual(rows[1]);
    expect((await db.query('SELECT count(*)::int AS n FROM finance_complaint_notification_reads WHERE event_id=$1',[notice.id])).rows[0].n).toBe(1);
    await expect(db.query('UPDATE finance_complaint_notification_reads SET read_at=now() WHERE event_id=$1',[notice.id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM finance_complaint_notification_reads WHERE event_id=$1',[notice.id])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE finance_complaint_notification_reads')).rejects.toThrow('append-only');
  });
  it('rolled-back complaint audit produces no notice or success replay',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',240,true,owner),input=complaintInput(),key=randomUUID();
    const spy=vi.spyOn(complaints as unknown as {event:()=>Promise<void>},'event').mockRejectedValueOnce(new Error('Synthetic notification audit failure'));
    try {await expect(complaints.create(tenantId,b.id,input,key,input)).rejects.toThrow('Synthetic notification audit failure');}
    finally {spy.mockRestore();}
    expect((await financeNotices.list(owner,1,20)).meta).toMatchObject({total:0,unreadCount:0});
    expect(await prisma.bookingIdempotency.count({where:{userId:tenantId,operation:'COMPLAINT_CREATE',key}})).toBe(0);
    await complaints.create(tenantId,b.id,input,key,input);
    expect((await financeNotices.list(owner,1,20)).meta).toMatchObject({total:1,unreadCount:1});
  });
  const refundDecision=(decision:'FULL_REFUND'|'PARTIAL_REFUND',version=1)=>({expectedVersion:1,expectedBookingVersion:version,decision,
    reason:'Synthetic Admin refund decision',evidenceNote:'Synthetic evidence; no real bank transfer',
    allocation:{baseAmount:decision==='FULL_REFUND'?'1000':'500',cleaningFee:decision==='FULL_REFUND'?'100':'0',serviceFee:'0',taxAmount:'0'}});
  async function refundComplaint(b:Awaited<ReturnType<typeof paidBooking>>) {
    const input=complaintInput(b.version),created=await complaints.create(tenantId,b.id,input,randomUUID(),input);return String(created.id);
  }
  it('complaint FULL_REFUND atomically cancels future stay, reverses Host entitlement and creates PENDING obligation, replay returns exact response',async()=>{
    const b=await paidBooking(),id=await refundComplaint(b),dto=refundDecision('FULL_REFUND'),key=randomUUID();
    releasedComplaintInventory.mockClear();
    const result=await complaints.resolve(adminId,id,dto,key,dto);
    expect(result).toMatchObject({status:'RESOLVED',resolution:{decision:'FULL_REFUND',refundObligation:{amount:'1100',status:'PENDING'},holdUntil:null}});
    expect(await complaints.resolve(adminId,id,dto,key,dto)).toEqual(result);
    expect(releasedComplaintInventory).toHaveBeenCalledTimes(1);
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});
    expect(current).toMatchObject({bookingStatus:'CANCELLED',paymentStatus:'PAID',version:2});expect(current.nightlyPrices).toEqual(b.nightlyPrices);
    const rows=await db.query("SELECT coalesce(sum(CASE WHEN e.side='CREDIT' THEN e.amount ELSE -e.amount END),0)::text AS balance FROM finance_entries e JOIN finance_journals j ON j.id=e.journal_id WHERE j.booking_id=$1 AND e.account='HOST_PAYABLE'",[b.id]);
    expect(rows.rows[0].balance).toBe('0');
    expect(await prisma.financeRefund.count({where:{complaintId:id}})).toBe(1);
    expect(await prisma.financeRefundConfirmation.count({where:{refund:{complaintId:id}}})).toBe(0);
    // DB exclusion is released at approval, not after bank evidence. Historical price snapshots remain unchanged.
    const {id:_id,createdAt:_created,updatedAt:_updated,...copy}=b;
    await expect(prisma.booking.create({data:{...copy,bookingCode:`REBOOK-${randomUUID().slice(0,20)}`}})).resolves.toMatchObject({bookingStatus:'CONFIRMED'});
    const detail=await complaints.read(id,hostId);expect(detail.resolution).not.toHaveProperty('evidenceNote');
  });
  it('complaint FULL_REFUND confirmation is separate, evidence-backed and idempotent; only then REFUNDED',async()=>{
    const b=await paidBooking(),id=await refundComplaint(b),dto=refundDecision('FULL_REFUND');
    await complaints.resolve(adminId,id,dto,randomUUID(),dto);
    const r=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:id}}),proof=evidence(),key=randomUUID();
    expect((await complaints.read(id,null)).bookingSnapshot).toMatchObject({version:2,refundedAmount:'0',pendingRefundAmount:'1100',reviewRequired:false,
      approvedRefundAmounts:{baseAmount:'1000',cleaningFee:'100',serviceFee:'0',taxAmount:'0'},remainingRefundableAmounts:{baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}});
    expect(await refunds.read(r.id)).toMatchObject({bookingId:b.id,cancelledBy:'ADMIN',status:'PENDING',amount:'1100'});
    const first=await refunds.confirm(adminId,r.id,proof,key,proof);expect(await refunds.confirm(adminId,r.id,proof,key,proof)).toEqual(first);
    expect(await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).toMatchObject({bookingStatus:'CANCELLED',paymentStatus:'REFUNDED',version:3});
    expect((await complaints.read(id,hostId)).resolution).toMatchObject({refundObligation:{status:'PAID'}});
    expect((await complaints.read(id,null)).bookingSnapshot).toMatchObject({version:3,refundedAmount:'1100',pendingRefundAmount:'0',reviewRequired:false,
      remainingRefundableAmounts:{baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}});
  });
  it.each([240,-100])('complaint PARTIAL_REFUND at checkout window %i hours preserves status and snapshots later hold clock',async hours=>{
    const b=await paidBooking('FLEXIBLE',hours),id=await refundComplaint(b),dto=refundDecision('PARTIAL_REFUND');
    const result=await complaints.resolve(adminId,id,dto,randomUUID(),dto);
    const a=(await db.query('SELECT a.*,r.created_at AS resolved_at FROM finance_complaint_refunds a JOIN finance_complaint_resolutions r USING(complaint_id) WHERE a.complaint_id=$1',[id])).rows[0];
    expect(a.hold_start.getTime()).toBe(Math.max(a.checkout_at.getTime(),a.resolved_at.getTime()));
    expect((result.resolution as {holdUntil:string}).holdUntil).toBe(new Date(a.hold_start.getTime()+72*3600000).toISOString());
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});expect(current).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',version:2,completedAt:null});
    expect((await complaints.read(id,null)).bookingSnapshot).toMatchObject({refundedAmount:'0',pendingRefundAmount:'500',reviewRequired:false,
      approvedRefundAmounts:{baseAmount:'500',cleaningFee:'0',serviceFee:'0',taxAmount:'0'},remainingRefundableAmounts:{baseAmount:'500',cleaningFee:'100',serviceFee:'0',taxAmount:'0'}});
    expect(current.nightlyPrices).toEqual(b.nightlyPrices);
    expect((await db.query('SELECT finance_payout_hold_start($1) AS hold_start',[b.id])).rows[0].hold_start).toEqual(a.hold_start);
    expect((await db.query('SELECT finance_complaint_journal_verified($1) AS verified',[a.reversal_journal_id])).rows[0].verified).toBe(true);
    expect(await hostFinance.summary(hostId)).toMatchObject({balances:{pendingHold:expect.any(String)}});
    const r=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:id}}),proof=evidence();await refunds.confirm(adminId,r.id,proof,randomUUID(),proof);
    expect(await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',completedAt:null});
  });
  it('complaint partial hold is recognized as pending, never as review/withdrawable, and does not inflate monthly earnings after cash return',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',-100,true,owner),id=await refundComplaint(b),dto=refundDecision('PARTIAL_REFUND');
    await complaints.resolve(adminId,id,dto,randomUUID(),dto);
    expect(await hostFinance.summary(owner)).toMatchObject({reviewCount:0,balances:{waitingCompletion:'0',pendingHold:'540',eligibleBeforeDeductions:'0'}});
    const year=new Date(Date.now()+7*3600000).getUTCFullYear();let revenue=await hostFinance.revenue(owner,year);
    expect(revenue.months.every(m=>m.isComplete)).toBe(true);
    const sum=(key:'hostEarned'|'commission'|'refundRecognized')=>revenue.months.reduce((v,m)=>v+BigInt(m[key]),0n);
    expect(sum('hostEarned')).toBe(540n);expect(sum('commission')).toBe(60n);expect(sum('refundRecognized')).toBe(500n);
    const r=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:id}}),proof=evidence();await refunds.confirm(adminId,r.id,proof,randomUUID(),proof);
    revenue=await hostFinance.revenue(owner,year);expect(sum('hostEarned')).toBe(540n);expect(sum('refundRecognized')).toBe(500n);
    const create={hostId:owner,reason:'Synthetic only'};const bank=await banks.submit(owner,bankInput(0),randomUUID(),bankInput(0)),verify=bankReview(1);
    await banks.review(adminId,(bank.account as {id:string}).id,'VERIFY',verify,randomUUID(),verify);
    await expect(payoutDrafts.create(adminId,create,randomUUID(),create)).rejects.toMatchObject({response:{errorCode:'PAYOUT_NO_ELIGIBLE_ITEMS'}});
  });
  it('complaint FULL_REFUND after checkout preserves historical stay state and snapshot even after confirmed bank return',async()=>{
    const b=await paidBooking('FLEXIBLE',-100);const completed=await prisma.booking.update({where:{id:b.id},data:{bookingStatus:'COMPLETED'}});
    const id=await refundComplaint(completed),dto=refundDecision('FULL_REFUND',completed.version);await complaints.resolve(adminId,id,dto,randomUUID(),dto);
    const r=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:id}}),proof=evidence();await refunds.confirm(adminId,r.id,proof,randomUUID(),proof);
    const after=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});expect(after).toMatchObject({bookingStatus:'COMPLETED',paymentStatus:'REFUNDED'});
    expect(after.completedAt).toEqual(completed.completedAt);expect(after.nightlyPrices).toEqual(b.nightlyPrices);expect(after.checkOutDate).toEqual(b.checkOutDate);
  });
  it.each([false,true])('successive partial refund with first cash confirmation=%s keeps cumulative cap, proof, latest hold and exact replay',async confirmed=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',-100,true,owner),firstId=await refundComplaint(b),first=refundDecision('PARTIAL_REFUND');
    await complaints.resolve(adminId,firstId,first,randomUUID(),first);
    const r1=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:firstId}});
    if(confirmed){const proof=evidence();await refunds.confirm(adminId,r1.id,proof,randomUUID(),proof);}
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}}),secondId=await refundComplaint(current);
    const second={...refundDecision('PARTIAL_REFUND',current.version),allocation:{baseAmount:'200',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}},key=randomUUID();
    const result=await complaints.resolve(adminId,secondId,second,key,second);
    expect(await complaints.resolve(adminId,secondId,second,key,second)).toEqual(result);
    expect((await complaints.read(secondId,null)).bookingSnapshot).toMatchObject({version:3,reviewRequired:false,
      approvedRefundAmounts:{baseAmount:'700',cleaningFee:'0',serviceFee:'0',taxAmount:'0'},
      remainingRefundableAmounts:{baseAmount:'300',cleaningFee:'100',serviceFee:'0',taxAmount:'0'},
      refundedAmount:confirmed?'500':'0',pendingRefundAmount:confirmed?'200':'700'});
    expect(await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',completedAt:null,nightlyPrices:b.nightlyPrices});
    const [hold]=(await db.query('SELECT finance_payout_hold_start($1) AS actual,(SELECT max(hold_start) FROM finance_complaint_refunds WHERE booking_id=$1) AS expected',[b.id])).rows;
    expect(hold.actual).toEqual(hold.expected);
    expect(await hostFinance.summary(owner)).toMatchObject({reviewCount:0,balances:{pendingHold:'360'}});
    if(!confirmed){const proof=evidence();await refunds.confirm(adminId,r1.id,proof,randomUUID(),proof);}
    const r2=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:secondId}}),proof=evidence();
    await refunds.confirm(adminId,r2.id,proof,randomUUID(),proof);
    expect((await complaints.read(secondId,null)).bookingSnapshot).toMatchObject({refundedAmount:'700',pendingRefundAmount:'0',reviewRequired:false});
  });
  it('second partial rejects cumulative over-cap before or after transfer, leaving complaint OPEN and original journals unchanged',async()=>{
    const b=await paidBooking(),id=await refundComplaint(b),first=refundDecision('PARTIAL_REFUND');await complaints.resolve(adminId,id,first,randomUUID(),first);
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}}),secondId=await refundComplaint(current);
    const bad={...refundDecision('PARTIAL_REFUND',current.version),allocation:{baseAmount:'501',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}};
    await expect(complaints.resolve(adminId,secondId,bad,randomUUID(),bad)).rejects.toMatchObject({status:400});
    const r=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:id}}),proof=evidence();await refunds.confirm(adminId,r.id,proof,randomUUID(),proof);
    await expect(complaints.resolve(adminId,secondId,bad,randomUUID(),bad)).rejects.toMatchObject({status:400});
    expect((await complaints.read(secondId,null)).status).toBe('OPEN');expect(await prisma.financeRefund.count({where:{complaintId:secondId}})).toBe(0);
    expect(await prisma.financeJournal.count({where:{eventKey:`complaint-refund:${secondId}`}})).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).version).toBe(current.version);
  });
  it('DB independently rejects a cumulative over-cap allocation if application calculator is bypassed',async()=>{
    const b=await paidBooking(),firstId=await refundComplaint(b),first=refundDecision('PARTIAL_REFUND');await complaints.resolve(adminId,firstId,first,randomUUID(),first);
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}}),secondId=await refundComplaint(current);
    const bad={...refundDecision('PARTIAL_REFUND',current.version),allocation:{baseAmount:'501',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}},key=randomUUID();
    const actual=refundCalculator.calculateAdminRefund;
    const bypass=vi.spyOn(refundCalculator,'calculateAdminRefund').mockImplementationOnce((s,a,d)=>actual(s,a,d));
    try {await expect(complaints.resolve(adminId,secondId,bad,key,bad)).rejects.toMatchObject({status:503});}
    finally {bypass.mockRestore();}
    expect(await prisma.financeRefund.count({where:{complaintId:secondId}})).toBe(0);
    expect(await prisma.financeJournal.count({where:{eventKey:`complaint-refund:${secondId}`}})).toBe(0);
    expect((await complaints.read(secondId,null)).status).toBe('OPEN');
    expect((await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).version).toBe(current.version);
    expect(await prisma.bookingIdempotency.count({where:{userId:adminId,operation:'ADMIN_COMPLAINT_RESOLVE',key}})).toBe(0);
  });
  it('two Admins resolving the next partial cannot reserve the remaining cap twice',async()=>{
    const b=await paidBooking(),firstId=await refundComplaint(b),first=refundDecision('PARTIAL_REFUND');await complaints.resolve(adminId,firstId,first,randomUUID(),first);
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}}),secondId=await refundComplaint(current);
    const dto={...refundDecision('PARTIAL_REFUND',current.version),allocation:{baseAmount:'400',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}};
    const results=await Promise.allSettled([complaints.resolve(adminId,secondId,dto,randomUUID(),dto),complaints.resolve(adminId,secondId,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await complaints.read(secondId,null)).bookingSnapshot).toMatchObject({pendingRefundAmount:'900',approvedRefundAmounts:{baseAmount:'900'}});
    expect(await prisma.financeRefund.count({where:{complaintId:secondId}})).toBe(1);
  });
  it.each([[240,false],[240,true],[-100,false],[-100,true]] as const)('full remaining after partial at %i hours, previous confirmed=%s never returns the same allocation twice',async(hours,confirmed)=>{
    const b=await paidBooking('FLEXIBLE',hours),firstId=await refundComplaint(b),first=refundDecision('PARTIAL_REFUND');
    await complaints.resolve(adminId,firstId,first,randomUUID(),first);
    const r1=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:firstId}});
    if(confirmed){const proof=evidence();await refunds.confirm(adminId,r1.id,proof,randomUUID(),proof);}
    const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}}),finalId=await refundComplaint(current);
    const full={...refundDecision('FULL_REFUND',current.version),allocation:{baseAmount:'500',cleaningFee:'100',serviceFee:'0',taxAmount:'0'}},key=randomUUID();
    await expect(complaints.resolve(adminId,finalId,refundDecision('FULL_REFUND',current.version),randomUUID(),{})).rejects.toMatchObject({status:400});
    const result=await complaints.resolve(adminId,finalId,full,key,full);expect(await complaints.resolve(adminId,finalId,full,key,full)).toEqual(result);
    expect((await complaints.read(finalId,null)).bookingSnapshot).toMatchObject({reviewRequired:false,pendingRefundAmount:confirmed?'600':'1100',refundedAmount:confirmed?'500':'0',
      remainingRefundableAmounts:{baseAmount:'0',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}});
    const r2=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:finalId}}),proof=evidence();await refunds.confirm(adminId,r2.id,proof,randomUUID(),proof);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).paymentStatus).toBe(confirmed?'REFUNDED':'PAID');
    if(!confirmed){const proof=evidence();await refunds.confirm(adminId,r1.id,proof,randomUUID(),proof);}
    const after=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});
    expect(after).toMatchObject({paymentStatus:'REFUNDED',bookingStatus:hours>0?'CANCELLED':'CONFIRMED',completedAt:null});
    expect(after.nightlyPrices).toEqual(b.nightlyPrices);
    expect((await complaints.read(finalId,null)).bookingSnapshot).toMatchObject({refundedAmount:'1100',pendingRefundAmount:'0',reviewRequired:false});
  });
  it('complaint refund rejects actors, stale booking, over-cap allocation and legacy PAID without source; no partial side effects',async()=>{
    const b=await paidBooking(),id=await refundComplaint(b),dto=refundDecision('PARTIAL_REFUND');
    for(const actor of [tenantId,hostId]) await expect(complaints.resolve(actor,id,dto,randomUUID(),dto)).rejects.toMatchObject({status:403});
    await expect(complaints.resolve(adminId,id,{...dto,expectedBookingVersion:2},randomUUID(),{})).rejects.toMatchObject({response:{errorCode:'STALE_BOOKING_VERSION'}});
    await expect(complaints.resolve(adminId,id,{...dto,allocation:{...dto.allocation,baseAmount:'1001'}},randomUUID(),{})).rejects.toMatchObject({status:400});
    expect((await complaints.read(id,null)).status).toBe('OPEN');expect(await prisma.financeRefund.count({where:{complaintId:id}})).toBe(0);
    expect(await prisma.financeJournal.count({where:{bookingId:b.id}})).toBe(1);
    const legacy=await paidBooking('FLEXIBLE',240,false),legacyId=await refundComplaint(legacy);
    await expect(complaints.resolve(adminId,legacyId,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
  });
  it('complaint refund concurrent Admin decisions apply once; late version cannot duplicate obligation',async()=>{
    const b=await paidBooking(),id=await refundComplaint(b),dto=refundDecision('FULL_REFUND');
    const results=await Promise.allSettled([complaints.resolve(adminId,id,dto,randomUUID(),dto),complaints.resolve(adminId,id,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await prisma.financeRefund.count({where:{complaintId:id}})).toBe(1);
    expect(await prisma.financeJournal.count({where:{eventKey:`complaint-refund:${id}`}})).toBe(1);
  });
  it('complaint refund rolls back reversal, booking, obligation and replay success when complaint closure fails',async()=>{
    const b=await paidBooking(),id=await refundComplaint(b),dto=refundDecision('FULL_REFUND'),key=randomUUID();
    await db.query("CREATE FUNCTION complaint_refund_fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='RESOLVED' THEN RAISE EXCEPTION 'Synthetic close failure'; END IF;RETURN NEW; END; $$");
    await db.query('CREATE TRIGGER complaint_refund_fixture_fail BEFORE UPDATE ON finance_complaints FOR EACH ROW EXECUTE FUNCTION complaint_refund_fixture_fail()');
    try {
      await expect(complaints.resolve(adminId,id,dto,key,dto)).rejects.toMatchObject({status:503});
      expect(await prisma.financeRefund.count({where:{complaintId:id}})).toBe(0);expect(await prisma.financeJournal.count({where:{bookingId:b.id}})).toBe(1);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:b.id}})).toMatchObject({bookingStatus:'CONFIRMED',version:1});
      expect(await prisma.bookingIdempotency.count({where:{userId:adminId,operation:'ADMIN_COMPLAINT_RESOLVE',key}})).toBe(0);
    }finally{await db.query('DROP TRIGGER complaint_refund_fixture_fail ON finance_complaints');await db.query('DROP FUNCTION complaint_refund_fixture_fail()');}
    await expect(complaints.resolve(adminId,id,dto,key,dto)).resolves.toMatchObject({status:'RESOLVED'});
  });
  it('complaint refund DB protects source/allocation/hold from mutation and requires manual proof before PAID',async()=>{
    const b=await paidBooking(),id=await refundComplaint(b),dto=refundDecision('PARTIAL_REFUND');await complaints.resolve(adminId,id,dto,randomUUID(),dto);
    const r=await prisma.financeRefund.findUniqueOrThrow({where:{complaintId:id}});
    await expect(db.query("UPDATE finance_complaint_refunds SET hold_start=hold_start-interval '72 hours' WHERE complaint_id=$1",[id])).rejects.toThrow('append-only');
    await expect(db.query('UPDATE finance_refunds SET complaint_id=NULL WHERE id=$1',[r.id])).rejects.toThrow('immutable');
    await expect(db.query("UPDATE finance_refunds SET status='PAID',version=version+1 WHERE id=$1",[r.id])).rejects.toThrow('matching immutable confirmation');
    await expect(db.query('DELETE FROM finance_complaint_refunds WHERE complaint_id=$1',[id])).rejects.toThrow('append-only');
  });
  it('Admin HOST resolution releases only complaint freeze, not hold/bank gates or booking/payment state',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',240,true,owner),other=await paidBooking('FLEXIBLE',240,true,owner);
    const completed=await prisma.booking.update({where:{id:b.id},data:{bookingStatus:'COMPLETED'}});
    const input=complaintInput(),created=await complaints.create(tenantId,b.id,input,randomUUID(),input),id=String(created.id);
    await complaints.create(tenantId,other.id,input,randomUUID(),input);
    expect((await hostFinance.summary(owner)).balances.frozen).toBe('1980');
    const before=await prisma.booking.findUniqueOrThrow({where:{id:b.id}}),journalCount=await prisma.financeJournal.count({where:{bookingId:b.id}}),refundCount=await prisma.financeRefund.count();
    const dto=complaintResolution(),key=randomUUID(),resolved=await complaints.resolve(adminId,id,dto,key,dto);
    expect(resolved).toMatchObject({id,bookingId:b.id,status:'RESOLVED',version:2,overdue:false,resolution:{decision:'HOST',reason:dto.reason,resolvedAt:expect.any(String)}});
    expect(await complaints.resolve(adminId,id,dto,key,dto)).toEqual(resolved);
    const after=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});
    expect(after).toEqual(before);expect(after.completedAt).toEqual(completed.completedAt);
    expect(await prisma.financeJournal.count({where:{bookingId:b.id}})).toBe(journalCount);
    expect(await prisma.financeRefund.count()).toBe(refundCount);
    const summary=await hostFinance.summary(owner);
    expect(summary).toMatchObject({bankVerified:false,payoutOperationsReady:false,balances:{pendingHold:'990',frozen:'990',eligibleBeforeDeductions:'0'}});
    const own=await complaints.read(id,owner),guest=(await complaints.bookingComplaints(tenantId,b.id))[0],adminDetail=await complaints.read(id,null);
    for(const detail of [own,guest]) {expect(detail.resolution).not.toHaveProperty('evidenceNote');expect(detail.resolution).not.toHaveProperty('actorId');expect(JSON.stringify(detail)).not.toContain(dto.evidenceNote);}
    expect(adminDetail.resolution).toMatchObject({actorId:adminId,evidenceNote:dto.evidenceNote});
    expect(own.events.map(e=>e.action)).toEqual(['CREATED','RESOLVED']);
    await expect(complaints.resolve(adminId,id,{...dto,reason:'Different'},key,{...dto,reason:'Different'})).rejects.toMatchObject({response:{errorCode:'IDEMPOTENCY_CONFLICT'}});
    await expect(complaints.resolve(adminId,id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'STALE_COMPLAINT_VERSION'}});
    await expect(complaints.resolve(adminId,id,complaintResolution(2),randomUUID(),complaintResolution(2))).rejects.toMatchObject({response:{errorCode:'COMPLAINT_CLOSED'}});
    const reply={expectedVersion:2,message:'Cannot reopen'};
    await expect(complaints.act(owner,id,'RESPOND',reply,randomUUID(),reply)).rejects.toMatchObject({response:{errorCode:'COMPLAINT_CLOSED'}});
  });
  it('only an active Admin can resolve; unsupported decision/missing evidence/missing record fail without audit',async()=>{
    const b=await paidBooking(),input=complaintInput(),created=await complaints.create(tenantId,b.id,input,randomUUID(),input),id=String(created.id),dto=complaintResolution();
    for(const actor of [tenantId,hostId,otherHostId]) await expect(complaints.resolve(actor,id,dto,randomUUID(),dto)).rejects.toMatchObject({status:403});
    await prisma.user.update({where:{id:adminId},data:{status:'BANNED'}});
    try {await expect(complaints.resolve(adminId,id,dto,randomUUID(),dto)).rejects.toMatchObject({status:403});}
    finally {await prisma.user.update({where:{id:adminId},data:{status:'ACTIVE'}});}
    await expect(complaints.resolve(adminId,randomUUID(),dto,randomUUID(),dto)).rejects.toMatchObject({status:404});
    await expect(complaints.resolve(adminId,id,{...dto,decision:'FULL_REFUND'} as never,randomUUID(),{})).rejects.toMatchObject({response:{errorCode:'INVALID_REFUND_ALLOCATION'}});
    await expect(complaints.resolve(adminId,id,{...dto,evidenceNote:' '},randomUUID(),{})).rejects.toMatchObject({status:400});
    expect((await complaints.read(id,null))).toMatchObject({status:'OPEN',version:1,resolution:null});
    expect(await prisma.financeComplaintResolution.count({where:{complaintId:id}})).toBe(0);
  });
  it('two Admin resolutions commit once and same-key concurrent replay returns the identical response',async()=>{
    const b=await paidBooking(),input=complaintInput(),created=await complaints.create(tenantId,b.id,input,randomUUID(),input),id=String(created.id),dto=complaintResolution();
    const results=await Promise.allSettled([complaints.resolve(adminId,id,dto,randomUUID(),dto),complaints.resolve(adminId,id,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'STALE_COMPLAINT_VERSION'}}});
    expect(await prisma.financeComplaintResolution.count({where:{complaintId:id}})).toBe(1);
    expect((await complaints.read(id,null)).events).toHaveLength(2);
    const second=await paidBooking(),secondCreated=await complaints.create(tenantId,second.id,input,randomUUID(),input),secondId=String(secondCreated.id),key=randomUUID();
    const replay=await Promise.all([complaints.resolve(adminId,secondId,dto,key,dto),complaints.resolve(adminId,secondId,dto,key,dto)]);
    expect(replay[1]).toEqual(replay[0]);
    expect((await complaints.read(secondId,null)).events).toHaveLength(2);
  });
  it('concurrent Host response and Admin resolution cannot overwrite each other',async()=>{
    const b=await paidBooking(),input=complaintInput(),created=await complaints.create(tenantId,b.id,input,randomUUID(),input),id=String(created.id),dto=complaintResolution(),reply={expectedVersion:1,message:'Synthetic response'};
    const results=await Promise.allSettled([complaints.resolve(adminId,id,dto,randomUUID(),dto),complaints.act(hostId,id,'RESPOND',reply,randomUUID(),reply)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'STALE_COMPLAINT_VERSION'}}});
    const detail=await complaints.read(id,null);expect(detail.version).toBe(2);expect(detail.events).toHaveLength(2);
    if(detail.status==='OPEN') expect(detail.resolution).toBeNull();else expect(detail.resolution?.decision).toBe('HOST');
  });
  it('failure after resolution insert rolls back proof, audit, state, and idempotency success',async()=>{
    const b=await paidBooking(),input=complaintInput(),created=await complaints.create(tenantId,b.id,input,randomUUID(),input),id=String(created.id),dto=complaintResolution(),key=randomUUID();
    await db.query(`CREATE FUNCTION complaint_fixture_fail_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='RESOLVED' THEN RAISE EXCEPTION 'Synthetic close failure'; END IF; RETURN NEW; END; $$`);
    await db.query('CREATE TRIGGER complaint_fixture_fail_close BEFORE UPDATE ON finance_complaints FOR EACH ROW EXECUTE FUNCTION complaint_fixture_fail_close()');
    try {
      await expect(complaints.resolve(adminId,id,dto,key,dto)).rejects.toMatchObject({status:503});
      expect(await prisma.financeComplaintResolution.count({where:{complaintId:id}})).toBe(0);
      expect(await prisma.bookingIdempotency.count({where:{userId:adminId,operation:'ADMIN_COMPLAINT_RESOLVE',key}})).toBe(0);
      const unchanged=await complaints.read(id,null);expect(unchanged).toMatchObject({status:'OPEN',version:1,resolution:null});expect(unchanged.events).toHaveLength(1);
    } finally {await db.query('DROP TRIGGER complaint_fixture_fail_close ON finance_complaints');await db.query('DROP FUNCTION complaint_fixture_fail_close()');}
    expect(await complaints.resolve(adminId,id,dto,key,dto)).toMatchObject({status:'RESOLVED',version:2});
  });
  it('DB prevents proofless close, forged audit/actor, orphan proof, mutation, reopen and truncate',async()=>{
    const b=await paidBooking(),input=complaintInput(),created=await complaints.create(tenantId,b.id,input,randomUUID(),input),id=String(created.id),dto=complaintResolution();
    await expect(db.query("UPDATE finance_complaints SET status='RESOLVED',version=version+1 WHERE id=$1",[id])).rejects.toThrow('requires resolution proof');
    const insert="INSERT INTO finance_complaint_resolutions (complaint_id,event_id,actor_id,decision,version_before,reason,evidence_note) VALUES ($1,$2,$3,'HOST',1,'Synthetic','Synthetic')";
    const event=(await db.query("SELECT id FROM finance_complaint_events WHERE complaint_id=$1",[id])).rows[0].id;
    await expect(db.query(insert,[id,event,hostId])).rejects.toThrow('active Admin');
    await expect(db.query(insert,[id,event,adminId])).rejects.toThrow('matching transaction audit');
    await expect(prisma.$transaction(async tx=>{
      const [audit]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_complaint_events (complaint_id,actor_id,action,message) VALUES (${id}::uuid,${adminId}::uuid,'RESOLVED','Synthetic') RETURNING id`;
      await tx.$executeRaw`INSERT INTO finance_complaint_resolutions (complaint_id,event_id,actor_id,decision,version_before,reason,evidence_note) VALUES (${id}::uuid,${audit.id}::uuid,${adminId}::uuid,'HOST',1,'Synthetic','Synthetic')`;
    })).rejects.toThrow('must commit with matching closed');
    expect(await prisma.financeComplaintResolution.count({where:{complaintId:id}})).toBe(0);
    await complaints.resolve(adminId,id,dto,randomUUID(),dto);
    await expect(db.query('UPDATE finance_complaint_resolutions SET reason=\'tamper\' WHERE complaint_id=$1',[id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM finance_complaint_resolutions WHERE complaint_id=$1',[id])).rejects.toThrow('append-only');
    await expect(db.query('TRUNCATE finance_complaint_resolutions')).rejects.toThrow(/append-only|cannot truncate.*referenced/i);
    await expect(db.query("UPDATE finance_complaints SET status='OPEN',version=version+1 WHERE id=$1",[id])).rejects.toThrow('cannot be changed or reopened');
  });
  async function historicalMonthlyPayment(owner:string,timestamp:string) {
    // Insert NEW historical fixture journals in the isolated DB; never update immutable rows or disable guards.
      const b=await paidBooking('FLEXIBLE',240,false,owner);
      await prisma.$transaction(async tx=>{
        const [j]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_journals (event_key,request_hash,kind,booking_id,host_id,reason,created_at)
          VALUES (${`monthly-fixture:${randomUUID()}`},${'a'.repeat(64)},'PAYMENT',${b.id}::uuid,${owner}::uuid,'Synthetic historical monthly fixture',${new Date(timestamp)}) RETURNING id`;
        await tx.$executeRaw`INSERT INTO finance_entries (journal_id,line_number,account,side,amount) VALUES
          (${j.id}::uuid,1,'CASH_CLEARING','DEBIT',1100),(${j.id}::uuid,2,'HOST_PAYABLE','CREDIT',990),(${j.id}::uuid,3,'PLATFORM_COMMISSION','CREDIT',110)`;
      });
      return b;
  }
  it('S5 Admin GMV uses inclusive Vietnam days and reconciles gross/commission with Host ledger',async()=>{
    const owner=await bankHost(),dashboard=new AdminDashboardService(prisma);
    for(const time of ['2005-01-01T16:59:59.999Z','2005-01-01T17:00:00Z','2005-01-02T16:59:59.999Z','2005-01-02T17:00:00Z'])await historicalMonthlyPayment(owner,time);
    expect((await dashboard.read('2005-01-02','2005-01-02')).money).toMatchObject({gmv:'2200',commissionRecognized:'220',refundApproved:'0',refundTransferred:'0',gmvLessApprovedRefunds:'2200'});
    expect((await dashboard.read('2005-01-01','2005-01-03')).money.gmv).toBe('4400');
    const host=(await hostFinance.revenue(owner,2005)).months[0];
    expect(host.roomAndCleaning).toBe('4400');expect(host.commission).toBe('440');
    const report=await dashboard.read('2005-01-01','2005-01-03');
    expect(JSON.stringify(report)).not.toMatch(/guestName|guestPhone|bookingId|bankAccount|actorId|bookingCode/);
  });
  it('S5 Admin GMV leaves historical gross unchanged; approved and transferred refunds post separately',async()=>{
    const owner=await bankHost(),dashboard=new AdminDashboardService(prisma);
    const b=await historicalMonthlyPayment(owner,'2006-06-15T12:00:00Z');
    const prior=(await dashboard.read('2006-06-01','2006-06-30')).money;
    const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),before=(await dashboard.read(today,today)).money;
    const result=await (await guestCancellation(b)).run(),approved=(await dashboard.read(today,today)).money;
    expect(BigInt(approved.refundApproved)-BigInt(before.refundApproved)).toBe(1100n);
    expect(BigInt(approved.refundPendingTransfer)-BigInt(before.refundPendingTransfer)).toBe(1100n);
    expect(approved.refundTransferred).toBe(before.refundTransferred);
    const dto=evidence();await refunds.confirm(adminId,String((result.refundObligation as {id:string}).id),dto,randomUUID(),dto);
    const transferred=(await dashboard.read(today,today)).money;
    expect(transferred.refundApproved).toBe(approved.refundApproved);
    expect(BigInt(transferred.refundTransferred)-BigInt(before.refundTransferred)).toBe(1100n);
    expect(transferred.refundPendingTransfer).toBe(before.refundPendingTransfer);
    const unchanged=(await dashboard.read('2006-06-01','2006-06-30')).money;
    for(const key of ['gmv','commissionRecognized','refundApproved','refundTransferred','gmvLessApprovedRefunds'] as const)expect(unchanged[key]).toBe(prior[key]);
  });
  it('S5 Admin GMV excludes unpaid and short/over receipts awaiting reconciliation',async()=>{
    const dashboard=new AdminDashboardService(prisma),today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
    const before=(await dashboard.read(today,today)).money;
    await pendingBooking();await paidBooking('FLEXIBLE',240,false);
    for(const amount of ['109900','110100']){const f=await ipnFixture();expect((await f.apply({vnp_Amount:amount})).RspCode).not.toBe('00');}
    expect((await dashboard.read(today,today)).money).toEqual(before);
  });
  it('S5 Admin GMV excludes duplicate payment sources and counts each journal once',async()=>{
    const dashboard=new AdminDashboardService(prisma),today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),before=await dashboard.read(today,today);
    const b=await paidBooking();
    await append({eventKey:`gmv-duplicate:${randomUUID()}`,kind:'PAYMENT',bookingId:b.id,hostId,actorId:adminId,reason:'Synthetic duplicate source',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'990'},{account:'PLATFORM_COMMISSION',side:'CREDIT',amount:'110'}]});
    const result=await dashboard.read(today,today);
    expect(result.money.gmv).toBe(before.money.gmv);expect(result.reviewCount-before.reviewCount).toBe(2);expect(result.isComplete).toBe(false);
  });
  it('S5 Admin GMV current counts separate soft deleted listings and do not depend on report dates',async()=>{
    const dashboard=new AdminDashboardService(prisma),before=await dashboard.read('2000-01-01','2000-01-01');
    const b=await paidBooking('FLEXIBLE',240,false);
    const unit=await prisma.homestayUnit.findUniqueOrThrow({where:{id:b.homestayUnitId}});
    await prisma.property.update({where:{id:unit.propertyId},data:{deletedAt:new Date()}});
    const report=await dashboard.read('2000-01-01','2000-01-01');
    expect(report.deletedListings).toBe(before.deletedListings+1);expect(report.listings.PUBLISHED).toBe(before.listings.PUBLISHED);
    expect(report.users).toEqual(before.users);
  });
  it('S4 monthly revenue groups journal timestamps at Vietnam year and month boundaries, not stay dates',async()=>{
    const owner=await bankHost();
    for(const timestamp of ['2025-12-31T16:59:59.999Z','2025-12-31T17:00:00Z','2026-01-31T17:00:00Z','2026-12-31T17:00:00Z'])await historicalMonthlyPayment(owner,timestamp);
    const result=await hostFinance.revenue(owner,2026);expect(result.months).toHaveLength(12);
    for(const index of [0,1])expect(result.months[index]).toMatchObject({roomAndCleaning:'1100',commission:'110',hostEarned:'990',refundRecognized:'0',paidOut:'0',reviewCount:0,isComplete:true});
    for(const month of result.months.slice(2))expect(month).toMatchObject({roomAndCleaning:'0',hostEarned:'0',reviewCount:0});
    expect((await hostFinance.revenue(owner,2025)).months[11].hostEarned).toBe('990');
    expect((await hostFinance.revenue(owner,2027)).months[0].hostEarned).toBe('990');
    expect((await hostFinance.revenue(await bankHost(),2026)).months.every(m=>m.hostEarned==='0')).toBe(true);
  });
  it('S4 monthly revenue preserves a prior posted year and permits negative net earnings in the refund month',async()=>{
    const owner=await bankHost(),local=new Date(Date.now()+7*3600000).toISOString(),year=Number(local.slice(0,4));
    const b=await historicalMonthlyPayment(owner,`${year-1}-06-15T12:00:00Z`),prior=await hostFinance.revenue(owner,year-1);
    const cancellation=await guestCancellation(b);await cancellation.run();
    expect(await hostFinance.revenue(owner,year-1)).toEqual(prior);
    expect(prior.months[5]).toMatchObject({roomAndCleaning:'1100',commission:'110',hostEarned:'990',refundRecognized:'0'});
    expect((await hostFinance.revenue(owner,year)).months[Number(local.slice(5,7))-1]).toMatchObject({roomAndCleaning:'0',commission:'-110',hostEarned:'-990',refundRecognized:'1100',paidOut:'0',reviewCount:0,isComplete:true});
  });
  it('S4 monthly revenue reports unsupported entries and duplicate sources once per journal without inflating totals',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',240,true,owner);
    for(const kind of ['PAYMENT','ADJUSTMENT','REFUND','PAYOUT'] as const)await append({eventKey:`monthly-invalid:${randomUUID()}`,kind,bookingId:b.id,hostId:owner,actorId:adminId,
      reason:'Synthetic unsupported journal',lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'100'}]});
    const year=Number(new Date(Date.now()+7*3600000).toISOString().slice(0,4)),result=await hostFinance.revenue(owner,year);
    expect(result.months.reduce((sum,m)=>sum+m.reviewCount,0)).toBe(5);
    expect(result.months.every(m=>m.roomAndCleaning==='0' && m.hostEarned==='0' && m.paidOut==='0')).toBe(true);
    expect(result.months.some(m=>!m.isComplete)).toBe(true);
  });
  it('S4 monthly revenue recognizes refund once and later manual cash confirmation does not deduct earnings again',async()=>{
    const owner=await bankHost(),b=await paidBooking('MODERATE',48,true,owner),cancel=await guestCancellation(b),result=await cancel.run();
    const local=new Date(Date.now()+7*3600000).toISOString(),year=Number(local.slice(0,4)),index=Number(local.slice(5,7))-1;
    const expected={roomAndCleaning:'1100',commission:'55',refundRecognized:'550',hostEarned:'495',paidOut:'0',reviewCount:0,isComplete:true};
    expect((await hostFinance.revenue(owner,year)).months[index]).toMatchObject(expected);
    const dto=evidence();await refunds.confirm(adminId,String((result.refundObligation as {id:string}).id),dto,randomUUID(),dto);
    expect((await hostFinance.revenue(owner,year)).months[index]).toMatchObject(expected);
  });
  it('S4 monthly revenue keeps proven payout separate from earned revenue',async()=>{
    const {fixture,draft}=await historicalPayoutDraft(),approve={expectedVersion:1,reason:'Synthetic monthly payout approval'};
    await payoutDrafts.approve(adminId,draft.id,approve,randomUUID(),approve);
    await prisma.$transaction(tx=>recordManualPayout(tx,adminId,draft.id,{expectedVersion:2,bankReference:`MONTHLY:${randomUUID()}`,evidenceNote:'Synthetic only, no transfer',reason:'Synthetic monthly paid proof'}));
    const local=new Date(Date.now()+7*3600000).toISOString(),report=await hostFinance.revenue(fixture.owner,Number(local.slice(0,4)));
    expect(report.months[Number(local.slice(5,7))-1]).toMatchObject({roomAndCleaning:'1100',commission:'110',refundRecognized:'0',hostEarned:'990',paidOut:'990',reviewCount:0,isComplete:true});
  });
  it('S4 monthly revenue HTTP enforces roles ownership required year no-store envelope and Swagger',async()=>{
    const owner=await bankHost();await paidBooking('FLEXIBLE',240,true,owner);
    const secret='monthly-http-fixture-access-secret-32chars';vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('JWT_ACCESS_SECRET',secret);vi.stubEnv('REDIS_KEY_PREFIX',`monthly-http:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(secret));
      const year=Number(new Date(Date.now()+7*3600000).toISOString().slice(0,4)),base=await app.getUrl();
      const http=async(query:string,auth?:string)=>{const res=await fetch(`${base}/api/v1/host/finance/revenue${query}`,{headers:auth?{authorization:`Bearer ${auth}`}:{}});return {status:res.status,cache:res.headers.get('cache-control'),body:await res.json()};};
      expect((await http(`?year=${year}`)).status).toBe(401);
      for(const [id,role] of [[tenantId,'TENANT'],[adminId,'ADMIN'],[tenantId,'HOST']])expect((await http(`?year=${year}`,await token(id,role))).status).toBe(403);
      const bearer=await token(owner,'HOST'),result=await http(`?year=${year}`,bearer);
      expect(result).toMatchObject({status:200,cache:'no-store',body:{success:true,data:{year,basis:'LEDGER_POSTED',currency:'VND'}}});
      expect(result.body.data.months).toHaveLength(12);expect(result.body.data.months.reduce((sum:number,m:{hostEarned:string})=>sum+Number(m.hostEarned),0)).toBe(990);
      expect((await http(`?year=${year}`,await token(otherHostId,'HOST'))).body.data.months.every((m:{hostEarned:string})=>m.hostEarned==='0')).toBe(true);
      for(const query of ['', '?year=', '?year=1999','?year=2101','?year=2026.5','?year=2026&year=2027','?year=2026&hostId='+owner])expect((await http(query,bearer)).status).toBe(400);
      const doc=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      expect(doc.paths['/api/v1/host/finance/revenue'].get!.parameters).toEqual(expect.arrayContaining([expect.objectContaining({name:'year',required:true,in:'query'})]));
      expect(doc.components!.schemas!.HostRevenueDto.required).toEqual(expect.arrayContaining(['year','timeZone','basis','currency','months']));
      expect(doc.components!.schemas!.HostRevenueMonthDto.required).toEqual(expect.arrayContaining(Object.keys(result.body.data.months[0])));
      expect(JSON.stringify(result.body.data)).not.toMatch(/guestName|guestPhone|bankAccount|actorId|bookingId/);
    } finally {await app.close();}
  });
  it('Host finance subtracts cancellation reversal once and actual refund does not deduct commission twice',async()=>{
    const owner=await bankHost(),booking=await paidBooking('MODERATE',48,true,owner),cancel=await guestCancellation(booking);
    const result=await cancel.run();expect((await hostFinance.summary(owner)).balances.pendingHold).toBe('495');
    const id=String((result.refundObligation as {id:string}).id),dto=evidence();
    await refunds.confirm(adminId,id,dto,randomUUID(),dto);
    const summary=await hostFinance.summary(owner);
    expect(summary.reviewCount).toBe(0);expect(summary.balances.pendingHold).toBe('495');
    expect(summary.balances.waitingCompletion).toBe('0');
    expect((await hostFinance.transactions(owner,1,20)).meta.total).toBe(3);
  });
  it('Host finance sends unsupported adjustments or mismatched money to review instead of inflating balances',async()=>{
    const owner=await bankHost(),booking=await paidBooking('FLEXIBLE',240,true,owner);
    await append({eventKey:`unsupported:${randomUUID()}`,kind:'ADJUSTMENT',bookingId:booking.id,hostId:owner,actorId:adminId,reason:'Synthetic unsupported adjustment',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'100'}]});
    expect(await hostFinance.summary(owner)).toMatchObject({reviewCount:1,balances:{waitingCompletion:'0',pendingHold:'0',eligibleBeforeDeductions:'0',frozen:'0'}});
  });
  it('Host transaction history keeps exact large VND strings, pagination and ownership without audit PII',async()=>{
    const owner=await bankHost(),other=await bankHost(),amount='9007199254740993';
    await append({eventKey:`large:${randomUUID()}`,kind:'ADJUSTMENT',bookingId:null,hostId:owner,actorId:adminId,reason:'Synthetic private evidence must not reach Host history',
      lines:[{account:'CASH_CLEARING',side:'DEBIT',amount},{account:'HOST_PAYABLE',side:'CREDIT',amount}]});
    const history=await hostFinance.transactions(owner,1,1);
    expect(history.meta).toMatchObject({total:1,totalPages:1});
    expect(history.data[0].entries.map(e=>e.amount)).toEqual([amount,amount]);
    expect(JSON.stringify(history)).not.toMatch(/actorId|reason|private evidence/);
    expect((await hostFinance.transactions(other,1,20)).meta.total).toBe(0);
  });
  it('S4 Admin HOST complaint resolution HTTP validates contract, privacy, version and replay',async()=>{
    // Financial proof survives for the lifetime of this dedicated DB; no per-case deletion/reset of audit.
    const accessSecret='finance-http-fixture-access-secret-32chars',prefix=`finance-http:${randomUUID()}:`;
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('JWT_ACCESS_SECRET',accessSecret);vi.stubEnv('REDIS_KEY_PREFIX',prefix);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const base=await app.getUrl(),owner=await bankHost(),booking=await paidBooking('FLEXIBLE',240,false,owner);
      const token=(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(accessSecret));
      const tenant={token:await token(tenantId,'TENANT')},host={token:await token(owner,'HOST')},otherHost={token:await token(otherHostId,'HOST')},reviewer={token:await token(adminId,'ADMIN')};
      const http=async(path:string,method='GET',body?:unknown,token?:string,key?:string)=>{
        const response=await fetch(`${base}/api/v1${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{ }),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
        return {status:response.status,body:await response.json()};
      };
      const input={expectedVersion:1,reason:'Synthetic complaint'},created=await http(`/bookings/${booking.id}/complaints`,'POST',input,tenant.token,randomUUID());
      expect(created.status).toBe(201);
      const id=created.body.data.id,path=`/admin/finance/complaints/${id}/resolve`,body={expectedVersion:1,decision:'HOST',reason:'Synthetic resolution',evidenceNote:'Private synthetic evidence'};
      for(const actor of [tenant,host,otherHost])expect((await http(`/admin/finance/complaints/${id}`,'GET',undefined,actor.token)).status).toBe(403);
      const snapshot=(await http(`/admin/finance/complaints/${id}`,'GET',undefined,reviewer.token)).body.data.bookingSnapshot;
      expect(snapshot).toMatchObject({version:1,bookingStatus:'CONFIRMED',paymentStatus:'PAID',refundedAmount:'0',pendingRefundAmount:'0',
        amounts:{baseAmount:'1000',cleaningFee:'100',serviceFee:'0',taxAmount:'0',totalAmount:'1100'},remainingRefundableAmounts:null,reviewRequired:true});
      const bookingAfterVersionUpdate=await prisma.booking.update({where:{id:booking.id},data:{version:{increment:1}}});
      const staleRefund={...body,decision:'PARTIAL_REFUND',expectedBookingVersion:snapshot.version,allocation:{baseAmount:'500',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}};
      const staleResult=await http(path,'POST',staleRefund,reviewer.token,randomUUID());
      expect(staleResult.status).toBe(409);expect(staleResult.body.errorCode).toBe('STALE_BOOKING_VERSION');
      expect((await http(`/admin/finance/complaints/${id}`,'GET',undefined,reviewer.token)).body.data.bookingSnapshot.version).toBe(2);
      for(const actor of [tenant,host]) expect((await http(path,'POST',body,actor.token,randomUUID())).status).toBe(403);
      expect((await http(path,'POST',body,reviewer.token)).status).toBe(400);
      for(const invalid of [{...body,decision:'PARTIAL_REFUND'},{...body,amount:100},{...body,evidenceNote:' '},{...body,reason:'x'.repeat(501)},{...body,expectedVersion:0}]) expect((await http(path,'POST',invalid,reviewer.token,randomUUID())).status).toBe(400);
      expect((await http(`/admin/finance/complaints/${randomUUID()}/resolve`,'POST',body,reviewer.token,randomUUID())).status).toBe(404);
      const key=randomUUID(),resolved=await http(path,'POST',body,reviewer.token,key);
      expect(resolved.status).toBe(200);expect(resolved.body.data).toMatchObject({id,status:'RESOLVED',version:2,overdue:false,resolution:{decision:'HOST',reason:body.reason}});
      expect(await http(path,'POST',body,reviewer.token,key)).toEqual(resolved);
      expect((await http(path,'POST',{...body,reason:'Changed'},reviewer.token,key)).body.errorCode).toBe('IDEMPOTENCY_CONFLICT');
      expect((await http(path,'POST',body,reviewer.token,randomUUID())).body.errorCode).toBe('STALE_COMPLAINT_VERSION');
      expect((await http(path,'POST',{...body,expectedVersion:2},reviewer.token,randomUUID())).body.errorCode).toBe('COMPLAINT_CLOSED');
      const own=await http(`/host/finance/complaints/${id}`,'GET',undefined,host.token),guest=await http(`/bookings/${booking.id}/complaints`,'GET',undefined,tenant.token),adminDetail=await http(`/admin/finance/complaints/${id}`,'GET',undefined,reviewer.token);
      expect(own.body.data.resolution).not.toHaveProperty('actorId');expect(guest.body.data[0].resolution).not.toHaveProperty('evidenceNote');
      expect(own.body.data).not.toHaveProperty('bookingSnapshot');expect(guest.body.data[0]).not.toHaveProperty('bookingSnapshot');
      expect(JSON.stringify(own.body)).not.toContain(body.evidenceNote);expect(JSON.stringify(guest.body)).not.toContain(body.evidenceNote);
      expect(adminDetail.body.data.resolution).toMatchObject({actorId:adminId,evidenceNote:body.evidenceNote});
      expect((await http(`/host/finance/complaints/${id}`,'GET',undefined,otherHost.token)).status).toBe(404);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(bookingAfterVersionUpdate);
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
      const raw=await fetch(`${base}/api/v1/admin/finance/complaints/${id}`,{headers:{authorization:`Bearer ${reviewer.token}`}});expect(raw.headers.get('cache-control')).toBe('no-store');
      const document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      const draftBody={hostId:owner,reason:'Synthetic API draft; no transfer'};
      expect((await http('/admin/finance/payouts','POST',draftBody,host.token,randomUUID())).status).toBe(403);
      expect((await http('/admin/finance/payouts','POST',draftBody,reviewer.token)).status).toBe(400);
      expect((await http('/admin/finance/payouts','POST',{...draftBody,amount:'1'},reviewer.token,randomUUID())).status).toBe(400);
      const noEligible=await http('/admin/finance/payouts','POST',draftBody,reviewer.token,randomUUID());
      expect(noEligible.status).toBe(409);expect(noEligible.body.errorCode).toBe('PAYOUT_NO_ELIGIBLE_ITEMS');
      const bankFixture=await payoutBank();
      const cancelledDraft=await prisma.$transaction(async tx=>{const draft=await insertDraft(tx,bankFixture);await draftAudit(tx,draft);await cancelPayoutDraft(tx,adminId,draft,1,'Synthetic API fixture cancel');return draft;});
      const bankHostToken=await token(bankFixture.owner,'HOST');
      const hostDraft=await http(`/host/payouts/${cancelledDraft}`,'GET',undefined,bankHostToken),adminDraft=await http(`/admin/finance/payouts/${cancelledDraft}`,'GET',undefined,reviewer.token);
      expect(hostDraft.status).toBe(200);expect(hostDraft.body.data.accountNumber).toBe(`****${bankFixture.bank.accountNumber.slice(-4)}`);
      expect(hostDraft.body.data).not.toHaveProperty('accountName');expect(hostDraft.body.data.events[0]).not.toHaveProperty('actorId');
      expect(hostDraft.body.data).not.toHaveProperty('operations');
      expect(adminDraft.body.data.operations).toEqual({canApprove:false,canExport:false,canConfirmPaid:false,canCancel:false,reviewRequired:false});
      expect(adminDraft.body.data.accountNumber).toBe(bankFixture.bank.accountNumber);expect(adminDraft.body.data.events[0].actorId).toBe(adminId);
      expect((await http(`/host/payouts/${cancelledDraft}`,'GET',undefined,otherHost.token)).status).toBe(404);
      expect((await http('/host/payouts','GET',undefined,tenant.token)).status).toBe(403);
      const hostList=await http('/host/payouts?page=1&limit=20','GET',undefined,bankHostToken);
      expect(hostList.body.meta).toMatchObject({total:1,page:1,limit:20});expect(hostList.body.data[0]).not.toHaveProperty('accountName');
      expect((await http('/admin/finance/payouts?page=0','GET',undefined,reviewer.token)).status).toBe(400);
      expect((await http('/admin/finance/payouts/invalid','GET',undefined,reviewer.token)).status).toBe(400);
      const cancelPath=`/admin/finance/payouts/${cancelledDraft}/cancel`;
      expect((await http(cancelPath,'POST',{expectedVersion:1,reason:'Synthetic stale'},reviewer.token,randomUUID())).body.errorCode).toBe('STALE_PAYOUT_VERSION');
      expect((await http(cancelPath,'POST',{expectedVersion:2,reason:'Synthetic closed'},reviewer.token,randomUUID())).body.errorCode).toBe('PAYOUT_NOT_DRAFT');
      expect((await http(`/admin/finance/payouts/${cancelledDraft}/confirm-paid`,'POST',{},reviewer.token,randomUUID())).status).toBe(400);
      const payoutRaw=await fetch(`${base}/api/v1/host/payouts/${cancelledDraft}`,{headers:{authorization:`Bearer ${bankHostToken}`}});expect(payoutRaw.headers.get('cache-control')).toBe('no-store');
      expect(document.paths['/api/v1/admin/finance/payouts'].post!.responses['201']).toHaveProperty('content.application/json.schema.properties.data.allOf');
      expect(document.components!.schemas!.CreatePayoutDraftDto).toMatchObject({required:expect.arrayContaining(['hostId','reason'])});
      expect(document.components!.schemas!.PayoutDraftHostDetailDto.properties).not.toHaveProperty('accountName');
      expect(document.components!.schemas!.PayoutDraftHostDetailDto.properties).not.toHaveProperty('operations');
      expect(document.components!.schemas!.PayoutDraftAdminDetailDto.properties.operations).toHaveProperty('allOf',[{$ref:'#/components/schemas/PayoutOperationsDto'}]);
      expect(document.components!.schemas!.PayoutOperationsDto.required).toEqual(expect.arrayContaining(['canApprove','canExport','canConfirmPaid','canCancel','reviewRequired']));
      const approvePath=`/admin/finance/payouts/${cancelledDraft}/approve`,approveBody={expectedVersion:2,reason:'Synthetic approval'};
      expect((await http(approvePath,'POST',approveBody,host.token,randomUUID())).status).toBe(403);
      expect((await http(approvePath,'POST',approveBody,reviewer.token)).status).toBe(400);
      expect((await http(approvePath,'POST',{...approveBody,amount:'1'},reviewer.token,randomUUID())).status).toBe(400);
      expect((await http(approvePath,'POST',approveBody,reviewer.token,randomUUID())).body.errorCode).toBe('PAYOUT_NOT_DRAFT');
      expect((await http(`/admin/finance/payouts/${randomUUID()}/approve`,'POST',approveBody,reviewer.token,randomUUID())).status).toBe(404);
      const approvalFixture=await historicalPayoutDraft(),goodPath=`/admin/finance/payouts/${approvalFixture.draft.id}/approve`,goodBody={expectedVersion:1,reason:'Synthetic API approval'},goodKey=randomUUID();
      const good=await http(goodPath,'POST',goodBody,reviewer.token,goodKey);
      expect(good.status).toBe(200);expect(good.body.data).toEqual({id:approvalFixture.draft.id,status:'APPROVED',version:2});
      expect((await http(`/admin/finance/payouts/${approvalFixture.draft.id}`,'GET',undefined,reviewer.token)).body.data.operations).toEqual({canApprove:false,canExport:true,canConfirmPaid:true,canCancel:true,reviewRequired:false});
      expect(await http(goodPath,'POST',goodBody,reviewer.token,goodKey)).toEqual(good);
      expect(await http(`/admin/finance/payouts/${approvalFixture.draft.id.toUpperCase()}/approve`,'POST',goodBody,reviewer.token,goodKey)).toEqual(good);
      expect((await http(goodPath,'POST',{...goodBody,reason:'Changed'},reviewer.token,goodKey)).body.errorCode).toBe('IDEMPOTENCY_CONFLICT');
      const goodRaw=await fetch(`${base}/api/v1/admin/finance/payouts/${approvalFixture.draft.id}`,{headers:{authorization:`Bearer ${reviewer.token}`}});
      expect(goodRaw.headers.get('cache-control')).toBe('no-store');
      expect(document.paths['/api/v1/admin/finance/payouts/{id}/approve'].post!.responses['200']).toHaveProperty('content.application/json.schema.properties.data.allOf');
      expect(document.components!.schemas!.ApprovePayoutDraftDto).toMatchObject({required:expect.arrayContaining(['expectedVersion','reason'])});
      expect(document.components!.schemas!.PayoutDraftSummaryDto.properties!.status.enum).toContain('APPROVED');
      const csvPath=`/admin/finance/payouts/${approvalFixture.draft.id}/export`;
      expect((await http(csvPath,'GET',undefined,host.token)).status).toBe(403);
      expect((await http(`/admin/finance/payouts/${cancelledDraft}/export`,'GET',undefined,reviewer.token)).body.errorCode).toBe('PAYOUT_NOT_APPROVED');
      const exported=await http(csvPath,'GET',undefined,reviewer.token);
      expect(exported.status).toBe(200);expect(exported.body.data).toMatchObject({encoding:'UTF-8',filename:`payout-${approvalFixture.draft.id}-v2.csv`});
      expect(exported.body.data.csv).toContain(approvalFixture.fixture.bank.accountNumber);
      expect(exported.body.data.csv).not.toContain('0990000001');
      const exportRaw=await fetch(`${base}/api/v1${csvPath}`,{headers:{authorization:`Bearer ${reviewer.token}`}});
      expect(exportRaw.headers.get('cache-control')).toBe('no-store');
      expect(document.paths['/api/v1/admin/finance/payouts/{id}/export'].get!.responses['200']).toHaveProperty('content.application/json.schema.properties.data.allOf');
      // Dedicated synthetic Admin keeps this contract test independent of the
      // earlier 30-write user bucket; production limits remain unchanged.
      const paidAdmin=await prisma.user.create({data:{phone:`F${randomUUID().replaceAll('-','').slice(0,14)}`,fullName:'Synthetic payout Admin',role:'ADMIN',passwordHash:'not-a-real-password'}});
      const paidAdminToken=await token(paidAdmin.id,'ADMIN');
      const paidPath=`/admin/finance/payouts/${approvalFixture.draft.id}/confirm-paid`,paidBody={expectedVersion:2,bankReference:'FIXTURE:'+randomUUID(),evidenceNote:'Synthetic HTTP evidence, no bank transfer',reason:'Synthetic confirmation'},paidKey=randomUUID();
      expect((await http(paidPath,'POST',paidBody,host.token,paidKey)).status).toBe(403);
      expect((await http(paidPath,'POST',paidBody,paidAdminToken)).status).toBe(400);
      expect((await http(paidPath,'POST',{...paidBody,amount:'1'},paidAdminToken,paidKey)).status).toBe(400);
      expect((await http(`/admin/finance/payouts/${randomUUID()}/confirm-paid`,'POST',paidBody,paidAdminToken,randomUUID())).status).toBe(404);
      const paid=await http(paidPath,'POST',paidBody,paidAdminToken,paidKey);
      expect(paid.status).toBe(200);expect(paid.body.data).toMatchObject({status:'PAID',version:3,amount:'990'});
      expect(await http(paidPath,'POST',paidBody,paidAdminToken,paidKey)).toEqual(paid);
      expect((await http(paidPath,'POST',{...paidBody,reason:'Changed'},paidAdminToken,paidKey)).body.errorCode).toBe('IDEMPOTENCY_CONFLICT');
      expect((await http(paidPath,'POST',paidBody,paidAdminToken,randomUUID())).body.errorCode).toBe('STALE_PAYOUT_VERSION');
      const payoutOwnerToken=await token(approvalFixture.fixture.owner,'HOST');
      const hostPaid=await http(`/host/payouts/${approvalFixture.draft.id}`,'GET',undefined,payoutOwnerToken);
      expect(hostPaid.body.data.confirmation).toEqual({confirmedAt:expect.any(String)});
      expect(JSON.stringify(hostPaid.body)).not.toContain(paidBody.evidenceNote);expect(JSON.stringify(hostPaid.body)).not.toContain(paidBody.bankReference);
      const adminPaid=await http(`/admin/finance/payouts/${approvalFixture.draft.id}`,'GET',undefined,reviewer.token);
      expect(adminPaid.body.data.confirmation).toMatchObject({actorId:paidAdmin.id,bankReference:paidBody.bankReference,evidenceNote:paidBody.evidenceNote});
      expect(adminPaid.body.data.operations).toEqual({canApprove:false,canExport:false,canConfirmPaid:false,canCancel:false,reviewRequired:false});
      expect(document.paths['/api/v1/admin/finance/payouts/{id}/confirm-paid'].post!.responses['200']).toHaveProperty('content.application/json.schema.properties.data.allOf');
      expect(document.components!.schemas!.ConfirmPayoutDto.required).toEqual(expect.arrayContaining(['expectedVersion','bankReference','evidenceNote','reason']));
      const notices=await http('/finance/notifications','GET',undefined,host.token);
      expect(notices.status).toBe(200);expect(notices.body.meta).toMatchObject({page:1,limit:20,total:2,unreadCount:2});
      expect(JSON.stringify(notices.body)).not.toContain(body.evidenceNote);
      const notice=notices.body.data.find((r:{type:string})=>r.type==='CREATED');
      expect((await http(`/finance/notifications/${notice.id}/read`,'POST',{},tenant.token)).status).toBe(404);
      expect((await http(`/finance/notifications/${notice.id}/read`,'POST',{},reviewer.token)).status).toBe(403);
      expect((await http(`/finance/notifications/${notice.id}/read`,'POST',{recipientId:owner},host.token)).status).toBe(400);
      expect((await http('/finance/notifications/invalid/read','POST',{},host.token)).status).toBe(400);
      const read=await http(`/finance/notifications/${notice.id}/read`,'POST',{},host.token);
      expect(read.status).toBe(200);expect(read.body.data.readAt).not.toBeNull();
      expect((await http(`/finance/notifications/${notice.id}/read`,'POST',{},host.token)).body).toEqual(read.body);
      expect((await http('/finance/notifications?page=1&limit=1','GET',undefined,host.token)).body.meta).toMatchObject({total:2,totalPages:2,unreadCount:1});
      expect((await http('/finance/notifications?page=0','GET',undefined,host.token)).status).toBe(400);
      expect((await http('/finance/notifications','GET')).status).toBe(401);
      const notificationResponse=await fetch(`${base}/api/v1/finance/notifications`,{headers:{authorization:`Bearer ${host.token}`}});
      expect(notificationResponse.headers.get('cache-control')).toBe('no-store');
      expect(document.paths['/api/v1/finance/notifications'].get!.responses['200']).toHaveProperty('content.application/json.schema.properties.meta.properties.unreadCount');
      expect(document.components!.schemas!.ComplaintNotificationDto).toMatchObject({properties:{type:{enum:['CREATED','RESPONDED','RESOLVED']},readAt:{nullable:true}}});
      const operation=document.paths['/api/v1/admin/finance/complaints/{id}/resolve'].post!;
      expect(operation).toHaveProperty('security');
      expect(operation.responses['200']).toHaveProperty('content.application/json.schema.properties.data.allOf',[{$ref:'#/components/schemas/ComplaintResolvedDto'}]);
      expect(document.components!.schemas!.ComplaintResolutionDto.properties.decision).toMatchObject({enum:['HOST','FULL_REFUND','PARTIAL_REFUND']});
      expect(document.components!.schemas!.ComplaintDetailDto.properties.resolution).toHaveProperty('allOf',[{$ref:'#/components/schemas/ComplaintResolutionDto'}]);
      expect(document.components!.schemas!.AdminComplaintDetailDto.properties.resolution).toHaveProperty('allOf',[{$ref:'#/components/schemas/AdminComplaintResolutionDto'}]);
      expect(document.components!.schemas!.ComplaintResolutionDto.required.sort()).toEqual(Object.keys(own.body.data.resolution).sort());
      expect(document.components!.schemas!.AdminComplaintResolutionDto.required.sort()).toEqual(Object.keys(adminDetail.body.data.resolution).sort());
      expect(document.components!.schemas!.ComplaintResolutionDto.properties).toHaveProperty('refundObligation');
      expect(document.components!.schemas!.ResolveComplaintDto).toMatchObject({required:expect.arrayContaining(['expectedVersion','decision','reason','evidenceNote']),properties:{decision:{enum:['HOST','FULL_REFUND','PARTIAL_REFUND']}}});
    } finally {
      const redis=app.get(RedisService).client;
      let cursor='0';do {const [next,keys]=await redis.scan(cursor,'MATCH',`${prefix}*`,'COUNT',100);cursor=next;if(keys.length) await redis.del(...keys.map(k=>k.slice(prefix.length)));}while(cursor!=='0');
      await app.close();
    }
  },60_000);
  const noShowReport=(version=1)=>({expectedVersion:version,reason:'Synthetic Host no-show report'});
  const noShowResolution=(version=2)=>({expectedVersion:version,decision:'NO_SHOW' as const,reason:'Synthetic Admin verification',evidenceNote:'No actual guest/bank data'});
  it.skipIf(process.env.S4_NOSHOW_ADMIN_BROWSER!=='1')('S4 Admin no-show UI real Auth BFF DB replays after resolution refresh without duplicating proof',async()=>{
    const owner=await bankHost(),booking=await paidBooking('FLEXIBLE',-72,true,owner),password='AdminNoShowFixture123!';
    const reportBody=noShowReport(),report=await noShow.report(owner,booking.id,reportBody,randomUUID(),reportBody);
    const other=await paidBooking('FLEXIBLE',-72,true,owner),otherReport=await noShow.report(owner,other.id,reportBody,randomUUID(),reportBody);
    await prisma.user.update({where:{id:adminId},data:{isPhoneVerified:true,passwordHash:await bcrypt.hash(password,4)}});
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('REDIS_KEY_PREFIX',`admin-no-show-browser:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let browser:{close():Promise<void>}|undefined,frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');const base=await app.getUrl();
      const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned Admin no-show frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright'),launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill('0990000003');await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();await page.getByRole('menuitem',{name:'Xác minh khách không đến',exact:true}).click();await page.waitForURL(origin+'/admin/finance/no-show-reports');
      await page.locator(`[data-report-id="${report.id}"]`).getByRole('button',{name:'Xem báo cáo',exact:true}).click();
      const form=page.getByRole('form',{name:'Xác minh khách không đến'}),reason=form.getByLabel('Lý do xác minh',{exact:true}),evidenceNote=form.getByLabel('Ghi chú chứng cứ',{exact:true}),submit=form.getByRole('button',{name:'Xác nhận khách không đến',exact:true});
      await submit.click();expect(await reason.getAttribute('aria-invalid')).toBe('true');expect(await evidenceNote.getAttribute('aria-invalid')).toBe('true');expect(await reason.evaluate((el:Element)=>el===document.activeElement)).toBe(true);
      await reason.fill('x'.repeat(501));await evidenceNote.fill('Synthetic fixture evidence');await submit.click();expect(await reason.inputValue()).toHaveLength(501);expect(await prisma.financeNoShowResolution.count({where:{bookingId:booking.id}})).toBe(0);
      await reason.fill(' Synthetic browser Admin verification ');await evidenceNote.fill(' Synthetic browser evidence ');
      const writes:{body:unknown;key:string|undefined}[]=[];
      await page.route(`**/api/management/admin/finance/bookings/${booking.id}/resolve-stay`,async route=>{
        writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});const response=await route.fetch();expect(response.status()).toBe(200);
        if(writes.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_LOST',message:'Synthetic delivery lost after actual resolve'}});
        return route.fulfill({response});
      });
      const images=resolve('../.tmp/s4-no-show-admin-real');await mkdir(images,{recursive:true});
      for(let width=1440;width>=375;width=Math.max(375,width-20)){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(width===375)break;}
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});await reason.evaluate((el:Element)=>el.scrollIntoView({block:'center'}));expect(await reason.evaluate((el:Element)=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);await page.screenshot({path:resolve(images,`form-${width}.png`),fullPage:true});await page.screenshot({path:resolve(images,`form-viewport-${width}.png`)});}
      await submit.click();const retry=form.getByRole('button',{name:'Thử lại cùng yêu cầu',exact:true});await retry.waitFor();
      expect(await reason.getAttribute('readonly')).not.toBeNull();expect(await evidenceNote.getAttribute('readonly')).not.toBeNull();expect(await page.locator(`[data-report-id="${otherReport.id}"]`).getByRole('button',{name:'Xem báo cáo'}).isDisabled()).toBe(true);
      // A focus read observes v3/resolved, but the pending acknowledgement must replay raw v2 and the same key.
      const refreshed=page.waitForResponse((r:{url():string;request():{method():string}})=>r.url().endsWith(`/api/management/admin/finance/no-show-reports/${report.id}`)&&r.request().method()==='GET');
      await page.evaluate(()=>window.dispatchEvent(new Event('visibilitychange')));expect((await (await refreshed).json()).data).toMatchObject({bookingVersion:3,resolution:{reason:'Synthetic browser Admin verification'}});
      await retry.click();await page.getByRole('status').filter({hasText:'Đã ghi nhận xác minh khách không đến'}).waitFor();
      expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(writes[0].body).toEqual({expectedVersion:2,decision:'NO_SHOW',reason:' Synthetic browser Admin verification ',evidenceNote:' Synthetic browser evidence '});expect(writes[0].key).toMatch(/^[a-f0-9-]{36}$/);
      expect(await prisma.financeNoShowResolution.count({where:{bookingId:booking.id}})).toBe(1);expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(1);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',version:3,completedAt:null});
      expect(await page.locator(`[data-report-id="${otherReport.id}"]`).getByRole('button',{name:'Xem báo cáo'}).isDisabled()).toBe(false);
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(images,`resolved-${width}.png`),fullPage:true});}
      expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('Synthetic browser evidence');
      await page.reload();await page.locator(`[data-report-id="${report.id}"]`).getByRole('button',{name:'Xem báo cáo'}).click();await page.getByText('Synthetic browser evidence',{exact:true}).waitFor();expect(await page.getByRole('form',{name:'Xác minh khách không đến'}).count()).toBe(0);
    }finally{try{await browser?.close();}finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}await app.close();}}
  },120000);
  it.skipIf(process.env.S4_NOSHOW_HOST_BROWSER!=='1')('S4 Host no-show UI real Auth BFF DB keeps original key and version after lost delivery',async()=>{
    const owner=await bankHost(),booking=await paidBooking('FLEXIBLE',-72,true,owner),password='NoShowBrowserFixture123!';
    await prisma.user.update({where:{id:owner},data:{phone:'0990000092',isPhoneVerified:true,passwordHash:await bcrypt.hash(password,4)}});
    vi.stubEnv('NODE_ENV','test');vi.stubEnv('OTP_PROVIDER','mock');vi.stubEnv('REDIS_KEY_PREFIX',`no-show-browser:${randomUUID()}:`);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let browser:{close():Promise<void>}|undefined,frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');const base=await app.getUrl();
      const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned no-show browser frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright'),launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill('0990000092');await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.goto(origin+'/host/bookings');await page.getByRole('button',{name:'Báo khách không đến',exact:true}).click();const form=page.getByRole('form',{name:'Báo cáo khách không đến'}),input=form.getByLabel('Lý do báo cáo',{exact:true});
      await form.getByRole('button',{name:'Gửi báo cáo',exact:true}).click();expect(await input.getAttribute('aria-invalid')).toBe('true');expect(await input.evaluate((el:Element)=>el===document.activeElement)).toBe(true);
      await input.fill('x'.repeat(501));await form.getByRole('button',{name:'Gửi báo cáo',exact:true}).click();expect(await input.inputValue()).toHaveLength(501);expect(await prisma.financeNoShowReport.count({where:{bookingId:booking.id}})).toBe(0);
      const writes:{body:unknown;key:string|undefined}[]=[];
      await page.route(`**/api/management/host/bookings/${booking.id}/no-show-report`,async route=>{
        writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});const response=await route.fetch();expect(response.status()).toBe(201);
        if(writes.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_LOST',message:'Synthetic delivery lost after actual write'}});
        return route.fulfill({response});
      });
      await input.fill(' Synthetic browser no-show reason ');
      const evidence=resolve('../.tmp/s4-no-show-host-real');await mkdir(evidence,{recursive:true});
      for(let width=1440;width>=375;width=Math.max(375,width-20)){
        await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);if(width===375)break;
      }
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});await input.evaluate((el:Element)=>el.scrollIntoView({block:'center'}));expect(await input.evaluate((el:Element)=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;})).toBe(true);await page.screenshot({path:resolve(evidence,`form-${width}.png`),fullPage:true});await page.screenshot({path:resolve(evidence,`form-viewport-${width}.png`)});}
      await form.getByRole('button',{name:'Gửi báo cáo',exact:true}).click();await form.getByRole('button',{name:'Thử lại cùng lý do',exact:true}).waitFor();
      expect(await input.getAttribute('readonly')).not.toBeNull();expect(await form.getByRole('button',{name:'Đóng',exact:true}).getAttribute('aria-disabled')).toBe('true');
      expect(await page.getByRole('button',{name:'Xác nhận nhận phòng',exact:true}).getAttribute('aria-disabled')).toBe('true');
      // Read a newer version during an uncertain write: replay must still use v1.
      const refreshed=await page.waitForResponse((r:{url():string;request():{method():string}})=>r.url().includes('/api/management/host/bookings?')&&r.request().method()==='GET',{timeout:22000});
      expect((await refreshed.json()).data.find((row:{bookingId:string})=>row.bookingId===booking.id).version).toBe(2);
      await form.getByRole('button',{name:'Thử lại cùng lý do',exact:true}).click();await page.getByText('Đã gửi báo cáo khách không đến.',{exact:false}).waitFor();
      expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(writes[0].body).toEqual({expectedVersion:1,reason:' Synthetic browser no-show reason '});expect(writes[0].key).toMatch(/^[a-f0-9-]{36}$/);
      expect((await db.query('SELECT count(*)::int AS n FROM finance_no_show_reports WHERE booking_id=$1',[booking.id])).rows[0].n).toBe(1);
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',version:2,completedAt:null});expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(1);
      expect(await page.getByRole('button',{name:'Xác nhận nhận phòng',exact:true}).getAttribute('aria-disabled')).toBe('false');
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,`saved-${width}.png`),fullPage:true});}
      expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('Synthetic browser no-show reason');
    }finally{try{await browser?.close();}finally{if(frontend&&frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}await app.close();}}
  },120000);
  it('S4 no-show actual HTTP matches documented report/list/detail/resolution without completing stay or moving money',async()=>{
    // Paid source and actors are synthetic fixtures; HTTP/Auth/DB are real local services.
    const owner=await bankHost(),booking=await paidBooking('FLEXIBLE',-72,true,owner);
    const app=await NestFactory.create(AppModule,{logger:false,abortOnError:false});let frontend:ReturnType<typeof spawn>|undefined;
    try {
      app.setGlobalPrefix('api/v1');app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
      app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());await app.listen(0,'127.0.0.1');
      const base=await app.getUrl(),document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      let api=base+'/api/v1',origin='';
      if(process.env.S4_NOSHOW_BFF==='1'){
        const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
        const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
        origin=`http://localhost:${port}`;const frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
        frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
        let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned no-show frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
        api=origin+'/api/management';
      }
      const token=async(id:string,role:string)=>new SignJWT({tokenType:'access',sessionVersion:0,role}).setProtectedHeader({alg:'HS256'}).setSubject(id).setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
      const hostToken=await token(owner,'HOST'),adminToken=await token(adminId,'ADMIN');
      const http=async(path:string,auth:string,body?:unknown,key?:string)=>{
        const response=await fetch(api+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${auth}`,'content-type':'application/json',...(origin?{origin}:{}),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
        expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('set-cookie')).toBeNull();return {status:response.status,body:await response.json()};
      };
      const fields=(data:object,name:string)=>expect(Object.keys(data).sort()).toEqual(Object.keys((document.components!.schemas![name] as {properties:object}).properties).sort());
      const report={...noShowReport(),reason:' Synthetic Host report '},reportKey=randomUUID(),reportPath=`/host/bookings/${booking.id}/no-show-report`;
      expect((await http(reportPath,await token(otherHostId,'HOST'),report,randomUUID())).status).toBe(404);
      expect((await http('/admin/finance/no-show-reports',hostToken)).status).toBe(403);
      expect((await http('/admin/finance/no-show-reports',await token(tenantId,'ADMIN'))).status).toBe(403);
      expect((await http(reportPath,hostToken,{...report,actorId:adminId},randomUUID())).status).toBe(400);
      expect((await http(reportPath,hostToken,report)).status).toBe(400);
      if(origin){const denied=await fetch(api+reportPath,{method:'POST',headers:{authorization:`Bearer ${hostToken}`,origin:'https://evil.test','content-type':'application/json','idempotency-key':randomUUID()},body:JSON.stringify(report)});expect(denied.status).toBe(403);}
      const created=await http(reportPath,hostToken,report,reportKey);expect(created.status).toBe(201);fields(created.body.data,'NoShowReportCreatedDto');
      expect(created.body.data).toMatchObject({bookingId:booking.id,bookingVersion:2,reason:report.reason.trim()});expect(await http(reportPath,hostToken,report,reportKey)).toEqual(created);
      const path=`/admin/finance/no-show-reports/${created.body.data.id}`;
      const detail=await http(path,adminToken);expect(detail.status).toBe(200);fields(detail.body.data,'NoShowReportDetailDto');expect(detail.body.data.resolution).toBeNull();
      const list=await http('/admin/finance/no-show-reports?page=1&limit=20',adminToken);expect(list.status).toBe(200);
      const listed=list.body.data.find((row:{id:string})=>row.id===created.body.data.id);fields(listed,'NoShowReportRowDto');expect(listed).toMatchObject({resolved:false,bookingVersion:2});
      expect(list.body.meta).toMatchObject({page:1,limit:20,total:await prisma.financeNoShowReport.count()});
      const decision=noShowResolution(),key=randomUUID(),resolvePath=`/admin/finance/bookings/${booking.id}/resolve-stay`;
      const resolved=await http(resolvePath,adminToken,decision,key);expect(resolved.status).toBe(200);fields(resolved.body.data,'NoShowResolvedDto');
      expect(resolved.body.data).toMatchObject({bookingId:booking.id,bookingVersion:3,refundAmount:'0',decision:'NO_SHOW'});
      expect(Date.parse(resolved.body.data.holdUntil)-Date.parse(resolved.body.data.resolvedAt)).toBe(72*3600000);expect(await http(resolvePath,adminToken,decision,key)).toEqual(resolved);
      const final=await http(path,adminToken);fields(final.body.data,'NoShowReportDetailDto');fields(final.body.data.resolution,'NoShowResolutionDto');
      expect(final.body.data.resolution).toMatchObject({actorId:adminId,reason:decision.reason,evidenceNote:decision.evidenceNote});
      expect((await http('/admin/finance/no-show-reports?page=1&limit=20',adminToken)).body.data.find((row:{id:string})=>row.id===created.body.data.id)).toMatchObject({resolved:true,bookingVersion:3});
      const stored=await prisma.booking.findUniqueOrThrow({where:{id:booking.id}});expect(stored).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',completedAt:null});
      expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(1); // Only the synthetic original PAYMENT.
      expect(await prisma.financeNoShowReport.count({where:{bookingId:booking.id}})).toBe(1);expect(await prisma.financeNoShowResolution.count({where:{bookingId:booking.id}})).toBe(1);
    }finally{if(frontend&&frontend.exitCode===null){frontend.kill();await once(frontend,'exit');}await app.close();}
  },60000);
  it('no-show report/Admin verification replay does not complete booking or move money; hold starts at resolution',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',-72,true,owner),report=noShowReport(),key=randomUUID();
    const created=await noShow.report(owner,b.id,report,key,report);
    expect(created).toMatchObject({bookingId:b.id,bookingVersion:2});
    expect(await noShow.report(owner,b.id,report,key,report)).toEqual(created);
    const dto=noShowResolution(),resolveKey=randomUUID(),resolved=await noShow.resolve(adminId,b.id,dto,resolveKey,dto);
    expect(resolved).toMatchObject({bookingId:b.id,bookingVersion:3,refundAmount:'0',decision:'NO_SHOW'});
    expect(new Date(String(resolved.holdUntil)).getTime()-new Date(String(resolved.resolvedAt)).getTime()).toBe(72*3600000);
    expect(await noShow.resolve(adminId,b.id,dto,resolveKey,dto)).toEqual(resolved);
    const unchanged=await prisma.booking.findUniqueOrThrow({where:{id:b.id}});
    expect(unchanged).toMatchObject({bookingStatus:'CONFIRMED',paymentStatus:'PAID',completedAt:null});
    expect((await hostFinance.summary(owner)).balances).toMatchObject({pendingHold:'990',eligibleBeforeDeductions:'0'});
    expect((await hostFinance.transactions(owner,1,20)).meta.total).toBe(1);
    expect((await noShow.read(String(created.id))).resolution).toMatchObject({actorId:adminId,evidenceNote:dto.evidenceNote});
    await expect(db.query('UPDATE finance_no_show_resolutions SET created_at=created_at-interval \'3 days\' WHERE booking_id=$1',[b.id])).rejects.toThrow('append-only');
    await expect(db.query('DELETE FROM finance_no_show_reports WHERE booking_id=$1',[b.id])).rejects.toThrow('append-only');
  });
  it('no-show ownership/roles and checkout gates reject early, wrong-owner and legacy payment resolution',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',-1,true,owner),report=noShowReport();
    await expect(noShow.report(otherHostId,b.id,report,randomUUID(),report)).rejects.toMatchObject({status:404});
    await expect(noShow.report(tenantId,b.id,report,randomUUID(),report)).rejects.toMatchObject({status:403});
    await noShow.report(owner,b.id,report,randomUUID(),report);
    const dto=noShowResolution();
    await expect(noShow.resolve(owner,b.id,dto,randomUUID(),dto)).rejects.toMatchObject({status:403});
    await expect(noShow.resolve(adminId,b.id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'NO_SHOW_NOT_ALLOWED'}});
    const legacy=await paidBooking('FLEXIBLE',-72,false,owner);await noShow.report(owner,legacy.id,report,randomUUID(),report);
    await expect(noShow.resolve(adminId,legacy.id,dto,randomUUID(),dto)).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
    expect((await prisma.booking.findUniqueOrThrow({where:{id:legacy.id}})).version).toBe(2);
    expect((await db.query('SELECT count(*)::int AS n FROM finance_no_show_resolutions WHERE booking_id=$1',[legacy.id])).rows[0].n).toBe(0);
  });
  it('concurrent no-show verification commits once and does not bypass an OPEN complaint',async()=>{
    const owner=await bankHost(),b=await paidBooking('FLEXIBLE',-72,true,owner),complaint=complaintInput();
    await complaints.create(tenantId,b.id,complaint,randomUUID(),complaint);
    const report=noShowReport();await noShow.report(owner,b.id,report,randomUUID(),report);
    const dto=noShowResolution();
    const results=await Promise.allSettled([noShow.resolve(adminId,b.id,dto,randomUUID(),dto),noShow.resolve(adminId,b.id,dto,randomUUID(),dto)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{response:{errorCode:'STALE_BOOKING_VERSION'}}});
    expect((await hostFinance.summary(owner)).balances).toMatchObject({frozen:'990',pendingHold:'0',eligibleBeforeDeductions:'0'});
    expect((await db.query('SELECT count(*)::int AS n FROM finance_no_show_resolutions WHERE booking_id=$1',[b.id])).rows[0].n).toBe(1);
  });
});
