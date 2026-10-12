// Only called by the UUID backup/restore runner. No real users, provider or money.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PrismaService} from '../src/database/prisma.service.js';
import {appendFinancialJournal} from '../src/finance/finance-journal.js';
import {AdminDashboardService} from '../src/admin/admin-dashboard.service.js';
const target=new URL(process.env.DATABASE_URL!);
assert.equal(process.env.NODE_ENV,'test');assert.equal(target.port,'58491');
assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
assert.match(target.pathname,/^\/trotot_(backup|restore)_test_[a-f0-9]{32}$/);
const prisma=new PrismaService();await prisma.$connect();
const host='00000000-0000-4000-8000-000000000001',admin='00000000-0000-4000-8000-000000000003';
try{
  if(process.argv[2]==='seed'){
    const guest=await prisma.user.create({data:{phone:'0999999997',fullName:'Backup Guest fixture',role:'TENANT',passwordHash:'fixture-only'}});
    const p=await prisma.property.create({data:{hostId:host,slug:'backup-homestay-fixture',title:'Backup homestay',description:'Fixture only',propertyType:'HOMESTAY',rentalMode:'SHORT_TERM',addressDetail:'Fixture only',provinceCode:'TEST',wardCode:'TEST',latitude:10,longitude:106,status:'PUBLISHED'}});
    const unit=await prisma.homestayUnit.create({data:{propertyId:p.id,unitName:'Backup finance fixture',maxAdults:2,maxChildren:1,bedrooms:1,bathrooms:1,basePricePerNight:500,cleaningFee:100,checkInTime:new Date('1970-01-01T14:00:00Z'),checkOutTime:new Date('1970-01-01T12:00:00Z'),instantBook:true,status:'PUBLISHED',cancellationPolicy:'FLEXIBLE'}});
    for(const [checkIn,checkOut,status] of [['2001-01-01','2001-01-03','COMPLETED'],['2099-02-01','2099-02-03','CONFIRMED']]){
      const second=new Date(new Date(checkIn).getTime()+86400000).toISOString().slice(0,10);
      const b=await prisma.booking.create({data:{bookingCode:`BACKUP-${randomUUID().slice(0,20)}`,homestayUnitId:unit.id,guestId:guest.id,checkInDate:new Date(checkIn),checkOutDate:new Date(checkOut),totalNights:2,numAdults:1,numChildren:0,guestName:'Backup guest fixture',guestPhone:'0999999997',nightlyPrices:[{date:checkIn,price:'500'},{date:second,price:'500'}],policySnapshot:{cancellationPolicy:'FLEXIBLE',checkInTime:'14:00:00',checkOutTime:'12:00:00'},baseAmount:1000,cleaningFee:100,serviceFee:0,taxAmount:0,totalAmount:1100,serviceFeeRate:0,taxRate:0,commissionRate:10,commissionAmount:110,hostPayoutAmount:990,bookingStatus:status==='COMPLETED'?'CHECKED_IN':status,paymentStatus:'PAID',expiresAt:new Date('2099-01-01')}});
      await prisma.$transaction(tx=>appendFinancialJournal(tx,{eventKey:`backup-payment:${b.id}`,kind:'PAYMENT',bookingId:b.id,hostId:host,actorId:null,reason:'Synthetic backup ledger; no real transfer',lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'1100'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'990'},{account:'PLATFORM_COMMISSION',side:'CREDIT',amount:'110'}]}));
      if(status==='COMPLETED'){
        // The DB completion trigger stamps the transition; never insert/alter its timestamp.
        await prisma.booking.update({where:{id:b.id},data:{bookingStatus:'COMPLETED',version:{increment:1}}});
        await prisma.review.create({data:{bookingId:b.id,guestId:guest.id,cleanliness:5,location:4,value:5,comment:'Backup review fixture'}});
      }
    }
    for(const [checkIn,checkOut,status] of [['2099-06-01','2099-06-02','PENDING_PAYMENT'],['2099-07-01','2099-07-02','PENDING_HOST_APPROVAL']]){
      await prisma.booking.create({data:{bookingCode:`EXPIRY-${randomUUID().slice(0,20)}`,homestayUnitId:unit.id,guestId:guest.id,
        checkInDate:new Date(checkIn),checkOutDate:new Date(checkOut),totalNights:1,numAdults:1,numChildren:0,guestName:'Backup expiry fixture',guestPhone:'0999999997',
        nightlyPrices:[{date:checkIn,price:'500'}],policySnapshot:{cancellationPolicy:'FLEXIBLE',checkInTime:'14:00:00',checkOutTime:'12:00:00'},
        baseAmount:500,cleaningFee:100,serviceFee:0,taxAmount:0,totalAmount:600,serviceFeeRate:0,taxRate:0,commissionRate:10,commissionAmount:60,hostPayoutAmount:540,
        bookingStatus:status,paymentStatus:'NOT_CONFIGURED',expiresAt:new Date(Date.now()-60000)}});
    }
    const c=await prisma.chatConversation.create({data:{propertyId:p.id,guestId:guest.id,hostId:host}});
    await prisma.chatMessage.create({data:{conversationId:c.id,senderId:guest.id,clientMessageId:randomUUID(),text:'Backup chat fixture'}});
    await prisma.userModerationEvent.create({data:{actorId:admin,targetId:guest.id,statusBefore:'ACTIVE',statusAfter:'BANNED',reason:'Backup audit fixture'}});
  }else if(process.argv[2]==='verify'){
    assert.equal(await prisma.booking.count(),4);assert.equal(await prisma.financeJournal.count(),2);assert.equal(await prisma.review.count(),1);assert.equal(await prisma.chatMessage.count(),1);assert.equal(await prisma.userModerationEvent.count(),1);
    const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
    const report=await new AdminDashboardService(prisma).read(today,today);
    assert.equal(report.money.gmv,'2200');assert.equal(report.money.commissionRecognized,'220');assert.equal(report.isComplete,true);
    const existing=await prisma.booking.findFirstOrThrow({where:{bookingStatus:'CONFIRMED'}});
    const {id:_id,createdAt:_created,updatedAt:_updated,...copy}=existing;
    await assert.rejects(prisma.booking.create({data:{...copy,nightlyPrices:existing.nightlyPrices!,policySnapshot:existing.policySnapshot!,inventoryLock:undefined,bookingCode:`CONFLICT-${randomUUID().slice(0,20)}`}}),/exclusion|overlap|23P01/i);
    const journal=await prisma.financeJournal.findFirstOrThrow();
    await assert.rejects(prisma.$executeRaw`INSERT INTO finance_journals(event_key,request_hash,kind,host_id,reason,created_txid) VALUES(${`spoof:${randomUUID()}`},${'a'.repeat(64)},'ADJUSTMENT',${host}::uuid,'Synthetic spoof',${journal.createdTxid})`,/current transaction/i);
    await assert.rejects(prisma.$executeRaw`UPDATE finance_journals SET reason='tamper' WHERE id=${journal.id}::uuid`,/append.only/i);
    await assert.rejects(prisma.$executeRaw`DELETE FROM finance_entries WHERE journal_id=${journal.id}::uuid`,/append.only/i);
    const count=await prisma.financeJournal.count();
    await assert.rejects(prisma.$transaction(async tx=>{
      const [j]=await tx.$queryRaw<{id:string}[]>`INSERT INTO finance_journals(event_key,request_hash,kind,host_id,actor_id,reason) VALUES(${`unbalanced:${randomUUID()}`},${'a'.repeat(64)},'ADJUSTMENT',${host}::uuid,${admin}::uuid,'Synthetic unbalanced') RETURNING id`;
      await tx.$executeRaw`INSERT INTO finance_entries(journal_id,line_number,account,side,amount) VALUES(${j.id}::uuid,1,'CASH_CLEARING','DEBIT',10),(${j.id}::uuid,2,'HOST_PAYABLE','CREDIT',9)`;
    }),/balanced|balance/i);
    assert.equal(await prisma.financeJournal.count(),count);
    await assert.rejects(prisma.$executeRaw`INSERT INTO finance_entries(journal_id,line_number,account,side,amount) VALUES(${journal.id}::uuid,20,'CASH_CLEARING','DEBIT',1)`,/previously committed/i);
    await assert.rejects(prisma.$executeRaw`UPDATE user_moderation_events SET reason='tamper'`,/append.only/i);
    const review=await prisma.review.findFirstOrThrow();
    await assert.rejects(prisma.review.create({data:{bookingId:review.bookingId,guestId:review.guestId,cleanliness:5,location:5,value:5,comment:'duplicate'}}),/unique/i);
    // Restore contains deadlines but deliberately no Redis jobs. Real startup
    // reconciliation must recover both pending paths from persisted DB rows.
    assert.equal(process.env.REDIS_PORT,'58492');assert.ok(['localhost','127.0.0.1'].includes(process.env.REDIS_HOST!));
    process.env.REALTIME_ENABLED='false';process.env.REDIS_KEY_PREFIX=`backup-restore:${target.pathname.slice(1)}:`;
    // tsx does not emit Nest decorator metadata. Exercise the built runtime;
    // never change application DI to accommodate a test-only transpiler.
    const [{NestFactory},{AppModule},{RedisService}]=await Promise.all([import('@nestjs/core'),import('../dist/app.module.js'),import('../dist/redis/redis.service.js')]);
    // Use the HTTP application DI graph (HttpAdapterHost is a dependency), but
    // do not listen on any port for this restored worker acceptance check.
    const application=await NestFactory.create(AppModule,{logger:false,abortOnError:false});await application.init();
    const redis=application.get(RedisService).client,cleanup=redis.duplicate({lazyConnect:true});cleanup.on('error',()=>{});
    try{
      const expired=await prisma.booking.findMany({where:{bookingCode:{startsWith:'EXPIRY-'}},orderBy:{checkInDate:'asc'}});
      assert.deepEqual(expired.map(b=>b.bookingStatus),['CANCELLED_TIMEOUT','CANCELLED_HOST_TIMEOUT']);
      assert.ok(expired.every(b=>b.paymentStatus==='NOT_CONFIGURED'&&b.version===2));
      const b=expired[0],{id:_expiredId,createdAt:_ec,updatedAt:_eu,...pending}=b;
      // DB inventory is actually released; a new hold for the same night fits.
      await prisma.booking.create({data:{...pending,nightlyPrices:b.nightlyPrices!,policySnapshot:b.policySnapshot!,inventoryLock:undefined,
        bookingCode:`AFTER-EXPIRY-${randomUUID().slice(0,12)}`,bookingStatus:'PENDING_PAYMENT',expiresAt:new Date('2099-01-01')}});
      assert.equal(await prisma.financeJournal.count(),2);
      assert.equal((await new AdminDashboardService(prisma).read(today,today)).money.gmv,'2200');
    }finally{
      await application.close();
      try{await cleanup.connect();let cursor='0';do{
        const [next,keys]=await cleanup.scan(cursor,'MATCH',process.env.REDIS_KEY_PREFIX+'*','COUNT',100);cursor=next;
        if(keys.length)await cleanup.del(...keys.map(key=>key.slice(process.env.REDIS_KEY_PREFIX!.length)));
      }while(cursor!=='0');}finally{cleanup.disconnect();}
    }
    console.log('Restored booking overlap, balanced append-only ledger, Admin GMV, review uniqueness, chat/audit and real worker startup recovery PASS');
  }else throw Error('Expected seed or verify');
}finally{await prisma.$disconnect();}
