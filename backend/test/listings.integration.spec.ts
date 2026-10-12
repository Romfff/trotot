import '../src/config/load-env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcrypt';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ListingsService } from '../src/listings/listings.service.js';
import { HomestayAvailabilityService } from '../src/homestays/homestay-availability.service.js';
import { vietnamToday } from '../src/bookings/booking-dates.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { calculateStayPrice } from '../src/bookings/booking-pricing.js';
import { BookingIdempotencyService } from '../src/bookings/booking-idempotency.service.js';
import { BookingExpiryService } from '../src/bookings/booking-expiry.service.js';
import { BookingWorkerService } from '../src/bookings/booking-worker.service.js';
import { BookingsService } from '../src/bookings/bookings.service.js';
import { verifyHomestayQuote } from '../src/homestays/homestay-quote.js';
import { HomestayCalendarService,PUBLIC_CALENDAR_TTL_SECONDS } from '../src/homestays/homestay-calendar.service.js';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { RedisService } from '../src/redis/redis.service.js';
import { ApiEnvelopeInterceptor } from '../src/common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';
import { sprint2RateLimits } from '../src/common/sprint2-rate-limit.guard.js';
import { AppointmentsService } from '../src/appointments/appointments.service.js';
import { AppointmentWorkerService } from '../src/appointments/appointment-worker.service.js';
import { seedLocalListings, assertLocalDemoTarget } from '../prisma/local-listings-seed.js';
import { appendFinancialJournal } from '../src/finance/finance-journal.js';

// S2-01/03/04 + owner-approved D02/D03/D05/D09. Real DB/Redis, synthetic catalog/users only.
describe.skipIf(process.env.LISTINGS_INTEGRATION !== '1')('Sprint 2 listings with PostgreSQL/PostGIS/Redis', () => {
  const suffix = randomUUID().replaceAll('-', '');
  const sourceDatabaseUrl = process.env.DATABASE_URL!;
  let databaseName = `trotot_listing_test_${suffix}`;
  const redisPrefix = `listing-test:${suffix}:`;
  let admin: Pool;
  let database: Pool;
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let created = false;
  let sequence = 0;
  let host: Awaited<ReturnType<typeof account>>;
  let otherHost: Awaited<ReturnType<typeof account>>;
  let tenant: Awaited<ReturnType<typeof account>>;
  let reviewer: Awaited<ReturnType<typeof account>>;
  const input = {
    title: 'Integration fixture room', propertyType: 'PHONG_TRO', description: 'Not a production listing',
    addressDetail: 'Fixture address', provinceCode: '79', wardCode: '26740', latitude: 10.7725, longitude: 106.6578,
    monthlyPrice: 3500000, depositAmount: 3500000, areaSqm: 25.5, electricityCost: 3500,
    waterCost: 20000, waterUnit: 'M3', internetCost: 100000, garbageCost: 30000, parkingFee: 120000, videoUrl: null,
    contactPhone: '0990000000', allowPets: false, amenityIds: ['wifi'], imageUrls: [],
  };

  async function http(path: string, method = 'GET', body?: unknown, token?: string, key?:string) {
    const response = await fetch(`${base}/api/v1${path}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),...(key?{'idempotency-key':key}:{}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  async function account(role: string) {
    const user = await prisma.user.create({ data: {
      phone: `099${String(++sequence).padStart(7,'0')}`, fullName: 'Integration fixture', role,
      passwordHash: 'not-a-real-password-hash', status: 'ACTIVE', isPhoneVerified: true,
    } });
    const token = await new SignJWT({ tokenType: 'access', sessionVersion: user.sessionVersion, role })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuedAt().setExpirationTime('10m')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
    return { id: user.id, token };
  }
  async function submit(payload: object = input, owner = host) {
    return http('/properties/long-term', 'POST', payload, owner.token);
  }
  async function fixture(status = 'PUBLISHED', overrides: Record<string, unknown> = {}) {
    return prisma.property.create({ data: {
      hostId: host.id, slug: `fixture-${randomUUID()}`, title: input.title, description: input.description,
      propertyType: 'PHONG_TRO', rentalMode: 'LONG_TERM', addressDetail: input.addressDetail,
      provinceCode: input.provinceCode, wardCode: input.wardCode, latitude: input.latitude, longitude: input.longitude,
      status, ...overrides,
      longTermDetail: { create: { monthlyPrice: input.monthlyPrice, depositAmount: input.depositAmount, areaSqm: input.areaSqm,
        electricityCost: input.electricityCost, waterCost: input.waterCost, waterUnit: input.waterUnit,
        internetCost: input.internetCost, garbageCost: input.garbageCost, parkingFee: input.parkingFee, contactPhone: input.contactPhone } },
      amenities: { create: [{ amenityId: 'wifi' }] },
    } });
  }

  async function startDatabase() {
    const source = new URL(sourceDatabaseUrl);
    if (process.env.NODE_ENV === 'production' || !['localhost','127.0.0.1','[::1]'].includes(source.hostname)
      || !['localhost','127.0.0.1','::1'].includes(process.env.REDIS_HOST || 'localhost')) {
      throw new Error('Tests accept only local development PostgreSQL/Redis');
    }
    admin = new Pool({ connectionString: source.toString() });
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    source.pathname = `/${databaseName}`;
    process.env.DATABASE_URL = source.toString();
    process.env.NODE_ENV = 'test'; process.env.OTP_PROVIDER = 'mock'; process.env.REDIS_KEY_PREFIX = redisPrefix;
    process.env.JWT_ACCESS_SECRET = 'listing-integration-access-secret-32chars';
    process.env.HOMESTAY_QUOTE_SECRET = 'listing-integration-independent-quote-secret-32chars';
    process.env.BOOKING_ALLOW_UNCONFIGURED_PAYMENT='true';
    // Repeat deploy must be a no-op rather than re-creating/re-seeding tables.
    for (let attempt = 0; attempt < 2; attempt++) {
      await promisify(execFile)(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'], { env: process.env, timeout: 60_000 });
    }
    database = new Pool({ connectionString: source.toString() });
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalInterceptors(new ApiEnvelopeInterceptor()); app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0, '127.0.0.1'); base = await app.getUrl(); prisma = app.get(PrismaService);
    await prisma.addressProvince.createMany({ data: [{ code: '79', name: 'Fixture Province A' }, { code: '01', name: 'Fixture Province B' }] });
    await prisma.addressWard.createMany({ data: [{ code: '26740', name: 'Fixture Ward A', provinceCode: '79' }, { code: '00001', name: 'Fixture Ward B', provinceCode: '01' }] });
    await prisma.amenity.createMany({ data: [{ id: 'wifi', name: 'Fixture wifi' }, { id: 'air_cond', name: 'Fixture AC' }], skipDuplicates: true });
  }
  beforeAll(startDatabase, 120_000);

  it('S5 public search cache uses current publication/version and Host before returning cached records',async()=>{
    const first=await fixture(),second=await fixture('PUBLISHED',{hostId:otherHost.id});
    const client=app.get(RedisService).client,reads=vi.spyOn(prisma.property,'findMany');
    try{
      const path='/properties/long-term/search?maxPrice=4000000';
      const warm=await http(path);expect(warm.status).toBe(200);expect(warm.body.meta.total).toBe(2);
      reads.mockClear();expect((await http(path)).body).toEqual(warm.body);expect(reads).not.toHaveBeenCalled();
      await prisma.property.update({where:{id:first.id},data:{status:'HIDDEN',version:{increment:1}}});
      expect((await http(path)).body.data.map((x:{id:string})=>x.id)).toEqual([second.id]);
      await prisma.user.update({where:{id:otherHost.id},data:{status:'BANNED',sessionVersion:{increment:1}}});
      expect((await http(path)).body.meta.total).toBe(0);
      await prisma.user.update({where:{id:otherHost.id},data:{status:'ACTIVE'}});
      await prisma.longTermDetail.update({where:{propertyId:second.id},data:{monthlyPrice:5000000}});
      expect((await http(path)).body.meta.total).toBe(0);
      await prisma.longTermDetail.update({where:{propertyId:second.id},data:{monthlyPrice:3900000}});
      expect((await http(path)).body.data[0].monthlyPrice).toBe(3900000);
      expect((await client.keys(redisPrefix+'listing:search:v2:*')).length).toBeGreaterThan(0);
    }finally{reads.mockRestore();}
  });
  it('S5 public search falls back to authoritative DB when Redis cache is malformed or unavailable',async()=>{
    await fixture();const service=app.get(ListingsService),client=app.get(RedisService).client;
    const input={page:1,limit:20,sortBy:'newest' as const};
    const expected=JSON.parse(JSON.stringify(await service.search(input)));
    const get=vi.spyOn(client,'get').mockResolvedValue('{bad cache'),set=vi.spyOn(client,'set').mockRejectedValue(new Error('Synthetic cache unavailable'));
    try{expect(JSON.parse(JSON.stringify(await new ListingsService(prisma,app.get(RedisService)).search(input)))).toEqual(expected);get.mockRejectedValue(new Error('Synthetic cache unavailable'));
      expect(JSON.parse(JSON.stringify(await new ListingsService(prisma,app.get(RedisService)).search(input)))).toEqual(expected);
    }finally{get.mockRestore();set.mockRestore();}
  });
  it('S5 search coalesces cold reads and a rolled back hide keeps the cached public snapshot valid',async()=>{
    const room=await fixture(),service=app.get(ListingsService),input={page:1,limit:20,sortBy:'newest' as const};
    const reads=vi.spyOn(prisma,'$transaction');
    try{
      const results=await Promise.all(Array.from({length:10},()=>service.search(input)));
      expect(reads).toHaveBeenCalledTimes(1);
      expect(results.every(result=>result.meta.total===1&&result.data[0].id===room.id)).toBe(true);
      await expect(prisma.$transaction(async tx=>{
        await tx.property.update({where:{id:room.id},data:{status:'HIDDEN'}});throw new Error('Synthetic rollback');
      })).rejects.toThrow('Synthetic rollback');
      reads.mockClear();expect((await service.search(input)).data[0].id).toBe(room.id);expect(reads).not.toHaveBeenCalled();
    }finally{reads.mockRestore();}
  });
  it('S5 a write after the hot epoch read cannot store newer data under the old cache generation',async()=>{
    const room=await fixture(),service=app.get(ListingsService),client=app.get(RedisService).client;
    const get=vi.spyOn(client,'get').mockImplementationOnce(async()=>{
      await prisma.property.update({where:{id:room.id},data:{status:'HIDDEN'}});return null;
    }),set=vi.spyOn(client,'set');
    try{
      expect((await service.search({page:1,limit:20,sortBy:'newest'})).meta.total).toBe(0);
      expect(set.mock.calls.filter(call=>String(call[0]).startsWith('listing:search:v2:'))).toHaveLength(0);
      expect((await service.search({page:1,limit:20,sortBy:'newest'})).meta.total).toBe(0);
    }finally{get.mockRestore();set.mockRestore();}
  });
  it('S5 failed read transaction acknowledgement never publishes L1 or Redis cache',async()=>{
    await fixture();const service=new ListingsService(prisma,app.get(RedisService)),input={page:1,limit:20,sortBy:'newest' as const};
    const original=prisma.$transaction.bind(prisma),set=vi.spyOn(app.get(RedisService).client,'set');
    const transaction=vi.spyOn(prisma,'$transaction').mockImplementationOnce(async(...args)=>{
      await Reflect.apply(original,prisma,args);throw new Error('Synthetic read commit acknowledgement failure');
    });
    try{
      await expect(service.search(input)).rejects.toThrow('Synthetic read commit acknowledgement failure');
      expect(set.mock.calls.filter(call=>String(call[0]).startsWith('listing:search:v2:'))).toHaveLength(0);
      expect((service as unknown as {memoryRecords:Map<string,unknown>}).memoryRecords.size).toBe(0);
      expect((await service.search(input)).meta.total).toBe(1);
      expect(transaction).toHaveBeenCalledTimes(2);
    }finally{transaction.mockRestore();set.mockRestore();}
  });
  it('S5 cold filters reuse public records only in the same authoritative epoch and TTL',async()=>{
    const room=await fixture(),service=app.get(ListingsService),reads=vi.fn();
    const original=prisma.$transaction.bind(prisma);
    const transactions=vi.spyOn(prisma,'$transaction').mockImplementation((callback,options)=>Reflect.apply(original,prisma,[async(tx:Prisma.TransactionClient)=>{
      const property=new Proxy(tx.property,{get(target,key){
        if(key==='findMany')return (...args:unknown[])=>{reads();return Reflect.apply(target.findMany,target,args);};
        return Reflect.get(target,key);
      }});
      return Reflect.apply(callback,undefined,[new Proxy(tx,{get(target,key){return key==='property'?property:Reflect.get(target,key);}})]);
    },options]));
    const query={page:1,limit:20,sortBy:'newest' as const};
    try{
      await service.search({...query,maxPrice:4000000});reads.mockClear();
      expect((await service.search({...query,minPrice:3000000,maxPrice:4000000})).data[0].id).toBe(room.id);
      expect(reads).not.toHaveBeenCalled();
      const near=await service.search({...query,lat:input.latitude,lng:input.longitude,sortBy:'distance_asc'});
      const farther=await service.search({...query,lat:input.latitude,lng:input.longitude+0.01,sortBy:'distance_asc'});
      expect(farther.data[0].distanceMeters!).toBeGreaterThan(near.data[0].distanceMeters!);
      expect(reads).not.toHaveBeenCalled();
      const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+60001);
      try{await service.search({...query,minPrice:3000001});expect(reads).toHaveBeenCalledTimes(1);}
      finally{clock.mockRestore();}
      reads.mockClear();
      await prisma.property.update({where:{id:room.id},data:{title:'Changed public title'}});
      expect((await service.search({...query,maxPrice:3900000})).data[0].title).toBe('Changed public title');
      expect(reads).toHaveBeenCalledTimes(1);
      await prisma.propertyImage.create({data:{propertyId:room.id,position:0,url:'https://example.com/synthetic.jpg'}});
      expect((await service.search({...query,minPrice:3100000})).data[0].images).toHaveLength(1);
      await prisma.user.update({where:{id:host.id},data:{status:'BANNED'}});
      expect((await service.search({...query,maxPrice:3800000})).meta.total).toBe(0);
      await prisma.user.update({where:{id:host.id},data:{status:'ACTIVE'}});
      await prisma.property.update({where:{id:room.id},data:{status:'HIDDEN'}});
      expect((await service.search({...query,maxPrice:3700000})).meta.total).toBe(0);
    }finally{transactions.mockRestore();}
  });
  it('S5 public record L1 remains bounded across more than 256 distinct records',async()=>{
    const properties=Array.from({length:257},()=>({id:randomUUID(),hostId:host.id,slug:`cache-${randomUUID()}`,title:'Synthetic cache room',description:'Fixture only',propertyType:'PHONG_TRO',rentalMode:'LONG_TERM',listingPlan:'PAID',addressDetail:'Fixture',provinceCode:'79',wardCode:'26740',latitude:10.7725,longitude:106.6578,status:'PUBLISHED'}));
    await prisma.property.createMany({data:properties});
    await prisma.longTermDetail.createMany({data:properties.map(p=>({propertyId:p.id,monthlyPrice:3500000,depositAmount:3500000,areaSqm:25,electricityCost:3500,waterCost:20000,waterUnit:'M3',internetCost:100000,garbageCost:30000,parkingFee:120000,contactPhone:'0990000000'}))});
    const service=app.get(ListingsService),seen=new Set<string>();
    for(let page=1;page<=3;page++){const result=await service.search({page,limit:100,sortBy:'newest'});
      result.data.forEach(record=>seen.add(record.id));
      expect((service as unknown as {memoryRecords:Map<string,unknown>}).memoryRecords.size).toBeLessThanOrEqual(256);
    }
    expect(seen.size).toBe(257);
  });
  it('S5 cold filter metadata and rows need only two snapshot SQL reads including empty pagination',async()=>{
    await fixture();const service=new ListingsService(prisma,app.get(RedisService));
    const query={page:1,limit:20,sortBy:'newest' as const,minPrice:3000009};
    const original=prisma.$transaction.bind(prisma),sqlReads=vi.fn();
    const transactions=vi.spyOn(prisma,'$transaction').mockImplementation((callback,options)=>Reflect.apply(original,prisma,[async(tx:Prisma.TransactionClient)=>{
      const traced=new Proxy(tx,{get(target,key){
        if(key==='$queryRaw')return (...args:unknown[])=>{sqlReads();return Reflect.apply(target.$queryRaw,target,args);};
        return Reflect.get(target,key);
      }});
      return Reflect.apply(callback,undefined,[traced]);
    },options]));
    try{
      const result=await service.search(query);expect(result.meta.total).toBe(1);expect(result.data).toHaveLength(1);
      expect(sqlReads).toHaveBeenCalledTimes(2);sqlReads.mockClear();
      const empty=await service.search({...query,page:2});expect(empty.meta).toMatchObject({page:2,total:1,totalPages:1});expect(empty.data).toEqual([]);
      expect(sqlReads).toHaveBeenCalledTimes(2);
    }finally{transactions.mockRestore();}
  });
  it.skipIf(process.env.LISTINGS_LOAD!=='1')('S5 local load measures real public search at scheduled 500 requests per second',async()=>{
    // Synthetic paid listings, not FREE quota bypass; 250 signed test edge identities.
    const properties=Array.from({length:1000},(_,i)=>({id:randomUUID(),hostId:host.id,slug:`load-${i}-${randomUUID()}`,title:'Synthetic load room',description:'Fixture only',propertyType:'PHONG_TRO',rentalMode:'LONG_TERM',listingPlan:'PAID',addressDetail:'Fixture only',provinceCode:'79',wardCode:'26740',latitude:10.7725,longitude:106.6578,status:'PUBLISHED'}));
    await prisma.property.createMany({data:properties});
    await prisma.longTermDetail.createMany({data:properties.map(p=>({propertyId:p.id,monthlyPrice:3500000,depositAmount:3500000,areaSqm:25,electricityCost:3500,waterCost:20000,waterUnit:'M3',internetCost:100000,garbageCost:30000,parkingFee:120000,contactPhone:'0990000000'}))});
    const original=process.env.BFF_PROXY_SECRET;process.env.BFF_PROXY_SECRET='load-fixture-only-bff-secret-at-least-32chars';
    const path='/api/v1/properties/long-term/search',query='?minPrice=3000000&maxPrice=4000000';
    // Keep the load generator outside the compiled API event loop. Vitest's
    // source transform/instrumentation is not the production serving path.
    const reserved=createServer();reserved.listen(0,'127.0.0.1');await once(reserved,'listening');
    const port=(reserved.address() as {port:number}).port;await new Promise<void>(done=>reserved.close(()=>done()));
    const profile=process.env.LISTINGS_LOAD_PROFILE==='1';let profileTail='',profileLast:unknown,apiError='';
    const api=spawn(process.execPath,[...(profile?['--import',pathToFileURL(resolve('test/search-load-profile.mjs')).href]:[]),resolve('dist/main.js')],{cwd:resolve('.'),
      env:{...process.env,PORT:String(port),LISTEN_HOST:'127.0.0.1',REALTIME_ENABLED:'false'},stdio:['ignore',profile?'pipe':'ignore',profile?'pipe':'ignore'],windowsHide:true});
    api.stderr?.on('data',chunk=>{apiError=(apiError+String(chunk)).slice(-4096);});
    api.stdout?.on('data',chunk=>{profileTail+=String(chunk);const lines=profileTail.split('\n');profileTail=lines.pop()!.slice(-8192);
      for(const line of lines)if(line.startsWith('S5_PROFILE ')){try{profileLast=JSON.parse(line.slice(11));}catch{/* Ignore incomplete diagnostic lines. */}}});
    const measuredBase=`http://127.0.0.1:${port}`;
    try{
      let ready=false;for(let i=0;i<100;i++){
        if(api.exitCode!==null){
          // Startup diagnostics only: redact connection strings and known secrets.
          let diagnostic=apiError.replace(/\b(?:postgres(?:ql)?|redis|https?):\/\/\S+/gi,'[redacted URL]');
          for(const [name,value]of Object.entries(process.env))if(value&&/(SECRET|PASSWORD|TOKEN|KEY)/i.test(name))diagnostic=diagnostic.replaceAll(value,'[redacted]');
          throw new Error('Compiled API exited'+(profile?': '+diagnostic:''));
        }
        if(await fetch(measuredBase+'/api/v1/health').then(r=>r.ok,()=>false)){ready=true;break;}
        await new Promise(done=>setTimeout(done,100));
      }
      expect(ready).toBe(true);expect((await fetch(measuredBase+path+query)).status).toBe(200);
      const result=await promisify(execFile)(process.execPath,[resolve('test/search-load-generator.mjs')],{
        env:{...process.env,LOAD_API_BASE:measuredBase},timeout:90000,windowsHide:true,
      }).catch((error:{code?:unknown;signal?:unknown;killed?:unknown;stderr?:string})=>{
        throw new Error(`Load generator failed: exit=${String(error.code)}, signal=${String(error.signal)}, killed=${Boolean(error.killed)}, stderrBytes=${error.stderr?.length??0}, apiExit=${String(api.exitCode)}`);
      });
      const line=result.stdout.split('\n').find(line=>line.startsWith('S5_LOAD_RESULT '));expect(line).toBeDefined();
      const report=JSON.parse(line!.slice(15));
      if(profile){await new Promise(done=>setTimeout(done,1100));expect(profileLast).toBeDefined();console.log('S5 server profile '+JSON.stringify(profileLast));}
      console.log(JSON.stringify({...report,profile}));expect(report.transportErrors).toBe(0);expect(report.statuses).toEqual({'200':report.count});expect(report.maxSchedulingLagMs).toBeLessThan(50);expect(report.p95).toBeLessThan(150);
    }finally{if(api.exitCode===null){const closed=once(api,'close');api.kill();await closed;}
      if(original===undefined)delete process.env.BFF_PROXY_SECRET;else process.env.BFF_PROXY_SECRET=original;}
  },120000);

  beforeEach(async () => {
    // Only the dedicated generated test DB is touched, never the user's database.
    if (!created || !/^trotot_listing_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Unsafe cleanup target');
    // Financial fixtures retain immutable journals and booking FKs. Dispose only
    // this owned DB; never delete journals or disable their append-only guards.
    if (await prisma.financeJournal.count()) {
      await app.close(); await database.end();
      await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      created = false; await admin.end();
      databaseName = `trotot_listing_test_${randomUUID().replaceAll('-', '')}`;
      await startDatabase();
    }
    await database.query('DELETE FROM listing_moderation_events');
    await database.query('DELETE FROM homestay_policy_audit');
    await database.query('DELETE FROM address_catalog_metadata');
    await prisma.bookingIdempotency.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.calendarPricing.deleteMany();
    await prisma.homestayUnit.deleteMany();
    await prisma.appointmentNotification.deleteMany();
    await prisma.appointmentIdempotency.deleteMany();
    await prisma.viewingAppointment.deleteMany();
    await prisma.property.deleteMany();
    // Independent cases get an independent rate window in this owned test namespace.
    const redis = app.get(RedisService).client;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${redisPrefix}sprint2:limit:*`, 'COUNT', 100);
      cursor = next;
      if (keys.length) await redis.del(...keys.map(key => key.slice(redisPrefix.length)));
    } while (cursor !== '0');
    host = await account('HOST'); otherHost = await account('HOST'); tenant = await account('TENANT'); reviewer = await account('ADMIN');
  },120_000);

  afterAll(async () => {
    try {
      if (app) {
        const redis = app.get(RedisService).client;
        let cursor = '0'; const keys: string[] = [];
        do {
          const result = await redis.scan(cursor, 'MATCH', `${redisPrefix}*`, 'COUNT', 100);
          cursor = result[0]; keys.push(...result[1]);
        } while (cursor !== '0');
        if (keys.length) await redis.del(...keys.map(key => key.slice(redisPrefix.length)));
      }
    } finally {
      await app?.close(); await database?.end();
      if (created && /^trotot_listing_test_[a-f0-9]{32}$/.test(databaseName)) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await admin?.end();
    }
  }, 30_000);

  it('local demo data is usable through real listing/homestay APIs and reruns preserve user edits',async()=>{
    assertLocalDemoTarget({...process.env,ALLOW_DEV_SEED:'true'});
    await prisma.addressWard.upsert({where:{code:'27169'},create:{code:'27169',name:'Phường Diên Hồng',provinceCode:'79'},update:{}});
    expect(await seedLocalListings(prisma)).toEqual({created:8,total:8});
    expect(await seedLocalListings(prisma)).toEqual({created:0,total:8});
    const properties=await prisma.property.findMany({where:{slug:{startsWith:'demo-local-trotot-'}},include:{images:true,homestayUnits:true}});
    expect(properties).toHaveLength(8);
    for(const p of properties){expect(p.wardCode).toBe('27169');expect(p.districtCode).toBeNull();expect(p.title).toContain('[DEMO]');expect(p.images).toHaveLength(3);}
    const search=await http('/properties/long-term/search?limit=4');
    expect(search.status).toBe(200);expect(search.body.data).toHaveLength(4);
    expect(JSON.stringify(search.body)).not.toContain('09999998');
    const stays=await http('/homestays/search?limit=4');
    expect(stays.status).toBe(200);expect(stays.body.data).toHaveLength(4);
    for(const stay of stays.body.data){expect(stay.media).toHaveLength(1);expect(stay.basePricePerNight).toBeGreaterThan(0);}
    const instant=stays.body.data.find((u:{instantBook:boolean})=>u.instantBook);
    const detail=await http(`/homestays/${instant.slug}`);expect(detail.status).toBe(200);expect(detail.body.data.media).toHaveLength(3);
    const date=new Date(vietnamToday()+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+3);
    const checkIn=date.toISOString().slice(0,10);date.setUTCDate(date.getUTCDate()+2);const checkOut=date.toISOString().slice(0,10);
    const quote=await http(`/homestays/check-availability?unitId=${instant.id}&checkIn=${checkIn}&checkOut=${checkOut}&adults=1&children=0`);
    expect(quote.status).toBe(200);expect(quote.body.data.isAvailable).toBe(true);expect(quote.body.data.priceBreakdown.totalAmount).toBeGreaterThan(0);
    const room=properties.find(p=>p.rentalMode==='LONG_TERM')!;
    expect((await http(`/properties/${room.slug}`)).status).toBe(200);
    await prisma.property.update({where:{id:room.id},data:{title:'[DEMO] Owner edit',status:'HIDDEN'}});
    expect(await seedLocalListings(prisma)).toEqual({created:0,total:8});
    expect(await prisma.property.findUnique({where:{id:room.id}})).toMatchObject({title:'[DEMO] Owner edit',status:'HIDDEN'});
    expect((await http(`/properties/${room.slug}`)).status).toBe(404);
    expect((await http('/properties/long-term/search?limit=4')).body.data).toHaveLength(3);
  },30_000);

  it('local demo seed refuses an account collision and rolls back all additions',async()=>{
    const demo=await prisma.user.findUniqueOrThrow({where:{phone:'0999999822'}});
    const before=demo.passwordHash;
    await prisma.user.update({where:{id:demo.id},data:{fullName:'Other fixture account'}});
    await expect(seedLocalListings(prisma)).rejects.toThrow('identifier collision');
    expect(await prisma.property.count()).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({where:{id:demo.id}})).passwordHash).toBe(before);
    // Restore only this test-owned user, never any application database account.
    await prisma.user.update({where:{id:demo.id},data:{fullName:demo.fullName}});
  },30_000);

  async function homestayFixture(propertyOverrides: Record<string, unknown> = {}, unitOverrides: Record<string, unknown> = {}) {
    const property = await prisma.property.create({ data: {
      hostId: host.id, slug: `homestay-fixture-${randomUUID()}`, title: 'Homestay integration fixture',
      description: 'Synthetic data only', propertyType: 'HOMESTAY', rentalMode: 'SHORT_TERM',
      addressDetail: 'Fixture', provinceCode: '79', wardCode: '26740', latitude: 10.7, longitude: 106.6,
      status: 'PUBLISHED', ...propertyOverrides,
    } });
    const unit = await prisma.homestayUnit.create({ data: {
      propertyId: property.id, unitName: 'Fixture unit', maxAdults: 2, maxChildren: 1,
      bedrooms: 1, bathrooms: 1, basePricePerNight: '600000', weekendPricePerNight: '750000', cleaningFee: '150000',
      checkInTime: new Date('1970-01-01T14:00:00Z'), checkOutTime: new Date('1970-01-01T12:00:00Z'),
      cancellationPolicy: 'FLEXIBLE', instantBook: true, status: 'PUBLISHED', ...unitOverrides,
    } });
    return { property, unit };
  }

  describe('S2-08 owner-approved contact reveal', () => {
    it('removes contact data from search/detail and ignores legacy cached contact payloads', async () => {
      const room = await fixture();
      const redis = app.get(RedisService).client;
      await redis.set(`listing:public:${room.id}:v1`, JSON.stringify({ contactPhone: 'legacy-secret-number', contactZalo: 'legacy-zalo' }), 'EX', 60);
      for (const result of [await http('/properties/long-term/search'), await http(`/properties/${room.slug}`), await http(`/properties/${room.slug}`)]) {
        expect(result.status).toBe(200);
        expect(JSON.stringify(result.body)).not.toMatch(/contactPhone|contactZalo|legacy-secret-number|0990000000/);
      }
      const response = await fetch(`${base}/api/v1/properties/${room.slug}/contact`);
      const revealed = {status:response.status,body:await response.json(),headers:response.headers};
      expect(revealed.status).toBe(200); expect(revealed.headers.get('cache-control')).toBe('no-store');
      expect(revealed.body.data).toEqual({contactPhone: input.contactPhone, contactZalo: null});
      expect(await prisma.viewingAppointment.count()).toBe(0); expect(await prisma.appointmentNotification.count()).toBe(0);
    });
    it('only reveals published, undeleted long-term records', async () => {
      for (const status of ['PENDING_REVIEW','REJECTED','HIDDEN','EXPIRED']) {
        const room = await fixture(status); expect((await http(`/properties/${room.slug}/contact`)).status).toBe(404);
      }
      const deleted = await fixture('PUBLISHED', {deletedAt:new Date()}); expect((await http(`/properties/${deleted.slug}/contact`)).status).toBe(404);
      const short = await homestayFixture(); expect((await http(`/properties/${short.property.slug}/contact`)).status).toBe(404);
      const room = await fixture(); await http(`/properties/${room.slug}/contact`);
      await prisma.property.update({where:{id:room.id},data:{status:'HIDDEN'}});
      expect((await http(`/properties/${room.slug}/contact`)).status).toBe(404);
    });
    it('accepts every existing role but rejects forged, revoked and expired credentials rather than falling back to Guest', async () => {
      const room = await fixture(), path = `/properties/${room.slug}/contact`;
      for (const account of [tenant, host, reviewer]) expect((await http(path, 'GET', undefined, account.token)).status).toBe(200);
      expect((await http(path, 'GET', undefined, 'forged-token')).status).toBe(401);
      await prisma.user.update({where:{id:tenant.id},data:{sessionVersion:{increment:1}}});
      expect((await http(path, 'GET', undefined, tenant.token)).status).toBe(401);
      const expired = await new SignJWT({tokenType:'access',sessionVersion:1}).setProtectedHeader({alg:'HS256'}).setSubject(host.id).setExpirationTime(0).sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
      expect((await http(path, 'GET', undefined, expired)).status).toBe(401);
    });
    it('enforces the account limit across listings, returns Retry-After and expires anonymized counters', async () => {
      const first = await fixture(), second = await fixture();
      for (let i=0;i<5;i++) expect((await http(`/properties/${i%2 ? first.slug : second.slug}/contact`, 'GET', undefined, tenant.token)).status).toBe(200);
      const response = await fetch(`${base}/api/v1/properties/${first.slug}/contact`,{headers:{authorization:`Bearer ${tenant.token}`}});
      const denied = {status:response.status,body:await response.json(),headers:response.headers};
      expect(denied.status).toBe(429); expect(denied.headers.get('retry-after')).toBe('60');
      expect(denied.body.errorCode).toBe('RATE_LIMITED'); expect(JSON.stringify(denied.body)).not.toContain(input.contactPhone);
      const redis=app.get(RedisService).client;
      const keys=await redis.keys(`${redisPrefix}sprint2:limit:contact:*`);
      expect(keys.length).toBe(2);
      for (const key of keys) {expect(key).not.toContain(tenant.id);expect(key).not.toContain('127.0.0.1');expect(await redis.ttl(key.slice(redisPrefix.length))).toBeGreaterThan(0);}
    });
    it('atomically caps simultaneous anonymous reveals by IP even with spoofed forwarding headers', async () => {
      const room=await fixture();
      const responses=await Promise.all(Array.from({length:12},(_,index)=>fetch(`${base}/api/v1/properties/${room.slug}/contact`,{headers:{'x-forwarded-for':`203.0.113.${index+1}`}})));
      expect(responses.filter(response=>response.status===200)).toHaveLength(10);
      expect(responses.filter(response=>response.status===429)).toHaveLength(2);
      for(const denied of responses.filter(response=>response.status===429)) expect(denied.headers.get('retry-after')).toBe('60');
    });
    it('fails closed if the contact limiter cannot reach Redis and documents the envelope', async () => {
      const room=await fixture(); const redis=app.get(RedisService);
      const original=redis.incrementWithTtl.bind(redis);
      const spy=vi.spyOn(redis,'incrementWithTtl').mockImplementation((key,ttl)=>key.includes(':contact:') ? Promise.reject(new Error('fixture unavailable')) : original(key,ttl));
      try {const result=await http(`/properties/${room.slug}/contact`);expect(result.status).toBe(503);expect(result.body.errorCode).toBe('RATE_LIMIT_UNAVAILABLE');expect(JSON.stringify(result.body)).not.toContain(input.contactPhone);}
      finally {spy.mockRestore();}
      const spec=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
      expect(spec.paths['/api/v1/properties/{slug}/contact'].get?.responses['200']).toHaveProperty('content.application/json.schema.properties.data.properties.contactPhone');
    });
  });

  it.skipIf(process.env.LISTINGS_CONTACT_BROWSER !== '1')('contact reveal real BFF/browser/DB keeps numbers out of SSR and applies the account counter', async () => {
    const room=await fixture();const password='ContactBrowserFixture123!';
    await prisma.user.update({where:{id:tenant.id},data:{passwordHash:await bcrypt.hash(password,4)}});
    const phone=(await prisma.user.findUniqueOrThrow({where:{id:tenant.id}})).phone;
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,dir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(dir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:dir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    let browser:{close():Promise<void>}|undefined;
    try{
      let ready=false;for(let attempt=0;attempt<100;attempt++){if(frontend.exitCode!==null)throw new Error('Owned contact test frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const page=await launched.newPage({viewport:{width:375,height:900}});
      const detailUrl=`${origin}/thue-phong-tro/${room.slug}`;
      const html=await fetch(detailUrl).then(response=>response.text());
      expect(html.includes(input.contactPhone)).toBe(false);expect(html.includes('contactPhone')).toBe(false);
      await page.goto(detailUrl);expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
      await page.getByRole('button',{name:'Xem số liên hệ',exact:true}).click();await page.locator(`a[href="tel:${input.contactPhone}"]`).waitFor();
      await page.goto(origin+'/login');await page.locator('[name="phone"]').fill(phone);await page.locator('[name="password"]').fill(password);
      await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.goto(detailUrl);await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).waitFor();
      const requested=page.waitForRequest((request:{url():string})=>request.url().endsWith('/contact'));
      await page.getByRole('button',{name:'Xem số liên hệ',exact:true}).click();
      const authorization=(await requested).headers().authorization;
      expect(typeof authorization==='string'&&authorization.startsWith('Bearer ')).toBe(true);
      await page.locator(`a[href="tel:${input.contactPhone}"]`).waitFor();
      for(let i=0;i<4;i++)expect((await fetch(`${origin}/api/listings/properties/${room.slug}/contact`,{headers:{authorization}})).status).toBe(200);
      const denied=await fetch(`${origin}/api/listings/properties/${room.slug}/contact`,{headers:{authorization}});
      expect(denied.status).toBe(429);expect(denied.headers.get('retry-after')).toBe('60');expect(denied.headers.get('cache-control')).toBe('no-store');
      expect((await denied.text()).includes(input.contactPhone)).toBe(false);
      await prisma.property.update({where:{id:room.id},data:{status:'HIDDEN',version:{increment:1}}});
      expect((await fetch(`${origin}/api/listings/properties/${room.slug}/contact`)).status).toBe(404);
      await page.goto(origin+'/account');await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.waitForURL(origin+'/');
      expect(await page.locator('a[href^="tel:"]').count()).toBe(0);
      expect(await prisma.appointmentNotification.count()).toBe(0);expect(await prisma.viewingAppointment.count()).toBe(0);
    }finally{await browser?.close();if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}
  },90_000);

  describe('D12 cost-estimate endpoint', () => {
    it('returns exact Decimal rates, rounded line totals and separate deposit without storing usage', async () => {
      const record = await fixture();
      await prisma.longTermDetail.update({where:{propertyId:record.id},data:{electricityCost:'4.9',waterCost:'5.1',internetCost:'0.49',garbageCost:'0.51',parkingFee:'0.5',depositAmount:'10.5'}});
      const result=await http(`/properties/${record.slug}/cost-estimate?electricityKwh=0.1&waterM3=0.1&vehicles=1&occupants=bad`);
      expect(result.status).toBe(200);
      expect(result.body.data).toMatchObject({totalMonthly:3500003,deposit:11,missingInputs:[],missingCosts:[],isComplete:true});
      expect(result.body.data.lines.map((line:{amount:number})=>line.amount)).toEqual([3500000,0,1,0,1,1]);
      expect(result.body.data.lines[1]).toMatchObject({unitPrice:'4.9',quantity:0.1,status:'COMPUTED',unit:'VND/KWH'});
      expect(result.body.data.lines[5]).toMatchObject({unitPrice:'0.5',unit:'VND/VEHICLE/MONTH'});
      expect(JSON.stringify(result.body)).not.toContain('contactPhone');expect(JSON.stringify(result.body)).not.toContain('hostId');
      expect(await prisma.appointmentNotification.count()).toBe(0);
      expect(await prisma.viewingAppointment.count()).toBe(0);
      const unchanged=await prisma.longTermDetail.findUniqueOrThrow({where:{propertyId:record.id}});expect(unchanged.electricityCost.toString()).toBe('4.9');
    });
    it('uses PERSON water, does not invent usage, and reflects price edits and hidden status immediately', async () => {
      const record=await fixture();
      const path=`/properties/${record.slug}/cost-estimate`;
      expect((await http(path)).body.data).toMatchObject({totalMonthly:3630000,missingInputs:['electricityKwh','waterM3','vehicles'],isComplete:false});
      await prisma.longTermDetail.update({where:{propertyId:record.id},data:{waterUnit:'PERSON',waterCost:'20000.5',parkingFee:0}});
      const response=await http(path+'?occupants=2&waterM3=bad');
      expect(response.status).toBe(200);expect(response.body.data.lines[2]).toMatchObject({unitPrice:'20000.5',quantity:2,amount:40001});
      expect(response.body.data.lines[5]).toMatchObject({status:'NEEDS_INPUT',amount:null});
      expect((await http(path+'?occupants=2&vehicles=0')).body.data.lines[5]).toMatchObject({status:'FREE',amount:0});
      await prisma.property.update({where:{id:record.id},data:{status:'HIDDEN'}});
      expect((await http(path)).status).toBe(404);
    });
    it('rejects unpublished/deleted/non-long-term records and malformed input with errors[]', async () => {
      for(const status of ['PENDING_REVIEW','REJECTED','HIDDEN','EXPIRED']){
        const record=await fixture(status);expect((await http(`/properties/${record.slug}/cost-estimate`)).status).toBe(404);
      }
      const deleted=await fixture('PUBLISHED',{deletedAt:new Date()});expect((await http(`/properties/${deleted.slug}/cost-estimate`)).status).toBe(404);
      const short=await homestayFixture();expect((await http(`/properties/${short.property.slug}/cost-estimate`)).status).toBe(404);
      const record=await fixture();
      for(const query of ['electricityKwh=1.01','waterM3=-1','vehicles=1.0','vehicles=11','electricityKwh=10000.1','waterM3=1000.1','electricityKwh=1&electricityKwh=2']){
        const result=await http(`/properties/${record.slug}/cost-estimate?${query}`);expect(result.status).toBe(400);
        expect(result.body).toMatchObject({success:false,errorCode:'INVALID_ESTIMATE_USAGE',errors:expect.arrayContaining([expect.objectContaining({field:expect.any(String),message:expect.any(String)})])});
      }
      expect((await http(`/properties/${record.slug}/cost-estimate?extra=1`)).status).toBe(400);
    });
    it('uses IP rate limiting with Retry-After and exposes the approved Swagger schemas', async () => {
      const record=await fixture();const redis=app.get(RedisService).client;
      // One successful request discovers the transport bucket in the owned namespace.
      expect((await http(`/properties/${record.slug}/cost-estimate`)).status).toBe(200);
      const keys=await redis.keys(`${redisPrefix}sprint2:limit:ip:*`);
      expect(keys).toHaveLength(1);
      for(const bucket of keys) await redis.set(bucket.slice(redisPrefix.length),String(sprint2RateLimits.ip),'EX',60);
      const response=await fetch(`${base}/api/v1/properties/${record.slug}/cost-estimate`);
      expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('60');
      const spec=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('D12 fixture').setVersion('1').build());
      expect(spec.paths['/api/v1/properties/{slug}/cost-estimate']?.get?.parameters).toHaveLength(5);
      expect(spec.components?.schemas?.CostEstimateLineDto).toMatchObject({properties:{unitPrice:{type:'string',nullable:true},amount:{type:'integer',nullable:true}}});
    });
  });

  function appointmentInput(propertyId:string) {
    const scheduledDate=vietnamToday(new Date(Date.now()+2*86400000));
    return {propertyId,tenantName:'Appointment synthetic guest',tenantPhone:'0990000011',scheduledDate,scheduledTime:'15:30:00',notes:'Synthetic appointment'};
  }
  async function createAppointment(propertyId:string,actor=tenant,key=randomUUID()) {
    return http('/appointments','POST',appointmentInput(propertyId),actor.token,key);
  }
  it('appointments: creates with atomic notification, exact idempotency replay and private ownership',async()=>{
    const property=await fixture(),body=appointmentInput(property.id),key=randomUUID();
    const created=await http('/appointments','POST',body,tenant.token,key);
    expect(created.status).toBe(201);expect(created.body.data).toMatchObject({propertyId:property.id,scheduledDate:body.scheduledDate,scheduledTime:'15:30:00',status:'PENDING',cancelledBy:null});
    expect(created.body.data.tenantPhone).toBeUndefined();expect(created.body.data.tenantName).toBeUndefined();
    expect(await http('/appointments','POST',body,tenant.token,key)).toEqual(created);
    const changed=await http('/appointments','POST',{...body,notes:'different'},tenant.token,key);
    expect(changed.status).toBe(409);expect(changed.body.errorCode).toBe('IDEMPOTENCY_KEY_REUSED');
    const id=created.body.data.id,otherTenant=await account('TENANT');
    expect((await http(`/appointments/${id}`,'GET',undefined,otherTenant.token)).status).toBe(404);
    expect((await http(`/host/appointments/${id}`,'GET',undefined,otherHost.token)).status).toBe(404);
    expect((await http(`/host/appointments/${id}`,'GET',undefined,tenant.token)).status).toBe(403);
    expect((await http(`/host/appointments/${id}`,'GET',undefined,host.token)).body.data).toMatchObject({tenantName:body.tenantName,tenantPhone:body.tenantPhone});
    const list=await http('/appointments?page=1&limit=20&status=PENDING','GET',undefined,tenant.token);
    expect(list.body.meta).toMatchObject({page:1,limit:20,total:1});expect(list.body.data).toHaveLength(1);
    const notifications=await http('/notifications','GET',undefined,host.token);
    expect(notifications.body.meta.unreadCount).toBe(1);expect(notifications.body.data[0].message).not.toContain(body.tenantPhone);
    const notificationId=notifications.body.data[0].id;
    expect((await http(`/notifications/${notificationId}/read`,'POST',{},otherHost.token)).status).toBe(404);
    expect((await http(`/notifications/${notificationId}/read`,'POST',{},host.token)).status).toBe(200);
    expect((await http('/notifications','GET',undefined,host.token)).body.meta.unreadCount).toBe(0);
  });
  it('appointments: validates UUID, roles, missing keys, times and unavailable listings without saving failures',async()=>{
    const property=await fixture(),body=appointmentInput(property.id);
    expect((await http('/appointments','POST',body,tenant.token)).status).toBe(400);
    expect((await http('/appointments','POST',body,host.token,randomUUID())).status).toBe(403);
    expect((await http('/appointments','POST',{...body,scheduledDate:'2026-02-30'},tenant.token,randomUUID())).status).toBe(400);
    expect((await http('/appointments','POST',{...body,scheduledTime:'15:15:00'},tenant.token,randomUUID())).status).toBe(400);
    const invalidTime=await http('/appointments','POST',{...body,scheduledTime:'10:46:00'},tenant.token,randomUUID());
    expect(invalidTime.status).toBe(400);
    expect(invalidTime.body).toMatchObject({success:false,errorCode:'APPOINTMENT_TIME_NOT_ALLOWED',message:expect.stringContaining('theo bước 30 phút')});
    expect((await http('/appointments/not-a-uuid','GET',undefined,tenant.token)).status).toBe(400);
    await prisma.property.update({where:{id:property.id},data:{isAvailable:false}});
    const key=randomUUID();expect((await http('/appointments','POST',body,tenant.token,key)).status).toBe(409);
    expect(await prisma.appointmentIdempotency.count({where:{userId:tenant.id}})).toBe(0);
    await prisma.property.update({where:{id:property.id},data:{isAvailable:true}});
    expect((await http('/appointments','POST',body,tenant.token,key)).status).toBe(201);
    for(const status of ['PENDING_REVIEW','HIDDEN','REJECTED']) {
      const hidden=await fixture(status);expect((await createAppointment(hidden.id)).status).toBe(409);
    }
  });
  it('appointments: concurrent creates protect active pair, Tenant quota and property quota in DB',async()=>{
    const property=await fixture();
    const samePair=await Promise.all([createAppointment(property.id),createAppointment(property.id)]);
    expect(samePair.map(r=>r.status).sort()).toEqual([201,409]);expect(samePair.find(r=>r.status===409)?.body.errorCode).toBe('APPOINTMENT_ALREADY_EXISTS');
    for(let i=0;i<3;i++) expect((await createAppointment((await fixture()).id)).status).toBe(201);
    const rooms=await Promise.all([fixture(),fixture()]);
    expect((await Promise.all(rooms.map(room=>createAppointment(room.id)))).map(r=>r.status).sort()).toEqual([201,409]);
    expect(await prisma.viewingAppointment.count({where:{tenantId:tenant.id,status:'PENDING'}})).toBe(5);
    const old=process.env.APPOINTMENT_PROPERTY_PENDING_LIMIT;process.env.APPOINTMENT_PROPERTY_PENDING_LIMIT='1';
    try {
      const capped=await fixture(),a=await account('TENANT'),b=await account('TENANT');
      expect((await Promise.all([createAppointment(capped.id,a),createAppointment(capped.id,b)])).map(r=>r.status).sort()).toEqual([201,409]);
      expect(await prisma.viewingAppointment.count({where:{propertyId:capped.id,status:'PENDING'}})).toBe(1);
    } finally {if(old===undefined) delete process.env.APPOINTMENT_PROPERTY_PENDING_LIMIT;else process.env.APPOINTMENT_PROPERTY_PENDING_LIMIT=old;}
  });
  it('appointments: duplicate in-flight key returns 409 and later replays success',async()=>{
    const room=await fixture(),body=appointmentInput(room.id),key=randomUUID();
    const connection=await database.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([tenant.id,'POST /appointments',key])]);
      const busy=await http('/appointments','POST',body,tenant.token,key);
      expect(busy.status).toBe(409);expect(busy.body.errorCode).toBe('IDEMPOTENCY_IN_PROGRESS');
      await connection.query('ROLLBACK');
      expect((await http('/appointments','POST',body,tenant.token,key)).status).toBe(201);
    } finally {await connection.query('ROLLBACK');connection.release();}
  });
  it('appointments: notification failure rolls back create and idempotency result',async()=>{
    const room=await fixture();
    await database.query(`CREATE FUNCTION fail_notification_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic notification failure'; END; $$`);
    await database.query(`CREATE TRIGGER fail_notification_fixture BEFORE INSERT ON appointment_notifications FOR EACH ROW EXECUTE FUNCTION fail_notification_fixture()`);
    try {
      expect((await createAppointment(room.id)).status).toBe(500);
      expect(await prisma.viewingAppointment.count({where:{propertyId:room.id}})).toBe(0);
      expect(await prisma.appointmentIdempotency.count({where:{userId:tenant.id}})).toBe(0);
    } finally {await database.query('DROP TRIGGER fail_notification_fixture ON appointment_notifications');await database.query('DROP FUNCTION fail_notification_fixture()');}
  });
  it('appointments: conditional actions, hidden listing processing, cancelledBy and stale response are correct',async()=>{
    const room=await fixture(),created=await createAppointment(room.id),id=created.body.data.id;
    await prisma.property.update({where:{id:room.id},data:{status:'HIDDEN'}});
    const results=await Promise.all(['accept','reject'].map(action=>http(`/host/appointments/${id}/${action}`,'POST',{expectedStatus:'PENDING'},host.token)));
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const current=(await prisma.viewingAppointment.findUniqueOrThrow({where:{id}})).status;
    expect(results.find(r=>r.status===409)?.body).toMatchObject({errorCode:'STALE_APPOINTMENT_STATUS',data:{currentStatus:current}});
    expect(await prisma.appointmentNotification.count({where:{appointmentId:id}})).toBe(2);
    await prisma.viewingAppointment.update({where:{id},data:{status:'ACCEPTED'}});
    expect((await http(`/host/appointments/${id}/complete`,'POST',{expectedStatus:'ACCEPTED'},host.token)).status).toBe(409);
    expect((await http(`/host/appointments/${id}/cancel`,'POST',{expectedStatus:'ACCEPTED',reason:' '},host.token)).status).toBe(400);
    expect((await http(`/host/appointments/${id}/cancel`,'POST',{expectedStatus:'ACCEPTED',reason:'  Synthetic reason  '},host.token)).body.data).toMatchObject({status:'CANCELLED',cancelledBy:'HOST',reason:'Synthetic reason'});
    const other=await fixture(),second=await createAppointment(other.id);
    expect((await http(`/appointments/${second.body.data.id}/cancel`,'POST',{expectedStatus:'PENDING'},tenant.token)).body.data).toMatchObject({status:'CANCELLED',cancelledBy:'TENANT'});
  });
  it('appointments: restart sweep cancels overdue PENDING once, leaves ACCEPTED open and enforces past-hour actions',async()=>{
    const room=await fixture(),pending=(await createAppointment(room.id)).body.data;
    const otherTenant=await account('TENANT'),accepted=(await createAppointment(room.id,otherTenant)).body.data;
    const before=vietnamToday(new Date(Date.now()-86400000));
    await prisma.viewingAppointment.update({where:{id:pending.id},data:{scheduledDate:new Date(before)}});
    await prisma.viewingAppointment.update({where:{id:accepted.id},data:{scheduledDate:new Date(before),status:'ACCEPTED'}});
    expect((await http(`/appointments/${accepted.id}/cancel`,'POST',{expectedStatus:'ACCEPTED'},otherTenant.token)).status).toBe(409);
    const worker=new AppointmentWorkerService(app.get(AppointmentsService));
    await worker.onModuleInit();await worker.reconcile();await worker.onModuleDestroy();
    expect(await prisma.viewingAppointment.findUnique({where:{id:pending.id}})).toMatchObject({status:'CANCELLED',cancelledBy:'SYSTEM',reason:'chủ nhà không phản hồi'});
    expect(await prisma.viewingAppointment.findUnique({where:{id:accepted.id}})).toMatchObject({status:'ACCEPTED'});
    expect(await prisma.appointmentNotification.count({where:{appointmentId:pending.id,type:'SYSTEM_CANCELLED'}})).toBe(1);
    expect((await http(`/host/appointments/${accepted.id}/complete`,'POST',{expectedStatus:'ACCEPTED'},host.token)).body.data.status).toBe('COMPLETED');
  });
  it('appointments: overlapping guests warn Host, no inventory lock, and future appointments prevent soft delete',async()=>{
    const room=await fixture(),a=await createAppointment(room.id),other=await account('TENANT');
    expect((await createAppointment(room.id,other)).status).toBe(201);
    expect((await http(`/host/appointments/${a.body.data.id}`,'GET',undefined,host.token)).body.data.simultaneousAppointments).toBe(1);
    expect((await http(`/host/properties/${room.id}`,'DELETE',{expectedVersion:1},host.token)).status).toBe(409);
    expect(await prisma.property.findUnique({where:{id:room.id}})).toMatchObject({deletedAt:null,isAvailable:true});
  });
  it('appointments: Swagger describes request/response DTO and notifications pagination',()=>{
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
    expect(document.paths['/api/v1/appointments'].post?.requestBody).toBeTruthy();
    expect(document.components?.schemas?.AppointmentResponseDto.properties?.scheduledTime).toBeTruthy();
    expect(document.components?.schemas?.HostAppointmentResponseDto.properties?.tenantPhone).toBeTruthy();
    expect(document.paths['/api/v1/notifications'].get?.responses?.['200']).toBeTruthy();
  });

  function inspectHomestay(unitId: string, overrides: Record<string, unknown> = {}) {
    return app.get(HomestayAvailabilityService).inspect({
      unitId, checkIn: '2026-10-22', checkOut: '2026-10-26', adults: 2, children: 1, ...overrides,
    });
  }

  function availabilityPath(unitId: string, overrides: Record<string, string> = {}) {
    return '/homestays/check-availability?' + new URLSearchParams({
      unitId, checkIn:'2026-10-22', checkOut:'2026-10-26', adults:'2', children:'1', ...overrides,
    });
  }

  // Booking rows are synthetic fixtures, not bookings created through a public hold endpoint.
  async function bookingData(unitId: string, overrides: Partial<Prisma.BookingUncheckedCreateInput> = {}): Promise<Prisma.BookingUncheckedCreateInput> {
    const unit = await prisma.homestayUnit.findUniqueOrThrow({ where: { id: unitId } });
    const checkIn = overrides.checkInDate ? new Date(overrides.checkInDate).toISOString().slice(0,10) : '2026-10-22';
    const checkOut = overrides.checkOutDate ? new Date(overrides.checkOutDate).toISOString().slice(0,10) : '2026-10-26';
    const price = calculateStayPrice(checkIn, checkOut, { ...unit, customPrices: new Map() });
    return {
      bookingCode: `FIX-${randomUUID().replaceAll('-','').slice(0,24)}`, homestayUnitId: unitId, guestId: tenant.id,
      checkInDate: new Date(checkIn), checkOutDate: new Date(checkOut), totalNights: price.totalNights,
      numAdults: 2, numChildren: 1, guestName: 'Synthetic guest', guestPhone: '0990000000',
      nightlyPrices: price.nightlyPrices.map(n => ({ date: n.date, price: n.price.toString() })),
      policySnapshot: { cancellationPolicy: unit.cancellationPolicy, instantBook: unit.instantBook,
        checkInTime: unit.checkInTime.toISOString().slice(11,19), checkOutTime: unit.checkOutTime.toISOString().slice(11,19),
        maxAdults: unit.maxAdults, maxChildren: unit.maxChildren, maxGuests: unit.maxGuests, maxNights: unit.maxNights,
        sameDayBookingCutoff: unit.sameDayBookingCutoff.toISOString().slice(11,19) },
      baseAmount: price.baseAmount, cleaningFee: price.cleaningFee, serviceFee: price.serviceFee, taxAmount: price.taxAmount,
      totalAmount: price.totalAmount, commissionAmount: price.commissionAmount, hostPayoutAmount: price.hostPayoutAmount,
      ...price.rates, bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'NOT_CONFIGURED',
      expiresAt: new Date(Date.now() + 15 * 60_000), ...overrides,
    };
  }

  it('S4 refund preview is owned, snapshot-based, signed and read-only over real HTTP/DB', async()=>{
    const {unit}=await homestayFixture();
    const booking=await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:'CONFIRMED',paymentStatus:'PAID'})});
    const before=await prisma.booking.findUniqueOrThrow({where:{id:booking.id}});
    const result=await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,tenant.token);
    expect(result.status).toBe(200);expect(result.body.success).toBe(true);
    expect(result.body.data).toMatchObject({bookingId:booking.id,version:booking.version,refundPercent:100,
      refund:{total:booking.totalAmount.toNumber()},refundQuoteToken:expect.any(String)});
    expect(JSON.stringify(result.body.data)).not.toMatch(/commission|hostPayout|guestPhone/);
    expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(before);
    expect((await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,host.token)).status).toBe(404);
    expect((await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,otherHost.token)).status).toBe(404);
    expect((await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,reviewer.token)).status).toBe(403);
    expect((await http(`/bookings/${booking.id}/refund-quote`)).status).toBe(401);
    const raw=await fetch(`${base}/api/v1/bookings/${booking.id}/refund-quote`,{headers:{authorization:`Bearer ${tenant.token}`}});
    expect(raw.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['NOT_CONFIGURED','PENDING','REFUNDED'])('S4 refund preview rejects %s without a paid mutation',async paymentStatus=>{
    const {unit}=await homestayFixture();
    const booking=await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:paymentStatus==='REFUNDED'?'CANCELLED_BY_GUEST':'PENDING_PAYMENT',paymentStatus})});
    const result=await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,tenant.token);
    expect(result.status).toBe(409);expect(result.body.errorCode).toBe('PAID_CANCELLATION_NOT_ALLOWED');
  });
  it('S4 refund preview preserves old policy/amount after unit pricing changes and allows Host acting as guest',async()=>{
    const {unit}=await homestayFixture();
    const booking=await prisma.booking.create({data:await bookingData(unit.id,{guestId:otherHost.id,bookingStatus:'CONFIRMED',paymentStatus:'PAID'})});
    await prisma.homestayUnit.update({where:{id:unit.id},data:{cancellationPolicy:'STRICT',basePricePerNight:990000}});
    const result=await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,otherHost.token);
    expect(result.status).toBe(200);expect(result.body.data).toMatchObject({policy:'FLEXIBLE',refundPercent:100,refund:{total:booking.totalAmount.toNumber()}});
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
    expect(document.paths['/api/v1/bookings/{id}/refund-quote'].get?.responses?.['200']).toBeTruthy();
    expect(document.components?.schemas?.RefundQuoteResponseDto.properties?.refund).toBeTruthy();
  });
  it('S4 refund preview refuses self cancellation at/after Vietnam check-in',async()=>{
    const {unit}=await homestayFixture();
    const today=vietnamToday(),tomorrow=new Date(new Date(today).getTime()+86400000).toISOString().slice(0,10);
    const booking=await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:'CONFIRMED',paymentStatus:'PAID',
      checkInDate:new Date(today),checkOutDate:new Date(tomorrow),policySnapshot:{cancellationPolicy:'FLEXIBLE',checkInTime:'00:00:00',checkOutTime:'12:00:00'}})});
    const result=await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,tenant.token);
    expect(result.status).toBe(409);expect(result.body.errorCode).toBe('MANUAL_REFUND_REVIEW_REQUIRED');
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).bookingStatus).toBe('CONFIRMED');
  });
  it('S4 paid cancellation HTTP guards validate role/ownership/body/key and never invent a payment',async()=>{
    const {unit}=await homestayFixture();
    const booking=await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:'CONFIRMED',paymentStatus:'PAID'})});
    const quote=await http(`/bookings/${booking.id}/refund-quote`,'GET',undefined,tenant.token);
    const body={expectedVersion:1,refundQuoteToken:quote.body.data.refundQuoteToken};
    const guestPath=`/bookings/${booking.id}/cancel-paid`,hostPath=`/host/bookings/${booking.id}/cancel-paid`;
    expect((await http(guestPath,'POST',body)).status).toBe(401);
    expect((await http(guestPath,'POST',body,tenant.token)).status).toBe(400);
    expect((await http(guestPath,'POST',{...body,totalAmount:0},tenant.token,randomUUID())).status).toBe(400);
    expect((await http(hostPath,'POST',{expectedVersion:1,reason:'No room'},tenant.token,randomUUID())).status).toBe(403);
    expect((await http(hostPath,'POST',{expectedVersion:1,reason:'  '},host.token,randomUUID())).status).toBe(400);
    expect((await http(hostPath,'POST',{expectedVersion:1,reason:'No room'},otherHost.token,randomUUID())).status).toBe(404);
    const missing=await http(guestPath,'POST',body,tenant.token,randomUUID());
    expect(missing.status).toBe(409);expect(missing.body.errorCode).toBe('FINANCIAL_REVIEW_REQUIRED');
    expect((await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).version).toBe(1);
    expect(await prisma.financeCancellation.count({where:{bookingId:booking.id}})).toBe(0);
  });
  it('S4 Admin manual refund HTTP routes enforce role, validation, pagination and private cache',async()=>{
    const path='/admin/finance/refunds';
    expect((await http(path)).status).toBe(401);
    for(const account of [tenant,host]) expect((await http(path,'GET',undefined,account.token)).status).toBe(403);
    const list=await http(path,'GET',undefined,reviewer.token);
    expect(list.status).toBe(200);expect(list.body.data).toEqual([]);expect(list.body.meta).toMatchObject({page:1,limit:20,total:0});
    const raw=await fetch(`${base}/api/v1${path}`,{headers:{authorization:`Bearer ${reviewer.token}`}});expect(raw.headers.get('cache-control')).toBe('no-store');
    const id=randomUUID(),body={expectedVersion:1,bankReference:'FIXTUREBANK:REF',evidenceNote:'Synthetic only',reason:'Test'};
    expect((await http(`${path}/${id}`,'GET',undefined,reviewer.token)).status).toBe(404);
    expect((await http(`${path}/${id}/confirm-paid`,'POST',body,reviewer.token)).status).toBe(400);
    expect((await http(`${path}/${id}/confirm-paid`,'POST',{...body,amount:100},reviewer.token,randomUUID())).status).toBe(400);
    expect((await http(`${path}/${id}/confirm-paid`,'POST',{...body,evidenceNote:'  '},reviewer.token,randomUUID())).status).toBe(400);
    expect((await http(`${path}/${id}/confirm-paid`,'POST',body,reviewer.token,randomUUID())).status).toBe(404);
  });
  it('S4 bank HTTP routes isolate own Host data and Admin review, validate fields, and disable caching',async()=>{
    expect((await http('/host/bank-account','GET',undefined,tenant.token)).status).toBe(403);
    const own=await http('/host/bank-account','GET',undefined,host.token);expect(own.body.data).toEqual({version:0,account:null,payoutReady:false});
    const body={expectedVersion:0,bankCode:'FIXTUREBANK',accountNumber:'1234567890',accountName:'Synthetic bank fixture'};
    expect((await http('/host/bank-account','PUT',{...body,status:'VERIFIED'},host.token,randomUUID())).status).toBe(400);
    const created=await http('/host/bank-account','PUT',body,host.token,randomUUID());expect(created.status).toBe(200);
    expect(created.body.data).toMatchObject({version:1,payoutReady:false,account:{status:'PENDING'}});
    expect((await http('/host/bank-account','GET',undefined,otherHost.token)).body.data.account).toBeNull();
    const path=`/admin/finance/bank-accounts/${created.body.data.account.id}`,review={expectedVersion:1,reason:'Synthetic only',evidenceNote:'No actual bank verification'};
    expect((await http(path,'GET',undefined,host.token)).status).toBe(403);
    expect((await http(`${path}/verify`,'POST',{...review,evidenceNote:''},reviewer.token,randomUUID())).status).toBe(400);
    const verified=await http(`${path}/verify`,'POST',review,reviewer.token,randomUUID());expect(verified.status).toBe(200);
    expect(verified.body.data).toEqual({id:created.body.data.account.id,status:'VERIFIED',version:2,payoutReady:true});
    const bankList=await http('/admin/finance/bank-accounts','GET',undefined,reviewer.token);
    expect(bankList.body.meta).toMatchObject({page:1,limit:20,total:1,totalPages:1});
    expect(bankList.body.data[0]).toEqual({id:created.body.data.account.id,hostId:host.id,bankCode:body.bankCode,accountNumber:'****7890',status:'VERIFIED',createdAt:expect.any(String),version:2,isCurrent:true});
    expect(JSON.stringify(bankList.body.data)).not.toContain(body.accountNumber);
    const bankDetail=await http(path,'GET',undefined,reviewer.token);
    expect(bankDetail.body.data).toMatchObject({...created.body.data.account,status:'VERIFIED',version:2,isCurrent:true});
    expect(bankDetail.body.data.events.map((e:{action:string})=>e.action)).toEqual(['SUBMITTED','VERIFIED']);
    expect(bankDetail.body.data.events[1]).toEqual({id:expect.any(String),actorId:reviewer.id,action:'VERIFIED',reason:review.reason,evidenceNote:review.evidenceNote,createdAt:expect.any(String)});
    const raw=await fetch(`${base}/api/v1/host/bank-account`,{headers:{authorization:`Bearer ${host.token}`}});expect(raw.headers.get('cache-control')).toBe('no-store');
    expect((await http('/host/bank-notifications','GET',undefined,tenant.token)).status).toBe(403);
    const notices=await http('/host/bank-notifications?page=1&limit=1','GET',undefined,host.token);
    expect(notices.body.meta).toMatchObject({total:2,unreadCount:2,totalPages:2});
    expect(notices.body.data[0].type).toBe('VERIFIED');
    const noticePath=`/host/bank-notifications/${notices.body.data[0].id}/read`;
    expect((await http(noticePath,'POST',{},otherHost.token)).status).toBe(404);
    expect((await http(noticePath,'POST',{recipientId:host.id},host.token)).status).toBe(400);
    const read=await http(noticePath,'POST',{},host.token);expect(read.status).toBe(200);expect(read.body.data.readAt).not.toBeNull();
    expect((await http(noticePath,'POST',{},host.token)).body.data).toEqual(read.body.data);
    expect((await http('/host/bank-notifications','GET',undefined,host.token)).body.meta.unreadCount).toBe(1);
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Synthetic bank schema verification').build());
    for(const method of ['get','put'] as const) expect(document.paths['/api/v1/host/bank-account'][method]?.responses['200']).toHaveProperty('content');
    expect(document.components?.schemas?.HostBankStateDto).toMatchObject({required:['version','account','payoutReady'],properties:{version:{minimum:0},account:{nullable:true}}});
    expect(document.components?.schemas?.HostBankAccountDto).toMatchObject({properties:{status:{enum:['PENDING','VERIFIED','REJECTED']},accountNumber:{type:'string'}}});
    const schemas=document.components!.schemas!;
    expect(schemas.AdminBankListItemDto).toMatchObject({required:expect.arrayContaining(['id','hostId','bankCode','accountNumber','status','createdAt','version','isCurrent']),properties:{accountNumber:{type:'string',description:expect.stringContaining('Masked')},isCurrent:{type:'boolean'}}});
    expect(schemas.AdminBankListItemDto).not.toHaveProperty('properties.accountName');
    expect(schemas.AdminBankDetailDto).toMatchObject({properties:{accountName:{type:'string'},events:{type:'array',items:{$ref:'#/components/schemas/AdminBankEventDto'}}}});
    expect(schemas.AdminBankEventDto).toMatchObject({required:['id','actorId','action','reason','evidenceNote','createdAt'],properties:{action:{enum:['SUBMITTED','VERIFIED','REJECTED']}}});
    expect(schemas.AdminBankReviewResultDto).toMatchObject({required:['id','version','status','payoutReady'],properties:{status:{enum:['VERIFIED','REJECTED']}}});
    const adminPaths=[['/api/v1/admin/finance/bank-accounts','get','AdminBankListItemDto'],['/api/v1/admin/finance/bank-accounts/{id}','get','AdminBankDetailDto'],['/api/v1/admin/finance/bank-accounts/{id}/verify','post','AdminBankReviewResultDto'],['/api/v1/admin/finance/bank-accounts/{id}/reject','post','AdminBankReviewResultDto']] as const;
    for(const [route,method,model] of adminPaths) {
      const operation=document.paths[route][method]!;
      expect(operation).toHaveProperty('security');
      expect(operation.responses['200']).toHaveProperty('content.application/json.schema.properties.data');
      expect(JSON.stringify(operation.responses['200'])).toContain(`#/components/schemas/${model}`);
    }
    expect(document.paths['/api/v1/admin/finance/bank-accounts'].get!.responses['200']).toHaveProperty('content.application/json.schema.required', ['success','message','data','meta']);
  });
  it.skipIf(process.env.S4_FINANCE_BFF !== '1')('S4 Host finance through real Next BFF preserves bank guards, exact ledger and notifications',async()=>{
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    async function bff(path:string,method='GET',body?:unknown,token=host.token,key?:string,requestOrigin=origin) {
      const response=await fetch(origin+'/api/management'+path,{method,headers:{authorization:`Bearer ${token}`,origin:requestOrigin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('set-cookie')).toBeNull();
      return {status:response.status,body:await response.json()};
    }
    try {
      let ready=false;
      for(let i=0;i<100;i++) {
        if(frontend.exitCode!==null) throw new Error('Isolated Next finance test server stopped');
        try {ready=(await fetch(origin+'/api/management/host/bank-account')).status===401;}catch{}
        if(ready) break;await new Promise(done=>setTimeout(done,100));
      }
      expect(ready).toBe(true);
      // Real payout allowlist/roles/ownership; no synthetic paid-transfer endpoint.
      for (const [path,actor] of [['/host/payouts',host],['/admin/finance/payouts',reviewer]] as const) {
        const batches=await bff(path+'?page=1&limit=20','GET',undefined,actor.token);
        expect(batches.status).toBe(200);expect(batches.body.data).toEqual([]);
        expect(batches.body.meta).toMatchObject({page:1,limit:20,total:0});
      }
      expect((await bff('/host/payouts','GET',undefined,tenant.token)).status).toBe(403);
      expect((await bff('/admin/finance/payouts')).status).toBe(403);
      const missingPayout='/admin/finance/payouts/'+randomUUID();
      expect((await bff(missingPayout+'/export','GET',undefined,reviewer.token)).status).toBe(404);
      expect((await bff('/host/payouts/'+randomUUID())).status).toBe(404);
      const payoutAction={expectedVersion:1,reason:'Synthetic transport check'};
      expect((await bff(missingPayout+'/approve','POST',payoutAction,reviewer.token)).body.errorCode).toBe('INVALID_IDEMPOTENCY_KEY');
      expect((await bff(missingPayout+'/approve','POST',payoutAction,reviewer.token,randomUUID())).status).toBe(404);
      expect((await bff(missingPayout+'/cancel','POST',payoutAction,reviewer.token,randomUUID())).status).toBe(404);
      expect((await bff(missingPayout+'/approve','POST',{...payoutAction,amount:'1'},reviewer.token,randomUUID())).status).toBe(400);
      expect((await bff(missingPayout+'/approve','POST',payoutAction,reviewer.token,randomUUID(),'https://evil.test')).status).toBe(403);
      expect((await bff(missingPayout+'/paid','POST',payoutAction,reviewer.token,randomUUID())).status).toBe(404);
      const paidEvidence={expectedVersion:2,bankReference:'FIXTURE',evidenceNote:'Synthetic only',reason:'Synthetic transport'};
      expect((await bff(missingPayout+'/confirm-paid','POST',paidEvidence,reviewer.token)).body.errorCode).toBe('INVALID_IDEMPOTENCY_KEY');
      expect((await bff(missingPayout+'/confirm-paid','POST',paidEvidence,reviewer.token,randomUUID())).status).toBe(404);
      expect((await bff(missingPayout+'/confirm-paid','POST',paidEvidence,host.token,randomUUID())).status).toBe(403);
      expect((await bff(missingPayout+'/confirm-paid','POST',{...paidEvidence,amount:'1'},reviewer.token,randomUUID())).status).toBe(400);
      expect((await bff(missingPayout+'/confirm-paid','POST',paidEvidence,reviewer.token,randomUUID(),'https://evil.test')).status).toBe(403);
      expect((await bff('/host/bank-account')).body.data).toEqual({version:0,account:null,payoutReady:false});
      for(const actor of [host,tenant,otherHost]) {
        const financeNotices=await bff('/finance/notifications?page=1&limit=20','GET',undefined,actor.token);
        expect(financeNotices.status).toBe(200);expect(financeNotices.body.data).toEqual([]);
        expect(financeNotices.body.meta).toMatchObject({page:1,limit:20,total:0,unreadCount:0});
      }
      expect((await bff('/finance/notifications','GET',undefined,reviewer.token)).status).toBe(403);
      const missingNotice=`/finance/notifications/${randomUUID()}/read`;
      expect((await bff(missingNotice,'POST',{})).status).toBe(404);
      expect((await bff(missingNotice,'POST',{},host.token,undefined,'https://evil.test')).status).toBe(403);
      expect((await bff(missingNotice,'POST',{recipientId:tenant.id})).status).toBe(400);
      expect((await bff('/host/finance','GET',undefined,tenant.token)).status).toBe(403);
      const input={expectedVersion:0,bankCode:'FIXTUREBANK',accountNumber:'1234567890',accountName:'Synthetic BFF fixture'};
      expect((await bff('/host/bank-account','PUT',input,host.token,randomUUID(),'https://evil.test')).status).toBe(403);
      expect((await bff('/host/bank-account','PUT',{...input,status:'VERIFIED'},host.token,randomUUID())).status).toBe(400);
      expect((await bff('/host/bank-account','PUT',input,tenant.token,randomUUID())).status).toBe(403);
      expect((await bff('/host/bank-account','PUT',input)).body.errorCode).toBe('INVALID_IDEMPOTENCY_KEY');
      const key=randomUUID(),submitted=await bff('/host/bank-account','PUT',input,host.token,key);
      expect(submitted.status).toBe(200);expect(submitted.body.data).toMatchObject({version:1,payoutReady:false,account:{status:'PENDING'}});
      expect(await bff('/host/bank-account','PUT',input,host.token,key)).toEqual(submitted);
      expect((await bff('/host/bank-account','PUT',{...input,accountNumber:'9876543210'},host.token,key)).body.errorCode).toBe('IDEMPOTENCY_CONFLICT');
      expect((await bff('/host/bank-account','PUT',input,host.token,randomUUID())).body.errorCode).toBe('STALE_BANK_VERSION');
      expect((await bff('/host/bank-account','GET',undefined,otherHost.token)).body.data.account).toBeNull();
      const notices=await bff('/host/bank-notifications?page=1&limit=1');expect(notices.body.meta).toMatchObject({total:1,unreadCount:1});
      expect(notices.body.data[0].type).toBe('SUBMITTED');expect(JSON.stringify(notices.body)).not.toContain(input.accountNumber);
      const readPath=`/host/bank-notifications/${notices.body.data[0].id}/read`;
      expect((await bff(readPath,'POST',{},otherHost.token)).status).toBe(404);
      const read=await bff(readPath,'POST',{});expect(read.status).toBe(200);expect(read.body.data.readAt).not.toBeNull();
      expect(await bff(readPath,'POST',{})).toEqual(read);
      expect((await bff('/host/bank-notifications')).body.meta.unreadCount).toBe(0);
      await http(`/admin/finance/bank-accounts/${submitted.body.data.account.id}/verify`,'POST',{expectedVersion:1,reason:'Synthetic only',evidenceNote:'No actual bank verification'},reviewer.token,randomUUID());
      expect((await bff('/host/finance')).body.data.bankVerified).toBe(true);
      const replaced=await bff('/host/bank-account','PUT',{...input,expectedVersion:2},host.token,randomUUID());expect(replaced.status).toBe(200);
      expect((await bff('/host/finance')).body.data).toMatchObject({bankVerified:false,payoutOperationsReady:false,balances:{eligibleBeforeDeductions:'0'}});
      // Synthetic journal without a booking: history is exact; it is not a payout entitlement.
      await prisma.$transaction(tx=>appendFinancialJournal(tx,{eventKey:`fixture:${randomUUID()}`,kind:'PAYMENT',bookingId:null,hostId:host.id,actorId:null,reason:'Synthetic BFF money only',
        lines:[{account:'CASH_CLEARING',side:'DEBIT',amount:'999999999999999999'},{account:'HOST_PAYABLE',side:'CREDIT',amount:'999999999999999999'}]}));
      const history=await bff('/host/finance/transactions?page=1&limit=1');expect(history.body.meta).toMatchObject({total:1,page:1,limit:1});
      expect(history.body.data[0].entries[0].amount).toBe('999999999999999999');
      expect((await bff('/host/finance/transactions','GET',undefined,otherHost.token)).body.data).toEqual([]);
      expect((await bff('/host/finance')).body.data.balances.eligibleBeforeDeductions).toBe('0');
      expect(await prisma.booking.count()).toBe(0);
      // Payment recovery through the same real BFF, with unconfigured provider and no payment/ledger mutation.
      const {unit}=await homestayFixture(),booking=await prisma.booking.create({data:await bookingData(unit.id)}),paymentPath=`/bookings/${booking.id}`;
      const paymentStatus=await bff(paymentPath+'/payment-status','GET',undefined,tenant.token);
      expect(paymentStatus.status).toBe(200);expect(paymentStatus.body.data).toMatchObject({bookingId:booking.id,amount:booking.totalAmount.toFixed(0),providerConnected:false,payment:null});
      expect((await bff(paymentPath+'/payment-status','GET',undefined,host.token)).status).toBe(404);
      const body={expectedVersion:booking.version},paymentKey=randomUUID();
      expect((await bff(paymentPath+'/payment-session','GET',undefined,tenant.token)).body.errorCode).toBe('PAYMENT_NOT_CONFIGURED');
      expect((await bff(paymentPath+'/payment-session','POST',body,tenant.token,paymentKey,'https://evil.test')).status).toBe(403);
      const unavailable=await bff(paymentPath+'/payment-session','POST',body,tenant.token,paymentKey);
      expect(unavailable.status).toBe(503);expect(unavailable.body.errorCode).toBe('PAYMENT_NOT_CONFIGURED');
      expect(await bff(paymentPath+'/payment-session','POST',body,tenant.token,paymentKey)).toEqual(unavailable);
      expect((await bff(paymentPath+'/payment-session','POST',{expectedVersion:booking.version+1},tenant.token,randomUUID())).body.errorCode).toBe('STALE_BOOKING_VERSION');
      expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(booking);
      expect(await prisma.bookingIdempotency.count({where:{userId:tenant.id,key:paymentKey}})).toBe(0);expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
    }finally {
      if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}
    }
  },60_000);
  it.skipIf(process.env.S4_BANK_BROWSER !== '1')('S4 Host bank UI through real Auth, Next BFF and DB survives lost commit response, stale version and reload',async()=>{
    // Synthetic bank details in the generated test DB only. No provider or actual transfer.
    const password='HostBankBrowserFixture123!';
    const user=await prisma.user.update({where:{id:host.id},data:{passwordHash:await bcrypt.hash(password,4)}});
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;
      for(let i=0;i<100;i++) {
        if(frontend.exitCode!==null)throw new Error('Owned bank frontend exited before ready');
        ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));
      }
      expect(ready).toBe(true);
      const html=await fetch(origin+'/host/bank-account').then(r=>r.text());
      expect(html).toContain('noindex');expect(html).not.toContain('0012AB');
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      await page.goto(origin+'/login');
      await page.getByLabel('Số điện thoại',{exact:true}).fill(user.phone);
      await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
      await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();
      await page.getByRole('menuitem',{name:'Ngân hàng nhận tiền',exact:true}).click();await page.waitForURL(origin+'/host/bank-account');
      await page.getByText('Chưa có tài khoản nhận tiền. Điền thông tin bên dưới để gửi xác minh.',{exact:true}).waitFor();
      const form=page.getByRole('form',{name:'Gửi ngân hàng nhận tiền'}),path='**/api/management/host/bank-account';
      const writes:{key:string|undefined;body:unknown}[]=[];let loseResponse=true;
      await page.route(path,async(route:{request():{method():string;headers():Record<string,string>;postDataJSON():unknown};fetch():Promise<{status():number;headers():Record<string,string>}>;fulfill(options:unknown):Promise<void>;continue():Promise<void>})=>{
        if(route.request().method()!=='PUT')return route.continue();
        writes.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
        if(!loseResponse)return route.continue();
        loseResponse=false;
        const response=await route.fetch();expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('no-store');
        // The DB really committed; only the response delivery is fault-injected.
        await route.fulfill({status:503,json:{success:false,errorCode:'TEST_LOST_RESPONSE',message:'Synthetic transport failure after commit'}});
      });
      await form.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).click();
      await form.getByText('Mã ngân hàng gồm 1–20 chữ cái, số, dấu gạch ngang hoặc gạch dưới.',{exact:true}).waitFor();expect(writes).toHaveLength(0);
      await form.getByLabel('Mã ngân hàng',{exact:true}).fill('fixturebank');
      await form.getByLabel('Số tài khoản',{exact:true}).fill('0012AB');
      await form.getByLabel('Tên chủ tài khoản',{exact:true}).fill('Synthetic Bank Browser');
      await form.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).click();
      await form.getByRole('button',{name:'Thử lại cùng thông tin',exact:true}).waitFor();
      expect(await form.getByLabel('Số tài khoản',{exact:true}).getAttribute('readonly')).not.toBeNull();
      const first=(await http('/host/bank-account','GET',undefined,host.token)).body.data;
      expect(first).toMatchObject({version:1,payoutReady:false,account:{accountNumber:'0012AB',bankCode:'FIXTUREBANK',status:'PENDING'}});
      expect(await prisma.financeBankAccount.count({where:{hostId:host.id}})).toBe(1);
      expect(await prisma.financeBankEvent.count({where:{accountId:first.account.id,action:'SUBMITTED'}})).toBe(1);
      const reviewed=await http(`/admin/finance/bank-accounts/${first.account.id}/verify`,'POST',{
        expectedVersion:1,reason:'Synthetic integration approval',evidenceNote:'Test fixture only; no actual bank verification',
      },reviewer.token,randomUUID());expect(reviewed.status).toBe(200);
      await form.getByRole('button',{name:'Thử lại cùng thông tin',exact:true}).click();
      await page.getByText('Đã xác minh',{exact:true}).waitFor();
      expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(writes[0].key).toMatch(/^[a-f0-9-]{36}$/);
      expect(await prisma.financeBankAccount.count({where:{hostId:host.id}})).toBe(1);
      expect(await prisma.financeBankEvent.count({where:{accountId:first.account.id}})).toBe(2);
      await page.reload();await page.getByText('Đã xác minh',{exact:true}).waitFor();
      expect(await page.getByText('0012AB',{exact:true}).count()).toBe(1);
      // Another real Host request changes the bank while the page still has version 2.
      const replacement=await http('/host/bank-account','PUT',{expectedVersion:2,bankCode:'FIXTUREBANK',accountNumber:'0034CD',accountName:'Synthetic Other Tab'},host.token,randomUUID());
      expect(replacement.status).toBe(200);expect(replacement.body.data).toMatchObject({version:3,payoutReady:false});
      await form.getByLabel('Mã ngân hàng',{exact:true}).fill('FIXTUREBANK');
      await form.getByLabel('Số tài khoản',{exact:true}).fill('0056EF');
      await form.getByLabel('Tên chủ tài khoản',{exact:true}).fill('Synthetic Replacement');
      await form.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).click();
      await form.getByText('Thông tin ngân hàng đã thay đổi. Vui lòng tải lại.',{exact:true}).waitFor();
      await page.getByText('0034CD',{exact:true}).waitFor();expect(await form.getByLabel('Số tài khoản',{exact:true}).inputValue()).toBe('0056EF');
      expect(await prisma.financeBankAccount.count({where:{hostId:host.id}})).toBe(2);
      await expect.poll(()=>form.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).getAttribute('aria-disabled')).toBe('false');
      await form.getByRole('button',{name:'Gửi Admin xác minh',exact:true}).click();await page.getByText('0056EF',{exact:true}).waitFor();
      expect(writes).toHaveLength(4);expect(writes[3].key).not.toBe(writes[2].key);
      expect(writes[3].body).toMatchObject({expectedVersion:3,accountNumber:'0056EF'});
      expect((await http('/host/bank-account','GET',undefined,host.token)).body.data).toMatchObject({version:4,payoutReady:false,account:{status:'PENDING',accountNumber:'0056EF'}});
      expect((await http('/host/finance','GET',undefined,host.token)).body.data.bankVerified).toBe(false);
      expect((await http('/host/bank-account','GET',undefined,otherHost.token)).body.data.account).toBeNull();
      expect(await prisma.financeBankAccount.count({where:{hostId:host.id}})).toBe(3);
      const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));
      expect(storage).not.toMatch(/0012AB|0034CD|0056EF|Synthetic Bank Browser|Synthetic Replacement/);
      const evidence=resolve('../.tmp/s4-bank-real-browser');await mkdir(evidence,{recursive:true});
      for(const width of [375,1440]) {
        await page.setViewportSize({width,height:1000});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:resolve(evidence,`pending-${width}.png`),fullPage:true});
      }
      // Read-only finance UI: real ledger strings and Host scoping through the
      // same authenticated BFF. These are internal synthetic journals only.
      const ledgerFixture=(owner:string)=>prisma.$transaction(tx=>appendFinancialJournal(tx,{
        eventKey:`browser-ledger:${randomUUID()}`,kind:'ADJUSTMENT',bookingId:null,hostId:owner,actorId:null,
        reason:'Synthetic browser fixture, not payment or payout',lines:[
          {account:'CASH_CLEARING',side:'DEBIT',amount:'999999999999999999'},
          {account:'HOST_PAYABLE',side:'CREDIT',amount:'999999999999999999'},
        ],
      }));
      const ownJournal=await ledgerFixture(host.id),otherJournal=await ledgerFixture(otherHost.id);
      await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();
      await page.getByRole('menuitem',{name:'Sổ tài chính chủ nhà',exact:true}).click();await page.waitForURL(origin+'/host/finance');
      await page.getByRole('heading',{name:'Điều chỉnh',exact:true}).waitFor();
      await page.getByRole('heading',{name:'Lịch sử lô chi trả',exact:true}).waitFor();
      await page.getByText('Chưa có lô chi trả ở trang này.',{exact:true}).waitFor();
      expect(await page.getByRole('button',{name:'Xem chi tiết',exact:true}).count()).toBe(0);
      expect(await page.getByText('999.999.999.999.999.999đ',{exact:true}).count()).toBe(2);
      expect(await page.getByText(ownJournal.journalId,{exact:true}).count()).toBe(1);
      expect(await page.getByText(otherJournal.journalId,{exact:true}).count()).toBe(0);
      // An unlinked journal is history, not a supported booking balance.
      expect(await page.getByText('0đ',{exact:true}).count()).toBe(4);
      await page.reload();await page.getByText(ownJournal.journalId,{exact:true}).waitFor();
      for(const width of [375,1440]) {
        await page.setViewportSize({width,height:1000});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await page.screenshot({path:resolve(evidence,`ledger-${width}.png`),fullPage:true});
      }
      expect(await prisma.financeJournal.count({where:{hostId:host.id}})).toBe(1);
      expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('999999999999999999');
      await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();await page.getByRole('menuitem',{name:'Đăng xuất',exact:true}).click();
      await page.getByRole('dialog').getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.waitForURL(origin+'/');
      await page.goto(origin+'/host/bank-account');await page.locator('main').getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
      expect(await page.getByRole('form',{name:'Gửi ngân hàng nhận tiền'}).count()).toBe(0);
      await page.goto(origin+'/host/finance');await page.locator('main').getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
      expect(await page.getByText(ownJournal.journalId,{exact:true}).count()).toBe(0);
    }finally {
      try{await browser?.close();}finally{if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}
    }
  },120_000);
  it.skipIf(process.env.S4_ADMIN_BANK_BROWSER !== '1')('S4 Admin bank UI through real Auth BFF DB verifies with replay and rejects superseded accounts',async()=>{
    // Synthetic ownership/evidence only, never an actual bank verification.
    const password='AdminBankBrowserFixture123!';
    const user=await prisma.user.update({where:{id:reviewer.id},data:{passwordHash:await bcrypt.hash(password,4)}});
    const submitBank=async(version:number,code:string)=>{
      const response=await http('/host/bank-account','PUT',{expectedVersion:version,bankCode:code,accountNumber:'0012AB',accountName:'Synthetic Admin Bank Browser'},host.token,randomUUID());
      expect(response.status).toBe(200);return response.body.data;
    };
    const old=await submitBank(0,'FIXTUREOLD'),pending=await submitBank(1,'FIXTURENEW');
    expect((await http('/admin/finance/bank-accounts','GET',undefined,host.token)).status).toBe(403);
    expect((await http('/admin/finance/bank-accounts','GET',undefined,tenant.token)).status).toBe(403);
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;
      for(let i=0;i<100;i++) {
        if(frontend.exitCode!==null)throw new Error('Owned Admin bank frontend exited before ready');
        ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));
      }
      expect(ready).toBe(true);
      expect(await fetch(origin+'/admin/finance/bank-accounts').then(r=>r.text())).toContain('noindex');
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(user.phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
      await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.getByRole('button',{name:'Mở menu tài khoản',exact:true}).click();await page.getByRole('menuitem',{name:'Xác minh ngân hàng chủ nhà',exact:true}).click();
      await page.waitForURL(origin+'/admin/finance/bank-accounts');
      await page.getByText('FIXTURENEW · ****12AB',{exact:true}).waitFor();expect(await page.getByText('0012AB',{exact:true}).count()).toBe(0);
      const select=async(code:string)=>{await page.locator('li').filter({has:page.getByRole('heading',{name:code+' · ****12AB',exact:true})}).getByRole('button',{name:'Xem tài khoản',exact:true}).click();await page.getByText('0012AB',{exact:true}).waitFor();};
      await select('FIXTUREOLD');expect(await page.getByRole('button',{name:'Xác minh tài khoản',exact:true}).isDisabled()).toBe(true);
      await select('FIXTURENEW');const form=page.getByRole('form',{name:'Xác minh ngân hàng',exact:true});
      await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic Admin review');await form.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Test fixture only, not actual bank verification');
      const writes:{key:string|undefined;body:unknown}[]=[];let lose=true;
      await page.route('**/api/management/admin/finance/bank-accounts/*/verify',async(route:{request():{headers():Record<string,string>;postDataJSON():unknown};fetch():Promise<{status():number}>;fulfill(options:unknown):Promise<void>;continue():Promise<void>})=>{
        writes.push({key:route.request().headers()['idempotency-key'],body:route.request().postDataJSON()});
        if(!lose)return route.continue();lose=false;const response=await route.fetch();expect(response.status()).toBe(200);
        await route.fulfill({status:503,json:{success:false,errorCode:'TEST_LOST_RESPONSE',message:'Synthetic delivery failure after actual DB commit'}});
      });
      await form.getByRole('button',{name:'Xác minh tài khoản',exact:true}).click();await form.getByRole('button',{name:'Thử lại cùng yêu cầu',exact:true}).waitFor();
      expect(await prisma.financeBankEvent.count({where:{accountId:pending.account.id,action:'VERIFIED'}})).toBe(1);
      await form.getByRole('button',{name:'Thử lại cùng yêu cầu',exact:true}).click();await form.getByText('Máy chủ đã ghi nhận xử lý.',{exact:false}).waitFor();
      await page.getByText('Đã xác minh · Bản hiện tại',{exact:true}).first().waitFor();expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
      expect(await prisma.financeBankEvent.count({where:{accountId:pending.account.id,action:'VERIFIED'}})).toBe(1);
      const evidence=resolve('../.tmp/s4-admin-bank-real');await mkdir(evidence,{recursive:true});
      for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,`verified-${width}.png`),fullPage:true});}
      expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain('0012AB');
      const later=await submitBank(3,'FIXTURELATER');await page.reload();await select('FIXTURELATER');
      await submitBank(4,'FIXTURELATEST');
      await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic stale review');await form.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Synthetic only');
      await form.getByRole('button',{name:'Xác minh tài khoản',exact:true}).click();await form.getByText('Host đã gửi tài khoản mới. Không thể duyệt bản cũ.',{exact:true}).waitFor();
      expect(await prisma.financeBankEvent.count({where:{accountId:later.account.id,action:'VERIFIED'}})).toBe(0);
      await page.getByText('FIXTURELATEST · ****12AB',{exact:true}).waitFor();await select('FIXTURELATEST');
      await form.getByLabel('Lý do xử lý',{exact:true}).fill('Synthetic rejection');await form.getByLabel('Ghi chú chứng cứ',{exact:true}).fill('Synthetic mismatch, not actual bank review');
      await form.getByRole('button',{name:'Từ chối tài khoản',exact:true}).click();await page.getByText('Đã từ chối · Bản hiện tại',{exact:true}).first().waitFor();
      const state=(await http('/host/bank-account','GET',undefined,host.token)).body.data;expect(state).toMatchObject({version:6,payoutReady:false,account:{status:'REJECTED'}});
      expect(await prisma.financeBankEvent.count({where:{accountId:old.account.id,action:'VERIFIED'}})).toBe(0);
      await page.goto(origin+'/admin/finance/payouts');
      await page.getByRole('heading',{name:'Lô chi trả chủ nhà',exact:true}).waitFor();
      await page.getByText('Chưa có lô ở trang này.',{exact:true}).waitFor();
      expect(await page.getByRole('button',{name:'Xem chi tiết',exact:true}).count()).toBe(0);
    }finally{try{await browser?.close();}finally{if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}}
  },120_000);
  it('S4 complaint HTTP guards validate intake and hide records from unrelated roles/owners',async()=>{
    const id=randomUUID(),input={expectedVersion:1,reason:'Synthetic complaint'};
    expect((await http('/bookings/'+id+'/complaints','POST',input,tenant.token)).status).toBe(400);
    expect((await http('/bookings/'+id+'/complaints','POST',{...input,status:'RESOLVED'},tenant.token,randomUUID())).status).toBe(400);
    expect((await http('/bookings/'+id+'/complaints','POST',input,tenant.token,randomUUID())).status).toBe(404);
    expect((await http('/host/finance/complaints','GET',undefined,tenant.token)).status).toBe(403);
    expect((await http('/admin/finance/complaints','GET',undefined,host.token)).status).toBe(403);
    expect((await http('/host/finance/complaints/'+id,'GET',undefined,host.token)).status).toBe(404);
    expect((await http('/host/finance/complaints/'+id+'/respond','POST',{expectedVersion:1,message:'test'},otherHost.token,randomUUID())).status).toBe(404);
    const {unit}=await homestayFixture();
    const b=await prisma.booking.create({data:await bookingData(unit.id)});
    expect((await http('/bookings/'+b.id+'/complaints','POST',input,tenant.token,randomUUID())).status).toBe(409);
    const raw=await fetch(`${base}/api/v1/host/finance/complaints`,{headers:{authorization:`Bearer ${host.token}`}});
    expect(raw.headers.get('cache-control')).toBe('no-store');
    expect((await raw.json()).meta).toMatchObject({page:1,total:0});
  });
  it('S4 payment recovery reads only Guest snapshot and unavailable sessions never mutate or fabricate payment',async()=>{
    const {unit}=await homestayFixture(),booking=await prisma.booking.create({data:await bookingData(unit.id)}),path=`/bookings/${booking.id}`;
    expect((await http(path+'/payment-status')).status).toBe(401);
    expect((await http(path+'/payment-status','GET',undefined,reviewer.token)).status).toBe(403);
    for(const account of [host,otherHost]) expect((await http(path+'/payment-status','GET',undefined,account.token)).status).toBe(404);
    expect((await http('/bookings/not-uuid/payment-status','GET',undefined,tenant.token)).status).toBe(400);
    const status=await http(path+'/payment-status?amount=0&paymentStatus=PAID','GET',undefined,tenant.token);
    expect(status.status).toBe(200);expect(status.body.data).toEqual({bookingId:booking.id,bookingCode:booking.bookingCode,version:booking.version,bookingStatus:booking.bookingStatus,paymentStatus:booking.paymentStatus,amount:booking.totalAmount.toFixed(0),currency:'VND',serverTime:expect.any(String),reservationExpiresAt:booking.expiresAt.toISOString(),reservationExpired:false,providerConnected:false,payment:null});
    expect(JSON.stringify(status.body)).not.toMatch(/guestPhone|guestEmail|guestName|policySnapshot|commission|hostPayout|accountNumber|qrCode/);
    const raw=await fetch(`${base}/api/v1${path}/payment-status`,{headers:{authorization:`Bearer ${tenant.token}`}});expect(raw.headers.get('cache-control')).toBe('no-store');
    const current={expectedVersion:booking.version};
    expect((await http(path+'/payment-session','GET',undefined,host.token)).status).toBe(404);
    expect((await http(path+'/payment-session','GET',undefined,tenant.token)).body.errorCode).toBe('PAYMENT_NOT_CONFIGURED');
    expect((await http(path+'/payment-session','POST',current,tenant.token)).body.errorCode).toBe('INVALID_IDEMPOTENCY_KEY');
    expect((await http(path+'/payment-session','POST',{...current,amount:1},tenant.token,randomUUID())).status).toBe(400);
    expect((await http(path+'/payment-session','POST',{expectedVersion:0},tenant.token,randomUUID())).status).toBe(400);
    expect((await http(path+'/payment-session','POST',{expectedVersion:booking.version+1},tenant.token,randomUUID())).body.errorCode).toBe('STALE_BOOKING_VERSION');
    const key=randomUUID(),first=await http(path+'/payment-session','POST',current,tenant.token,key);
    expect(first.status).toBe(503);expect(first.body.errorCode).toBe('PAYMENT_NOT_CONFIGURED');expect(await http(path+'/payment-session','POST',current,tenant.token,key)).toEqual(first);
    expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(booking);expect(await prisma.bookingIdempotency.count({where:{userId:tenant.id,key}})).toBe(0);expect(await prisma.financeJournal.count({where:{bookingId:booking.id}})).toBe(0);
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
    expect(document.paths['/api/v1/bookings/{id}/payment-status'].get!.responses['200']).toHaveProperty('content');
    expect(document.components!.schemas!.BookingPaymentStatusDto).toMatchObject({properties:{amount:{type:'string'},providerConnected:{type:'boolean'},reservationExpiresAt:{nullable:true},payment:{nullable:true}}});
    expect(document.paths['/api/v1/bookings/{id}/payment-session'].post!.responses).toHaveProperty('503');
    const {unit:otherUnit}=await homestayFixture(),hostGuest=await prisma.booking.create({data:await bookingData(otherUnit.id,{guestId:otherHost.id,bookingStatus:'CONFIRMED',paymentStatus:'PAID'})});
    const storedFlag=await http(`/bookings/${hostGuest.id}/payment-status`,'GET',undefined,otherHost.token);
    expect(storedFlag.status).toBe(200);expect(storedFlag.body.data).toMatchObject({paymentStatus:'PAID',providerConnected:false,payment:null,reservationExpiresAt:null,reservationExpired:false});
    expect((await http(`/bookings/${hostGuest.id}/payment-session`,'POST',{expectedVersion:hostGuest.version},otherHost.token,randomUUID())).body.errorCode).toBe('PAYMENT_NOT_CONFIGURED');
  });
  it('S4 Host finance HTTP is private, role-scoped, exact-money and does not invent a wallet from PAID flags',async()=>{
    expect((await http('/host/finance','GET',undefined,tenant.token)).status).toBe(403);
    const {unit}=await homestayFixture();
    await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:'CONFIRMED',paymentStatus:'PAID'})});
    const own=await http('/host/finance','GET',undefined,host.token);expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({reviewCount:1,payoutOperationsReady:false,balances:{eligibleBeforeDeductions:'0'}});
    expect((await http('/host/finance','GET',undefined,otherHost.token)).body.data.reviewCount).toBe(0);
    const history=await http('/host/finance/transactions?page=1&limit=1','GET',undefined,host.token);
    expect(history.body.data).toEqual([]);expect(history.body.meta).toMatchObject({page:1,total:0});
    const raw=await fetch(`${base}/api/v1/host/finance`,{headers:{authorization:`Bearer ${host.token}`}});expect(raw.headers.get('cache-control')).toBe('no-store');
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Synthetic API schema verification').build());
    expect(document.paths['/api/v1/host/finance'].get?.responses['200']).toHaveProperty('content');
    expect(document.components?.schemas?.HostFinanceEntryDto).toMatchObject({properties:{amount:{type:'string'}}});
    expect(document.components?.schemas?.HostFinanceBalancesDto).toMatchObject({properties:{eligibleBeforeDeductions:{type:'string'}}});
  });
  it('S4 Host finance HTTP aggregates exact verified snapshots, freezes only one booking and rejects duplicate sources',async()=>{
    // Isolated synthetic PAID rows and matching journals are test evidence, not a connected payment provider.
    const makePaid=async()=>{
      const {unit}=await homestayFixture();
      const booking=await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:'CONFIRMED',paymentStatus:'PAID'})});
      const source=()=>({eventKey:`fixture:finance-http:${randomUUID()}`,kind:'PAYMENT' as const,bookingId:booking.id,hostId:host.id,actorId:null,reason:'Synthetic matching snapshot only',lines:[
        {account:'CASH_CLEARING' as const,side:'DEBIT' as const,amount:booking.totalAmount.toFixed(0)},
        {account:'HOST_PAYABLE' as const,side:'CREDIT' as const,amount:booking.hostPayoutAmount.toFixed(0)},
        {account:'PLATFORM_COMMISSION' as const,side:'CREDIT' as const,amount:booking.commissionAmount.toFixed(0)},
        {account:'PLATFORM_SERVICE' as const,side:'CREDIT' as const,amount:booking.serviceFee.toFixed(0)},
        {account:'TAX_PAYABLE' as const,side:'CREDIT' as const,amount:booking.taxAmount.toFixed(0)},
      ].filter(line=>new Prisma.Decimal(line.amount).gt(0))});
      await prisma.$transaction(tx=>appendFinancialJournal(tx,source()));return {booking,source};
    };
    const first=await makePaid(),second=await makePaid(),read=()=>http('/host/finance','GET',undefined,host.token);
    const total=first.booking.hostPayoutAmount.plus(second.booking.hostPayoutAmount).toFixed(0);
    expect((await read()).body.data).toMatchObject({reviewCount:0,source:'LEDGER',payoutOperationsReady:false,
      balances:{waitingCompletion:total,pendingHold:'0',eligibleBeforeDeductions:'0',frozen:'0'}});
    const created=await http(`/bookings/${first.booking.id}/complaints`,'POST',{expectedVersion:first.booking.version,reason:'Synthetic room mismatch'},tenant.token,randomUUID());
    expect(created.status).toBe(201);
    expect((await read()).body.data).toMatchObject({reviewCount:0,balances:{waitingCompletion:second.booking.hostPayoutAmount.toFixed(0),frozen:first.booking.hostPayoutAmount.toFixed(0)}});
    const other=await http('/host/finance','GET',undefined,otherHost.token);
    expect(other.body.data).toMatchObject({reviewCount:0,balances:{waitingCompletion:'0',pendingHold:'0',eligibleBeforeDeductions:'0',frozen:'0'}});
    expect((await http('/host/finance/transactions','GET',undefined,otherHost.token)).body.data).toEqual([]);
    expect((await http('/host/finance','GET',undefined,tenant.token)).status).toBe(403);
    // Two independently balanced PAYMENT journals are still an invalid source for this booking.
    await prisma.$transaction(tx=>appendFinancialJournal(tx,first.source()));
    expect((await read()).body.data).toMatchObject({reviewCount:1,balances:{waitingCompletion:second.booking.hostPayoutAmount.toFixed(0),frozen:'0'}});
    const history=await http('/host/finance/transactions?page=1&limit=2','GET',undefined,host.token);
    expect(history.status).toBe(200);expect(history.body.meta).toMatchObject({page:1,limit:2,total:3,totalPages:2});
    expect(history.body.data).toHaveLength(2);expect(new Set(history.body.data.map((row:{id:string})=>row.id)).size).toBe(2);
    for(const journal of history.body.data){expect(journal).not.toHaveProperty('reason');expect(journal).not.toHaveProperty('actorId');for(const line of journal.entries)expect(typeof line.amount).toBe('string');}
  });
  it('S4 no-show HTTP requires Host ownership/Admin role, evidence and keys without accepting simulated payment',async()=>{
    const id=randomUUID(),report={expectedVersion:1,reason:'Synthetic report'},decision={expectedVersion:2,decision:'NO_SHOW',reason:'Synthetic verification',evidenceNote:'Synthetic evidence'};
    expect((await http(`/host/bookings/${id}/no-show-report`,'POST',report,tenant.token,randomUUID())).status).toBe(403);
    expect((await http(`/host/bookings/${id}/no-show-report`,'POST',report,host.token)).status).toBe(400);
    expect((await http(`/host/bookings/${id}/no-show-report`,'POST',report,host.token,randomUUID())).status).toBe(404);
    expect((await http(`/admin/finance/bookings/${id}/resolve-stay`,'POST',decision,host.token,randomUUID())).status).toBe(403);
    expect((await http(`/admin/finance/bookings/${id}/resolve-stay`,'POST',{...decision,evidenceNote:''},reviewer.token,randomUUID())).status).toBe(400);
    expect((await http(`/admin/finance/bookings/${id}/resolve-stay`,'POST',{...decision,decision:'SIMULATE_PAID'},reviewer.token,randomUUID())).status).toBe(400);
    expect((await http(`/admin/finance/bookings/${id}/resolve-stay`,'POST',decision,reviewer.token,randomUUID())).status).toBe(404);
    const raw=await fetch(`${base}/api/v1/admin/finance/no-show-reports`,{headers:{authorization:`Bearer ${reviewer.token}`}});
    expect(raw.headers.get('cache-control')).toBe('no-store');expect((await raw.json()).meta).toMatchObject({page:1,total:0});
  });
  function bookingDbRow(data: Prisma.BookingUncheckedCreateInput) {
    const row = Object.fromEntries(Object.entries({ id:randomUUID(),version:1,createdAt:new Date(),updatedAt:new Date(),...data })
      .map(([key,value]) => [key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`), value]));
    for (const key of ['check_in_date','check_out_date']) row[key] = new Date(row[key] as Date).toISOString().slice(0,10);
    return JSON.stringify(row);
  }

  it.each(['PENDING_PAYMENT','PENDING_HOST_APPROVAL','CONFIRMED','CHECKED_IN'])(
    'DB excludes active overlapping %s bookings and public availability sees the same inventory', async bookingStatus => {
      const { unit } = await homestayFixture();
      const data = await bookingData(unit.id, { bookingStatus, paymentStatus: ['CONFIRMED','CHECKED_IN'].includes(bookingStatus) ? 'PAID' : 'NOT_CONFIGURED' });
      await prisma.booking.create({ data });
      await expect(prisma.booking.create({ data: { ...data, bookingCode: `OTHER-${randomUUID().slice(0,20)}` } })).rejects.toThrow();
      expect(await prisma.booking.count()).toBe(1);
      const response = await http(availabilityPath(unit.id));
      expect(response.status).toBe(200); expect(response.body.data.isAvailable).toBe(false);
      expect(JSON.stringify(response.body)).not.toMatch(/guestName|guestPhone|bookingCode|policySnapshot/);
    });

  it('twenty simultaneous DB inserts for different keys but overlapping ranges commit exactly one active booking', async () => {
    const { unit } = await homestayFixture();
    const data = await bookingData(unit.id);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => database.query(`
      INSERT INTO bookings SELECT * FROM jsonb_populate_record(NULL::bookings,$1::jsonb)`, [JSON.stringify({
        id: randomUUID(), booking_code: `FIX-RACE-${i}`, homestay_unit_id: unit.id, guest_id: tenant.id,
        check_in_date: i % 2 ? '2026-10-23' : '2026-10-22', check_out_date: i % 2 ? '2026-10-27' : '2026-10-26',
        total_nights: 4, num_adults: 2, num_children: 1, guest_name: 'Synthetic', guest_phone: '0990000000',
        nightly_prices: (data.nightlyPrices as { date:string;price:string }[]).map(n => ({ ...n,
          date: i % 2 ? new Date(new Date(n.date).getTime()+86400000).toISOString().slice(0,10) : n.date })),
        policy_snapshot: data.policySnapshot,
        base_amount: data.baseAmount, cleaning_fee: data.cleaningFee, service_fee: data.serviceFee, tax_amount: data.taxAmount,
        total_amount: data.totalAmount, service_fee_rate: data.serviceFeeRate, tax_rate: data.taxRate,
        commission_rate: data.commissionRate, commission_amount: data.commissionAmount, host_payout_amount: data.hostPayoutAmount,
        booking_status: 'PENDING_PAYMENT', payment_status: 'NOT_CONFIGURED', expires_at: data.expiresAt,
        version: 1, created_at: new Date(), updated_at: new Date(),
      })])));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected') expect(result.reason.code).toBe('23P01');
    expect(await prisma.booking.count()).toBe(1);
  });

  it('DB accepts adjacent stays and different units without weakening the overlap guard', async () => {
    const { unit, property } = await homestayFixture();
    const data = await bookingData(unit.id);
    await prisma.booking.create({ data });
    await prisma.booking.create({ data: await bookingData(unit.id, { bookingCode: `NEXT-${randomUUID().slice(0,20)}`,
      checkInDate: new Date('2026-10-26'), checkOutDate: new Date('2026-10-30') }) });
    const other = await prisma.homestayUnit.create({ data: {
      ...Object.fromEntries(Object.entries(unit).filter(([key]) => !['id','createdAt'].includes(key))), propertyId: property.id, unitName: 'Different unit',
    } as Prisma.HomestayUnitUncheckedCreateInput });
    await prisma.booking.create({ data: { ...data, homestayUnitId: other.id, bookingCode: `UNIT-${randomUUID().slice(0,20)}` } });
    expect(await prisma.booking.count()).toBe(3);
  });

  it.each(['REJECTED_BY_HOST','CANCELLED_HOST_TIMEOUT','CANCELLED_TIMEOUT','CANCELLED','COMPLETED'])(
    'inactive %s fixtures neither block inventory nor disappear from booking history', async bookingStatus => {
      const { unit } = await homestayFixture();
      const data = await bookingData(unit.id, { bookingStatus, paymentStatus: bookingStatus === 'COMPLETED' ? 'PAID' : 'NOT_CONFIGURED' });
      await prisma.booking.create({ data });
      expect((await http(availabilityPath(unit.id))).body.data.isAvailable).toBe(true);
      await prisma.booking.create({ data: { ...data, bookingCode: `NEW-${randomUUID().slice(0,20)}`, bookingStatus: 'PENDING_PAYMENT', paymentStatus: 'NOT_CONFIGURED' } });
      expect(await prisma.booking.count()).toBe(2);
    });

  it('bookings restrict physical deletion of units, properties and guests', async () => {
    const { unit, property } = await homestayFixture();
    await prisma.booking.create({ data: await bookingData(unit.id) });
    for (const [table, id] of [['homestay_units',unit.id],['properties',property.id],['users',tenant.id]]) {
      await expect(database.query(`DELETE FROM ${table} WHERE id=$1`, [id])).rejects.toMatchObject({ code: '23503' });
    }
    expect(await prisma.booking.count()).toBe(1);
  });

  it.each([
    ['total_nights','3'], ['num_adults','0'], ['num_children','-1'], ['version','0'],
    ['base_amount',"'NaN'"], ['cleaning_fee','150000.50'], ['total_amount','1'],
    ['commission_rate','13'], ['service_fee_rate','-1'], ['tax_rate','101'], ['host_payout_amount','0'],
    ['nightly_prices',"'[]'::jsonb"], ['policy_snapshot',"'[]'::jsonb"],
    ['booking_status',"'CONFIRMED'"], ['payment_status',"'PAID'"],
  ])('booking DB rejects invalid or inconsistent %s=%s', async (field, value) => {
    const { unit } = await homestayFixture();
    // INSERT checks intrinsic constraints, not merely the immutable-snapshot UPDATE trigger.
    await expect(database.query(`INSERT INTO bookings
      SELECT (fixture).* FROM (SELECT jsonb_populate_record(NULL::bookings,
        $1::jsonb || jsonb_build_object('${field}',${value})) AS fixture) candidate`,
    [bookingDbRow(await bookingData(unit.id))])).rejects.toMatchObject({ code: '23514' });
    expect(await prisma.booking.count()).toBe(0);
  });

  it.each([
    [{ date:'2026-10-22',price:'2700000' }],
    [{ date:'2026-10-22',price:'-600000' },{ date:'2026-10-23',price:'750000' },{ date:'2026-10-24',price:'750000' },{ date:'2026-10-25',price:'1800000' }],
    [{ date:'2026-10-22',price:'600000.5' },{ date:'2026-10-23',price:'750000' },{ date:'2026-10-24',price:'750000' },{ date:'2026-10-25',price:'599999.5' }],
    [{ date:'2026-10-22',price:'600000' },{ date:'2026-10-22',price:'750000' },{ date:'2026-10-24',price:'750000' },{ date:'2026-10-25',price:'600000' }],
    [{ date:'2026-10-22',price:'600001' },{ date:'2026-10-23',price:'750000' },{ date:'2026-10-24',price:'750000' },{ date:'2026-10-25',price:'600000' }],
    [{ date:'2026-10-22' },{ date:'2026-10-23',price:'750000' },{ date:'2026-10-24',price:'750000' },{ date:'2026-10-25',price:'600000' }],
  ])('DB rejects malformed or inconsistent nightly snapshot %j', async nightlyPrices => {
    const { unit } = await homestayFixture(); const data = await bookingData(unit.id, { nightlyPrices });
    await expect(database.query('INSERT INTO bookings SELECT * FROM jsonb_populate_record(NULL::bookings,$1::jsonb)',
      [bookingDbRow(data)])).rejects.toMatchObject({ code:'23514' });
    expect(await prisma.booking.count()).toBe(0);
  });

  it('price/policy snapshots retain each rounded charge and rate after the unit/calendar is edited', async () => {
    const { unit } = await homestayFixture({}, { basePricePerNight:'100.50',weekendPricePerNight:'110.49',cleaningFee:'4.50',serviceFeeRate:'5',taxRate:'8',commissionRate:'12' });
    const before = await prisma.booking.create({ data: await bookingData(unit.id) });
    expect(before.totalAmount.toString()).toBe('484');
    expect(before.serviceFee.toString()).toBe('21'); expect(before.taxAmount.toString()).toBe('36');
    expect(before.commissionAmount.toString()).toBe('51'); expect(before.hostPayoutAmount.toString()).toBe('376');
    await prisma.homestayUnit.update({ where: { id: unit.id }, data: { basePricePerNight:999,cleaningFee:0,serviceFeeRate:0,taxRate:0,commissionRate:10,cancellationPolicy:'STRICT' } });
    await prisma.calendarPricing.create({ data: { homestayUnitId:unit.id,date:new Date('2026-10-23'),customPrice:9999 } });
    expect(await prisma.booking.findUnique({ where: { id: before.id } })).toEqual(before);
    await expect(prisma.booking.update({ where:{ id:before.id },data:{ nightlyPrices:[{ date:'2026-10-22',price:'1' }] } })).rejects.toThrow();
    await expect(prisma.booking.update({ where:{ id:before.id },data:{ policySnapshot:{ cancellationPolicy:'STRICT' } } })).rejects.toThrow();
  });

  it.each(['PENDING_PAYMENT','PENDING_HOST_APPROVAL'])('expiry atomically releases %s exactly once using DB time', async bookingStatus => {
    const { unit } = await homestayFixture();
    const booking = await prisma.booking.create({ data: await bookingData(unit.id, { bookingStatus,expiresAt:new Date(Date.now()-60_000) }) });
    expect((await http(availabilityPath(unit.id))).body.data.isAvailable).toBe(true);
    // Wall-clock expiry alone must not weaken the exclusion predicate; transition is required first.
    await expect(prisma.booking.create({ data: await bookingData(unit.id) })).rejects.toThrow();
    const expiry = new BookingExpiryService(prisma);
    const results = await Promise.all(Array.from({ length: 10 }, () => expiry.expire(booking.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await prisma.booking.findUniqueOrThrow({ where:{ id:booking.id } });
    expect(after.bookingStatus).toBe(bookingStatus === 'PENDING_PAYMENT' ? 'CANCELLED_TIMEOUT' : 'CANCELLED_HOST_TIMEOUT');
    expect(after.version).toBe(2); expect(after.paymentStatus).toBe('NOT_CONFIGURED');
    await prisma.booking.create({ data: await bookingData(unit.id) });
    expect(await expiry.expire(booking.id)).toBe(false); expect(await prisma.booking.count()).toBe(2);
  });

  it('early/stale expiry cannot cancel a renewed pending deadline, confirmed paid booking or missing ID', async () => {
    const { unit } = await homestayFixture();
    const booking = await prisma.booking.create({ data: await bookingData(unit.id) });
    const expiry = new BookingExpiryService(prisma);
    expect(await expiry.expire(booking.id)).toBe(false);
    await prisma.booking.update({ where: { id:booking.id }, data: { bookingStatus:'CONFIRMED',paymentStatus:'PAID',expiresAt:new Date(Date.now()-60_000) } });
    expect(await expiry.expire(booking.id)).toBe(false); expect(await expiry.expire(randomUUID())).toBe(false);
    expect((await http(availabilityPath(unit.id))).body.data.isAvailable).toBe(false);
  });

  it('twenty concurrent idempotent mutations save one booking and replay the exact original response for seven days', async () => {
    const { unit } = await homestayFixture(); const data = await bookingData(unit.id);
    const store = new BookingIdempotencyService(prisma); const key = randomUUID();
    const apply = vi.fn(async (tx: Prisma.TransactionClient) => {
      const booking = await tx.booking.create({ data });
      return { status:201,body:{ success:true,message:'Fixture',data:{ bookingId:booking.id,expiresAt:booking.expiresAt.toISOString(),payment:null } } };
    });
    const body = { unitId:unit.id,numAdults:2,numChildren:1 };
    const results = await Promise.all(Array.from({ length:20 }, () => store.run(tenant.id,'HOLD',key,body,apply)));
    expect(apply).toHaveBeenCalledTimes(1); expect(await prisma.booking.count()).toBe(1);
    for (const result of results) expect(result).toEqual(results[0]);
    const stored = await prisma.bookingIdempotency.findFirstOrThrow();
    expect(stored.expiresAt.getTime()-stored.createdAt.getTime()).toBe(604800000);
    await prisma.booking.update({ where:{ id:(results[0].body.data as { bookingId:string }).bookingId }, data:{ bookingStatus:'CANCELLED' } });
    expect(await store.run(tenant.id,'HOLD',key,{ numChildren:1,numAdults:2,unitId:unit.id },apply)).toEqual(results[0]);
    expect(apply).toHaveBeenCalledTimes(1);
    await expect(store.run(tenant.id,'HOLD',key,{ ...body,numAdults:1 },apply)).rejects.toMatchObject({ status:409 });
    expect(await prisma.bookingIdempotency.count()).toBe(1);
  }, 40_000);

  it('idempotency rollback leaves neither booking nor replay record, and the same key can retry', async () => {
    const { unit } = await homestayFixture(); const data = await bookingData(unit.id);
    const store = new BookingIdempotencyService(prisma); const key = randomUUID();
    await expect(store.run(tenant.id,'HOLD',key,{ unitId:unit.id },async tx => {
      await tx.booking.create({ data }); throw new Error('Synthetic failure after INSERT');
    })).rejects.toThrow('Synthetic failure');
    expect(await prisma.booking.count()).toBe(0); expect(await prisma.bookingIdempotency.count()).toBe(0);
    await store.run(tenant.id,'HOLD',key,{ unitId:unit.id },async tx => {
      const booking = await tx.booking.create({ data }); return { status:201,body:{ bookingId:booking.id } };
    });
    expect(await prisma.booking.count()).toBe(1); expect(await prisma.bookingIdempotency.count()).toBe(1);
  });

  it('idempotency isolates users and operations, and an expired key is reusable without altering another actor record', async () => {
    const store = new BookingIdempotencyService(prisma); const key = randomUUID();
    const result = (value:string) => async () => ({ status:200,body:{ value } });
    await store.run(host.id,'HOLD',key,{},result('Host hold'));
    await store.run(host.id,'HOST_ACCEPT',key,{},result('Host accept'));
    await store.run(tenant.id,'HOLD',key,{},result('Tenant hold'));
    expect(await prisma.bookingIdempotency.count()).toBe(3);
    const createdAt = new Date(Date.now()-8*86400000);
    await prisma.bookingIdempotency.update({ where:{ userId_operation_key:{ userId:host.id,operation:'HOLD',key } }, data:{ createdAt,expiresAt:new Date(createdAt.getTime()+604800000) } });
    expect(await store.run(host.id,'HOLD',key,{ newRequest:true },result('New hold'))).toEqual({ status:200,body:{ value:'New hold' } });
    expect(await store.run(tenant.id,'HOLD',key,{},result('Must not apply'))).toEqual({ status:200,body:{ value:'Tenant hold' } });
    expect(await prisma.bookingIdempotency.count()).toBe(3);
  });

  it('idempotency rejects banned/Admin/missing actors and a Tenant Host action even on response replay', async () => {
    const store = new BookingIdempotencyService(prisma); const key = randomUUID();
    const apply = vi.fn(async () => ({ status:200,body:{ fixture:true } }));
    await store.run(tenant.id,'HOLD',key,{},apply);
    await prisma.user.update({ where:{ id:tenant.id },data:{ status:'BANNED' } });
    for (const id of [tenant.id,reviewer.id,randomUUID()]) await expect(store.run(id,'HOLD',key,{},apply)).rejects.toMatchObject({ status:403 });
    await prisma.user.update({ where:{ id:tenant.id },data:{ status:'ACTIVE' } });
    await expect(store.run(tenant.id,'HOST_ACCEPT',key,{},apply)).rejects.toMatchObject({ status:403 });
    expect(apply).toHaveBeenCalledTimes(1);
    for (const invalid of ['', 'white space', 'x'.repeat(129), 'mã', '\n']) {
      await expect(store.run(host.id,'HOLD',invalid,{},apply)).rejects.toMatchObject({ status:400 });
    }
    expect(await prisma.bookingIdempotency.count()).toBe(1);
  });

  it('public availability HTTP returns the real 06 envelope, rounded price and no-store without private fields', async () => {
    const { unit } = await homestayFixture({}, { basePricePerNight:'100.50', weekendPricePerNight:'110.49', cleaningFee:'4.50' });
    const response = await fetch(`${base}/api/v1${availabilityPath(unit.id)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({ success:true, message:'Yêu cầu thành công.', data:{ isAvailable:true,totalNights:4,
      quoteToken:expect.any(String),quoteExpiresAt:expect.any(String),priceBreakdown:{
      nightlyPrices:[{ date:'2026-10-22',price:101 },{ date:'2026-10-23',price:110 },{ date:'2026-10-24',price:110 },{ date:'2026-10-25',price:101 }],
      baseAmount:422,cleaningFee:5,serviceFee:0,taxAmount:0,totalAmount:427,
    } } });
    const inspection = await inspectHomestay(unit.id);
    expect((await verifyHomestayQuote(body.data.quoteToken,{ unitId:unit.id,checkIn:'2026-10-22',checkOut:'2026-10-26',adults:2,children:1 },inspection)).priceChanged).toBe(false);
    expect(await prisma.booking.count()).toBe(0); expect(await prisma.bookingIdempotency.count()).toBe(0);
    const spec = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Fixture').setVersion('1').build());
    const operation = spec.paths['/api/v1/homestays/check-availability'].get!;
    expect(operation.parameters?.map(parameter => 'name' in parameter ? parameter.name : '')).toEqual(expect.arrayContaining(['unitId','checkIn','checkOut','adults','children']));
    expect(operation.responses).toHaveProperty('200');
    expect(operation.responses).toHaveProperty('429');
    expect(operation.responses).toHaveProperty('503');
    expect(spec.paths['/api/v1/bookings/hold']).toHaveProperty('post');
  });

  function calendarPath(unitId:string,overrides:Record<string,string> = {}) {
    return `/homestays/units/${unitId}/calendar?` + new URLSearchParams({ month:'2026-10',adults:'2',children:'1',...overrides });
  }

  it('public calendar emits the exact daily projection for blocked and held dates without reasons or private data',async () => {
    const { unit } = await homestayFixture();
    await prisma.calendarPricing.create({ data:{ homestayUnitId:unit.id,date:new Date('2026-10-23'),customPrice:900000,status:'BLOCKED' } });
    await prisma.booking.create({ data:await bookingData(unit.id,{ checkInDate:new Date('2026-10-24'),checkOutDate:new Date('2026-10-26') }) });
    const response = await fetch(`${base}/api/v1${calendarPath(unit.id)}`); const body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(body.data).sort()).toEqual(['days','month','timeZone','unitId']);
    expect(body.data.days).toHaveLength(31);
    for (const day of body.data.days) expect(Object.keys(day).sort()).toEqual(['date','isAvailable','price']);
    expect(body.data.days.find((d:{ date:string }) => d.date==='2026-10-22')).toEqual({ date:'2026-10-22',isAvailable:true,price:600000 });
    expect(body.data.days.find((d:{ date:string }) => d.date==='2026-10-23')).toEqual({ date:'2026-10-23',isAvailable:false,price:900000 });
    expect(body.data.days.find((d:{ date:string }) => d.date==='2026-10-24')).toEqual({ date:'2026-10-24',isAvailable:false,price:750000 });
    expect(body.data.days.find((d:{ date:string }) => d.date==='2026-10-26').isAvailable).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/guest|bookingId|bookingCode|BLOCKED|BOOKED|PENDING_HOST_APPROVAL|commission|payout/);
    const spec = SwaggerModule.createDocument(app,new DocumentBuilder().setTitle('Fixture').setVersion('1').build());
    expect(spec.paths['/api/v1/homestays/units/{unitId}/calendar'].get!.responses).toHaveProperty('200');
    expect(spec.paths['/api/v1/bookings/hold']).toHaveProperty('post');
  });

  it.each([{ month:'0000-01' },{ month:'2026-13' },{ month:'2026-1' },{ adults:'0' },{ children:'-1' },{ bookingId:'private' },{ unitId:'extra' }])(
    'public calendar rejects invalid or extra query %j',async query => {
      const { unit } = await homestayFixture(); expect((await http(calendarPath(unit.id,query))).status).toBe(400);
    });

  it('public calendar rejects repeated/missing query and capacity overflow and keeps hidden cached content private',async () => {
    const { unit,property } = await homestayFixture();
    expect((await http(calendarPath(unit.id)+'&adults=1')).status).toBe(400);
    expect((await http(`/homestays/units/${unit.id}/calendar?month=2026-10`)).status).toBe(400);
    expect((await http(calendarPath(unit.id,{ adults:'3' }))).status).toBe(400);
    expect((await http(calendarPath('invalid'))).status).toBe(400);
    expect((await http(calendarPath(unit.id))).status).toBe(200);
    await prisma.property.update({ where:{ id:property.id },data:{ status:'HIDDEN' } });
    expect((await http(calendarPath(unit.id))).status).toBe(404);
    await prisma.property.update({ where:{ id:property.id },data:{ status:'PUBLISHED' } });
    await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ status:'PENDING_REVIEW' } });
    expect((await http(calendarPath(unit.id))).status).toBe(404);
    await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ status:'PUBLISHED' } });
    await prisma.user.update({ where:{ id:host.id },data:{ status:'BANNED' } });
    expect((await http(calendarPath(unit.id))).status).toBe(404);
  });

  it('cached calendar invalidation prevents stale data revival while fresh quotes always bypass it',async () => {
    const { unit } = await homestayFixture(); const calendar = app.get(HomestayCalendarService);
    const initial = await http(calendarPath(unit.id)); expect(initial.status).toBe(200);
    const redis = app.get(RedisService).client;
    const [,keys] = await redis.scan('0','MATCH',`${redisPrefix}homestay:calendar:${unit.id}:*`,'COUNT',1000);
    expect(keys).toHaveLength(1); const staleKey = keys[0].slice(redisPrefix.length);
    const stale = await redis.get(staleKey); const ttl = await redis.ttl(staleKey);
    expect(ttl).toBeGreaterThan(0); expect(ttl).toBeLessThanOrEqual(PUBLIC_CALENDAR_TTL_SECONDS);
    await prisma.calendarPricing.create({ data:{ homestayUnitId:unit.id,date:new Date('2026-10-23'),customPrice:900000,status:'BLOCKED' } });
    const fresh = await http(availabilityPath(unit.id)); expect(fresh.body.data.isAvailable).toBe(false);
    expect(fresh.body.data.priceBreakdown.nightlyPrices.find((n:{ date:string }) => n.date==='2026-10-23').price).toBe(900000);
    await calendar.invalidate(unit.id);
    // Simulate an old reader filling its old generation key after invalidation.
    await redis.set(staleKey,stale!,'EX',PUBLIC_CALENDAR_TTL_SECONDS);
    const changed = await http(calendarPath(unit.id));
    expect(changed.body.data.days.find((d:{ date:string }) => d.date==='2026-10-23')).toEqual({ date:'2026-10-23',isAvailable:false,price:900000 });
    await prisma.calendarPricing.deleteMany({ where:{ homestayUnitId:unit.id } }); await calendar.invalidate(unit.id);
    expect((await http(calendarPath(unit.id))).body.data.days.find((d:{ date:string }) => d.date==='2026-10-23')).toEqual({ date:'2026-10-23',isAvailable:true,price:750000 });
  });

  it('calendar cache does not bypass same-day policy/cutoff or a changed room capacity/base price',async () => {
    const { unit } = await homestayFixture(); const today = vietnamToday(); const month = today.slice(0,7);
    expect((await http(calendarPath(unit.id,{ month }))).status).toBe(200);
    await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ sameDayBookingCutoff:new Date('1970-01-01T00:00:00Z'),basePricePerNight:123456,weekendPricePerNight:123456 } });
    const changed = await http(calendarPath(unit.id,{ month }));
    expect(changed.body.data.days.find((d:{ date:string }) => d.date===today)).toEqual({ date:today,isAvailable:false,price:123456 });
    await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ maxGuests:2 } });
    expect((await http(calendarPath(unit.id,{ month }))).status).toBe(400);
  });

  it('malformed cached calendar is repaired, cached extra private fields are not projected, and cache outage fails closed',async () => {
    const { unit } = await homestayFixture(); await http(calendarPath(unit.id));
    const redis = app.get(RedisService).client;
    const [,keys] = await redis.scan('0','MATCH',`${redisPrefix}homestay:calendar:${unit.id}:*`,'COUNT',1000);
    const cacheKey = keys[0].slice(redisPrefix.length);
    await redis.set(cacheKey,'malformed-json','EX',PUBLIC_CALENDAR_TTL_SECONDS);
    expect((await http(calendarPath(unit.id))).status).toBe(200);
    const rows = JSON.parse((await redis.get(cacheKey))!);
    rows[0].guestName = 'Do not expose fixture'; rows[0].bookingCode = 'PRIVATE-FIXTURE';
    await redis.set(cacheKey,JSON.stringify(rows),'EX',PUBLIC_CALENDAR_TTL_SECONDS);
    const response = await http(calendarPath(unit.id)); expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/guestName|bookingCode|PRIVATE-FIXTURE/);
    const failed = vi.spyOn(redis,'get').mockRejectedValueOnce(new Error('Synthetic cache outage'));
    try {
      const error = await http(calendarPath(unit.id)); expect(error.status).toBe(503);
      expect(error.body.errorCode).toBe('CALENDAR_CACHE_UNAVAILABLE');
    } finally { failed.mockRestore(); }
  });

  it('quote zero returns normally and missing signing config fails closed without creating a booking',async () => {
    const { unit } = await homestayFixture({}, { basePricePerNight:0,weekendPricePerNight:0,cleaningFee:0 });
    const quote = await http(availabilityPath(unit.id));
    expect(quote.status).toBe(200); expect(quote.body.data.priceBreakdown.totalAmount).toBe(0);
    expect(typeof quote.body.data.quoteToken).toBe('string');
    const original = process.env.HOMESTAY_QUOTE_SECRET;
    try {
      process.env.HOMESTAY_QUOTE_SECRET = '';
      const failed = await http(availabilityPath(unit.id)); expect(failed.status).toBe(503);
      expect(failed.body.errorCode).toBe('QUOTE_SIGNING_NOT_CONFIGURED');
    } finally { process.env.HOMESTAY_QUOTE_SECRET = original; }
    expect(await prisma.booking.count()).toBe(0);
  });

  it.each([
    { adults:'' }, { adults:'true' }, { adults:'1.5' }, { adults:'0' }, { children:'-1' },
    { children:'' }, { children:'0.5' }, { unitId:'invalid' }, { checkIn:'2026-02-30' },
    { checkOut:'2026-10-22' }, { checkIn:'2026-1-01' }, { numChildren:'0' }, { childAges:'5' },
  ])('public availability HTTP rejects invalid/unknown query %j', async query => {
    const { unit } = await homestayFixture();
    const result = await http(availabilityPath(unit.id, query));
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
  });

  it('public availability requires adults/children and rejects repeated query values', async () => {
    const { unit } = await homestayFixture();
    const missing = new URLSearchParams({ unitId:unit.id,checkIn:'2026-10-22',checkOut:'2026-10-26' });
    expect((await http('/homestays/check-availability?' + missing)).status).toBe(400);
    expect((await http(availabilityPath(unit.id) + '&adults=1')).status).toBe(400);
  });

  it('public availability reports a blocked middle night and hides unpublished units/properties', async () => {
    const { unit, property } = await homestayFixture();
    await prisma.calendarPricing.create({ data:{ homestayUnitId:unit.id,date:new Date('2026-10-24'),status:'BLOCKED' } });
    expect((await http(availabilityPath(unit.id))).body.data.isAvailable).toBe(false);
    await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ status:'PENDING_REVIEW' } });
    expect((await http(availabilityPath(unit.id))).status).toBe(404);
    await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ status:'PUBLISHED' } });
    await prisma.property.update({ where:{ id:property.id },data:{ status:'HIDDEN' } });
    expect((await http(availabilityPath(unit.id))).status).toBe(404);
    expect((await http(availabilityPath(randomUUID()))).status).toBe(404);
  });

  it('public availability enforces per-room nights and combined guest capacity', async () => {
    const { unit } = await homestayFixture({}, { maxNights:3,maxGuests:2 });
    expect((await http(availabilityPath(unit.id))).body.errorCode).toBe('STAY_TOO_LONG');
    expect((await http(availabilityPath(unit.id,{ checkOut:'2026-10-25' }))).body.errorCode).toBe('INVALID_CAPACITY');
    expect((await http(availabilityPath(unit.id,{ checkOut:'2026-10-25',children:'0' }))).status).toBe(200);
  });

  it('public availability checks Vietnam today for Request-to-Book, closed Instant Book and past check-in', async () => {
    const { unit } = await homestayFixture({}, { instantBook:false });
    const today = vietnamToday();
    const tomorrow = new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
    const afterTomorrow = new Date(Date.parse(today+'T00:00:00Z')+2*86400000).toISOString().slice(0,10);
    expect((await http(availabilityPath(unit.id,{ checkIn:today,checkOut:tomorrow }))).body.errorCode).toBe('INVALID_CHECK_IN_DATE');
    expect((await http(availabilityPath(unit.id,{ checkIn:tomorrow,checkOut:afterTomorrow }))).status).toBe(200);
    await prisma.homestayUnit.update({ where:{ id:unit.id }, data:{ instantBook:true,sameDayBookingCutoff:new Date('1970-01-01T00:00:00Z') } });
    expect((await http(availabilityPath(unit.id,{ checkIn:today,checkOut:tomorrow }))).body.errorCode).toBe('SAME_DAY_BOOKING_CLOSED');
    expect((await http(availabilityPath(unit.id,{ checkIn:'2020-01-01',checkOut:'2020-01-02' }))).body.errorCode).toBe('INVALID_CHECK_IN_DATE');
  });

  it('public quote uses configured Decimal fees in test but production refuses nonzero fees until tax decisions', async () => {
    const { unit } = await homestayFixture({}, { basePricePerNight:'100.50',weekendPricePerNight:null,cleaningFee:'4.50',serviceFeeRate:'5',taxRate:'8',commissionRate:'10' });
    const query = { checkIn:'2026-10-22',checkOut:'2026-10-23' };
    const result = await http(availabilityPath(unit.id,query));
    expect(result.status).toBe(200);
    expect(result.body.data.priceBreakdown).toMatchObject({ baseAmount:101,cleaningFee:5,serviceFee:5,taxAmount:9,totalAmount:120 });
    const internal = await inspectHomestay(unit.id,query);
    expect(internal.commissionAmount.toString()).toBe('11');
    expect(internal.hostPayoutAmount.toString()).toBe('95');
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV='production';
      const blocked = await http(availabilityPath(unit.id,query));
      expect(blocked.status).toBe(503);
      expect(blocked.body.errorCode).toBe('PRICING_POLICY_NOT_CONFIGURED');
      await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ serviceFeeRate:0,taxRate:0 } });
      expect((await http(availabilityPath(unit.id,query))).status).toBe(200);
    } finally { process.env.NODE_ENV=previous; }
  });

  it('public availability shares the real Redis IP quota with public listings', async () => {
    const { unit } = await homestayFixture();
    const redis = app.get(RedisService).client;
    const key = `sprint2:limit:ip:${createHash('sha256').update('127.0.0.1').digest('hex')}`;
    await redis.set(key,String(sprint2RateLimits.ip),'EX',60);
    expect((await http(availabilityPath(unit.id))).status).toBe(429);
    expect((await http('/properties/long-term/search')).status).toBe(429);
  });

  it('public availability recalculates price after a DB change and never modifies the prior quote', async () => {
    const { unit } = await homestayFixture();
    const oldQuote = await http(availabilityPath(unit.id));
    expect(oldQuote.body.data.priceBreakdown.totalAmount).toBe(2850000);
    await prisma.calendarPricing.create({ data:{ homestayUnitId:unit.id,date:new Date('2026-10-23'),customPrice:'800000' } });
    await prisma.homestayUnit.update({ where:{ id:unit.id },data:{ cleaningFee:'150001',commissionRate:'12' } });
    const newQuote = await http(availabilityPath(unit.id));
    expect(newQuote.body.data.priceBreakdown.totalAmount).toBe(2900001);
    expect(oldQuote.body.data.priceBreakdown.totalAmount).toBe(2850000);
    expect(newQuote.body.data.priceBreakdown.nightlyPrices[1]).toEqual({ date:'2026-10-23',price:800000 });
    expect(newQuote.body.data.priceBreakdown).not.toHaveProperty('commissionAmount');
  });

  it('policy migration defaults and DB constraints match the approved per-room configuration', async () => {
    const { unit } = await homestayFixture();
    expect(unit.maxNights).toBe(90); expect(unit.maxGuests).toBeNull();
    expect(unit.sameDayBookingCutoff.toISOString().slice(11,19)).toBe('18:00:00');
    expect(unit.serviceFeeRate.toString()).toBe('0'); expect(unit.taxRate.toString()).toBe('0');
    expect(unit.commissionRate.toString()).toBe('10');
    for (const update of ['max_nights=0','max_nights=91','max_guests=0','commission_rate=7.99','commission_rate=12.01',
      'service_fee_rate=-1','tax_rate=100.01',"tax_rate='NaN'","same_day_booking_cutoff='24:00:00'"]) {
      await expect(database.query(`UPDATE homestay_units SET ${update} WHERE id=$1`,[unit.id])).rejects.toMatchObject({ code:'23514' });
    }
  });

  it('homestay availability reads missing-calendar nights and custom prices from real DB without creating bookings', async () => {
    const { unit } = await homestayFixture();
    await prisma.calendarPricing.createMany({ data: [
      { homestayUnitId: unit.id, date: new Date('2026-10-23'), customPrice: '900000' },
      { homestayUnitId: unit.id, date: new Date('2026-10-26'), status: 'BLOCKED' },
    ] });
    const result = await inspectHomestay(unit.id);
    expect(result.isAvailable).toBe(true);
    expect(result.totalNights).toBe(4);
    expect(result.baseAmount.toString()).toBe('2850000');
    expect(result.cleaningFee.toString()).toBe('150000');
    expect(result.nightlyPrices.map(row => row.date)).toEqual(['2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
    expect(result).not.toHaveProperty('guestId');
    expect(result).not.toHaveProperty('hostId');
    expect(await prisma.calendarPricing.count()).toBe(2);
  });

  it.each(['BLOCKED','BOOKED'])('homestay availability rejects a %s night in the middle, not just endpoints', async status => {
    const { unit } = await homestayFixture();
    await prisma.calendarPricing.create({ data: { homestayUnitId: unit.id, date: new Date('2026-10-24'), status } });
    expect((await inspectHomestay(unit.id)).isAvailable).toBe(false);
    expect((await inspectHomestay(unit.id, { checkOut: '2026-10-24' })).isAvailable).toBe(true);
    expect((await inspectHomestay(unit.id, { checkIn: '2026-10-25' })).isAvailable).toBe(true);
  });

  it.each([
    { status: 'PENDING_REVIEW' }, { status: 'HIDDEN' }, { status: 'REJECTED' },
    { deletedAt: new Date() }, { isAvailable: false }, { rentalMode: 'LONG_TERM' }, { propertyType: 'PHONG_TRO' },
  ])('homestay availability hides non-public or wrong-mode property %j', async overrides => {
    const { unit } = await homestayFixture(overrides);
    await expect(inspectHomestay(unit.id)).rejects.toMatchObject({ response: { errorCode: 'UNIT_NOT_FOUND' } });
  });

  it.each(['PENDING_REVIEW','HIDDEN','REJECTED'])('homestay availability hides a %s unit under a published property', async status => {
    const { unit } = await homestayFixture({}, { status });
    await expect(inspectHomestay(unit.id)).rejects.toMatchObject({ response: { errorCode: 'UNIT_NOT_FOUND' } });
  });

  it('homestay availability hides a banned Host and never falls back to another unit', async () => {
    const { unit } = await homestayFixture();
    await prisma.user.update({ where: { id: host.id }, data: { status: 'BANNED' } });
    await expect(inspectHomestay(unit.id)).rejects.toMatchObject({ response: { errorCode: 'UNIT_NOT_FOUND' } });
    await expect(inspectHomestay(randomUUID())).rejects.toMatchObject({ response: { errorCode: 'UNIT_NOT_FOUND' } });
  });

  it.each([
    { adults: 0 }, { adults: -1 }, { adults: 1.5 }, { adults: 3 },
    { children: -1 }, { children: 0.5 }, { children: 2 },
  ])('homestay availability validates independent adult/child capacity %j', async overrides => {
    const { unit } = await homestayFixture();
    await expect(inspectHomestay(unit.id, overrides)).rejects.toMatchObject({ response: { errorCode: 'INVALID_CAPACITY' } });
  });

  it('homestay availability handles leap nights and zero custom prices using real numeric/date columns', async () => {
    const { unit } = await homestayFixture({}, { weekendPricePerNight: null });
    await prisma.calendarPricing.create({ data: { homestayUnitId: unit.id, date: new Date('2028-02-29'), customPrice: '0' } });
    const result = await inspectHomestay(unit.id, { checkIn: '2028-02-28', checkOut: '2028-03-01' });
    expect(result.totalNights).toBe(2);
    expect(result.baseAmount.toString()).toBe('600000');
    await expect(inspectHomestay(unit.id, { checkIn: '2027-02-29', checkOut: '2027-03-01' }))
      .rejects.toMatchObject({ response: { errorCode: 'INVALID_DATE_RANGE' } });
  });

  it('homestay migration enforces unique night/FK/capacity/nonnegative prices without touching S2 data', async () => {
    const old = await fixture();
    const { unit } = await homestayFixture();
    const date = new Date('2026-10-24');
    await prisma.calendarPricing.create({ data: { homestayUnitId: unit.id, date } });
    await expect(prisma.calendarPricing.create({ data: { homestayUnitId: unit.id, date } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(database.query('UPDATE homestay_units SET max_adults=0 WHERE id=$1', [unit.id])).rejects.toMatchObject({ code: '23514' });
    await expect(database.query("UPDATE homestay_units SET base_price_per_night='NaN' WHERE id=$1", [unit.id])).rejects.toMatchObject({ code: '23514' });
    await expect(database.query('UPDATE calendar_pricing SET custom_price=-1 WHERE homestay_unit_id=$1', [unit.id])).rejects.toMatchObject({ code: '23514' });
    await expect(database.query('DELETE FROM homestay_units WHERE id=$1', [unit.id])).rejects.toMatchObject({ code: '23503' });
    expect(await prisma.property.findUnique({ where: { id: old.id }, select: { status: true } })).toEqual({ status: 'PUBLISHED' });
  });

  it('homestay migration upgrades the S2 schema while preserving a user, listing and appointment', async () => {
    if (!created || !/^trotot_listing_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Unsafe upgrade fixture target');
    const connection = await database.connect();
    try {
      await connection.query('CREATE SCHEMA homestay_upgrade_fixture');
      await connection.query('SET search_path=homestay_upgrade_fixture,public');
      for (const migration of ['20260928000000_sprint1_core','20261002000000_auth_handoff_fixes',
        '20261003000000_sprint2_listings','20261004000000_listing_moderation_audit']) {
        await connection.query(await readFile(resolve(`prisma/migrations/${migration}/migration.sql`), 'utf8'));
      }
      const ownerId = randomUUID(); const propertyId = randomUUID();
      await connection.query("INSERT INTO users(id,phone,password_hash,full_name,role) VALUES ($1,'0999999910','fixture','Preserved S2 owner','HOST')", [ownerId]);
      await connection.query("INSERT INTO address_provinces VALUES ('79','Fixture')");
      await connection.query("INSERT INTO address_wards VALUES ('26740','Fixture','79')");
      await connection.query(`INSERT INTO properties(id,host_id,title,slug,property_type,rental_mode,description,address_detail,
        province_code,ward_code,latitude,longitude,status) VALUES ($1,$2,'Preserved S2 listing','preserved-s2','PHONG_TRO',
        'LONG_TERM','Fixture','Fixture','79','26740',10.7,106.6,'PUBLISHED')`, [propertyId, ownerId]);
      await connection.query(`INSERT INTO viewing_appointments(property_id,tenant_id,tenant_name,tenant_phone,scheduled_date,scheduled_time)
        VALUES ($1,$2,'Fixture','0999999910','2026-10-22','15:00')`, [propertyId, ownerId]);
      await connection.query(await readFile(resolve('prisma/migrations/20261004010000_homestay_availability/migration.sql'), 'utf8'));
      await connection.query(`INSERT INTO homestay_units(property_id,unit_name,max_adults,max_children,bedrooms,bathrooms,
        base_price_per_night,cleaning_fee,check_in_time,check_out_time,cancellation_policy,instant_book)
        VALUES ($1,'Preserved old unit',2,1,1,1,123456.50,100,'14:00','12:00','FLEXIBLE',true)`,[propertyId]);
      await connection.query(await readFile(resolve('prisma/migrations/20261004020000_homestay_stay_pricing_policy/migration.sql'), 'utf8'));
      await connection.query(await readFile(resolve('prisma/migrations/20261004030000_booking_inventory_snapshots/migration.sql'), 'utf8'));
      await connection.query(await readFile(resolve('prisma/migrations/20261004040000_booking_nightly_snapshot_integrity/migration.sql'), 'utf8'));
      await connection.query(await readFile(resolve('prisma/migrations/20261004050000_booking_lifecycle/migration.sql'), 'utf8'));
      await connection.query(await readFile(resolve('prisma/migrations/20261004060000_homestay_management/migration.sql'), 'utf8'));
      await connection.query(await readFile(resolve('prisma/migrations/20261004070000_calendar_idempotency/migration.sql'), 'utf8'));
      await connection.query(await readFile(resolve('prisma/migrations/20261004080000_catalog_provenance/migration.sql'), 'utf8'));
      expect((await connection.query('SELECT full_name,session_version FROM users')).rows).toEqual([{ full_name: 'Preserved S2 owner', session_version: 0 }]);
      expect((await connection.query('SELECT title,status FROM properties')).rows).toEqual([{ title: 'Preserved S2 listing', status: 'PUBLISHED' }]);
      expect((await connection.query('SELECT count(*)::int AS n FROM viewing_appointments')).rows[0].n).toBe(1);
      expect((await connection.query(`SELECT unit_name,base_price_per_night::text,max_nights,max_guests,
        same_day_booking_cutoff::text,service_fee_rate::text,tax_rate::text,commission_rate::text FROM homestay_units`)).rows).toEqual([{
        unit_name:'Preserved old unit',base_price_per_night:'123456.50',max_nights:90,max_guests:null,
        same_day_booking_cutoff:'18:00:00',service_fee_rate:'0.00',tax_rate:'0.00',commission_rate:'10.00',
      }]);
      expect((await connection.query('SELECT count(*)::int AS n FROM calendar_pricing')).rows[0].n).toBe(0);
      expect((await connection.query('SELECT count(*)::int AS n FROM bookings')).rows[0].n).toBe(0);
      expect((await connection.query('SELECT count(*)::int AS n FROM booking_idempotency')).rows[0].n).toBe(0);
    } finally {
      await connection.query('SET search_path=public');
      await connection.query('DROP SCHEMA IF EXISTS homestay_upgrade_fixture CASCADE');
      connection.release();
    }
  });

  it('migrates from Sprint 1 while preserving its user, and builds geography indexes/coordinates', async () => {
    const connection = await database.connect();
    try {
      await connection.query('CREATE SCHEMA upgrade_fixture'); await connection.query('SET search_path=upgrade_fixture,public');
      for (const migration of ['20260928000000_sprint1_core','20261002000000_auth_handoff_fixes']) {
        await connection.query(await readFile(resolve(`prisma/migrations/${migration}/migration.sql`),'utf8'));
      }
      await connection.query("INSERT INTO users(phone,password_hash,full_name) VALUES ('0999999900','fixture','Preserved S1 user')");
      await connection.query(await readFile(resolve('prisma/migrations/20261003000000_sprint2_listings/migration.sql'),'utf8'));
      expect((await connection.query('SELECT full_name,session_version FROM users')).rows).toEqual([{ full_name: 'Preserved S1 user', session_version: 0 }]);
    } finally {
      await connection.query('SET search_path=public'); await connection.query('DROP SCHEMA IF EXISTS upgrade_fixture CASCADE'); connection.release();
    }
    const record = await fixture();
    const point = (await database.query('SELECT ST_X(location) AS lng,ST_Y(location) AS lat,ST_SRID(location) AS srid FROM properties WHERE id=$1',[record.id])).rows[0];
    expect(point).toEqual({ lng: input.longitude, lat: input.latitude, srid: 4326 });
    expect((await database.query("SELECT indexdef FROM pg_indexes WHERE indexname='idx_properties_location_geography'")).rows[0].indexdef).toContain('geography');
  });

  it('shares an atomic public IP limit across search/detail/catalog and cannot bypass it with forwarding headers', async () => {
    const redis = app.get(RedisService).client;
    const key = `sprint2:limit:ip:${createHash('sha256').update('127.0.0.1').digest('hex')}`;
    await redis.set(key, String(sprint2RateLimits.ip - 1), 'EX', 60);
    const results = await Promise.all([http('/amenities'), http('/properties/long-term/search')]);
    expect(results.map(result => result.status).sort()).toEqual([200,429]);
    expect(results.find(result => result.status === 429)!.body.errorCode).toBe('RATE_LIMITED');
    const bypass = await fetch(`${base}/api/v1/properties/fixture-hidden`, {
      headers: { 'x-forwarded-for':'203.0.113.99','x-trotot-client-ip':'203.0.113.99' },
    });
    expect(bypass.status).toBe(429);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    // Verify real TTL expiration without waiting an entire minute in a test.
    await redis.pexpire(key, 1);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect((await http('/amenities')).status).toBe(200);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });

  it('serializes the last write slot across create/hide/delete/promotion and isolates different users', async () => {
    const redis = app.get(RedisService).client;
    const record = await fixture();
    const key = `sprint2:limit:write:${createHash('sha256').update(host.id).digest('hex')}`;
    await redis.set(key, String(sprint2RateLimits.write - 1), 'EX', 60);
    const results = await Promise.all([submit(), http(`/host/properties/${record.id}/hide`,'POST',{ expectedVersion:1 },host.token)]);
    expect(results.filter(result => [200,201].includes(result.status))).toHaveLength(1);
    expect(results.filter(result => result.status === 429)).toHaveLength(1);
    expect((await http(`/host/properties/${record.id}`,'DELETE',{ expectedVersion:2 },host.token)).status).toBe(429);
    expect((await http('/auth/become-host','POST',{},host.token)).status).toBe(429);
    expect(await prisma.property.findUnique({ where:{ id:record.id } })).toMatchObject({ deletedAt:null });
    expect((await http(`/host/properties/${record.id}`,'GET',undefined,host.token)).status).toBe(200);
    expect((await submit(input,otherHost)).status).toBe(201);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
  });

  it('blocks an exhausted Admin write bucket before approval changes listing state', async () => {
    const redis = app.get(RedisService).client; const record = await fixture('PENDING_REVIEW');
    const key = `sprint2:limit:write:${createHash('sha256').update(reviewer.id).digest('hex')}`;
    await redis.set(key, String(sprint2RateLimits.write), 'EX', 60);
    const result = await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion:1 },reviewer.token);
    expect(result.status).toBe(429); expect(result.body.errorCode).toBe('RATE_LIMITED');
    expect(await prisma.property.findUnique({ where:{ id:record.id } })).toMatchObject({ status:'PENDING_REVIEW',version:1 });
    expect((await http(`/admin/properties/${record.id}`,'GET',undefined,reviewer.token)).status).toBe(200);
    const secondAdmin = await account('ADMIN');
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion:1 },secondAdmin.token)).status).toBe(200);
  });

  it('shares private read limit across routes while keeping write requests available', async () => {
    const redis = app.get(RedisService).client; const record = await fixture();
    const key = `sprint2:limit:read:${createHash('sha256').update(host.id).digest('hex')}`;
    await redis.set(key, String(sprint2RateLimits.read - 1), 'EX', 60);
    const results = await Promise.all([http('/host/properties','GET',undefined,host.token),http(`/host/properties/${record.id}`,'GET',undefined,host.token)]);
    expect(results.map(result => result.status).sort()).toEqual([200,429]);
    const head = await fetch(`${base}/api/v1/host/properties/${record.id}`, { method:'HEAD',headers:{ authorization:`Bearer ${host.token}` } });
    expect(head.status).toBe(429);
    expect(await redis.get(`sprint2:limit:write:${createHash('sha256').update(host.id).digest('hex')}`)).toBeNull();
    expect((await http(`/host/properties/${record.id}/availability`,'POST',{ expectedVersion:1,isAvailable:false },host.token)).status).toBe(200);
  });

  it('guards roles, owner reads/writes, and injected status/plan/ownership', async () => {
    expect((await http('/properties/long-term','POST',input)).status).toBe(401);
    expect((await submit(input,tenant)).status).toBe(403);
    for (const field of ['hostId','status','listingPlan','isVip','rentalMode']) {
      expect((await submit({ ...input, [field]: field === 'status' ? 'PUBLISHED' : 'spoofed' })).status).toBe(400);
    }
    const record = (await submit()).body.data;
    expect(record).toMatchObject({ hostId: host.id, status: 'PENDING_REVIEW', listingPlan: 'FREE', districtCode: null });
    expect((await http(`/host/properties/${record.id}`,'GET',undefined,otherHost.token)).status).toBe(404);
    expect((await http(`/host/properties/${record.id}`,'PUT',{ ...input, expectedVersion: record.version },otherHost.token)).status).toBe(404);
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion: record.version },host.token)).status).toBe(403);
  });

  it('counts only active FREE long-term listings and serializes simultaneous quota requests', async () => {
    for (const status of ['DRAFT','REJECTED','EXPIRED']) await fixture(status);
    await fixture('PUBLISHED',{ deletedAt: new Date() });
    await fixture('PUBLISHED',{ rentalMode: 'SHORT_TERM' });
    await fixture('PUBLISHED',{ listingPlan: 'PAID' });
    const results = await Promise.all([submit(),submit(),submit()]);
    expect(results.map(result => result.status).sort()).toEqual([201,201,409]);
    expect(results.find(result => result.status === 409)!.body.errorCode).toBe('FREE_LISTING_LIMIT');
    expect(await prisma.property.count({ where: { hostId: host.id, listingPlan: 'FREE', rentalMode: 'LONG_TERM', deletedAt: null, status: { in: ['PENDING_REVIEW','PUBLISHED','HIDDEN'] } } })).toBe(2);
  });

  it('counts hidden/published/pending and frees quota only after rejection or soft delete', async () => {
    const a = await fixture('HIDDEN'); const b = await fixture('PENDING_REVIEW');
    expect((await submit()).status).toBe(409);
    expect((await http(`/admin/properties/${b.id}/reject`,'POST',{ expectedVersion: b.version },reviewer.token)).status).toBe(200);
    expect((await submit()).status).toBe(201);
    expect((await http(`/host/properties/${b.id}`,'PUT',{ ...input, expectedVersion: b.version + 1 },host.token)).body.errorCode).toBe('FREE_LISTING_LIMIT');
    expect((await http(`/host/properties/${a.id}`,'DELETE',{ expectedVersion: a.version },host.token)).status).toBe(200);
    expect((await http(`/host/properties/${b.id}`,'PUT',{ ...input, expectedVersion: b.version + 1 },host.token)).status).toBe(200);
  });

  it('never exposes unpublished/deleted listings through search/detail, including cached detail', async () => {
    const published = await fixture();
    for (const state of ['DRAFT','PENDING_REVIEW','REJECTED','HIDDEN','EXPIRED']) {
      const record = await fixture(state);
      expect((await http(`/properties/${record.slug}`)).status).toBe(404);
    }
    await fixture('PUBLISHED',{ deletedAt: new Date() });
    const search = await http('/properties/long-term/search');
    expect(search.body.data.map((record: { id: string }) => record.id)).toEqual([published.id]);
    expect(search.body.meta).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    const detail = await http(`/properties/${published.slug}`);
    expect(detail.body.data).not.toHaveProperty('hostId'); expect(detail.body.data).not.toHaveProperty('revision');
    expect(detail.body.data.host).not.toHaveProperty('passwordHash');
    expect(await app.get(RedisService).client.ttl(`listing:public:v2:${published.id}:v1`)).toBeGreaterThan(0);
    await http(`/host/properties/${published.id}/hide`,'POST',{ expectedVersion: 1 },host.token);
    expect((await http(`/properties/${published.slug}`)).status).toBe(404);
  });

  it('records one moderation audit with server actor/version and does not audit denied/stale reviews', async () => {
    const record = await fixture('PENDING_REVIEW');
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion:1, actorId:host.id },reviewer.token)).status).toBe(400);
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion:1 },tenant.token)).status).toBe(403);
    const reviewed = await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion:1 },reviewer.token);
    expect(reviewed.status).toBe(200);
    expect((await http(`/admin/properties/${record.id}/reject`,'POST',{ expectedVersion:1 },reviewer.token)).status).toBe(409);
    const events = (await database.query('SELECT actor_id,action,target,reviewed_version,result_version,status_before,status_after,created_at FROM listing_moderation_events WHERE property_id=$1',[record.id])).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({actor_id:reviewer.id,action:'APPROVE',target:'LISTING',reviewed_version:1,result_version:2,status_before:'PENDING_REVIEW',status_after:'PUBLISHED'});
    expect(events[0].created_at).toBeInstanceOf(Date);
    expect((await http(`/properties/${record.slug}`)).body.data).not.toHaveProperty('moderationEvents');
    expect((await http(`/host/properties/${record.id}`,'DELETE',{expectedVersion:2},host.token)).status).toBe(200);
    expect((await http(`/admin/properties/${record.id}`,'GET',undefined,reviewer.token)).status).toBe(404);
    expect((await database.query('SELECT count(*)::int AS n FROM listing_moderation_events WHERE property_id=$1',[record.id])).rows[0].n).toBe(1);
  });

  it('rolls back listing review if its durable audit cannot commit', async () => {
    const record = await fixture('PENDING_REVIEW');
    await database.query(`CREATE FUNCTION test_reject_audit() RETURNS trigger AS $audit$ BEGIN RAISE EXCEPTION 'Test audit failure'; END $audit$ LANGUAGE plpgsql;
      CREATE TRIGGER test_reject_audit BEFORE INSERT ON listing_moderation_events FOR EACH ROW EXECUTE FUNCTION test_reject_audit();`);
    try {
      expect((await http(`/admin/properties/${record.id}/approve`,'POST',{expectedVersion:1},reviewer.token)).status).toBe(500);
      expect(await prisma.property.findUnique({where:{id:record.id}})).toMatchObject({status:'PENDING_REVIEW',version:1});
      expect((await database.query('SELECT count(*)::int AS n FROM listing_moderation_events WHERE property_id=$1',[record.id])).rows[0].n).toBe(0);
      expect((await http(`/properties/${record.slug}`)).status).toBe(404);
    } finally { await database.query('DROP TRIGGER test_reject_audit ON listing_moderation_events; DROP FUNCTION test_reject_audit();'); }
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{expectedVersion:1},reviewer.token)).status).toBe(200);
  });

  it('audits only the winner of concurrent revision approval/rejection and preserves Host hiding', async () => {
    const record=await fixture('HIDDEN');
    await http(`/host/properties/${record.id}`,'PUT',{...input,title:'Audit revision',expectedVersion:1},host.token);
    const results=await Promise.all(['approve','reject'].map(action=>http(`/admin/properties/${record.id}/${action}`,'POST',{expectedVersion:2},reviewer.token)));
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const events=(await database.query('SELECT actor_id,action,target,reviewed_version,result_version,status_before,status_after FROM listing_moderation_events WHERE property_id=$1',[record.id])).rows;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({actor_id:reviewer.id,target:'REVISION',reviewed_version:2,result_version:3,status_before:'HIDDEN',status_after:'HIDDEN'});
    expect(events[0].action).toBe(results[0].status===200?'APPROVE':'REJECT');
    expect((await http(`/properties/${record.slug}`)).status).toBe(404);
  });

  it('preserves the approved snapshot until pending revision is reviewed and rejects stale approval', async () => {
    const record = await fixture();
    await http(`/properties/${record.slug}`); // Warm Redis with approved data.
    const updated = await http(`/host/properties/${record.id}`,'PUT',{ ...input, title: 'Pending new title', monthlyPrice: 5000000, expectedVersion: 1 },host.token);
    expect(updated.status).toBe(200); expect(updated.body.data.title).toBe(input.title);
    expect(updated.body.data.revision.content.title).toBe('Pending new title');
    expect((await http(`/properties/${record.slug}`)).body.data.monthlyPrice).toBe(3500000);
    expect((await http('/properties/long-term/search')).body.data[0].title).toBe(input.title);
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion: 1 },reviewer.token)).body.errorCode).toBe('STALE_LISTING_VERSION');
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion: 2 },reviewer.token)).status).toBe(200);
    const approved = (await http(`/properties/${record.slug}`)).body.data;
    expect(approved.title).toBe('Pending new title'); expect(approved.monthlyPrice).toBe(5000000); expect(approved.slug).toBe(record.slug);
    expect(await prisma.propertyRevision.count({ where: { propertyId: record.id } })).toBe(0);
  });

  it('rejects a revision without removing approved content, and serializes approve versus reject', async () => {
    const record = await fixture();
    await http(`/host/properties/${record.id}`,'PUT',{ ...input, title: 'Unapproved title', expectedVersion: 1 },host.token);
    expect((await http(`/admin/properties/${record.id}/reject`,'POST',{ expectedVersion: 2 },reviewer.token)).status).toBe(200);
    expect((await http(`/properties/${record.slug}`)).body.data.title).toBe(input.title);
    expect((await http(`/host/properties/${record.id}`,'GET',undefined,host.token)).body.data.revision.status).toBe('REJECTED');
    await http(`/host/properties/${record.id}`,'PUT',{ ...input, title: 'Second revision', expectedVersion: 3 },host.token);
    const results = await Promise.all(['approve','reject'].map(action => http(`/admin/properties/${record.id}/${action}`,'POST',{ expectedVersion: 4 },reviewer.token)));
    expect(results.map(result => result.status).sort()).toEqual([200,409]);
  });

  it('applies visibility/availability immediately; revision approval never undoes Host hiding or availability', async () => {
    const record = await fixture();
    await http(`/host/properties/${record.id}`,'PUT',{ ...input, title: 'Next approved title', expectedVersion: 1 },host.token);
    expect((await http(`/host/properties/${record.id}/availability`,'POST',{ expectedVersion: 2, isAvailable: false },host.token)).status).toBe(200);
    expect((await http(`/properties/${record.slug}`)).body.data.isAvailable).toBe(false);
    await http(`/host/properties/${record.id}/hide`,'POST',{ expectedVersion: 3 },host.token);
    const reviewed = await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion: 4 },reviewer.token);
    expect(reviewed.body.data.status).toBe('HIDDEN'); expect((await http(`/properties/${record.slug}`)).status).toBe(404);
    await http(`/host/properties/${record.id}/show`,'POST',{ expectedVersion: 5 },host.token);
    const shown = (await http(`/properties/${record.slug}`)).body.data;
    expect(shown.title).toBe('Next approved title'); expect(shown.isAvailable).toBe(false);
  });

  it('blocks deletion for upcoming pending/accepted appointments, allows hiding, and preserves appointment history on soft delete', async () => {
    for (const state of ['PENDING','ACCEPTED']) {
      const record = await fixture();
      const appointment = await prisma.viewingAppointment.create({ data: { propertyId: record.id, tenantId: tenant.id,
        tenantName: 'Fixture tenant', tenantPhone: '0990000000', scheduledDate: new Date('2099-10-15T00:00:00Z'), scheduledTime: new Date('1970-01-01T15:30:00Z'), status: state } });
      const deletion = await http(`/host/properties/${record.id}`,'DELETE',{ expectedVersion: 1 },host.token);
      expect(deletion.status).toBe(409); expect(deletion.body.errorCode).toBe('UPCOMING_APPOINTMENTS');
      expect((await http(`/host/properties/${record.id}/hide`,'POST',{ expectedVersion: 1 },host.token)).status).toBe(200);
      await prisma.viewingAppointment.update({ where: { id: appointment.id }, data: { scheduledDate: new Date('2000-01-01T00:00:00Z') } });
      expect((await http(`/host/properties/${record.id}`,'DELETE',{ expectedVersion: 2 },host.token)).status).toBe(200);
      expect(await prisma.viewingAppointment.findUnique({ where: { id: appointment.id } })).not.toBeNull();
      expect((await http(`/host/properties/${record.id}`,'GET',undefined,host.token)).status).toBe(404);
      expect((await http(`/properties/${record.slug}`)).status).toBe(404);
      expect((await prisma.property.findUniqueOrThrow({ where: { id: record.id } })).deletedAt).not.toBeNull();
    }
  });

  it('filters actual prices/area/province/amenities, orders ties deterministically, and validates queries', async () => {
    const catalog = await http('/amenities');
    expect(catalog.status).toBe(200);
    expect(catalog.body.data.find((item: { id: string }) => item.id === 'wifi').name).toBe('Wi-Fi');
    expect(await app.get(RedisService).client.ttl('catalog:amenities:v1')).toBeGreaterThan(86000);
    const a = await fixture(); const b = await fixture('PUBLISHED',{ provinceCode: '01', wardCode: '00001' });
    await prisma.longTermDetail.update({ where: { propertyId: b.id }, data: { monthlyPrice: 8000000, areaSqm: 60 } });
    await prisma.propertyAmenityMapping.create({ data: { propertyId: b.id, amenityId: 'air_cond' } });
    const found = await http('/properties/long-term/search?province=79&maxPrice=4000000&maxArea=30&amenities=wifi');
    expect(found.body.data.map((record: { id: string }) => record.id)).toEqual([a.id]);
    expect((await http('/properties/long-term/search?amenities=air_cond')).body.data[0].id).toBe(b.id);
    expect((await http('/properties/long-term/search?sortBy=price_desc')).body.data.map((record: { id: string }) => record.id)).toEqual([b.id,a.id]);
    const one = await http('/properties/long-term/search?sortBy=price_asc&limit=1&page=1');
    const two = await http('/properties/long-term/search?sortBy=price_asc&limit=1&page=2');
    expect(one.body.meta).toMatchObject({ total: 2, totalPages: 2 }); expect(one.body.data[0].id).not.toBe(two.body.data[0].id);
    for (const query of ['page=0','limit=101','maxPrice=','maxPrice=true','minPrice=5&maxPrice=4','province=%27%20OR%201=1','lat=91','sortBy=DROP_TABLE','hostId=spoofed']) {
      expect((await http(`/properties/long-term/search?${query}`)).status,query).toBe(400);
    }
    expect((await http('/properties/long-term/search?amenities=wifi,air_cond')).body.data.map((record: { id: string }) => record.id)).toEqual([b.id]);
    const empty = await http('/properties/long-term/search?minPrice=9000000'); expect(empty.body.data).toEqual([]); expect(empty.body.meta.total).toBe(0);
  });

  it('uses real geography meters and requires a complete center for distance sorting', async () => {
    const a = await fixture('PUBLISHED',{ latitude: 0, longitude: 0 });
    const b = await fixture('PUBLISHED',{ latitude: 0, longitude: 0.01 });
    const inside = await http('/properties/long-term/search?lat=0&lng=0&radius=1000&sortBy=distance_asc');
    expect(inside.body.data.map((record: { id: string }) => record.id)).toEqual([a.id]);
    const both = await http('/properties/long-term/search?lat=0&lng=0&radius=2000&sortBy=distance_asc');
    expect(both.body.data.map((record: { id: string }) => record.id)).toEqual([a.id,b.id]);
    expect(both.body.data[1].distanceMeters).toBeGreaterThan(1100); expect(both.body.data[1].distanceMeters).toBeLessThan(1120);
    for (const query of ['radius=1000','lat=0','sortBy=distance_asc']) expect((await http(`/properties/long-term/search?${query}`)).status).toBe(400);
  });

  it('rejects mismatched address, unknown amenities, oversized images, unavailable media and wrong DTO types without partial writes', async () => {
    for (const payload of [
      { ...input, wardCode: '00001' }, { ...input, amenityIds: ['unknown'] }, { ...input, monthlyPrice: '3500000' },
      { ...input, imageUrls: Array.from({ length: 16 },(_,i) => `https://example.com/${i}.webp`) },
      { ...input, latitude: 91 }, { ...input, areaSqm: 0 }, { ...input, allowPets: 'false' },
    ]) expect((await submit(payload)).status).toBe(400);
    expect((await submit({ ...input, imageUrls: ['https://example.com/one.webp'] })).body.errorCode).toBe('MEDIA_SERVER_NOT_CONFIGURED');
    expect(await prisma.property.count({ where: { hostId: host.id } })).toBe(0);
    const valid = await submit(); expect(valid.status).toBe(201);
    await expect(prisma.propertyImage.create({ data: { propertyId: valid.body.data.id, url: 'fixture', position: 15 } })).rejects.toThrow();
  });

  it('uses current DB roles rather than trusting a previously issued Admin JWT', async () => {
    const record = await fixture('PENDING_REVIEW');
    await prisma.user.update({ where: { id: reviewer.id }, data: { role: 'TENANT' } });
    expect((await http(`/admin/properties/${record.id}/approve`,'POST',{ expectedVersion: 1 },reviewer.token)).status).toBe(403);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: record.id } })).status).toBe('PENDING_REVIEW');
  });

  it('isolates Host lists and Admin queue/detail, including revisions on hidden listings', async () => {
    const a = await fixture('PENDING_REVIEW');
    const b = await fixture('HIDDEN',{ hostId: otherHost.id });
    await http(`/host/properties/${b.id}`,'PUT',{ ...input, title: 'Other host revision', expectedVersion: 1 },otherHost.token);
    const own = await http('/host/properties','GET',undefined,host.token);
    expect(own.body.data.map((record: { id: string }) => record.id)).toEqual([a.id]);
    expect(own.body.meta.total).toBe(1);
    expect((await http('/admin/properties','GET',undefined,host.token)).status).toBe(403);
    expect((await http(`/admin/properties/${a.id}`,'GET',undefined,tenant.token)).status).toBe(403);
    const queue = await http('/admin/properties','GET',undefined,reviewer.token);
    expect(queue.body.data.map((record: { id: string }) => record.id).sort()).toEqual([a.id,b.id].sort());
    const detail = await http(`/admin/properties/${b.id}`,'GET',undefined,reviewer.token);
    expect(detail.body.data.version).toBe(2); expect(detail.body.data.revision.content.title).toBe('Other host revision');
    expect((await http('/host/properties?hostId=spoofed','GET',undefined,host.token)).status).toBe(400);
  });

  it('does not apply the FREE quota when resubmitting a PAID record; cancelled/completed appointments do not block soft delete', async () => {
    await fixture('PUBLISHED'); await fixture('HIDDEN');
    const paid = await fixture('REJECTED',{ listingPlan: 'PAID' });
    expect((await http(`/host/properties/${paid.id}`,'PUT',{ ...input, expectedVersion: 1 },host.token)).status).toBe(200);
    for (const status of ['CANCELLED','COMPLETED','REJECTED']) await prisma.viewingAppointment.create({ data: {
      propertyId: paid.id, tenantId: tenant.id, tenantName: 'Fixture tenant', tenantPhone: '0990000000', status,
      scheduledDate: new Date('2099-10-15T00:00:00Z'), scheduledTime: new Date('1970-01-01T15:30:00Z'),
    } });
    expect((await http(`/host/properties/${paid.id}`,'DELETE',{ expectedVersion: 2 },host.token)).status).toBe(200);
    expect(await prisma.viewingAppointment.count({ where: { propertyId: paid.id } })).toBe(3);
  });

  it.skipIf(process.env.LISTINGS_BROWSER !== '1')('Sprint 2 appointment and estimate UI works through real BFF/DB, retry, stale response and notifications', async () => {
    const password='AppointmentBrowserFixture123!';
    await prisma.user.updateMany({where:{id:{in:[host.id,tenant.id]}},data:{passwordHash:await bcrypt.hash(password,4)}});
    const room=await fixture('PUBLISHED',{title:'Appointment browser room',description:'Synthetic browser fixture only'});
    await prisma.longTermDetail.update({where:{propertyId:room.id},data:{electricityCost:'3500.5',waterCost:'20000.5',parkingFee:'120000.5'}});
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
      const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;for(let attempt=0;attempt<100;attempt++){
        if(frontend.exitCode!==null)throw new Error('Owned appointment frontend exited');
        ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));
      }expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const guestContext=await launched.newContext({viewport:{width:1440,height:1000}}),hostContext=await launched.newContext({viewport:{width:1440,height:1000}});
      for(const context of [guestContext,hostContext]) await context.route('**/*',(route:{request():{url():string};continue():Promise<void>;abort():Promise<void>})=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const guest=await guestContext.newPage(),owner=await hostContext.newPage();
      const login=async(page:typeof guest,id:string)=>{
        await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill((await prisma.user.findUniqueOrThrow({where:{id}})).phone);
        await page.getByLabel('Mật khẩu',{exact:true}).fill(password);await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      };
      await guest.goto(`${origin}/thue-phong-tro/${room.slug}`);
      await guest.getByTestId('cost-estimate-total').waitFor();
      expect(await guest.getByLabel('Điện (kWh/tháng)',{exact:true}).inputValue()).toBe('');
      expect(await guest.getByLabel('Nước (m³/tháng)',{exact:true}).inputValue()).toBe('');
      expect(await guest.getByLabel('Số xe gửi',{exact:true}).inputValue()).toBe('');
      const expected=await http(`/properties/${room.slug}/cost-estimate?electricityKwh=0.1&waterM3=0.1&vehicles=1`);
      await guest.getByLabel('Điện (kWh/tháng)',{exact:true}).fill('0.1');await guest.getByLabel('Nước (m³/tháng)',{exact:true}).fill('0.1');await guest.getByLabel('Số xe gửi',{exact:true}).fill('1');
      await guest.waitForFunction((total:string)=>document.querySelector('[data-testid=cost-estimate-total]')?.textContent===total,`${new Intl.NumberFormat('vi-VN').format(expected.body.data.totalMonthly)} đ`);
      expect(await guest.getByText('3.500,5 đ/kWh',{exact:false}).count()).toBe(1);
      // Failure injection changes transport only. All successful amounts still originate from the real server/DB.
      let costFailure=true,delayed=false,release:()=>void=()=>{};
      await guest.route('**/cost-estimate*',async(route:{request():{url():string};fetch():Promise<unknown>;fulfill(options:unknown):Promise<void>})=>{
        if(costFailure){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({success:false,errorCode:'FIXTURE_TRANSPORT_FAILURE',message:'Fixture temporary cost failure'})});return;}
        const response=await route.fetch();
        if(new URL(route.request().url()).searchParams.get('electricityKwh')==='15') {delayed=true;await new Promise<void>(done=>{release=done;});}
        try{await route.fulfill({response});}catch{/* The application deliberately aborts superseded requests. */}
      });
      const oldTotal=await guest.getByTestId('cost-estimate-total').textContent();
      await guest.getByLabel('Điện (kWh/tháng)',{exact:true}).fill('2');await guest.getByRole('alert').filter({hasText:'Fixture temporary cost failure'}).waitFor();
      expect(await guest.getByTestId('cost-estimate-total').textContent()).toBe(oldTotal);
      costFailure=false;await guest.getByRole('button',{name:'Thử lại',exact:true}).click();
      const retryExpected=await http(`/properties/${room.slug}/cost-estimate?electricityKwh=2&waterM3=0.1&vehicles=1`);
      await guest.waitForFunction((total:string)=>document.querySelector('[data-testid=cost-estimate-total]')?.textContent===total,`${new Intl.NumberFormat('vi-VN').format(retryExpected.body.data.totalMonthly)} đ`);
      await guest.getByLabel('Điện (kWh/tháng)',{exact:true}).fill('15');
      for(let attempt=0;attempt<60&&!delayed;attempt++) await new Promise(done=>setTimeout(done,50));expect(delayed).toBe(true);
      await guest.getByLabel('Điện (kWh/tháng)',{exact:true}).fill('3');
      const latest=await http(`/properties/${room.slug}/cost-estimate?electricityKwh=3&waterM3=0.1&vehicles=1`);
      const latestText=`${new Intl.NumberFormat('vi-VN').format(latest.body.data.totalMonthly)} đ`;
      await guest.waitForFunction((total:string)=>document.querySelector('[data-testid=cost-estimate-total]')?.textContent===total,latestText);
      release();await new Promise(done=>setTimeout(done,250));expect(await guest.getByTestId('cost-estimate-total').textContent()).toBe(latestText);
      await guest.unroute('**/cost-estimate*');
      if(process.env.APPOINTMENT_BROWSER_EVIDENCE_DIR){
        const evidence=process.env.APPOINTMENT_BROWSER_EVIDENCE_DIR;
        await mkdir(evidence,{recursive:true});
        for(const width of [375,768,1440,2560]){
          await guest.setViewportSize({width,height:1000});
          await guest.evaluate(async()=>{window.scrollTo(0,0);await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));});
          expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await guest.screenshot({path:resolve(evidence,`cost-estimate-${width}.png`),fullPage:true});
        }
        await promisify(execFile)(process.execPath,[resolve('../.agents/skills/ui-ux/scripts/probe.mjs'),`${origin}/thue-phong-tro/${room.slug}`,'--widths','375,768,1440,2560','--wait','1200','--out',resolve(evidence,'cost-probe'),'--pw',resolve(process.env.PLAYWRIGHT_PACKAGE_PATH!,'../..')],{timeout:90_000,windowsHide:true});
      }
      await login(guest,tenant.id);await login(owner,host.id);
      await guest.goto(`${origin}/thue-phong-tro/${room.slug}`);await guest.getByRole('button',{name:'Đặt lịch xem trọ',exact:true}).click();
      const date=new Date(`${vietnamToday(new Date())}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+1);const day=date.toISOString().slice(0,10);
      await guest.getByLabel('Ngày xem trọ (giờ Việt Nam)',{exact:true}).fill(day);await guest.getByLabel('Giờ xem trọ (giờ Việt Nam)',{exact:true}).fill('15:30');
      await guest.getByLabel('Ghi chú (không bắt buộc)',{exact:true}).fill('Literal <script>window.appointmentXss=1</script>');
      if(process.env.APPOINTMENT_BROWSER_EVIDENCE_DIR){await mkdir(process.env.APPOINTMENT_BROWSER_EVIDENCE_DIR,{recursive:true});for(const width of [375,768,1440,2560]){
        await guest.setViewportSize({width,height:1000});expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        const bounds=await guest.getByRole('dialog').boundingBox();expect(bounds?.x).toBeGreaterThanOrEqual(0);expect((bounds?.y??-1)).toBeGreaterThanOrEqual(0);expect((bounds?.height??Infinity)+(bounds?.y??0)).toBeLessThanOrEqual(1001);
        await guest.screenshot({path:resolve(process.env.APPOINTMENT_BROWSER_EVIDENCE_DIR,`appointment-modal-${width}.png`)});
      }}
      const keys:string[]=[];let dropFirst=true;
      await guest.route('**/api/management/appointments',async(route:{request():{method():string;headers():Record<string,string>};fetch():Promise<unknown>;abort():Promise<void>;fulfill(options:unknown):Promise<void>;continue():Promise<void>})=>{
        if(route.request().method()!=='POST'){await route.continue();return;}
        keys.push(route.request().headers()['idempotency-key']);const response=await route.fetch();
        if(dropFirst){dropFirst=false;await route.abort();}else await route.fulfill({response});
      });
      await guest.getByRole('button',{name:'Gửi yêu cầu xem trọ',exact:true}).click();await guest.getByRole('alert').filter({hasText:'Giữ nguyên thông tin'}).waitFor();
      await guest.getByRole('button',{name:'Gửi yêu cầu xem trọ',exact:true}).click();await guest.getByText('Đã gửi yêu cầu xem trọ. Chờ chủ nhà xác nhận; chưa gửi SMS/Zalo.',{exact:true}).waitFor();
      expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect(await prisma.viewingAppointment.count({where:{propertyId:room.id,tenantId:tenant.id}})).toBe(1);
      const appointment=await prisma.viewingAppointment.findFirstOrThrow({where:{propertyId:room.id}});
      expect(appointment.status).toBe('PENDING');expect(await prisma.appointmentNotification.count({where:{appointmentId:appointment.id,recipientId:host.id}})).toBe(1);
      await guest.getByRole('link',{name:'Xem lịch hẹn của tôi',exact:true}).click();await guest.getByRole('heading',{name:room.title,exact:true}).waitFor();
      expect(await guest.getByText('Khách:',{exact:false}).count()).toBe(0);
      await owner.goto(origin+'/notifications');await owner.getByRole('button',{name:/Có yêu cầu xem phòng mới/}).click();await owner.waitForURL(origin+'/host/appointments');
      await owner.getByRole('heading',{name:room.title,exact:true}).waitFor();
      expect(await owner.getByText('Khách:',{exact:false}).count()).toBe(1);
      await owner.getByRole('button',{name:'Xác nhận lịch',exact:true}).click();
      expect((await http(`/host/appointments/${appointment.id}/reject`,'POST',{expectedStatus:'PENDING',reason:'Other tab rejected'},host.token)).status).toBe(200);
      await owner.getByRole('dialog').getByRole('button',{name:'Xác nhận lịch',exact:true}).click();await owner.getByRole('button',{name:'Tải lại trạng thái mới nhất',exact:true}).waitFor();
      expect(await owner.getByRole('dialog').getByRole('button',{name:'Xác nhận lịch',exact:true}).isDisabled()).toBe(true);
      await owner.getByRole('button',{name:'Tải lại trạng thái mới nhất',exact:true}).click();await owner.getByRole('listitem').getByText('Bị từ chối',{exact:true}).waitFor();
      await guest.goto(`${origin}/thue-phong-tro/${room.slug}`);await guest.getByRole('button',{name:'Đặt lịch xem trọ',exact:true}).click();
      await guest.getByLabel('Ngày xem trọ (giờ Việt Nam)',{exact:true}).fill(day);await guest.getByLabel('Giờ xem trọ (giờ Việt Nam)',{exact:true}).fill('16:00');
      await guest.getByRole('button',{name:'Gửi yêu cầu xem trọ',exact:true}).click();await guest.getByRole('link',{name:'Xem lịch hẹn của tôi',exact:true}).click();
      await owner.reload();await owner.getByRole('button',{name:'Xác nhận lịch',exact:true}).click();await owner.getByRole('dialog').getByRole('button',{name:'Xác nhận lịch',exact:true}).click();
      await owner.getByRole('listitem').getByText('Đã xác nhận',{exact:true}).waitFor();
      await owner.getByRole('button',{name:'Hủy lịch',exact:true}).click();expect(await owner.getByRole('dialog').getByRole('button',{name:'Hủy lịch',exact:true}).isDisabled()).toBe(true);
      await owner.getByLabel('Lý do hủy (bắt buộc)',{exact:true}).fill('Literal <img src=x onerror=window.appointmentXss=2>');
      await owner.getByRole('dialog').getByRole('button',{name:'Hủy lịch',exact:true}).click();await owner.getByRole('listitem').getByText('Đã hủy',{exact:true}).waitFor();
      await guest.goto(origin+'/notifications');await guest.getByRole('button',{name:/Chủ nhà đã hủy lịch xem phòng/}).click();await guest.waitForURL(origin+'/my-appointments');await guest.getByRole('listitem').getByText('Đã hủy',{exact:true}).waitFor();
      expect(await guest.getByText('Literal <img src=x onerror=window.appointmentXss=2>',{exact:false}).count()).toBe(1);
      for(const page of [guest,owner])expect(await page.evaluate(()=>(window as unknown as {appointmentXss?:number}).appointmentXss)).toBeUndefined();
      await guest.goto(origin+'/account');await guest.getByRole('button',{name:'Đăng xuất',exact:true}).click();await guest.waitForURL(origin+'/');
      await guest.goto(origin+'/my-appointments');await guest.getByText('Cần đăng nhập để xem lịch hẹn và thông báo.',{exact:true}).waitFor();expect(await guest.getByRole('heading',{name:room.title,exact:true}).count()).toBe(0);
    } finally {await browser?.close();if(frontend.exitCode===null){const exited=once(frontend,'exit');frontend.kill();await exited;}}
  },180_000);

  it.skipIf(process.env.LISTINGS_BROWSER !== '1')('Host listing UI submits and edits through real BFF/DB, preserves revisions and handles stale actions', async () => {
    const password='HostBrowserFixture123!';
    await prisma.user.update({where:{id:host.id},data:{passwordHash:await bcrypt.hash(password,4)}});
    const phone=(await prisma.user.findUniqueOrThrow({where:{id:host.id}})).phone;
    await database.query("INSERT INTO address_catalog_metadata(id,version,as_of,source_url) VALUES(true,'fixture-browser-test','2026-10-04','https://example.test/fixture-only')");
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;for(let attempt=0;attempt<100;attempt++){
        if(frontend.exitCode!==null)throw new Error('Owned Host frontend exited');
        ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));
      }expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000},permissions:['geolocation'],geolocation:{latitude:input.latitude,longitude:input.longitude,accuracy:10},reducedMotion:'reduce'});
      // Only map tiles are synthetic; Auth/BFF/DB and browser geolocation stay native.
      await context.route('https://tile.openstreetmap.org/**',(route:{fulfill(options:unknown):Promise<void>})=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef3f0"/></svg>'}));
      // Keep the native network lifecycle for login + early unload/keepalive.
      const page=await context.newPage();await page.goto(origin+'/host/properties');
      const authEvents:string[]=[];
      page.on('response',(response:{url():string;status():number})=>{if(response.url().includes('/api/auth/'))authEvents.push(`${new URL(response.url()).pathname} HTTP ${response.status()}`);});
      page.on('requestfailed',(request:{url():string;failure():{errorText:string}|null})=>{if(request.url().includes('/api/auth/'))authEvents.push(`${new URL(request.url()).pathname} ${request.failure()?.errorText||'failed'}`);});
      await page.getByText('Cần đăng nhập để quản lý tin.',{exact:true}).waitFor();
      await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
      await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      await page.goto(origin+'/host/properties/create');
      try {await page.getByLabel('Tiêu đề',{exact:true}).waitFor();}
      catch(error){console.log('Host bootstrap diagnostic (fixture only)',JSON.stringify({authEvents,headings:await page.locator('h1').allTextContents(),alerts:await page.getByRole('alert').allTextContents()}));throw error;}
      await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
      expect(await page.locator('input[name=title]').evaluate((node:HTMLInputElement)=>node.validity.valueMissing)).toBe(true);
      await page.getByLabel('Tiêu đề',{exact:true}).fill('Host browser room');await page.locator('textarea[name=description]').fill('Fixture content <script>window.hostXss=1</script>');
      await page.getByRole('combobox',{name:'Tỉnh/thành phố',exact:true}).click();
      await page.getByRole('combobox',{name:'Tìm tỉnh/thành phố',exact:true}).fill('Fixture Province A');
      await page.getByRole('option',{name:'Fixture Province A',exact:true}).click();
      expect(await page.locator('input[name=provinceCode]').inputValue()).toBe('79');
      await page.getByRole('combobox',{name:'Phường/xã',exact:true}).click();
      await page.getByRole('combobox',{name:'Tìm phường/xã',exact:true}).fill('Fixture Ward A');
      await page.getByRole('option',{name:'Fixture Ward A',exact:true}).click();
      await page.locator('input[name=addressDetail]').fill(input.addressDetail);
      await page.getByRole('button',{name:'Dùng vị trí hiện tại',exact:true}).click();
      await expect.poll(async()=>page.locator('input[name=latitude]').inputValue()).toBe(input.latitude.toFixed(6));
      await expect.poll(async()=>page.locator('input[name=longitude]').inputValue()).toBe(input.longitude.toFixed(6));
      await page.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();
      await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
      expect(await page.locator('input[name=monthlyPrice]').inputValue()).toBe('');
      await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
      expect(await page.getByText('Cần kê khai khoản phí này. Chọn miễn phí / đã gồm trong giá thuê nếu giá là 0.',{exact:true}).count()).toBe(5);
      expect(await page.getByRole('button',{name:'Gửi tin để duyệt',exact:true}).isVisible()).toBe(false);
      for(const field of ['monthlyPrice','depositAmount','areaSqm','electricityCost','waterCost','internetCost','garbageCost','parkingFee'] as const) await page.locator(`input[name=${field}]`).fill(String(input[field]));
      for(const [name,label] of [['electricityCost','Điện (đ/kWh)'],['waterCost','Đơn giá nước (đ)'],['internetCost','Internet (đ/tháng)'],['garbageCost','Rác (đ/phòng/tháng)'],['parkingFee','Phí gửi xe (đ/xe/tháng)']]){
        await page.getByRole('button',{name:`${label}: Miễn phí / đã gồm trong giá thuê`,exact:true}).click();
        expect(await page.locator(`input[name=${name}]`).inputValue()).toBe('0');
      }
      expect(await page.getByText('Cần kê khai khoản phí này. Chọn miễn phí / đã gồm trong giá thuê nếu giá là 0.',{exact:true}).count()).toBe(0);
      // Manual editing stays available after choosing zero; do not persist a separate flag/contract.
      await page.locator('input[name=electricityCost]').fill('3500.50');
      await page.locator('input[name=amenityIds][value=wifi]').check();
      if(process.env.HOST_BROWSER_EVIDENCE_DIR){
        await mkdir(process.env.HOST_BROWSER_EVIDENCE_DIR,{recursive:true});
        for(const width of [375,768,1440,2560]){
          await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await page.evaluate(()=>window.scrollTo(0,0));
          await page.evaluate(()=>new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done()))));
          await page.screenshot({path:resolve(process.env.HOST_BROWSER_EVIDENCE_DIR,`host-prices-${width}.png`),fullPage:true});
        }
      }
      await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
      try {await page.locator('input[name=contactPhone]').waitFor({state:'visible'});}
      catch(error){console.log('Host step diagnostic (numeric fixture only)',JSON.stringify(await page.locator('fieldset[data-step="1"] input[type=number]').evaluateAll((nodes:HTMLInputElement[])=>nodes.map(node=>({name:node.name,value:node.value,valid:node.validity.valid,missing:node.validity.valueMissing,step:node.validity.stepMismatch})))));throw error;}
      await page.locator('input[name=contactPhone]').fill(input.contactPhone);
      await page.getByRole('button',{name:'Gửi tin để duyệt',exact:true}).click();await page.waitForURL(origin+'/host/properties');
      await page.getByRole('heading',{name:'Host browser room',exact:true}).waitFor();
      const record=await prisma.property.findFirstOrThrow({where:{hostId:host.id,title:'Host browser room'}});
      expect(Number(record.latitude)).toBe(input.latitude);expect(Number(record.longitude)).toBe(input.longitude);
      expect(record.provinceCode).toBe('79');expect(record.wardCode).toBe('26740');expect(record.districtCode).toBeNull();
      const declared=await prisma.longTermDetail.findUniqueOrThrow({where:{propertyId:record.id}});
      expect(declared.electricityCost.toString()).toBe('3500.5');
      for(const value of [declared.waterCost,declared.internetCost,declared.garbageCost,declared.parkingFee]) expect(value.toString()).toBe('0');
      const estimate=await http(`/properties/${record.slug}/cost-estimate`);expect(estimate.status).toBe(404);
      expect(record.status).toBe('PENDING_REVIEW');expect((await http(`/properties/${record.slug}`)).status).toBe(404);
      expect((await http(`/admin/properties/${record.id}/approve`,'POST',{expectedVersion:1},reviewer.token)).status).toBe(200);
      const free=await http(`/properties/${record.slug}/cost-estimate?waterM3=1&vehicles=1`);expect(free.status).toBe(200);
      expect(free.body.data.lines.filter((line:{status:string})=>line.status==='FREE')).toHaveLength(4);
      expect(free.body.data.totalMonthly).toBe(Number(input.monthlyPrice));
      await page.goto(`${origin}/thue-phong-tro/${record.slug}`);
      await page.getByLabel('Nước (m³/tháng)',{exact:true}).fill('1');await page.getByLabel('Số xe gửi',{exact:true}).fill('1');
      const costSection=page.locator('section[aria-labelledby=cost-estimate-heading]');
      await costSection.getByText('Miễn phí / đã gồm trong giá thuê',{exact:true}).nth(3).waitFor();
      expect(await costSection.getByText('Miễn phí / đã gồm trong giá thuê',{exact:true}).count()).toBe(4);
      expect(await page.getByTestId('cost-estimate-total').textContent()).toBe(`${new Intl.NumberFormat('vi-VN').format(Number(input.monthlyPrice))} đ`);
      await page.setViewportSize({width:375,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      if(process.env.HOST_BROWSER_EVIDENCE_DIR){await page.evaluate(async()=>{window.scrollTo(0,0);await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));});await page.screenshot({path:resolve(process.env.HOST_BROWSER_EVIDENCE_DIR,'host-cost-free-375.png'),fullPage:true});}
      await page.goto(origin+'/host/properties');
      // Reload before bootstrap is stable: regression for lost refresh cookies.
      {
        const refreshEvents:string[]=[];
        page.on('response',(response:{url():string;status():number})=>{if(response.url().endsWith('/api/auth/refresh'))refreshEvents.push(`HTTP ${response.status()}`);});
        page.on('requestfailed',(request:{url():string;failure():{errorText:string}|null})=>{if(request.url().endsWith('/api/auth/refresh'))refreshEvents.push(request.failure()?.errorText||'failed');});
        await page.reload();
        try {await page.getByRole('button',{name:'Ẩn tin',exact:true}).waitFor();}
        catch(error){
          const tokens=await database.query('SELECT count(*)::int AS total,count(*) FILTER(WHERE revoked_at IS NULL)::int AS active FROM refresh_tokens WHERE user_id=$1',[host.id]);
          console.log('Early reload diagnostic (fixture only)',JSON.stringify({refreshEvents,tokens:tokens.rows[0]}));
          throw error;
        }
      }
      await page.getByRole('button',{name:'Ẩn tin',exact:true}).waitFor();
      await page.reload();await page.getByRole('button',{name:'Ẩn tin',exact:true}).waitFor();
      await page.getByRole('link',{name:'Xem và sửa tin',exact:true}).click();await page.getByLabel('Tiêu đề',{exact:true}).fill('Host pending revision');
      expect(await page.locator('input[name=latitude]').inputValue()).toBe(input.latitude.toFixed(6));
      expect(await page.locator('input[name=longitude]').inputValue()).toBe(input.longitude.toFixed(6));
      await page.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();
      await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();await page.getByRole('button',{name:'Tiếp tục',exact:true}).click();
      await page.getByRole('button',{name:'Gửi bản sửa để duyệt',exact:true}).click();await page.waitForURL(origin+'/host/properties');
      await page.getByText(/Bản sửa: Chờ duyệt/).waitFor();expect((await http(`/properties/${record.slug}`)).body.data.title).toBe('Host browser room');
      const current=await prisma.property.findUniqueOrThrow({where:{id:record.id}});
      expect((await http(`/host/properties/${record.id}/availability`,'POST',{expectedVersion:current.version,isAvailable:false},host.token)).status).toBe(200);
      await page.getByRole('button',{name:'Ẩn tin',exact:true}).click();await page.getByRole('button',{name:'Tải lại danh sách',exact:true}).waitFor();
      expect(await page.getByRole('button',{name:'Ẩn tin',exact:true}).isDisabled()).toBe(true);
      await page.getByRole('button',{name:'Tải lại danh sách',exact:true}).click();
      await page.getByRole('button',{name:'Báo còn phòng',exact:true}).waitFor();
      await page.getByRole('button',{name:'Ẩn tin',exact:true}).click();await page.getByRole('button',{name:'Hiện tin',exact:true}).waitFor();
      expect((await http(`/properties/${record.slug}/cost-estimate`)).status).toBe(404);
      expect(await page.evaluate(()=>(window as unknown as {hostXss?:number}).hostXss)).toBeUndefined();
      await page.goto(origin+'/account');await page.getByRole('button',{name:'Đăng xuất',exact:true}).click();await page.waitForURL(origin+'/');
      await page.goto(origin+'/host/properties');await page.getByText('Cần đăng nhập để quản lý tin.',{exact:true}).waitFor();
      expect(await page.getByText('Host browser room',{exact:true}).count()).toBe(0);
    } finally {await browser?.close();if(frontend.exitCode===null){const exited=once(frontend,'exit');frontend.kill();await exited;}}
  },120_000);

  it.skipIf(process.env.LISTINGS_BROWSER !== '1')('reviews through real Admin UI/BFF/DB with failures, stale versions, two tabs and logout', async () => {
    const browserPassword = 'BrowserAdminFixture123!';
    await prisma.user.update({where:{id:reviewer.id},data:{passwordHash:await bcrypt.hash(browserPassword,4)}});
    const browserPhone=(await prisma.user.findUniqueOrThrow({where:{id:reviewer.id}})).phone;
    const pending=await fixture('PENDING_REVIEW',{title:'CMS new room',description:'Literal </dd><script>window.cmsXss=1</script>'});
    // Existing DB media fixtures, not a working upload provider.
    await prisma.propertyImage.createMany({data:[
      {propertyId:pending.id,position:0,url:'https://images.unsplash.com/s5-admin-fixture-a.svg'},
      {propertyId:pending.id,position:1,url:'https://images.unsplash.com/s5-admin-fixture-b.svg'},
    ]});
    const rejected=await fixture('PENDING_REVIEW',{title:'CMS rejected room',hostId:otherHost.id});
    const hidden=await fixture('HIDDEN',{title:'CMS existing hidden'});
    expect((await http(`/host/properties/${hidden.id}`,'PUT',{...input,title:'CMS submitted revision',expectedVersion:1},host.token)).status).toBe(200);
    expect((await http('/admin/properties','GET',undefined,tenant.token)).status).toBe(403);
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`;
    const frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;
      for(let attempt=0;attempt<100;attempt++){
        if(frontend.exitCode!==null)throw new Error('Owned CMS frontend exited before ready');
        ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));
      }
      expect(ready).toBe(true);
      const initialHtml=await fetch(origin+'/admin/properties').then(r=>r.text());
      expect(initialHtml).toContain('noindex');expect(initialHtml).not.toContain('CMS existing hidden');
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({viewport:{width:1440,height:1000}});
      await context.addInitScript(()=>{
        const events:{type:string;role?:string;revisionMatches:boolean;sessionMatches:boolean}[]=[];
        Object.assign(window,{__cmsAuthEvents:events});
        if(typeof BroadcastChannel!=='undefined') new BroadcastChannel('trotot-auth-v1').addEventListener('message',event=>{
          events.push({type:event.data.type,role:event.data.user?.role,revisionMatches:event.data.revision===localStorage.getItem('trotot-auth-revision'),sessionMatches:event.data.sessionId===localStorage.getItem('trotot-auth-session-id')});
        });
      });
      await context.route('https://images.unsplash.com/**',(route:{abort():Promise<void>})=>route.abort());
      await context.route('https://images.unsplash.com/s5-admin-fixture-a.svg',(route:{fulfill(options:unknown):Promise<void>})=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#e5f4ec"/><text x="60" y="240" font-size="28">Synthetic photo preview</text></svg>'}));
      const first=await context.newPage();const second=await context.newPage();
      // Deliberately lose all BroadcastChannel messages in this tab; storage + trusted refresh must recover.
      await second.addInitScript(()=>{Object.defineProperty(window,'BroadcastChannel',{value:undefined,configurable:true});});
      const responses:{tab:string;path:string;status:number}[]=[];
      for(const [tab,page] of [['first',first],['second',second]] as const) page.on('response',(r:{url():string;status():number})=>{
        if(r.url().includes('/api/management/')) responses.push({tab,path:new URL(r.url()).pathname,status:r.status()});
      });
      await first.goto(origin+'/login');await second.goto(origin+'/admin/properties');
      await second.locator('main').getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
      await first.getByLabel('Số điện thoại',{exact:true}).fill(browserPhone);
      await first.getByLabel('Mật khẩu',{exact:true}).fill(browserPassword);
      await first.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();
      await first.waitForURL(origin+'/account');
      await first.getByRole('link',{name:'Duyệt tin trọ dài hạn',exact:true}).click();
      await first.waitForURL(origin+'/admin/properties');
      try { await second.getByRole('button').filter({hasText:'CMS new room'}).waitFor(); }
      catch(error){console.log('CMS fixture diagnostic',JSON.stringify({first:await first.locator('main').first().innerText(),second:await second.locator('main').first().innerText(),events:await second.evaluate(()=>(window as unknown as {__cmsAuthEvents:unknown}).__cmsAuthEvents),responses}));throw error;}
      await first.getByRole('button').filter({hasText:'CMS new room'}).click();
      await first.getByRole('heading',{name:'CMS new room',exact:true}).waitFor();
      expect(await first.getByText('Literal </dd><script>window.cmsXss=1</script>',{exact:true}).count()).toBe(1);
      expect(await first.evaluate(()=>(window as unknown as {cmsXss?:number}).cmsXss)).toBeUndefined();
      const photo=first.getByRole('img',{name:'Nội dung tin — ảnh 1',exact:true});
      await photo.waitFor();await expect.poll(()=>photo.evaluate((node:HTMLImageElement)=>node.complete&&node.naturalWidth>0)).toBe(true);
      if(process.env.ADMIN_BROWSER_EVIDENCE_DIR){
        await mkdir(process.env.ADMIN_BROWSER_EVIDENCE_DIR,{recursive:true});
        for(const width of [375,1440]){
          await first.setViewportSize({width,height:1000});
          expect(await first.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await first.screenshot({path:resolve(process.env.ADMIN_BROWSER_EVIDENCE_DIR,`cms-photo-${width}.png`),fullPage:true});
        }
      }
      await first.getByRole('button',{name:'Ảnh sau',exact:true}).click();
      await first.getByText('Không tải được ảnh này.',{exact:true}).waitFor();
      await first.getByRole('button',{name:'Ảnh trước',exact:true}).click();
      const approvePath=`**/api/management/admin/properties/${pending.id}/approve`;
      await first.route(approvePath,(route:{fulfill(options:unknown):Promise<void>})=>route.fulfill({status:503,json:{success:false,errorCode:'TEST_UNAVAILABLE',message:'Fixture review unavailable'}}));
      await first.getByRole('button',{name:'Duyệt nội dung',exact:true}).click();
      await first.getByRole('alert').filter({hasText:'Fixture review unavailable'}).waitFor();
      expect(await prisma.property.findUnique({where:{id:pending.id}})).toMatchObject({status:'PENDING_REVIEW',version:1});
      expect(await prisma.listingModerationEvent.count({where:{propertyId:pending.id}})).toBe(0);
      expect(await first.getByRole('button').filter({hasText:'CMS new room'}).count()).toBe(1);
      await first.unroute(approvePath);
      await first.getByRole('button',{name:'Duyệt nội dung',exact:true}).press('Enter');
      await first.getByRole('status').filter({hasText:'Đã duyệt nội dung.'}).waitFor();
      expect(await prisma.property.findUnique({where:{id:pending.id}})).toMatchObject({status:'PUBLISHED',version:2});
      expect(await prisma.listingModerationEvent.findFirst({where:{propertyId:pending.id}})).toMatchObject({actorId:reviewer.id,action:'APPROVE',reviewedVersion:1,resultVersion:2});
      expect((await http(`/properties/${pending.slug}`)).body.data.title).toBe('CMS new room');
      await first.getByRole('button').filter({hasText:'CMS rejected room'}).click();
      await first.getByRole('heading',{name:'CMS rejected room',exact:true}).waitFor();
      await first.getByRole('button',{name:'Từ chối nội dung',exact:true}).click();
      await first.getByRole('status').filter({hasText:'Đã từ chối nội dung.'}).waitFor();
      expect(await prisma.property.findUnique({where:{id:rejected.id}})).toMatchObject({status:'REJECTED',version:2});
      expect(await prisma.listingModerationEvent.findFirst({where:{propertyId:rejected.id}})).toMatchObject({actorId:reviewer.id,action:'REJECT'});
      await first.getByRole('button').filter({hasText:'CMS existing hidden'}).click();
      await second.getByRole('button').filter({hasText:'CMS existing hidden'}).click();
      for(const page of [first,second]){
        await page.getByRole('heading',{name:'Bản sửa chờ duyệt',exact:true}).waitFor();
        await page.getByText(/Phiên bản 2 · Tạm ẩn/).waitFor();
      }
      expect((await http(`/host/properties/${hidden.id}/availability`,'POST',{expectedVersion:2,isAvailable:false},host.token)).status).toBe(200);
      await first.getByRole('button',{name:'Duyệt nội dung',exact:true}).click();
      await first.getByRole('status').filter({hasText:'Tin đã thay đổi. Tải lại và xem nội dung mới trước khi duyệt.'}).waitFor();
      expect(await first.getByRole('button',{name:'Duyệt nội dung',exact:true}).isDisabled()).toBe(true);
      expect(await prisma.listingModerationEvent.count({where:{propertyId:hidden.id}})).toBe(0);
      await first.getByRole('button',{name:'Tải lại nội dung',exact:true}).click();
      await first.getByText(/Phiên bản 3 · Tạm ẩn · Hết phòng/).waitFor();
      await first.getByRole('heading',{name:'Bản đã duyệt',exact:true}).waitFor();
      if(process.env.ADMIN_BROWSER_EVIDENCE_DIR){
        await mkdir(process.env.ADMIN_BROWSER_EVIDENCE_DIR,{recursive:true});
        for(const width of [375,768,1440,2560]){
          await first.setViewportSize({width,height:1000});
          expect(await first.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
          await first.screenshot({path:resolve(process.env.ADMIN_BROWSER_EVIDENCE_DIR,`cms-${width}.png`),fullPage:true});
        }
      }
      await first.getByRole('button',{name:'Duyệt nội dung',exact:true}).click();
      await first.getByRole('status').filter({hasText:'Đã duyệt nội dung.'}).waitFor();
      await second.getByRole('button',{name:'Duyệt nội dung',exact:true}).click();
      await second.getByRole('status').filter({hasText:'Tin đã thay đổi. Tải lại và xem nội dung mới trước khi duyệt.'}).waitFor();
      expect(await second.getByRole('button',{name:'Duyệt nội dung',exact:true}).isDisabled()).toBe(true);
      expect(await prisma.property.findUnique({where:{id:hidden.id}})).toMatchObject({status:'HIDDEN',version:4,isAvailable:false,title:'CMS submitted revision'});
      expect(await prisma.listingModerationEvent.count({where:{propertyId:hidden.id}})).toBe(1);
      expect(await prisma.listingModerationEvent.findFirst({where:{propertyId:hidden.id}})).toMatchObject({actorId:reviewer.id,target:'REVISION',reviewedVersion:3,resultVersion:4,statusAfter:'HIDDEN'});
      expect((await http(`/properties/${hidden.slug}`)).status).toBe(404);
      await second.getByRole('button',{name:'Tải lại nội dung',exact:true}).click();
      await second.getByRole('status').filter({hasText:'Tin không còn nội dung chờ duyệt.'}).waitFor();
      expect(await second.getByRole('button',{name:'Duyệt nội dung',exact:true}).isDisabled()).toBe(true);
      await first.goto(origin+'/account');
      const logoutResponse=first.waitForResponse((r:{url():string})=>r.url().endsWith('/api/auth/logout'));
      await first.getByRole('button',{name:'Đăng xuất',exact:true}).click();expect((await logoutResponse).status()).toBe(200);
      await second.locator('main').getByRole('link',{name:'Đăng nhập',exact:true}).waitFor();
      expect(await second.getByText('CMS submitted revision',{exact:true}).count()).toBe(0);
    }finally{
      await browser?.close();
      if(frontend.exitCode===null){const exited=once(frontend,'exit');frontend.kill();await exited;}
    }
  },120_000);

  it('records a reproducible local search baseline on 2,000 synthetic listings (not production load acceptance)', async () => {
    await database.query(`INSERT INTO users(phone,password_hash,full_name,role,status)
      SELECT '098'||lpad(g::text,7,'0'),'fixture','Benchmark fixture','HOST','ACTIVE' FROM generate_series(1,1000) g`);
    // Two FREE long-term listings per Host, consistent with the approved quota.
    await database.query(`WITH hosts AS (SELECT id,row_number() OVER(ORDER BY phone) AS n FROM users WHERE phone LIKE '098%')
      INSERT INTO properties(host_id,title,description,slug,property_type,rental_mode,address_detail,province_code,ward_code,latitude,longitude,status)
      SELECT id,'Performance fixture','Synthetic benchmark only','bench-'||uuid_generate_v4()::text,'PHONG_TRO','LONG_TERM','Fixture','79','26740',
        10.7725+(n%100)*0.001,106.6578+(n/100)*0.003+r*0.001,'PUBLISHED'
      FROM hosts CROSS JOIN generate_series(1,2) r`);
    await database.query(`INSERT INTO long_term_details(property_id,monthly_price,deposit_amount,area_sqm,electricity_cost,water_cost,water_unit,internet_cost,garbage_cost,parking_fee,contact_phone)
      SELECT id,3500000,0,25,3500,20000,'M3',100000,30000,100000,'0990000000' FROM properties WHERE slug LIKE 'bench-%'`);
    await database.query('ANALYZE properties; ANALYZE long_term_details');
    expect(await prisma.property.count()).toBe(2000);
    const path = '/properties/long-term/search?lat=10.7725&lng=106.6578&radius=1000&maxPrice=4000000&sortBy=distance_asc&limit=20';
    for (let warm = 0; warm < 5; warm++) expect((await http(path)).status).toBe(200);
    const samples: number[] = [];
    for (let sample = 0; sample < 60; sample++) {
      const start = performance.now(); const response = await http(path); samples.push(performance.now() - start);
      expect(response.status).toBe(200); expect(response.body.data.length).toBeGreaterThan(0);
    }
    samples.sort((a,b) => a-b);
    const percentile = (p: number) => Number(samples[Math.ceil(samples.length * p) - 1].toFixed(2));
    const explained = (await database.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM properties
      WHERE status='PUBLISHED' AND rental_mode='LONG_TERM' AND deleted_at IS NULL
      AND ST_DWithin(location::geography,ST_SetSRID(ST_MakePoint(106.6578,10.7725),4326)::geography,1000)`)).rows[0]['QUERY PLAN'][0];
    console.info('S2 search baseline', JSON.stringify({ dataset: 2000, concurrency: 1, warmup: 5, samples: 60,
      p50Ms: percentile(.5), p95Ms: percentile(.95), p99Ms: percentile(.99),
      geographyIndexUsed: JSON.stringify(explained.Plan).includes('idx_properties_location_geography'),
      spatialExecutionMs: explained['Execution Time'],
    }));
  }, 60_000);

  it('allows self-service Tenant → Host atomically, keeps existing sessions, and never accepts arbitrary roles or user IDs', async () => {
    expect((await http('/auth/become-host','POST',{})).status).toBe(401);
    expect((await http('/auth/become-host','POST',{ role: 'ADMIN' },tenant.token)).status).toBe(400);
    expect((await http('/auth/become-host','POST',{ userId: reviewer.id },tenant.token)).status).toBe(400);
    const results = await Promise.all([http('/auth/become-host','POST',{},tenant.token),http('/auth/become-host','POST',{},tenant.token)]);
    for (const result of results) {
      expect(result.status).toBe(200); expect(result.body.data.user.role).toBe('HOST');
      expect(result.body.data.user).not.toHaveProperty('passwordHash'); expect(result.body.data.user).not.toHaveProperty('sessionVersion');
    }
    expect(await prisma.hostProfile.count({ where: { userId: tenant.id } })).toBe(1);
    const me = await http('/auth/me','GET',undefined,tenant.token); expect(me.status).toBe(200); expect(me.body.data.role).toBe('HOST');
    expect((await submit(input,tenant)).status).toBe(201);
    expect((await http('/auth/become-host','POST',{},reviewer.token)).status).toBe(403);
    const unverified = await account('TENANT');
    await prisma.user.update({ where: { id: unverified.id }, data: { isPhoneVerified: false } });
    expect((await http('/auth/become-host','POST',{},unverified.token)).status).toBe(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: unverified.id } })).role).toBe('TENANT');
  });

  it('requires garbageCost, accepts nullable video URL metadata and supported types, and preserves sortOrder', async () => {
    const { garbageCost: _garbageCost, ...missing } = input;
    expect((await submit(missing)).status).toBe(400);
    expect((await submit({ ...input, garbageCost: -1 })).status).toBe(400);
    expect((await submit({ ...input, videoUrl: 'javascript:alert(1)' })).status).toBe(400);
    for (const propertyType of ['PHONG_TRO','CHUNG_CU_MINI','NHA_NGUYEN_CAN','O_GHEP']) {
      const owner = await account('HOST');
      const result = await submit({ ...input, propertyType, videoUrl: 'https://example.com/video.mp4' },owner);
      expect(result.status).toBe(201); expect(result.body.data.videoUrl).toBe('https://example.com/video.mp4');
      expect(Number(result.body.data.longTermDetail.garbageCost)).toBe(30000);
    }
    const record = await fixture();
    await prisma.propertyImage.createMany({ data: [{ propertyId: record.id, url: 'https://example.com/b.webp', position: 1 }, { propertyId: record.id, url: 'https://example.com/a.webp', position: 0 }] });
    for (const path of [`/properties/${record.slug}`,`/host/properties/${record.id}`]) {
      const result = await http(path,'GET',undefined,host.token);
      expect(result.body.data.images.map((image: { sortOrder: number }) => image.sortOrder)).toEqual([0,1]);
    }
    expect((await http(`/properties/${record.slug}`)).body.data.garbageCost).toBe(30000);
  });
  it.skipIf(process.env.LISTINGS_SEO_BROWSER !== '1')('renders public metadata once per SSR request without leaking hidden/draft/deleted listings', async () => {
    const title='SEO literal </title><script id="seo-xss">window.seoXss=1</script>';
    const published=await fixture('PUBLISHED',{title,description:'SEO approved description\n with whitespace'});
    const pending=await fixture('PENDING_REVIEW',{title:'SEO unpublished private title'});
    const deleted=await fixture('PUBLISHED',{title:'SEO deleted private title',deletedAt:new Date()});
    const counts=new Map<string,number>();let failure=false;
    // Instrumented public pass-through: real Nest/DB/Redis responses, no fixture success payloads.
    const proxy=createHttpServer(async(req,res)=>{
      const path=req.url||'/';
      if(req.method!=='GET'||!path.startsWith('/api/v1/properties/')){res.writeHead(404);res.end();return;}
      counts.set(path,(counts.get(path)||0)+1);
      if(failure){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({success:false,errorCode:'SEO_TEST_FAILURE',message:'Explicit test-only upstream outage'}));return;}
      try{const response=await fetch(base+path);res.writeHead(response.status,{'content-type':'application/json'});res.end(Buffer.from(await response.arrayBuffer()));}
      catch{res.writeHead(502);res.end();}
    });
    proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
    const backendOrigin=`http://127.0.0.1:${(proxy.address() as {port:number}).port}`;
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`;
    const frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:backendOrigin+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;
      for(let attempt=0;attempt<100;attempt++){
        if(frontend.exitCode!==null)throw new Error('Owned SEO frontend exited before ready');
        ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));
      }
      expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({javaScriptEnabled:false});
      await context.route('**/*',(route:{request():{url():string};continue():Promise<void>;abort():Promise<void>})=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await context.newPage();
      const path=`/thue-phong-tro/${published.slug}`,apiPath=`/api/v1/properties/${published.slug}`;
      expect((await page.goto(origin+path))?.status()).toBe(200);
      expect(await page.locator('h1').textContent()).toBe(title);
      expect(await page.title()).toBe(title+' | TroTot');
      expect(await page.locator('meta[name="description"]').getAttribute('content')).toBe('SEO approved description with whitespace');
      expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toBe(title+' | TroTot');
      expect(await page.locator('meta[name="twitter:title"]').getAttribute('content')).toBe(title+' | TroTot');
      expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe(origin+path);
      expect(await page.locator('script#seo-xss').count()).toBe(0);
      const schema=page.locator('script[type="application/ld+json"]');expect(await schema.count()).toBe(1);
      const serialized=await schema.textContent();expect(serialized).not.toContain('<');
      const data=JSON.parse(serialized!);expect(data['@context']).toBe('https://schema.org');
      const property=data['@graph'].find((item:{'@type':string})=>item['@type']==='Room');
      expect(property.name).toBe(title);expect(property.description).toBe('SEO approved description\n with whitespace');
      expect(property.url).toBe(origin+path);expect(property.floorSize).toEqual({'@type':'QuantitativeValue',value:input.areaSqm,unitCode:'MTK'});
      expect(property.address).toMatchObject({'@type':'PostalAddress',streetAddress:input.addressDetail});
      expect(property).not.toHaveProperty('offers');expect(property).not.toHaveProperty('aggregateRating');expect(property).not.toHaveProperty('potentialAction');
      expect(data['@graph'].find((item:{'@type':string})=>item['@type']==='BreadcrumbList').itemListElement).toEqual([
        {'@type':'ListItem',position:1,name:'Trang chủ',item:origin+'/'},
        {'@type':'ListItem',position:2,name:'Thuê trọ dài hạn',item:origin+'/thue-phong-tro'},
        {'@type':'ListItem',position:3,name:'Chi tiết phòng',item:origin+path},
      ]);
      expect(counts.get(apiPath)).toBe(1);
      // Server/API pending revision remains private; metadata/page use the approved snapshot.
      expect((await http(`/host/properties/${published.id}`,'PUT',{...input,title:'SEO_PENDING_DRAFT',description:'SEO_PENDING_DESCRIPTION',expectedVersion:1},host.token)).status).toBe(200);
      expect((await page.goto(origin+path))?.status()).toBe(200);
      expect(await page.title()).toBe(title+' | TroTot');expect(await page.content()).not.toContain('SEO_PENDING_DRAFT');
      expect(await page.locator('script[type="application/ld+json"]').textContent()).not.toContain('SEO_PENDING_DESCRIPTION');
      expect(counts.get(apiPath)).toBe(2);
      expect((await http(`/host/properties/${published.id}/hide`,'POST',{expectedVersion:2},host.token)).status).toBe(200);
      expect((await page.goto(origin+path))?.status()).toBe(404);
      expect(await page.content()).not.toContain('SEO approved description');expect(await page.content()).not.toContain('seo-xss');
      expect(await page.locator('script[type="application/ld+json"]').count()).toBe(0);
      expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
      for(const record of [pending,deleted]){
        expect((await page.goto(origin+`/thue-phong-tro/${record.slug}`))?.status()).toBe(404);
        expect(await page.content()).not.toContain(record.title);
      }
      // Failure injection is explicit fixture; verify it cannot return previously reviewed content.
      failure=true;
      expect((await page.goto(origin+path))?.status()).toBe(500);
      expect(await page.content()).not.toContain('SEO approved description');
      const human=await launched.newContext();
      await human.route('**/*',(route:{request():{url():string};continue():Promise<void>;abort():Promise<void>})=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const recovery=await human.newPage();
      expect((await recovery.goto(origin+path))?.status()).toBe(500);
      await recovery.getByRole('heading',{name:'Không thể tải thông tin phòng',exact:true}).waitFor();
      failure=false;
      await recovery.getByRole('button',{name:'Thử lại',exact:true}).click();
      await recovery.getByRole('heading',{name:'404',exact:true}).waitFor();
      expect(await recovery.content()).not.toContain('SEO approved description');
      await human.close();
      expect((await fetch(origin+'/sitemap.xml')).status).toBe(200);
      failure=true;expect((await fetch(origin+'/sitemap.xml')).status).toBe(503);failure=false;
      const accountHtml=await fetch(origin+'/account').then(r=>r.text());
      expect(accountHtml).toContain('noindex');expect(accountHtml).not.toContain('Fixture tenant');
    } finally {
      await browser?.close();
      if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}
      await new Promise<void>(done=>proxy.close(()=>done()));
    }
  },90_000);

  it.skipIf(process.env.LISTINGS_SEO_BROWSER !== '1')('renders filtered public search results in initial HTML without JavaScript', async () => {
    const searchCalls=vi.spyOn(app.get(ListingsService),'search');
    const included=await fixture('PUBLISHED',{title:'SSR_FILTERED_PUBLIC_ROOM'});
    const cheap=await fixture('PUBLISHED',{title:'SSR_CHEAP_EXCLUDED_ROOM',hostId:otherHost.id});
    await prisma.longTermDetail.update({where:{propertyId:cheap.id},data:{monthlyPrice:1000000}});
    await fixture('PENDING_REVIEW',{title:'SSR_UNPUBLISHED_PRIVATE_ROOM'});
    const hidden=await fixture('HIDDEN',{title:'SITEMAP_HIDDEN_ROOM'});
    const deleted=await fixture('PUBLISHED',{title:'SITEMAP_DELETED_ROOM',deletedAt:new Date()});
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin},stdio:'ignore',windowsHide:true,
    });
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;for(let attempt=0;attempt<100;attempt++){if(frontend.exitCode!==null)throw new Error('Owned search frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const context=await launched.newContext({javaScriptEnabled:false});await context.route('**/*',(route:{request():{url():string};continue():Promise<void>;abort():Promise<void>})=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const page=await context.newPage();expect((await page.goto(origin+'/thue-phong-tro?minPrice=3000000&maxPrice=4000000&minArea=25&amenities=wifi'))?.status()).toBe(200);
      expect(await page.locator('h3').allTextContents()).toContain(included.title);
      expect(await page.getByRole('heading',{name:included.title,exact:true}).isVisible()).toBe(true);
      expect(await page.content()).not.toContain(cheap.title);expect(await page.content()).not.toContain('SSR_UNPUBLISHED_PRIVATE_ROOM');
      expect(searchCalls).toHaveBeenCalledTimes(1);
      const human=await launched.newContext();
      await human.route('**/*',(route:{request():{url():string};continue():Promise<void>;abort():Promise<void>})=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const interactive=await human.newPage();
      const initial='/thue-phong-tro?minPrice=3000000&maxPrice=4000000&minArea=25&amenities=wifi';
      await interactive.goto(origin+initial);
      await interactive.getByRole('button',{name:/^Tiện ích/}).click();
      await interactive.getByRole('button',{name:'Wi-Fi',exact:true}).waitFor();
      expect(await interactive.getByRole('button',{name:'Wi-Fi',exact:true}).getAttribute('aria-pressed')).toBe('true');
      expect(searchCalls).toHaveBeenCalledTimes(2);
      expect(await interactive.locator('#desktop-filter-price').inputValue()).toBe('4000000');
      await interactive.evaluate(()=>history.pushState(null,'','/thue-phong-tro?maxPrice=2000000&amenities=wifi'));
      await interactive.getByRole('heading',{name:cheap.title,exact:true}).waitFor();
      expect(await interactive.locator('h3').allTextContents()).not.toContain(included.title);
      expect(searchCalls).toHaveBeenCalledTimes(3);
      await interactive.goBack();await interactive.getByRole('heading',{name:included.title,exact:true}).waitFor();
      expect(new URL(interactive.url()).search).toBe(new URL(origin+initial).search);
      await interactive.goForward();await interactive.getByRole('heading',{name:cheap.title,exact:true}).waitFor();
      expect(searchCalls).toHaveBeenCalledTimes(3);
      await human.close();
      // Public sitemap is rebuilt from current server publication on each read.
      const indexResponse=await fetch(origin+'/sitemap.xml');expect(indexResponse.status).toBe(200);
      const index=await indexResponse.text();expect(index).toContain(origin+'/sitemaps/0.xml');expect(index).toContain(origin+'/sitemaps/1.xml');
      expect(indexResponse.headers.get('cache-control')).toContain('no-store');
      const staticXml=await fetch(origin+'/sitemaps/0.xml').then(r=>r.text());
      expect(staticXml).toContain(`<loc>${origin}/</loc>`);expect(staticXml).toContain(`<loc>${origin}/thue-phong-tro</loc>`);
      expect(staticXml).not.toMatch(/homestay|account|admin|login|phong-tro\//);
      const publicXml=await fetch(origin+'/sitemaps/1.xml').then(r=>r.text());
      expect(publicXml).toContain(included.slug);expect(publicXml).toContain(cheap.slug);
      expect(publicXml).not.toContain(hidden.slug);expect(publicXml).not.toContain(deleted.slug);expect(publicXml).not.toContain('SSR_UNPUBLISHED_PRIVATE_ROOM');

      // A fresh RSC search snapshot must replace a previously cached public query.
      const revisit=await launched.newContext();await revisit.route('**/*',(route:{request():{url():string};continue():Promise<void>;abort():Promise<void>})=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
      const revisited=await revisit.newPage();await revisited.goto(origin+'/thue-phong-tro');
      await revisited.getByRole('heading',{name:included.title,exact:true}).waitFor();
      await revisited.locator(`a[href="/thue-phong-tro/${cheap.slug}"]`).first().click();
      await revisited.getByRole('heading',{name:cheap.title,exact:true}).waitFor();
      expect((await http(`/host/properties/${included.id}/hide`,'POST',{expectedVersion:1},host.token)).status).toBe(200);
      const callsBeforeRevisit=searchCalls.mock.calls.length;
      await revisited.getByRole('navigation',{name:'Đường dẫn trang',exact:true}).getByRole('link',{name:'Thuê trọ dài hạn',exact:true}).click();
      await revisited.waitForURL(origin+'/thue-phong-tro');
      await revisited.getByRole('heading',{name:cheap.title,exact:true}).waitFor();
      expect(searchCalls.mock.calls.length).toBeGreaterThan(callsBeforeRevisit);
      expect(await revisited.locator('h3').allTextContents()).not.toContain(included.title);
      await revisit.close();
      const refreshed=await fetch(origin+'/sitemaps/1.xml').then(r=>r.text());expect(refreshed).not.toContain(included.slug);expect(refreshed).toContain(cheap.slug);
      const robots=await fetch(origin+'/robots.txt').then(r=>r.text());expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
      for(const path of ['/account','/admin','/api/','/login','/register','/verify-otp','/forgot-password','/reset-password','/homestay','/phong-tro/'])expect(robots).toContain('Disallow: '+path);
      for(const path of ['/login','/register','/verify-otp','/forgot-password','/reset-password','/homestay','/phong-tro/1','/admin/properties']){
        await page.goto(origin+path);expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
      }
      for(const path of ['/sitemaps/-1.xml','/sitemaps/01.xml','/sitemaps/2.xml','/sitemaps/not-xml'])expect((await fetch(origin+path)).status).toBe(404);
    } finally {searchCalls.mockRestore();await browser?.close();if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}
  },60_000);

  it.skipIf(process.env.LISTINGS_LIGHTHOUSE !== '1')('measures local Lighthouse search/detail with real API and isolated DB', async () => {
    // Synthetic published records in the owned DB, no media/provider/physical-device acceptance.
    const detail=await fixture('PUBLISHED',{title:'Lighthouse public room'});
    for(let i=1;i<20;i++){const owner=await account('HOST');await fixture('PUBLISHED',{hostId:owner.id,title:`Lighthouse public room ${i}`});}
    const frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`;
    const debugging=createServer();debugging.listen(0,'127.0.0.1');await once(debugging,'listening');
    const debugPort=(debugging.address() as {port:number}).port;await new Promise<void>(done=>debugging.close(()=>done()));
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    let browser:{close():Promise<void>}|undefined;
    try{
      let ready=false;for(let attempt=0;attempt<100;attempt++){if(frontend.exitCode!==null)throw new Error('Owned Lighthouse frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined,args:[`--remote-debugging-port=${debugPort}`,'--remote-debugging-address=127.0.0.1']});browser=launched;
      const reportDir=resolve(process.env.LIGHTHOUSE_EVIDENCE_DIR||'../.tmp/lighthouse');
      // Run audit dependencies in native Node, outside Vitest's module transform/worker.
      const result=await promisify(execFile)(process.execPath,[resolve('test/lighthouse-audit.mjs'),resolve(process.env.LIGHTHOUSE_PACKAGE_PATH!),origin,detail.slug,String(debugPort),reportDir],{timeout:480_000,maxBuffer:2_000_000});
      console.log(result.stdout);
      const {reports}=JSON.parse(await readFile(resolve(reportDir,'summary.json'),'utf8'));
      expect(reports.every(report=>report.scores.performance>90&&report.scores.seo>90&&report.scores['best-practices']>90)).toBe(true);
    }finally{await browser?.close();if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}
  },600_000);

  it.skipIf(process.env.LISTINGS_SEO_BROWSER !== '1')('uses signed configured edge IP for SSR public reads without trusting ordinary forwarded headers', async () => {
    const record=await fixture('PUBLISHED',{title:'SSR edge IP fixture'});
    const redisCalls=vi.spyOn(app.get(RedisService),'incrementWithTtl');
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:'x-owned-edge-ip'},stdio:'ignore',windowsHide:true,
    });
    try{
      let ready=false;for(let attempt=0;attempt<100;attempt++){if(frontend.exitCode!==null)throw new Error('Owned proxy frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      for(const ip of ['198.51.100.10','2001:db8::20']){
        redisCalls.mockClear();
        const requestHeaders={'x-owned-edge-ip':ip,'x-forwarded-for':'192.0.2.66','x-trotot-client-ip':'192.0.2.99','x-trotot-proxy-signature':'f'.repeat(64)};
        for(const path of [`/thue-phong-tro/${record.slug}`,'/thue-phong-tro','/sitemap.xml','/sitemaps/1.xml']){
          const response=await fetch(origin+path,{headers:requestHeaders});expect(response.status).toBe(200);await response.text();
        }
        const expected='sprint2:limit:ip:'+createHash('sha256').update(ip).digest('hex');
        expect(redisCalls.mock.calls.map(([key])=>key)).toEqual([expected,expected,expected,expected]);
      }
      redisCalls.mockClear();
      for(const edge of ['','198.51.100.10, 198.51.100.11','not-ip']){
        const response=await fetch(origin+'/thue-phong-tro/'+record.slug,{headers:{'x-owned-edge-ip':edge}});expect(response.status).toBe(500);expect(await response.text()).not.toContain(record.title);
        expect((await fetch(origin+'/sitemap.xml',{headers:{'x-owned-edge-ip':edge}})).status).toBe(503);
      }
      expect(redisCalls).not.toHaveBeenCalled();
    }finally{redisCalls.mockRestore();if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}
  },60_000);

  async function holdInput(unitId:string,overrides:Record<string,unknown>={}) {
    const quote=await http(availabilityPath(unitId));
    expect(quote.status).toBe(200);
    return {unitId,checkInDate:'2026-10-22',checkOutDate:'2026-10-26',numAdults:2,numChildren:1,
      quoteToken:quote.body.data.quoteToken,guestName:'Synthetic guest',guestPhone:'0990000000',...overrides};
  }
  const homestayContent={title:'Synthetic homestay',description:'Test only',propertyType:'HOMESTAY',addressDetail:'Fixture',provinceCode:'79',wardCode:'26740',latitude:10.7,longitude:106.6,amenityIds:['wifi'],imageUrls:[],videoUrl:null};
  const homestayUnitContent={unitName:'Synthetic unit',maxAdults:2,maxChildren:1,maxNights:90,maxGuests:3,bedrooms:1,bathrooms:1,basePricePerNight:600000,
    weekendPricePerNight:750000,cleaningFee:150000,checkInTime:'14:00:00',checkOutTime:'12:00:00',sameDayBookingCutoff:'18:00:00',cancellationPolicy:'FLEXIBLE',instantBook:true};
  it('homestay submission/approval/revision retains approved public snapshot and ownership',async()=>{
    const content={...homestayContent,units:[homestayUnitContent]};
    expect((await http('/host/homestays','POST',content,tenant.token)).status).toBe(403);
    const created=await http('/host/homestays','POST',content,host.token);expect(created.status).toBe(201);
    const {id,slug}=created.body.data;
    expect((await http('/homestays/'+slug)).status).toBe(404);expect((await http('/homestays/search')).body.meta.total).toBe(0);
    expect((await http('/host/homestays/'+id,'GET',undefined,otherHost.token)).status).toBe(404);
    expect((await http('/admin/homestays/'+id+'/approve','POST',{expectedVersion:1},host.token)).status).toBe(403);
    expect((await http('/admin/homestays/'+id+'/approve','POST',{expectedVersion:1},reviewer.token)).status).toBe(200);
    expect((await http('/homestays/'+slug)).body.data.title).toBe(homestayContent.title);
    const update=await http('/host/homestays/'+id,'PUT',{...homestayContent,title:'Revised fixture',expectedVersion:2},host.token);expect(update.status).toBe(200);
    expect((await http('/homestays/'+slug)).body.data.title).toBe(homestayContent.title);
    expect((await http('/admin/homestays/'+id+'/approve','POST',{expectedVersion:2},reviewer.token)).status).toBe(409);
    expect((await http('/admin/homestays/'+id+'/approve','POST',{expectedVersion:3},reviewer.token)).status).toBe(200);
    expect((await http('/homestays/'+slug)).body.data.title).toBe('Revised fixture');
    const detail=(await http('/homestays/'+slug)).body.data;
    expect(detail).not.toHaveProperty('hostId');expect(detail.units[0]).not.toHaveProperty('commissionRate');
  });
  it.skipIf(process.env.HOMESTAY_MANAGEMENT_BROWSER!=='1')('real Host homestay management UI/BFF/DB creates, revises and Admin approves without exposing pending content',async()=>{
    await database.query("INSERT INTO address_catalog_metadata(id,version,as_of,source_url) VALUES(true,'synthetic-ui-test','2026-10-09','https://example.test/catalog') ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,as_of=EXCLUDED.as_of,source_url=EXCLUDED.source_url");
    const password='SyntheticManagementBrowser123!';
    await prisma.user.updateMany({where:{id:{in:[host.id,reviewer.id]}},data:{passwordHash:await bcrypt.hash(password,4)}});
    const hostPhone=(await prisma.user.findUniqueOrThrow({where:{id:host.id}})).phone;
    const adminPhone=(await prisma.user.findUniqueOrThrow({where:{id:reviewer.id}})).phone;
    const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
    const port=(reservation.address() as {port:number}).port;await new Promise<void>(done=>reservation.close(()=>done()));
    const origin=`http://localhost:${port}`,dir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(dir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:dir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
    let browser:{close():Promise<void>}|undefined;
    try{
      let ready=false;for(let i=0;i<100;i++){if(frontend.exitCode!==null)throw new Error('Owned management frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||'msedge'});browser=launched;
      const hostPage=await launched.newPage({viewport:{width:375,height:1000}}),adminPage=await launched.newPage({viewport:{width:1440,height:1000}});
      for(const [page,phone] of [[hostPage,hostPhone],[adminPage,adminPhone]]){
        await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
        await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      }
      // GPS/tile transport only is synthetic; Auth, catalog, BFF, API and persisted records are real in the isolated DB.
      await hostPage.route('https://tile.openstreetmap.org/**',(r:{fulfill(input:unknown):Promise<void>})=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#eef2ed"/></svg>'}));
      await hostPage.addInitScript(()=>Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition(ok:(value:unknown)=>void){ok({coords:{latitude:10.7725,longitude:106.6578}});}}}));
      await hostPage.goto(origin+'/host/homestays/create');await hostPage.getByLabel('Tên homestay',{exact:true}).fill('Synthetic UI homestay');await hostPage.getByLabel('Mô tả',{exact:true}).fill('Synthetic UI persisted description');
      for(const [label,name] of [['Tỉnh/thành phố','Fixture Province A'],['Phường/xã','Fixture Ward A']]){
        await hostPage.getByRole('combobox',{name:label,exact:true}).click();await hostPage.getByRole('option',{name,exact:true}).click();await hostPage.waitForFunction((label:string)=>document.activeElement?.getAttribute('aria-label')===label,label);
      }
      await hostPage.locator('[name="addressDetail"]').fill('24 Synthetic Street');await hostPage.getByRole('region',{name:'Bản đồ chọn vị trí phòng'}).locator('.leaflet-pane').first().waitFor({state:'attached'});
      await hostPage.getByRole('button',{name:'Dùng vị trí hiện tại',exact:true}).click();await hostPage.getByRole('status').filter({hasText:'Đã dùng vị trí hiện tại'}).waitFor();await hostPage.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();
      for(const [name,value] of Object.entries({unitName:'Synthetic UI unit',maxAdults:'2',maxChildren:'0',bedrooms:'1',bathrooms:'1',basePricePerNight:'500000',cleaningFee:'0',checkInTime:'14:00:00',checkOutTime:'12:00:00'}))await hostPage.locator(`[name="${name}"]`).fill(value);
      const creating=hostPage.waitForResponse((r:{url():string;request():{method():string}})=>r.url().endsWith('/api/management/host/homestays')&&r.request().method()==='POST');
      await hostPage.getByRole('button',{name:'Gửi duyệt homestay',exact:true}).click();const response=await creating;expect(response.status()).toBe(201);const created=(await response.json()).data;
      await hostPage.waitForURL('**/host/homestays');expect((await http('/homestays/'+created.slug)).status).toBe(404);
      await adminPage.goto(origin+`/admin/homestays/${created.id}`);await adminPage.getByRole('button',{name:'Duyệt toàn bộ nội dung chờ',exact:true}).click();await adminPage.getByRole('status').filter({hasText:'Đã cập nhật homestay.'}).waitFor();
      expect((await http('/homestays/'+created.slug)).body.data.title).toBe('Synthetic UI homestay');
      await hostPage.goto(origin+`/host/homestays/${created.id}/edit`);await hostPage.getByLabel('Tên homestay',{exact:true}).fill('Synthetic UI pending revision');await hostPage.getByRole('button',{name:'Xác nhận vị trí',exact:true}).click();
      const editing=hostPage.waitForResponse((r:{url():string;request():{method():string}})=>r.url().endsWith(`/api/management/host/homestays/${created.id}`)&&r.request().method()==='PUT');
      await hostPage.getByRole('button',{name:'Gửi duyệt homestay',exact:true}).click();expect((await editing).status()).toBe(200);await hostPage.waitForURL('**/host/homestays');
      expect((await http('/homestays/'+created.slug)).body.data.title).toBe('Synthetic UI homestay');
      await adminPage.reload();await adminPage.getByRole('heading',{name:'Synthetic UI pending revision',exact:true}).waitFor();await adminPage.getByRole('button',{name:'Duyệt toàn bộ nội dung chờ',exact:true}).click();await adminPage.getByRole('status').filter({hasText:'Đã cập nhật homestay.'}).waitFor();
      expect((await http('/homestays/'+created.slug)).body.data.title).toBe('Synthetic UI pending revision');
      await hostPage.goto(origin+`/host/homestays/${created.id}`);await hostPage.getByRole('button',{name:'Sửa phòng',exact:true}).click();await hostPage.locator('[name="basePricePerNight"]').fill('600000');
      await hostPage.getByRole('button',{name:'Gửi duyệt phòng',exact:true}).click();await hostPage.getByRole('dialog').waitFor({state:'hidden'});
      expect((await http('/homestays/'+created.slug)).body.data.units[0].basePricePerNight).toBe(500000);
      await adminPage.reload();await adminPage.getByText('Ngày thường: 600000 đ',{exact:false}).waitFor();await adminPage.getByRole('button',{name:'Duyệt toàn bộ nội dung chờ',exact:true}).click();await adminPage.getByRole('status').filter({hasText:'Đã cập nhật homestay.'}).waitFor();
      expect((await http('/homestays/'+created.slug)).body.data.units[0].basePricePerNight).toBe(600000);
      await hostPage.reload();await hostPage.getByRole('button',{name:'Ẩn tin',exact:true}).click();await hostPage.getByRole('button',{name:'Hiện tin',exact:true}).waitFor();expect((await http('/homestays/'+created.slug)).status).toBe(404);
      await hostPage.getByRole('button',{name:'Hiện tin',exact:true}).click();await hostPage.getByRole('button',{name:'Ẩn tin',exact:true}).waitFor();expect((await http('/homestays/'+created.slug)).status).toBe(200);
      expect((await http('/host/homestays/'+created.id,'GET',undefined,otherHost.token)).status).toBe(404);
      for(const page of [hostPage,adminPage])expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }finally{await browser?.close();if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}
  },120_000);

  it('unit revisions stay private; Host cannot override platform fees; Admin changes are audited',async()=>{
    const {unit,property}=await homestayFixture();
    expect((await http('/host/homestays/'+property.id+'/units/'+unit.id,'PUT',{...homestayUnitContent,expectedVersion:1,serviceFeeRate:50},host.token)).status).toBe(400);
    const changed=await http('/host/homestays/'+property.id+'/units/'+unit.id,'PUT',{...homestayUnitContent,basePricePerNight:800000,expectedVersion:1},host.token);
    expect(changed.status).toBe(200);expect((await http('/homestays/'+property.slug)).body.data.units[0].basePricePerNight).toBe(600000);
    expect((await http('/admin/homestays/'+property.id+'/approve','POST',{expectedVersion:2},reviewer.token)).status).toBe(200);
    expect((await http('/homestays/'+property.slug)).body.data.units[0].basePricePerNight).toBe(800000);
    const version=(await prisma.homestayUnit.findUniqueOrThrow({where:{id:unit.id}})).version;
    const fees={expectedVersion:version,serviceFeeRate:0,taxRate:0,commissionRate:12};
    expect((await http('/admin/homestays/units/'+unit.id+'/fees','PUT',fees,host.token)).status).toBe(403);
    expect((await http('/admin/homestays/units/'+unit.id+'/fees','PUT',fees,reviewer.token)).status).toBe(200);
    const audit=await database.query('SELECT actor_id,old_values,new_values FROM homestay_policy_audit WHERE unit_id=$1',[unit.id]);
    expect(audit.rows[0]).toMatchObject({actor_id:reviewer.id,old_values:{commissionRate:'10'},new_values:{commissionRate:'12'}});
  });
  it.skipIf(process.env.S4_CALENDAR_BFF !== '1')('Sprint 4 calendar through real Next BFF/Nest/DB preserves ownership, version and idempotency',async()=>{
    const {unit,property}=await homestayFixture();
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve(process.env.FRONTEND_TEST_DIR||'../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true,
    });
    async function bff(path:string,method='GET',body?:unknown,token=host.token,key?:string,requestOrigin=origin) {
      const response=await fetch(origin+'/api/management'+path,{method,headers:{authorization:`Bearer ${token}`,origin:requestOrigin,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})});
      expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('set-cookie')).toBeNull();
      return {status:response.status,body:await response.json()};
    }
    try {
      let ready=false;
      for(let i=0;i<100;i++) {
        if(frontend.exitCode!==null) throw new Error('Isolated Next calendar test server stopped');
        try {ready=(await fetch(origin+'/api/management/host/homestays')).status===401;}catch{}
        if(ready) break;await new Promise(done=>setTimeout(done,100));
      }
      expect(ready).toBe(true);
      const calendarPath='/host/calendar/'+unit.id;
      const read=await bff(calendarPath+'?month=2026-10');expect(read.status).toBe(200);
      expect(read.body.data).toMatchObject({unitId:unit.id,month:'2026-10',timeZone:'Asia/Ho_Chi_Minh',version:1});
      expect(read.body.data.days).toHaveLength(31);
      expect((await bff('/host/homestays?page=1&limit=20')).body.data.map((p:{id:string})=>p.id)).toEqual([property.id]);
      expect((await bff(calendarPath+'?month=2026-10','GET',undefined,tenant.token)).status).toBe(403);
      expect((await bff(calendarPath+'?month=2026-10','GET',undefined,otherHost.token)).status).toBe(404);
      const price={expectedVersion:1,dates:['2026-10-22'],customPrice:900000.5},priceKey=randomUUID();
      expect((await bff(calendarPath+'/pricing','PUT',price,host.token,priceKey,'https://evil.test')).status).toBe(403);
      expect((await bff(calendarPath+'/pricing','PUT',price)).body.errorCode).toBe('INVALID_IDEMPOTENCY_KEY');
      const priced=await bff(calendarPath+'/pricing','PUT',price,host.token,priceKey);expect(priced.status).toBe(200);
      expect(await bff(calendarPath+'/pricing','PUT',price,host.token,priceKey)).toEqual(priced);
      expect((await bff(calendarPath+'/pricing','PUT',{...price,customPrice:900001},host.token,priceKey)).body.errorCode).toBe('IDEMPOTENCY_CONFLICT');
      expect((await bff(calendarPath+'/pricing','PUT',price,host.token,randomUUID())).body.errorCode).toBe('STALE_HOMESTAY_VERSION');
      expect((await prisma.calendarPricing.findUniqueOrThrow({where:{homestayUnitId_date:{homestayUnitId:unit.id,date:new Date('2026-10-22')}}})).customPrice!.toString()).toBe('900000.5');
      const updated=await bff(calendarPath+'?month=2026-10');expect(updated.body.data.version).toBe(2);
      expect(updated.body.data.days.find((d:{date:string})=>d.date==='2026-10-22')).toMatchObject({price:900001,status:'AVAILABLE'});
      const block={expectedVersion:2,dates:['2026-10-23'],isBlocked:true},blockKey=randomUUID();
      const blocked=await bff(calendarPath+'/toggle-block','POST',block,host.token,blockKey);expect(blocked.status).toBe(200);
      expect(await bff(calendarPath+'/toggle-block','POST',block,host.token,blockKey)).toEqual(blocked);
      expect((await bff(calendarPath+'?month=2026-10')).body.data.days.find((d:{date:string})=>d.date==='2026-10-23').status).toBe('BLOCKED');
      expect((await bff(calendarPath+'/toggle-block','POST',{...block,expectedVersion:3,isBlocked:false},host.token,randomUUID())).status).toBe(200);
      expect((await bff(calendarPath+'?month=2026-10')).body.data.days.find((d:{date:string})=>d.date==='2026-10-23').status).toBe('AVAILABLE');
      expect((await bff(calendarPath+'/pricing','PUT',{expectedVersion:4,dates:['2026-10-22'],customPrice:null},host.token,randomUUID())).status).toBe(200);
      expect((await bff(calendarPath+'?month=2026-10')).body.data.days.find((d:{date:string})=>d.date==='2026-10-22').price).toBe(600000);
      expect(await prisma.booking.count()).toBe(0);
      const dto=await holdInput(unit.id),held=await http('/bookings/hold','POST',dto,tenant.token,randomUUID());
      expect(held.status).toBe(201);
      const bookingId=held.body.data.bookingId,privatePath='/host/bookings/'+bookingId;
      const detail=await bff(privatePath);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({bookingId,unitId:unit.id,guestName:dto.guestName,guestPhone:dto.guestPhone,
        checkInDate:dto.checkInDate,checkOutDate:dto.checkOutDate,bookingStatus:'PENDING_PAYMENT',paymentStatus:'NOT_CONFIGURED'});
      expect(detail.body.data).not.toHaveProperty('inventoryLock');
      expect((await bff(privatePath,'GET',undefined,tenant.token)).status).toBe(403);
      expect((await bff(privatePath,'GET',undefined,otherHost.token)).status).toBe(404);
      const heldCalendar=await bff(calendarPath+'?month=2026-10');
      expect(heldCalendar.body.data.days.find((day:{date:string})=>day.date===dto.checkInDate)).toMatchObject({status:'HELD',bookingId});
      if(process.env.S4_CALENDAR_BROWSER==='1') {
        // Actual login, UI, Next/Nest/DB/Redis. No mocked calendar or payment success.
        const password='CalendarBrowserFixture123!';
        const owner=await prisma.user.update({where:{id:host.id},data:{passwordHash:await bcrypt.hash(password,4)}});
        const bookingBefore=await prisma.booking.findUniqueOrThrow({where:{id:bookingId}});
        const publicPath=`/homestays/units/${unit.id}/calendar?month=2026-10&adults=1&children=0`;
        expect((await http(publicPath)).status).toBe(200); // Warm real public cache before editing.
        const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
        const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});
        try {
          const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
          await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(owner.phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
          await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
          await page.goto(origin+'/host/calendar');await page.getByRole('link',{name:unit.unitName,exact:true}).click();
          const month=page.getByLabel('Tháng (YYYY-MM)');await month.fill('2026-10');await month.press('Tab');
          const day=(date:string)=>page.locator(`[data-date="${date}"]`);
          await day(dto.checkInDate).click();const detailDialog=page.getByRole('dialog');
          await detailDialog.getByText(dto.guestPhone,{exact:true}).waitFor();
          expect(await detailDialog.getByText(dto.guestName,{exact:true}).isVisible()).toBe(true);
          expect(await detailDialog.getByText('Chưa kết nối thanh toán',{exact:true}).isVisible()).toBe(true);
          await detailDialog.getByRole('button',{name:'Đóng hộp thoại',exact:true}).click();
          expect(await day(dto.checkInDate).evaluate((el:HTMLElement)=>el===document.activeElement)).toBe(true);
          await day(dto.checkInDate).click();await page.getByRole('dialog').getByRole('button',{name:'Đóng hộp thoại',exact:true}).click(); // Deselect booked day.
          await day('2026-10-27').click();await day('2026-10-28').click({modifiers:['Shift']});
          const form=page.getByRole('form',{name:'Cập nhật lịch'});await page.getByRole('heading',{name:'Đã chọn 2 ngày',exact:true}).waitFor();
          const writes:{body:unknown;key:string|undefined}[]=[];
          await page.route(`**/api/management${calendarPath}/pricing`,async route=>{
            writes.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']});
            const response=await route.fetch();expect(response.status()).toBe(200);
            if(writes.length===1)return route.fulfill({status:503,json:{success:false,errorCode:'FIXTURE_DELIVERY_LOST',message:'Synthetic delivery lost after actual calendar commit'}});
            return route.fulfill({response});
          });
          await form.getByLabel('Giá mỗi đêm (VND)',{exact:true}).fill('910000.5');await form.getByRole('button',{name:'Áp dụng cho ngày đã chọn',exact:true}).click();
          await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).waitFor();
          const versionAfterCommit=(await prisma.homestayUnit.findUniqueOrThrow({where:{id:unit.id}})).version;
          expect(versionAfterCommit).toBe(heldCalendar.body.data.version+1);
          expect(await page.getByRole('button',{name:'Tháng sau',includeHidden:true}).isDisabled()).toBe(true);
          await form.getByRole('button',{name:'Thử lại cùng yêu cầu'}).click();await form.getByText('Máy chủ đã ghi nhận.',{exact:false}).waitFor();
          expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
          expect((await prisma.homestayUnit.findUniqueOrThrow({where:{id:unit.id}})).version).toBe(versionAfterCommit);
          for(const date of ['2026-10-27','2026-10-28'])expect((await prisma.calendarPricing.findUniqueOrThrow({where:{homestayUnitId_date:{homestayUnitId:unit.id,date:new Date(date)}}})).customPrice!.toString()).toBe('910000.5');
          await form.getByRole('button',{name:'Đóng',exact:true}).click();
          expect(await day('2026-10-27').getAttribute('aria-label')).toContain('910.001');
          for(const [action,blocked] of [['Khóa ngày',true],['Mở ngày',false]] as const) {
            await day('2026-10-29').click();await page.getByRole('button',{name:'Chỉnh ngày đã chọn',exact:true}).click();
            await form.getByRole('button',{name:action,exact:true}).click();await form.getByRole('button',{name:'Áp dụng cho ngày đã chọn',exact:true}).click();
            await form.getByText('Máy chủ đã ghi nhận.',{exact:false}).waitFor();await form.getByRole('button',{name:'Đóng',exact:true}).click();
            const row=await prisma.calendarPricing.findUniqueOrThrow({where:{homestayUnitId_date:{homestayUnitId:unit.id,date:new Date('2026-10-29')}}});
            expect(row.status).toBe(blocked?'BLOCKED':'AVAILABLE');
            expect(await day('2026-10-29').getAttribute('aria-label')).toContain(blocked?'Đã khóa':'Còn phòng');
          }
          expect(await prisma.booking.findUniqueOrThrow({where:{id:bookingId}})).toEqual(bookingBefore);
          const publicCalendar=await http(publicPath);expect(publicCalendar.status).toBe(200);
          expect(publicCalendar.body.data.days.find((d:{date:string})=>d.date==='2026-10-27').price).toBe(910001);
          expect(JSON.stringify(publicCalendar.body)).not.toContain(dto.guestPhone);expect(JSON.stringify(publicCalendar.body)).not.toContain(bookingId);
          await page.reload();await day('2026-10-27').waitFor();expect(await day('2026-10-27').getAttribute('aria-label')).toContain('910.001');
          const evidence=resolve('../.tmp/s4-calendar-real');await mkdir(evidence,{recursive:true});
          for(const width of [375,1440]){await page.setViewportSize({width,height:1000});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(evidence,`calendar-${width}.png`),fullPage:true});}
          expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain(dto.guestPhone);
        }finally{await browser.close();}
      }
    }finally {
      if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}
    }
  },120_000);
  it('real search excludes full-range collisions/capacity, calendar writes are atomic/idempotent and delete is guarded',async()=>{
    const {unit,property}=await homestayFixture();
    expect((await http('/homestays/search?checkIn=2026-10-22&checkOut=2026-10-26&adults=2&children=1')).body.meta.total).toBe(1);
    expect((await http('/homestays/search?checkIn=2026-10-22&checkOut=2026-10-26&adults=3&children=1')).body.meta.total).toBe(0);
    expect((await http('/homestays/search?checkIn=2026-10-22')).status).toBe(400);
    const dto=await holdInput(unit.id),first=await http('/bookings/hold','POST',dto,tenant.token,randomUUID());
    expect(first.status).toBe(201);
    expect((await http('/homestays/search?checkIn=2026-10-22&checkOut=2026-10-26&adults=2&children=1')).body.meta.total).toBe(0);
    expect((await http('/host/homestays/'+property.id,'DELETE',{expectedVersion:1},host.token)).body.errorCode).toBe('ACTIVE_BOOKINGS');
    expect((await http('/host/homestays/'+property.id+'/units/'+unit.id,'DELETE',{expectedVersion:1},host.token)).body.errorCode).toBe('ACTIVE_BOOKINGS');
    expect((await http('/host/calendar/'+unit.id+'/toggle-block','POST',{expectedVersion:1,dates:['2026-10-21','2026-10-22'],isBlocked:true},host.token,randomUUID())).body.errorCode).toBe('INVENTORY_CONFLICT');
    expect(await prisma.calendarPricing.count()).toBe(0);
    const key=randomUUID(),price={expectedVersion:1,dates:['2026-10-22'],customPrice:900000};
    const update=await http('/host/calendar/'+unit.id+'/pricing','PUT',price,host.token,key);expect(update.status).toBe(200);
    expect(await http('/host/calendar/'+unit.id+'/pricing','PUT',price,host.token,key)).toEqual(update);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:first.body.data.bookingId}})).baseAmount.toNumber()).toBe(first.body.data.baseAmount);
    expect((await http('/host/calendar/'+unit.id+'?month=2026-10','GET',undefined,otherHost.token)).status).toBe(404);
    expect((await http('/host/calendar/'+unit.id+'?month=2026-10','GET',undefined,host.token)).status).toBe(200);
    expect((await http('/bookings/'+first.body.data.bookingId+'/cancel','POST',{expectedVersion:1},tenant.token,randomUUID())).status).toBe(200);
    expect((await http('/host/homestays/'+property.id+'/units/'+unit.id,'DELETE',{expectedVersion:2},host.token)).status).toBe(200);
    expect((await http(availabilityPath(unit.id))).status).toBe(404);
  });
  it('HTTP hold exact replay, collision, private reads and atomic unpaid cancellation',async()=>{
    const {unit}=await homestayFixture();const dto=await holdInput(unit.id),key=randomUUID();
    const first=await http('/bookings/hold','POST',dto,tenant.token,key);
    expect(first.status).toBe(201);expect(first.body.data.payment).toBeNull();expect(first.body.data.bookingStatus).toBe('PENDING_PAYMENT');
    expect(first.body.data).not.toHaveProperty('inventoryLock');expect(first.body.data).not.toHaveProperty('hostPayoutAmount');
    expect(await http('/bookings/hold','POST',dto,tenant.token,key)).toEqual(first);
    expect((await http('/bookings/hold','POST',{...dto,guestName:'Other'},tenant.token,key)).status).toBe(409);
    expect((await http('/bookings/hold','POST',dto,otherHost.token,randomUUID())).status).toBe(409);
    const id=first.body.data.bookingId;
    expect((await http('/bookings/'+id,'GET',undefined,otherHost.token)).status).toBe(404);
    expect((await http('/host/bookings/'+id,'GET',undefined,otherHost.token)).status).toBe(404);
    expect((await http('/host/bookings/'+id,'GET',undefined,tenant.token)).status).toBe(403);
    const hostRead=await http('/host/bookings/'+id,'GET',undefined,host.token);
    expect(hostRead.status).toBe(200);
    expect(hostRead.body.data).toMatchObject({bookingId:id,unitId:unit.id,guestName:dto.guestName,guestPhone:dto.guestPhone,
      checkInDate:dto.checkInDate,checkOutDate:dto.checkOutDate,bookingStatus:'PENDING_PAYMENT',paymentStatus:'NOT_CONFIGURED'});
    expect(hostRead.body.data).not.toHaveProperty('inventoryLock');
    expect((await http('/host/bookings/'+id+'/accept','POST',{expectedVersion:1},host.token,randomUUID())).status).toBe(409);
    const cancelKey=randomUUID(),cancel=await http('/bookings/'+id+'/cancel','POST',{expectedVersion:1},tenant.token,cancelKey);
    expect(cancel.status).toBe(200);expect(cancel.body.data.bookingStatus).toBe('CANCELLED_BY_GUEST');
    expect(await http('/bookings/'+id+'/cancel','POST',{expectedVersion:1},tenant.token,cancelKey)).toEqual(cancel);
    expect((await http('/bookings/hold','POST',dto,tenant.token,randomUUID())).status).toBe(201);
    expect(await http('/bookings/hold','POST',dto,tenant.token,key)).toEqual(first);
  });
  it('HTTP validates ownership, quote, key, arbitrary payload and production/payment gate',async()=>{
    const {unit}=await homestayFixture();const dto=await holdInput(unit.id);
    expect((await http('/bookings/hold','POST',dto,host.token,randomUUID())).body.errorCode).toBe('SELF_BOOKING_NOT_ALLOWED');
    expect((await http('/bookings/hold','POST',dto,reviewer.token,randomUUID())).status).toBe(403);
    expect((await http('/bookings/hold','POST',dto,tenant.token)).status).toBe(400);
    expect((await http('/bookings/hold','POST',{...dto,totalAmount:1},tenant.token,randomUUID())).status).toBe(400);
    expect((await http('/bookings/hold','POST',{...dto,quoteToken:'bad'},tenant.token,randomUUID())).body.errorCode).toBe('INVALID_QUOTE_TOKEN');
    const original=process.env.BOOKING_ALLOW_UNCONFIGURED_PAYMENT;
    try {process.env.BOOKING_ALLOW_UNCONFIGURED_PAYMENT='false';expect((await http('/bookings/hold','POST',dto,tenant.token,randomUUID())).status).toBe(503);}
    finally {process.env.BOOKING_ALLOW_UNCONFIGURED_PAYMENT=original;}
    expect(await prisma.booking.count()).toBe(0);
  });
  it('HTTP repricing returns a new signed quote, no booking; zero rejected',async()=>{
    const {unit}=await homestayFixture();const dto=await holdInput(unit.id);
    await prisma.homestayUnit.update({where:{id:unit.id},data:{cleaningFee:'250000'}});
    const changed=await http('/bookings/hold','POST',dto,tenant.token,randomUUID());
    expect(changed.status).toBe(409);expect(changed.body.errorCode).toBe('PRICE_CHANGED');expect(changed.body.data.quoteToken).toBeTypeOf('string');
    expect(await prisma.booking.count()).toBe(0);
    await prisma.homestayUnit.update({where:{id:unit.id},data:{basePricePerNight:'0',weekendPricePerNight:'0',cleaningFee:'0'}});
    const free=await holdInput(unit.id);
    expect((await http('/bookings/hold','POST',free,tenant.token,randomUUID())).body.errorCode).toBe('FREE_BOOKING_NOT_SUPPORTED');
  });
  it('20 HTTP holds with overlapping ranges produce only one active booking',async()=>{
    const {unit}=await homestayFixture();const dto=await holdInput(unit.id);
    const requests=await Promise.all(Array.from({length:20},()=>http('/bookings/hold','POST',dto,tenant.token,randomUUID())));
    expect(requests.filter(r=>r.status===201)).toHaveLength(1);expect(requests.filter(r=>r.status===409)).toHaveLength(19);
    expect(await prisma.booking.count()).toBe(1);
  },60_000);
  it('Request-to-Book accept/reject and expiry use real DB deadlines',async()=>{
    const {unit}=await homestayFixture({}, {instantBook:false});const dto=await holdInput(unit.id);
    const first=await http('/bookings/hold','POST',dto,tenant.token,randomUUID());const id=first.body.data.bookingId;
    expect(first.body.data.bookingStatus).toBe('PENDING_HOST_APPROVAL');
    expect((await http('/host/bookings/'+id+'/accept','POST',{expectedVersion:1},otherHost.token,randomUUID())).status).toBe(404);
    const key=randomUUID(),accept=await http('/host/bookings/'+id+'/accept','POST',{expectedVersion:1},host.token,key);
    expect(accept.status).toBe(200);expect(accept.body.data.bookingStatus).toBe('PENDING_PAYMENT');expect(accept.body.data.expiresInSeconds).toBeLessThanOrEqual(900);
    expect(await http('/host/bookings/'+id+'/accept','POST',{expectedVersion:1},host.token,key)).toEqual(accept);
    expect((await http('/host/bookings/'+id+'/reject','POST',{expectedVersion:1},host.token,randomUUID())).status).toBe(409);
    await prisma.booking.update({where:{id},data:{expiresAt:new Date(Date.now()-1000)}});
    await app.get(BookingWorkerService).reconcile();
    expect((await prisma.booking.findUniqueOrThrow({where:{id}})).bookingStatus).toBe('CANCELLED_TIMEOUT');
    expect((await http('/bookings/hold','POST',dto,tenant.token,randomUUID())).status).toBe(201);
    const second=await prisma.booking.findFirstOrThrow({where:{bookingStatus:'PENDING_HOST_APPROVAL'}});
    const reject=await http('/host/bookings/'+second.id+'/reject','POST',{expectedVersion:1},host.token,randomUUID());
    expect(reject.body.data.bookingStatus).toBe('REJECTED_BY_HOST');
  });
  it('catalog requires provenance and preserves leading zeroes and province ownership',async()=>{
    await database.query('DELETE FROM address_catalog_metadata');
    expect((await http('/catalog/provinces')).body.errorCode).toBe('ADDRESS_CATALOG_NOT_READY');
    await database.query("INSERT INTO address_catalog_metadata(version,as_of,source_url) VALUES ('synthetic-test','2026-10-04','https://example.test/synthetic')");
    expect((await http('/catalog/provinces')).body.data).toMatchObject({version:'synthetic-test',asOf:'2026-10-04'});
    expect((await http('/catalog/wards?provinceCode=01')).body.data.items).toEqual([{code:'00001',name:'Fixture Ward B',provinceCode:'01'}]);
    expect((await http('/catalog/wards?provinceCode=99')).status).toBe(404);
    expect((await http('/catalog/wards')).status).toBe(400);
    expect((await http('/catalog/wards?provinceCode=1')).status).toBe(400);
  });
  it('missing calendar price is rejected without resetting existing custom prices',async()=>{
    const {unit}=await homestayFixture();
    await prisma.calendarPricing.create({data:{homestayUnitId:unit.id,date:new Date('2026-10-22'),customPrice:900000}});
    expect((await http('/host/calendar/'+unit.id+'/pricing','PUT',{expectedVersion:1,dates:['2026-10-22']},host.token,randomUUID())).status).toBe(400);
    expect((await prisma.calendarPricing.findFirstOrThrow()).customPrice?.toNumber()).toBe(900000);
    expect((await http('/host/calendar/'+unit.id+'/pricing','PUT',{expectedVersion:1,dates:['2026-10-22'],customPrice:null},host.token,randomUUID())).status).toBe(200);
    expect((await prisma.calendarPricing.findFirstOrThrow()).customPrice).toBeNull();
  });
  it('paid check-in/complete enforce room times and ownership; no clock-based automatic completion',async()=>{
    const {unit,property}=await homestayFixture();const today=vietnamToday();
    const tomorrow=new Date(new Date(today).getTime()+86400000).toISOString().slice(0,10);
    const b=await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:'CONFIRMED',paymentStatus:'PAID',checkInDate:new Date(today),checkOutDate:new Date(tomorrow),policySnapshot:{checkInTime:'00:00:00',checkOutTime:'23:59:59'}})});
    expect((await http('/host/bookings/'+b.id+'/check-in','POST',{expectedVersion:1},otherHost.token,randomUUID())).status).toBe(404);
    const key=randomUUID(),checkin=await http('/host/bookings/'+b.id+'/check-in','POST',{expectedVersion:1},host.token,key);
    expect(checkin.status).toBe(200);expect(checkin.body.data.bookingStatus).toBe('CHECKED_IN');
    expect(await http('/host/bookings/'+b.id+'/check-in','POST',{expectedVersion:1},host.token,key)).toEqual(checkin);
    expect((await http('/host/bookings/'+b.id+'/complete','POST',{expectedVersion:2},host.token,randomUUID())).status).toBe(409);
    expect((await http('/bookings/'+b.id+'/cancel','POST',{expectedVersion:2},tenant.token,randomUUID())).status).toBe(409);
    expect((await http('/host/homestays/'+property.id,'DELETE',{expectedVersion:1},host.token)).status).toBe(409);
    const yesterday=new Date(new Date(today).getTime()-86400000).toISOString().slice(0,10);
    // Separate immutable fixture: production cannot rewrite an existing booking's stay/policy.
    const due=await prisma.booking.create({data:await bookingData(unit.id,{bookingStatus:'CHECKED_IN',paymentStatus:'PAID',checkInDate:new Date(yesterday),checkOutDate:new Date(today),policySnapshot:{checkInTime:'00:00:00',checkOutTime:'00:00:00'}})});
    await app.get(BookingWorkerService).reconcile();expect((await prisma.booking.findUniqueOrThrow({where:{id:due.id}})).bookingStatus).toBe('CHECKED_IN');
    const completionKey=randomUUID(),complete=await http('/host/bookings/'+due.id+'/complete','POST',{expectedVersion:1},host.token,completionKey);
    expect(complete.status).toBe(200);expect(complete.body.data.bookingStatus).toBe('COMPLETED');
    const recorded=(await prisma.booking.findUniqueOrThrow({where:{id:due.id}})).completedAt;
    expect(recorded).toBeInstanceOf(Date);
    expect(await http('/host/bookings/'+due.id+'/complete','POST',{expectedVersion:1},host.token,completionKey)).toEqual(complete);
    expect((await prisma.booking.findUniqueOrThrow({where:{id:due.id}})).completedAt).toEqual(recorded);
  });
  it('concurrent guest cancel and Host accept cannot both apply the same version',async()=>{
    const {unit}=await homestayFixture({}, {instantBook:false}),dto=await holdInput(unit.id);
    const first=await http('/bookings/hold','POST',dto,tenant.token,randomUUID()),id=first.body.data.bookingId;
    const results=await Promise.all([http('/bookings/'+id+'/cancel','POST',{expectedVersion:1},tenant.token,randomUUID()),http('/host/bookings/'+id+'/accept','POST',{expectedVersion:1},host.token,randomUUID())]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);expect((await prisma.booking.findUniqueOrThrow({where:{id}})).version).toBe(2);
  });
  it('fresh BullMQ worker recovers committed deadlines and executes delayed expiration without browser activity',async()=>{
    const {unit}=await homestayFixture();
    const expired=await prisma.booking.create({data:await bookingData(unit.id,{expiresAt:new Date(Date.now()-1000)})});
    const upcoming=await prisma.booking.create({data:await bookingData(unit.id,{checkInDate:new Date('2026-11-01'),checkOutDate:new Date('2026-11-02'),expiresAt:new Date(Date.now()+1800)})});
    const worker=new BookingWorkerService(prisma,app.get(RedisService),app.get(BookingExpiryService),app.get(BookingsService),app.get(HomestayCalendarService));
    try {
      await worker.onModuleInit();expect((await prisma.booking.findUniqueOrThrow({where:{id:expired.id}})).bookingStatus).toBe('CANCELLED_TIMEOUT');
      for(let attempt=0;attempt<60;attempt++) {
        if((await prisma.booking.findUniqueOrThrow({where:{id:upcoming.id}})).bookingStatus==='CANCELLED_TIMEOUT') break;
        await new Promise(done=>setTimeout(done,100));
      }
      expect((await prisma.booking.findUniqueOrThrow({where:{id:upcoming.id}})).bookingStatus).toBe('CANCELLED_TIMEOUT');
    } finally {await worker.onModuleDestroy();}
  },15_000);
  it('hold denies missing/unavailable inventory and Redis contention; cleanup never deletes another owner',async()=>{
    const {unit}=await homestayFixture(),dto=await holdInput(unit.id);
    expect((await http('/bookings/hold','POST',{...dto,unitId:randomUUID()},tenant.token,randomUUID())).status).toBe(404);
    await prisma.calendarPricing.create({data:{homestayUnitId:unit.id,date:new Date('2026-10-22'),status:'BLOCKED'}});
    expect((await http('/bookings/hold','POST',dto,tenant.token,randomUUID())).body.errorCode).toBe('ROOM_ALREADY_LOCKED');
    await prisma.calendarPricing.deleteMany();const redis=app.get(RedisService);
    const resource=`booking:night:${unit.id}:2026-10-22`;await redis.client.set(resource,'another-owner','EX',60);
    try {
      expect((await http('/bookings/hold','POST',dto,tenant.token,randomUUID())).body.errorCode).toBe('ROOM_ALREADY_LOCKED');
      await app.get(BookingsService).releaseLock({value:'not-owner',resources:[resource,1]});
      expect(await redis.client.get(resource)).toBe('another-owner');
    } finally {await redis.client.del(resource);}
    for(const lock of [null,[],true,{}, {value:1,resources:[]},{value:'x',resources:'bad'}])await app.get(BookingsService).releaseLock(lock);
    const cleanup=vi.spyOn(redis,'deleteIfValue').mockRejectedValueOnce(new Error('Synthetic Redis failure'));
    try {await app.get(BookingsService).releaseLock({value:'x',resources:[resource]});}finally{cleanup.mockRestore();}
    expect(await prisma.booking.count()).toBe(0);
  });
  it('committed hold survives cache failure; lists expose only owned bookings and keep pagination',async()=>{
    const {unit}=await homestayFixture(),dto=await holdInput(unit.id);
    const invalidate=vi.spyOn(app.get(HomestayCalendarService),'invalidate').mockRejectedValueOnce(new Error('Synthetic invalidation failure'));
    let first:Awaited<ReturnType<typeof http>>;
    try{first=await http('/bookings/hold','POST',dto,tenant.token,randomUUID());}finally{invalidate.mockRestore();}
    expect(first!.status).toBe(201);
    for(const [url,token,total] of [['/bookings',tenant.token,1],['/bookings',otherHost.token,0],['/host/bookings',host.token,1],['/host/bookings',otherHost.token,0]] as const){
      const list=await http(url,'GET',undefined,token);expect(list.status).toBe(200);expect(list.body.meta.total).toBe(total);
      expect(list.body.data).toHaveLength(total);for(const b of list.body.data){expect(b).not.toHaveProperty('inventoryLock');expect(b).not.toHaveProperty('hostPayoutAmount');}
    }
    expect((await http('/bookings?page=2&limit=1','GET',undefined,tenant.token)).body.data).toEqual([]);
    expect((await http('/host/bookings','GET',undefined,tenant.token)).status).toBe(403);
  });
  it('DB unique conflict rolls back hold/idempotency and releases acquired Redis ownership',async()=>{
    const {unit}=await homestayFixture(),dto=await holdInput(unit.id),key=randomUUID();
    await database.query("CREATE FUNCTION synthetic_booking_insert_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE unique_violation USING MESSAGE='Synthetic unique conflict'; END $$");
    await database.query('CREATE TRIGGER synthetic_booking_insert_failure BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION synthetic_booking_insert_fail()');
    try{expect((await http('/bookings/hold','POST',dto,tenant.token,key)).status).toBe(409);expect(await prisma.booking.count()).toBe(0);}
    finally{await database.query('DROP TRIGGER synthetic_booking_insert_failure ON bookings');await database.query('DROP FUNCTION synthetic_booking_insert_fail()');}
    expect((await http('/bookings/hold','POST',dto,tenant.token,key)).status).toBe(201);
  });
  it.skipIf(process.env.HOMESTAY_BROWSER!=='1')('real homestay UI/BFF/DB handles repricing, cancellation and Host approval at mobile/desktop widths',async()=>{
    const password='SyntheticBrowserFixture123!';
    await prisma.user.updateMany({where:{id:{in:[host.id,tenant.id]}},data:{passwordHash:await bcrypt.hash(password,4)}});
    const guestPhone=(await prisma.user.findUniqueOrThrow({where:{id:tenant.id}})).phone;
    const hostPhone=(await prisma.user.findUniqueOrThrow({where:{id:host.id}})).phone;
    const {unit,property}=await homestayFixture();
    await prisma.calendarPricing.create({data:{homestayUnitId:unit.id,date:new Date('2026-10-26'),status:'BLOCKED'}});
    const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
    const port=(socket.address() as {port:number}).port;await new Promise<void>(done=>socket.close(()=>done()));
    const origin=`http://localhost:${port}`,frontendDir=resolve('../frontend');
    const frontend=spawn(process.execPath,[resolve(frontendDir,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{
      cwd:frontendDir,env:{...process.env,NODE_ENV:'production',BACKEND_API_URL:base+'/api/v1',FRONTEND_ORIGIN:origin,TRUSTED_CLIENT_IP_HEADER:''},stdio:'ignore',windowsHide:true});
    let browser:{close():Promise<void>}|undefined;
    try {
      let ready=false;for(let attempt=0;attempt<100;attempt++){if(frontend.exitCode!==null)throw new Error('Owned homestay frontend exited');ready=await fetch(origin+'/login').then(r=>r.ok,()=>false);if(ready)break;await new Promise(done=>setTimeout(done,100));}expect(ready).toBe(true);
      const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PACKAGE_PATH||'playwright');
      const launched=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL||undefined});browser=launched;
      const guestContext=await launched.newContext({viewport:{width:1440,height:1000}}),hostContext=await launched.newContext();
      const guest=await guestContext.newPage(),hostPage=await hostContext.newPage();
      const errors:string[]=[];guest.on('pageerror',(error:Error)=>errors.push(error.message));hostPage.on('pageerror',(error:Error)=>errors.push(error.message));
      const calendarRequests:string[]=[];
      guest.on('request',(request:{url():string})=>{if(request.url().includes('/calendar?'))calendarRequests.push('calendar request');});
      guest.on('requestfailed',(request:{url():string;failure():{errorText:string}|null})=>{if(request.url().includes('/calendar?'))calendarRequests.push(`calendar failed ${request.failure()?.errorText}`);});
      guest.on('response',(response:{url():string;status():number})=>{if(response.url().includes('/calendar?')||response.url().endsWith('/api/auth/me'))calendarRequests.push(`${response.url().includes('/calendar?')?'calendar':'session'} response ${response.status()}`);});
      for(const [page,phone] of [[guest,guestPhone],[hostPage,hostPhone]]) {
        await page.goto(origin+'/login');await page.getByLabel('Số điện thoại',{exact:true}).fill(phone);await page.getByLabel('Mật khẩu',{exact:true}).fill(password);
        await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();await page.waitForURL(origin+'/account');
      }
      await guest.goto(origin+'/homestay');await guest.getByRole('link',{name:'Xem phòng',exact:true}).click();
      await guest.waitForURL(origin+'/homestay/'+property.slug);
      await guest.getByRole('heading',{name:property.title,exact:true}).waitFor();
      expect(await guest.locator('main h1').count()).toBe(1);
      await guest.getByLabel('Nhận phòng',{exact:true}).fill('2026-10-21');
      await expect.poll(()=>guest.getByLabel('Nhận phòng',{exact:true}).inputValue()).toBe('2026-10-21');
      await guest.getByLabel('Trả phòng',{exact:true}).fill('2026-10-23');
      await expect.poll(()=>guest.getByLabel('Nhận phòng',{exact:true}).inputValue()).toBe('2026-10-21');
      await guest.getByRole('button',{name:'Nhận phòng 2026-10-22',exact:true}).click();
      expect(await guest.getByRole('button',{name:'Nhận phòng 2026-10-01',exact:true}).isDisabled()).toBe(true);
      expect(await guest.getByRole('button',{name:'Trả phòng 2026-10-26',exact:true}).isDisabled()).toBe(false);
      await guest.getByRole('button',{name:'Trả phòng 2026-10-26',exact:true}).click();
      expect(await guest.getByLabel('Nhận phòng',{exact:true}).inputValue()).toBe('2026-10-22');
      expect(await guest.getByLabel('Trả phòng',{exact:true}).inputValue()).toBe('2026-10-26');
      await guest.getByLabel('Người lớn',{exact:true}).fill('2');await guest.getByLabel('Trẻ em',{exact:true}).fill('1');
      await guest.getByRole('button',{name:'Xem báo giá',exact:true}).click();
      try {await guest.getByRole('link',{name:'Tiếp tục đặt phòng',exact:true}).waitFor({timeout:10000});}
      catch(error){console.log('Synthetic homestay quote diagnostic',await guest.locator('main').innerText(),await guest.locator('main input').evaluateAll((nodes:HTMLInputElement[])=>nodes.map(n=>({id:n.id,value:n.value,valid:n.checkValidity(),message:n.validationMessage}))));throw error;}
      await guest.getByRole('link',{name:'Tiếp tục đặt phòng',exact:true}).click();await guest.getByRole('button',{name:'Giữ phòng',exact:true}).waitFor();
      await prisma.homestayUnit.update({where:{id:unit.id},data:{cleaningFee:250000}});
      await guest.getByRole('button',{name:'Giữ phòng',exact:true}).click();await guest.getByRole('button',{name:'Xác nhận giá mới và giữ phòng',exact:true}).waitFor();
      expect(await prisma.booking.count()).toBe(0);
      const evidenceDir=resolve('../.tmp/sprint3-browser');await mkdir(evidenceDir,{recursive:true});
      for(const width of [375,768,1440,2560]) {
        await guest.setViewportSize({width,height:1000});
        const summary=await guest.getByRole('heading',{name:'Tóm tắt lưu trú',exact:true}).locator('..').boundingBox();
        const confirm=await guest.getByRole('button',{name:'Xác nhận giá mới và giữ phòng',exact:true}).boundingBox();
        expect(summary).not.toBeNull();expect(confirm).not.toBeNull();
        if(width<1024)expect(summary!.y+summary!.height).toBeLessThanOrEqual(confirm!.y);
        else expect(summary!.x).toBeGreaterThan(confirm!.x+confirm!.width);
        expect(await guest.evaluate(()=>{
          const summary=Array.from(document.querySelectorAll('h2')).find(n=>n.textContent?.trim()==='Tóm tắt lưu trú')?.closest('section');
          const confirm=Array.from(document.querySelectorAll('button')).find(n=>n.textContent?.trim()==='Xác nhận giá mới và giữ phòng');
          return Boolean(summary&&confirm&&(summary.compareDocumentPosition(confirm)&Node.DOCUMENT_POSITION_FOLLOWING));
        })).toBe(true);
        expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await guest.screenshot({path:resolve(evidenceDir,`checkout-reprice-${width}.png`),fullPage:true});
      }
      await guest.getByRole('button',{name:'Xác nhận giá mới và giữ phòng',exact:true}).click();await guest.getByRole('link',{name:'Xem đơn của tôi',exact:true}).waitFor();
      const held=await prisma.booking.findFirstOrThrow();expect(held.paymentStatus).toBe('NOT_CONFIGURED');expect(held.bookingStatus).toBe('PENDING_PAYMENT');expect(held.cleaningFee.toNumber()).toBe(250000);
      for(const width of [375,768,1440,2560]) {
        await guest.setViewportSize({width,height:1000});expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await guest.screenshot({path:resolve(evidenceDir,`checkout-${width}.png`),fullPage:true});
      }
      await guest.getByRole('link',{name:'Xem đơn của tôi',exact:true}).click();await guest.getByRole('button',{name:'Hủy đơn chưa thanh toán',exact:true}).click();
      await guest.getByText('Bạn đã hủy',{exact:true}).waitFor();expect((await prisma.booking.findUniqueOrThrow({where:{id:held.id}})).bookingStatus).toBe('CANCELLED_BY_GUEST');
      await prisma.homestayUnit.update({where:{id:unit.id},data:{instantBook:false}});
      await guest.goto(origin+'/homestay/'+property.slug);await guest.getByLabel('Nhận phòng',{exact:true}).fill('2026-10-22');await guest.getByLabel('Trả phòng',{exact:true}).fill('2026-10-26');
      await guest.getByRole('button',{name:'Xem báo giá',exact:true}).click();await guest.getByRole('link',{name:'Tiếp tục đặt phòng',exact:true}).click();await guest.getByRole('button',{name:'Giữ phòng',exact:true}).click();
      await guest.getByText('Chờ chủ nhà duyệt',{exact:true}).waitFor();
      await hostPage.goto(origin+'/host/bookings');await hostPage.getByRole('button',{name:'Chấp nhận',exact:true}).click();
      await hostPage.getByText('Chờ thanh toán',{exact:true}).waitFor();
      expect((await prisma.booking.findFirstOrThrow({where:{bookingStatus:'PENDING_PAYMENT'}})).paymentStatus).toBe('NOT_CONFIGURED');
      expect(errors).toEqual([]);
      // Run the skill's read-only probe against a real public detail while the owned backend is alive.
      try {await promisify(execFile)(process.execPath,[resolve('../.agents/skills/ui-ux/scripts/probe.mjs'),origin+'/homestay/'+property.slug,'--pw',process.env.PLAYWRIGHT_RUNTIME_ROOT||'', '--widths','375,768,1440,2560','--out',resolve(evidenceDir,'probe')],{timeout:60_000,windowsHide:true});}
      catch(error){
        // Preserve tool failure; do not equate manual/Playwright checks with the skill's full probe.
        if(!String(error).includes('node.children is not iterable'))throw error;
        console.log('UI probe tool blocked: node.children is not iterable; viewport/browser assertions are separate evidence.');
      }
      // Force bootstrap to finish while the real calendar read is still pending.
      let releaseSession!:()=>void;
      const calendarReady=new Promise<void>(done=>{releaseSession=done;});
      await guest.route('**/api/auth/me',async(route:{continue():Promise<void>})=>{await calendarReady;await route.continue();});
      await guest.route(`**/api/listings/homestays/units/${unit.id}/calendar?*`,async(route:{fetch():Promise<unknown>;fulfill(options:unknown):Promise<void>})=>{
        const response=await route.fetch();releaseSession();
        await guest.getByRole('button',{name:'Mở menu tài khoản',exact:true}).waitFor();
        await route.fulfill({response});
      });
      await guest.goto(origin+'/homestay/'+property.slug);await guest.getByRole('heading',{name:property.title,exact:true}).waitFor();
      try {await guest.getByRole('button',{name:'Nhận phòng 2026-10-22',exact:true}).waitFor({timeout:10000});}
      catch(error){console.log('Synthetic final calendar diagnostic',calendarRequests,await guest.locator('main').innerText(),await http('/homestays/units/'+unit.id+'/calendar?month=2026-10&adults=1&children=0'));throw error;}
      for(const width of [375,768,1440,2560]) {
        await guest.setViewportSize({width,height:1000});expect(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
        await guest.screenshot({path:resolve(evidenceDir,`detail-${width}.png`),fullPage:true});
      }
    } finally {await browser?.close();if(frontend.exitCode===null){const closed=once(frontend,'close');frontend.kill();await closed;}}
  },120_000);
});
