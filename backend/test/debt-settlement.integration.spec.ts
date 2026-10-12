import '../src/config/load-env.js';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {Pool} from 'pg';
import {PrismaService} from '../src/database/prisma.service.js';
import {BookingIdempotencyService} from '../src/bookings/booking-idempotency.service.js';
import {DebtSettlementsService} from '../src/finance/debt-settlements.service.js';
import {PayoutDraftsService} from '../src/finance/payout-drafts.service.js';
import {BankAccountsService} from '../src/finance/bank-accounts.service.js';
import {ComplaintsService} from '../src/finance/complaints.service.js';
import {appendFinancialJournal} from '../src/finance/finance-journal.js';
import type {BookingsService} from '../src/bookings/bookings.service.js';
import type {HomestayCalendarService} from '../src/homestays/homestay-calendar.service.js';

// Real isolated PostgreSQL/constraints/transactions. Synthetic ledger, no bank or
// gateway. A schema-local clock fixture advances time, never backdates bookings,
// alters production functions, disables triggers, or touches the application DB.
describe.skipIf(process.env.FINANCE_INTEGRATION!=='1')('Host debt settlement real DB',()=>{
 const name=`trotot_debt_test_${randomUUID().replaceAll('-','')}`,original=process.env.DATABASE_URL;
 let admin:Pool,db:Pool,prisma:PrismaService,created=false,actor:string,guest:string;
 let settlements:DebtSettlementsService,payouts:PayoutDraftsService,banks:BankAccountsService,complaints:ComplaintsService;
 let tick=0;
 const advance=async(days=14)=>{tick+=days;await db.query("UPDATE test_clock SET instant='2026-01-05T02:00:00Z'::timestamptz+$1*interval '1 day'",[tick]);};
 const host=async()=> (await prisma.user.create({data:{phone:`T${randomUUID().replaceAll('-','').slice(0,14)}`,fullName:'Synthetic debt Host',role:'HOST',passwordHash:'fixture-only'}})).id;
 beforeAll(async()=>{
  const url=new URL(original!);if(process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Isolated local DB only');
  admin=new Pool({connectionString:url.toString()});await admin.query(`CREATE DATABASE "${name}"`);created=true;
  url.pathname=`/${name}`;process.env.DATABASE_URL=url.toString();
  await promisify(execFile)(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{env:process.env,timeout:60000});
  db=new Pool({connectionString:url.toString()});
  await db.query("CREATE TABLE test_clock(instant timestamptz NOT NULL); INSERT INTO test_clock VALUES('2026-01-05T02:00:00Z'); CREATE FUNCTION public.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS 'SELECT instant FROM public.test_clock';");
  url.searchParams.set('options','-c search_path=public,pg_catalog');process.env.DATABASE_URL=url.toString();
  prisma=new PrismaService();await prisma.$connect();
  expect((await prisma.$queryRaw<{now:Date}[]>`SELECT clock_timestamp() AS now`)[0].now.toISOString()).toBe('2026-01-05T02:00:00.000Z');
  const idem=new BookingIdempotencyService(prisma);settlements=new DebtSettlementsService(prisma,idem);payouts=new PayoutDraftsService(prisma,idem);banks=new BankAccountsService(prisma,idem);
  complaints=new ComplaintsService(prisma,idem,{invalidate:async()=>{}} as unknown as HomestayCalendarService,{releaseLock:async()=>{}} as unknown as BookingsService);
  actor=(await prisma.user.create({data:{phone:'D00000000000001',fullName:'Synthetic Admin',role:'ADMIN',passwordHash:'fixture-only'}})).id;
  guest=(await prisma.user.create({data:{phone:'D00000000000002',fullName:'Synthetic Guest',role:'TENANT',passwordHash:'fixture-only'}})).id;
  await prisma.addressProvince.create({data:{code:'79',name:'Fixture province'}});await prisma.addressWard.create({data:{code:'26740',provinceCode:'79',name:'Fixture ward'}});
 },120000);
 afterAll(async()=>{
  await prisma?.$disconnect();await db?.end();
  if(created&&/^trotot_debt_test_[a-f0-9]{32}$/.test(name))await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin?.end();process.env.DATABASE_URL=original;
 });
 async function earning(owner:string,base=1000000){
  const p=await prisma.property.create({data:{hostId:owner,slug:`debt-${randomUUID()}`,title:'Synthetic',description:'Fixture',propertyType:'HOMESTAY',rentalMode:'SHORT_TERM',addressDetail:'Fixture',provinceCode:'79',wardCode:'26740',latitude:10.7,longitude:106.6,status:'PUBLISHED'}});
  const u=await prisma.homestayUnit.create({data:{propertyId:p.id,unitName:'Fixture',maxAdults:2,maxChildren:0,bedrooms:1,bathrooms:1,basePricePerNight:base,cleaningFee:0,checkInTime:new Date('1970-01-01T14:00:00Z'),checkOutTime:new Date('1970-01-01T12:00:00Z'),cancellationPolicy:'FLEXIBLE',status:'PUBLISHED',instantBook:true}});
  const commission=Math.floor(base/10+0.5),payable=base-commission;
  const b=await prisma.booking.create({data:{bookingCode:`D-${randomUUID().replaceAll('-','').slice(0,24)}`,homestayUnitId:u.id,guestId:guest,checkInDate:new Date('2026-01-01'),checkOutDate:new Date('2026-01-02'),totalNights:1,numAdults:1,numChildren:0,guestName:'Fixture',guestPhone:'0990000001',nightlyPrices:[{date:'2026-01-01',price:String(base)}],policySnapshot:{cancellationPolicy:'FLEXIBLE',checkInTime:'14:00:00',checkOutTime:'12:00:00'},baseAmount:base,cleaningFee:0,serviceFee:0,taxAmount:0,totalAmount:base,serviceFeeRate:0,taxRate:0,commissionRate:10,commissionAmount:commission,hostPayoutAmount:payable,bookingStatus:'CONFIRMED',paymentStatus:'PAID',expiresAt:new Date('2026-01-01T01:00:00Z')}});
  await prisma.$transaction(tx=>appendFinancialJournal(tx,{eventKey:`fixture:${b.id}`,kind:'PAYMENT',bookingId:b.id,hostId:owner,actorId:null,reason:'Synthetic money only',lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:String(base)},{account:'HOST_PAYABLE',side:'CREDIT',amount:String(payable)},...(commission?[{account:'PLATFORM_COMMISSION' as const,side:'CREDIT' as const,amount:String(commission)}]:[])]}));
  return prisma.booking.update({where:{id:b.id},data:{bookingStatus:'COMPLETED'}});
 }
 async function paidSource(owner:string,base=1000000){
  const bank={expectedVersion:0,bankCode:'VCB',accountNumber:'1234567890',accountName:'SYNTHETIC HOST'};
  const submitted=await banks.submit(owner,bank,randomUUID(),bank);
  const review={expectedVersion:1,reason:'Fixture verification',evidenceNote:'No real bank'};
  await banks.review(actor,submitted.account!.id,'VERIFY',review,randomUUID(),review);
  const b=await earning(owner,base);await advance();
  const input={hostId:owner,reason:'Fixture payout'},draft=await payouts.create(actor,input,randomUUID(),input);
  const approve={expectedVersion:1,reason:'Fixture approval'};await payouts.approve(actor,draft.id,approve,randomUUID(),approve);
  const proof={expectedVersion:2,bankReference:`FIX-${randomUUID()}`,evidenceNote:'Synthetic transfer, no bank',reason:'Fixture paid'};
  await payouts.confirmPaid(actor,draft.id,proof,randomUUID(),proof);
  return {b,batchId:draft.id};
 }
 async function debt(b:Awaited<ReturnType<typeof earning>>,baseAmount:string){
  const current=await prisma.booking.findUniqueOrThrow({where:{id:b.id}}),input={expectedVersion:current.version,reason:'Fixture late refund',evidenceNote:'Synthetic private proof'};
  const c=await complaints.createAdminLate(actor,b.id,input,randomUUID(),input);
  const dto={expectedVersion:c.version,expectedBookingVersion:current.version,reason:'Fixture resolve',evidenceNote:'Synthetic proof',decision:'PARTIAL_REFUND' as const,allocation:{baseAmount,cleaningFee:'0',serviceFee:'0',taxAmount:'0'}};
  const key=randomUUID(),result=await complaints.resolve(actor,c.id,dto,key,dto);
  expect(await complaints.resolve(actor,c.id,dto,key,dto)).toEqual(result);
  return (await db.query('SELECT refund_id AS id,amount::text FROM finance_host_debts WHERE booking_id=$1 ORDER BY created_at,refund_id',[b.id])).rows.at(-1) as {id:string;amount:string};
 }
 const settle=(owner:string,key=randomUUID())=>settlements.create(actor,owner,'Fixture weekly settlement',key,{hostId:owner,reason:'Fixture weekly settlement'});
 it('post-PAID refund creates exactly one evidenced debt, replay preserves paid history',async()=>{
  const owner=await host(),{b,batchId}=await paidSource(owner);const before=await payouts.read(batchId,owner);
  const d=await debt(b,'500000');expect(d.amount).toBe('450000');
  expect(await payouts.read(batchId,owner)).toEqual(before);
  expect((await settlements.list(owner,'debts',1,20)).data).toHaveLength(1);
  expect((await settlements.list(await host(),'debts',1,20)).data).toHaveLength(0);
  await expect(db.query('UPDATE finance_host_debts SET amount=1 WHERE refund_id=$1',[d.id])).rejects.toThrow();
 });
 it.each([[-1,'1'],[0,'0'],[1,'0']])('zero-transfer settlement debt boundary %s VND, retry and reversal',async(delta,remaining)=>{
  const owner=await host(),{b}=await paidSource(owner);await debt(b,'500000');
  // base 499999 -> Host 449999; 500000 ->450000; 500001 ->450001.
  await earning(owner,500000+delta);await advance();
  if(delta===1){await expect(settle(owner)).rejects.toMatchObject({response:{errorCode:'PAYOUT_BELOW_THRESHOLD'}});expect((await db.query('SELECT count(*)::int AS n FROM finance_debt_offsets o JOIN finance_debt_settlements s ON s.id=o.settlement_id WHERE s.host_id=$1',[owner])).rows[0].n).toBe(0);return;}
  const key=randomUUID(),s=await settle(owner,key);expect(s.batchId).toBeNull();expect(s.netPayout).toBe('0');expect(await settle(owner,key)).toEqual(s);
  expect((await settlements.list(owner,'debts',1,20)).data[0]).toMatchObject({remainingAmount:remaining});
  expect((await settlements.list(owner,'settlements',1,20)).data[0]).toMatchObject({status:'OFFSET'});
  const reverseKey=randomUUID(),raw={reason:'Fixture reversal'},r=await settlements.reverse(actor,s.id,raw.reason,reverseKey,raw);
  expect(await settlements.reverse(actor,s.id,raw.reason,reverseKey,raw)).toEqual(r);
  expect((await settlements.list(owner,'debts',1,20)).data[0]).toMatchObject({remainingAmount:'450000'});
  await expect(settlements.reverse(actor,s.id,raw.reason,randomUUID(),raw)).rejects.toMatchObject({response:{errorCode:'SETTLEMENT_ALREADY_REVERSED'}});
 });
 it('FIFO, simultaneous creation, cancellation restores offsets atomically and isolates Host',async()=>{
  const owner=await host(),{b}=await paidSource(owner);const d1=await debt(b,'200000');await advance(1);const d2=await debt(b,'300000');
  await earning(owner,1000000);await advance();
  const results=await Promise.allSettled([settle(owner),settle(owner)]);if(results.every(r=>r.status==='rejected'))throw (results[0] as PromiseRejectedResult).reason;expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const s=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof settle>>>).value;
  expect(s).toMatchObject({grossEligible:'900000',debtOffset:'450000',netPayout:'450000'});expect(s.batchId).not.toBeNull();
  const offsets=(await db.query('SELECT o.refund_id,o.amount::text FROM finance_debt_offsets o JOIN finance_host_debts d ON d.refund_id=o.refund_id WHERE o.settlement_id=$1 ORDER BY d.created_at,d.refund_id',[s.id])).rows;
  expect(offsets.map(o=>o.refund_id)).toEqual([d1.id,d2.id]);expect(offsets.map(o=>o.amount)).toEqual(['180000','270000']);
  // Even raw SQL with valid cancellation audit/item release must reverse offsets.
  await expect(prisma.$transaction(async tx=>{
   await tx.$executeRaw`INSERT INTO finance_payout_events(batch_id,actor_id,action,version_before,reason) VALUES (${s.batchId}::uuid,${actor}::uuid,'CANCELLED',1,'Fixture missing reversal')`;
   await tx.$executeRaw`UPDATE finance_payout_batches SET status='CANCELLED',version=2 WHERE id=${s.batchId}::uuid`;
   await tx.$executeRaw`UPDATE finance_payout_items SET status='RELEASED' WHERE batch_id=${s.batchId}::uuid`;
  })).rejects.toThrow();
  await expect(settlements.reverse(actor,s.id,'Wrong path',randomUUID(),{})).rejects.toMatchObject({response:{errorCode:'SETTLEMENT_USE_BATCH_CANCEL'}});
  await expect(payouts.read(s.batchId!,await host())).rejects.toMatchObject({status:404});
  const cancel={expectedVersion:1,reason:'Fixture cancellation'},key=randomUUID();
  await payouts.cancel(actor,s.batchId!,cancel,key,cancel);await payouts.cancel(actor,s.batchId!,cancel,key,cancel);
  expect((await settlements.list(owner,'debts',1,20)).data.map((r:unknown)=>(r as {remainingAmount:string}).remainingAmount).sort()).toEqual(['180000','270000']);
  expect((await settlements.list(owner,'settlements',1,20)).data[0]).toMatchObject({status:'REVERSED'});
  const retry=await settle(owner);expect(retry.netPayout).toBe('450000');
 // Multiple real, serialized ledger transactions; not a 5-second unit test.
 },30_000);
 it('residual batch can be approved/paid once; paid batch and its offsets cannot be reversed',async()=>{
  const owner=await host(),{b}=await paidSource(owner,1000001);const d=await debt(b,'500005');
  expect(d.amount).toBe('450005'); // Original commission minus half-up rounded remaining commission.
  const residualBooking=await earning(owner,1000000);await advance();const s=await settle(owner);
  expect(s.netPayout).toBe('449995');
  const approve={expectedVersion:1,reason:'Fixture residual approval'};await payouts.approve(actor,s.batchId!,approve,randomUUID(),approve);
  const proof={expectedVersion:2,reason:'Fixture residual paid',bankReference:`FIX-${randomUUID()}`,evidenceNote:'Synthetic only, no bank'},key=randomUUID();
  const paid=await payouts.confirmPaid(actor,s.batchId!,proof,key,proof);expect(await payouts.confirmPaid(actor,s.batchId!,proof,key,proof)).toEqual(paid);
  await expect(payouts.cancel(actor,s.batchId!,{expectedVersion:3,reason:'No reverse paid'},randomUUID(),{})).rejects.toMatchObject({status:409});
  expect((await settlements.list(owner,'debts',1,20)).data[0]).toMatchObject({remainingAmount:'0'});
  const current=await prisma.booking.findUniqueOrThrow({where:{id:residualBooking.id}});
  const late={expectedVersion:current.version,reason:'Mixed source review',evidenceNote:'Synthetic private evidence'};
  const c=await complaints.createAdminLate(actor,current.id,late,randomUUID(),late);
  const before=(await db.query('SELECT count(*)::int AS n FROM finance_journals WHERE booking_id=$1',[current.id])).rows[0].n;
  const adminDetail=await complaints.read(c.id,null);
  expect('settlementReview' in adminDetail?adminDetail.settlementReview:null).toEqual({originalHostAmount:'900000',offsetAmount:'450005',paidAmount:'449995',potentialExcessAmount:'450005'});
  const hostDetail=await complaints.read(c.id,owner);
  expect(hostDetail).toMatchObject({settlementReviewStatus:'PENDING'});expect(hostDetail).not.toHaveProperty('settlementReview');
  await expect(complaints.read(c.id,await host())).rejects.toMatchObject({status:404});
  const full={expectedVersion:c.version,expectedBookingVersion:current.version,reason:'Do not automate',evidenceNote:'Synthetic only',decision:'FULL_REFUND' as const,allocation:{baseAmount:'1000000',cleaningFee:'0',serviceFee:'0',taxAmount:'0'}};
  await expect(complaints.resolve(actor,c.id,full,randomUUID(),full)).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
  const hostDecision={expectedVersion:c.version,reason:'Do not bypass review',evidenceNote:'Synthetic',decision:'HOST' as const};
  await expect(complaints.resolve(actor,c.id,hostDecision,randomUUID(),hostDecision)).rejects.toMatchObject({response:{errorCode:'FINANCIAL_REVIEW_REQUIRED'}});
  await expect(db.query("UPDATE finance_complaints SET status='RESOLVED',version=version+1 WHERE id=$1",[c.id])).rejects.toThrow();
  await expect(settle(owner)).rejects.toMatchObject({response:{errorCode:'SETTLEMENT_NO_ELIGIBLE_ITEMS'}});
  expect((await db.query('SELECT count(*)::int AS n FROM finance_journals WHERE booking_id=$1',[current.id])).rows[0].n).toBe(before);
  expect((await db.query('SELECT count(*)::int AS n FROM finance_host_debts WHERE booking_id=$1',[current.id])).rows[0].n).toBe(0);
  expect((await db.query('SELECT count(*)::int AS n FROM finance_debt_offset_reversals r JOIN finance_debt_offsets o ON o.id=r.offset_id WHERE o.booking_id=$1',[current.id])).rows[0].n).toBe(0);
  // Table defaults retain their original pg_catalog clock binding. Advance only
  // the fixture clock relative to the immutable case timestamp; never backdate it.
  const fixtureInstant=(await db.query('SELECT instant FROM test_clock')).rows[0].instant;
  try {
   await db.query("UPDATE test_clock SET instant=(SELECT created_at+interval '8 days' FROM finance_complaints WHERE id=$1)",[c.id]);
   expect(await complaints.read(c.id,null)).toMatchObject({overdue:true,status:'OPEN'});
  } finally {await db.query('UPDATE test_clock SET instant=$1',[fixtureInstant]);}
 });
 it('offset-only settlement does not require current bank verification; no cross-Host funds are consumed',async()=>{
  const owner=await host(),other=await host(),{b}=await paidSource(owner);await debt(b,'500000');
  const bank={expectedVersion:2,bankCode:'VCB',accountNumber:'9876543210',accountName:'SYNTHETIC NEW'};await banks.submit(owner,bank,randomUUID(),bank);
  await earning(other,500000);await advance();await expect(settle(owner)).rejects.toMatchObject({response:{errorCode:'SETTLEMENT_NO_ELIGIBLE_ITEMS'}});
  await earning(owner,500000);await advance();expect((await settle(owner)).batchId).toBeNull();
  expect((await settlements.list(other,'settlements',1,20)).data).toHaveLength(0);
 });
 it('wrong actor and forced transaction rollback leave no settlement or offsets',async()=>{
  const owner=await host(),{b}=await paidSource(owner);await debt(b,'500000');await earning(owner,500000);await advance();
  await expect(settlements.create(owner,owner,'Not Admin',randomUUID(),{})).rejects.toMatchObject({status:403});
  await db.query("CREATE FUNCTION test_settlement_rollback() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; CREATE TRIGGER test_settlement_rollback AFTER INSERT ON finance_debt_offsets FOR EACH ROW EXECUTE FUNCTION test_settlement_rollback();");
  try{await expect(settle(owner)).rejects.toThrow();}finally{await db.query('DROP TRIGGER test_settlement_rollback ON finance_debt_offsets; DROP FUNCTION test_settlement_rollback()');}
  expect((await settlements.list(owner,'settlements',1,20)).data).toHaveLength(0);
  expect((await settlements.list(owner,'debts',1,20)).data[0]).toMatchObject({remainingAmount:'450000'});
  expect((await settle(owner)).netPayout).toBe('0');
 });
});
