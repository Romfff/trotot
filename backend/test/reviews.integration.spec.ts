import '../src/config/load-env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ApiEnvelopeInterceptor } from '../src/common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';

// Opt-in: real HTTP + auth + PostgreSQL + Redis; synthetic bookings only, no gateway/real money.
describe.skipIf(process.env.REVIEWS_INTEGRATION !== '1')('S5 verified reviews with real DB',()=>{
  const name=`trotot_reviews_test_${randomUUID().replaceAll('-','')}`;
  const original={url:process.env.DATABASE_URL,prefix:process.env.REDIS_KEY_PREFIX,secret:process.env.JWT_ACCESS_SECRET,refreshSecret:process.env.JWT_REFRESH_SECRET,proxySecret:process.env.BFF_PROXY_SECRET};
  let admin:Pool,db:Pool,app:INestApplication,prisma:PrismaService,base:string,created=false;
  let guest:Awaited<ReturnType<typeof account>>,host:Awaited<ReturnType<typeof account>>,other:Awaited<ReturnType<typeof account>>,operator:Awaited<ReturnType<typeof account>>,otherHost:Awaited<ReturnType<typeof account>>;
  let counter=0;
  const input={cleanliness:5,location:4,value:3,comment:'Đánh giá fixture — không phải khách thật.'};
  async function account(role:string){
    const user=await prisma.user.create({data:{phone:`09900000${String(counter++).padStart(2,'0')}`,fullName:`Synthetic ${role}`,role,passwordHash:'fixture-only'}});
    const token=await new SignJWT({tokenType:'access',sessionVersion:user.sessionVersion})
      .setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuedAt().setExpirationTime('10m')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
    return {id:user.id,token};
  }
  async function fixture(status='COMPLETED',guestId=guest.id){
    const property=await prisma.property.create({data:{hostId:guestId===host.id?otherHost.id:host.id,slug:`review-${randomUUID()}`,title:'Review fixture',description:'Synthetic only',
      propertyType:'HOMESTAY',rentalMode:'SHORT_TERM',addressDetail:'Fixture',provinceCode:'TEST',wardCode:'TEST',latitude:10,longitude:106,status:'PUBLISHED'}});
    const unit=await prisma.homestayUnit.create({data:{propertyId:property.id,unitName:'Fixture',maxAdults:2,maxChildren:1,bedrooms:1,bathrooms:1,
      basePricePerNight:500,cleaningFee:100,status:'PUBLISHED',instantBook:true,checkInTime:new Date('1970-01-01T14:00:00Z'),
      checkOutTime:new Date('1970-01-01T12:00:00Z'),cancellationPolicy:'FLEXIBLE'}});
    const booking=await prisma.booking.create({data:{bookingCode:`RV-${randomUUID().replaceAll('-','').slice(0,24)}`,homestayUnitId:unit.id,guestId,
      checkInDate:new Date('2020-01-01'),checkOutDate:new Date('2020-01-03'),totalNights:2,numAdults:1,numChildren:0,guestName:'Synthetic guest',guestPhone:'0990000099',
      nightlyPrices:[{date:'2020-01-01',price:'500'},{date:'2020-01-02',price:'500'}],policySnapshot:{cancellationPolicy:'FLEXIBLE',checkInTime:'14:00:00',checkOutTime:'12:00:00'},
      baseAmount:1000,cleaningFee:100,serviceFee:0,taxAmount:0,totalAmount:1100,serviceFeeRate:0,taxRate:0,commissionRate:10,commissionAmount:110,hostPayoutAmount:990,
      bookingStatus:status==='COMPLETED'?'CHECKED_IN':status,paymentStatus:status.startsWith('PENDING_')?'PENDING':'PAID',expiresAt:new Date(Date.now()+60000)}});
    if(status==='COMPLETED') await prisma.booking.update({where:{id:booking.id},data:{bookingStatus:status}});
    return {booking,property};
  }
  async function http(path:string,method='GET',body?:unknown,token?:string){
    const result=await fetch(`${base}/api/v1${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:result.status,body:await result.json()};
  }
  beforeAll(async()=>{
    const source=new URL(original.url!);
    if(process.env.NODE_ENV!=='test'||!['localhost','127.0.0.1'].includes(source.hostname)||source.port!=='58491') throw new Error('Use isolated local test stack port 58491 and NODE_ENV=test');
    admin=new Pool({connectionString:source.toString()});
    await admin.query(`CREATE DATABASE "${name}"`);created=true;
    source.pathname=`/${name}`;process.env.DATABASE_URL=source.toString();
    process.env.REDIS_KEY_PREFIX=`reviews-test:${name}:`;process.env.JWT_ACCESS_SECRET='reviews-integration-access-only-secret-32chars';
    process.env.JWT_REFRESH_SECRET='reviews-integration-refresh-only-secret-32chars';process.env.BFF_PROXY_SECRET='reviews-integration-bff-only-secret-32chars';
    await promisify(execFile)(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{env:process.env,timeout:90000});
    db=new Pool({connectionString:source.toString()});
    app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));
    app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0,'127.0.0.1');base=await app.getUrl();prisma=app.get(PrismaService);
    await prisma.addressProvince.create({data:{code:'TEST',name:'Synthetic'}});
    await prisma.addressWard.create({data:{code:'TEST',provinceCode:'TEST',name:'Synthetic'}});
    guest=await account('TENANT');host=await account('HOST');other=await account('TENANT');operator=await account('ADMIN');otherHost=await account('HOST');
  },120000);
  afterAll(async()=>{
    await app?.close();await db?.end();
    if(created&&/^trotot_reviews_test_[a-f0-9]{32}$/.test(name)) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin?.end();process.env.DATABASE_URL=original.url;
    if(original.prefix===undefined)delete process.env.REDIS_KEY_PREFIX;else process.env.REDIS_KEY_PREFIX=original.prefix;
    if(original.secret===undefined)delete process.env.JWT_ACCESS_SECRET;else process.env.JWT_ACCESS_SECRET=original.secret;
    if(original.refreshSecret===undefined)delete process.env.JWT_REFRESH_SECRET;else process.env.JWT_REFRESH_SECRET=original.refreshSecret;
    if(original.proxySecret===undefined)delete process.env.BFF_PROXY_SECRET;else process.env.BFF_PROXY_SECRET=original.proxySecret;
  });
  it('creates verified review, reads own, public envelope has no private identifiers or financial mutation',async()=>{
    const {booking,property}=await fixture();
    expect((await http(`/bookings/${booking.id}/review`,'GET',undefined,guest.token)).body.data).toBeNull();
    const before=await prisma.booking.findUniqueOrThrow({where:{id:booking.id}});
    const result=await http(`/bookings/${booking.id}/review`,'POST',{...input,comment:'  Review fixture  '},guest.token);
    expect(result.status).toBe(201);expect(result.body).toMatchObject({success:true,data:{comment:'Review fixture',cleanliness:5,location:4,value:3,authorName:'Synthetic TENANT'}});
    expect((await http(`/bookings/${booking.id}/review`,'GET',undefined,guest.token)).body.data).toEqual(result.body.data);
    const list=await http(`/properties/${property.slug}/reviews?page=1&limit=1`);
    expect(list.status).toBe(200);expect(list.body.meta).toEqual({page:1,limit:1,total:1,totalPages:1});expect(list.body.data).toEqual([result.body.data]);
    expect(Object.keys(list.body.data[0]).sort()).toEqual(['authorName','cleanliness','comment','createdAt','id','location','value']);
    expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(before);
    expect(await prisma.financeJournal.count()).toBe(0);expect(await prisma.financeEntry.count()).toBe(0);
  });
  it('denies anonymous, wrong guest, owning Host and Admin, including reading a private review',async()=>{
    const {booking}=await fixture();
    for(const [token,status] of [[undefined,401],[other.token,404],[host.token,404],[operator.token,403]] as const){
      expect((await http(`/bookings/${booking.id}/review`,'POST',input,token)).status).toBe(status);
      expect((await http(`/bookings/${booking.id}/review`,'GET',undefined,token)).status).toBe(status);
    }
  });
  it('allows Host acting as guest only for their own completed booking',async()=>{
    const {booking}=await fixture('COMPLETED',host.id);
    expect((await http(`/bookings/${booking.id}/review`,'POST',input,host.token)).status).toBe(201);
  });
  it.skipIf(process.env.REVIEWS_BROWSER !== '1')('browser submits and reads through real Next BFF and isolated API/DB',async()=>{
    const {booking,property}=await fixture();
    const record=await prisma.user.findUniqueOrThrow({where:{id:guest.id}});
    const password='S5BrowserFixtureOnly!42';
    await prisma.user.update({where:{id:guest.id},data:{passwordHash:await bcrypt.hash(password,12),isPhoneVerified:true}});
    const before=await prisma.booking.findUniqueOrThrow({where:{id:booking.id}});
    const result=await promisify(execFile)(process.execPath,[resolve('../frontend/tests/reviews-browser-check.mjs'),resolve('../frontend'),
      process.env.PLAYWRIGHT_MODULE||'playwright'],{
      env:{...process.env,REVIEWS_BROWSER_FIXTURE:JSON.stringify({api:base,login:{phone:record.phone,role:record.role,password},bookingId:booking.id,bookingCode:booking.bookingCode,slug:property.slug,
        user:{id:record.id,phone:record.phone,email:record.email,fullName:record.fullName,role:record.role,status:record.status,avatarUrl:record.avatarUrl,
          isPhoneVerified:record.isPhoneVerified,isIdentityVerified:record.isIdentityVerified,createdAt:record.createdAt,updatedAt:record.updatedAt}})},
      timeout:90000,windowsHide:true,
    });
    expect(result.stdout).toContain('REAL PASS');
    expect(await prisma.review.count({where:{bookingId:booking.id}})).toBe(1);
    expect(await prisma.booking.findUniqueOrThrow({where:{id:booking.id}})).toEqual(before);
    expect(await prisma.financeJournal.count()).toBe(0);
  },100000);
  it.each(['PENDING_PAYMENT','PENDING_HOST_APPROVAL','CONFIRMED','CHECKED_IN','CANCELLED','CANCELLED_BY_GUEST','REJECTED_BY_HOST','CANCELLED_TIMEOUT','CANCELLED_HOST_TIMEOUT'])('rejects %s without changing booking',async status=>{
    const {booking}=await fixture(status);
    const result=await http(`/bookings/${booking.id}/review`,'POST',input,guest.token);
    expect(result.status).toBe(409);expect(result.body.errorCode).toBe('REVIEW_NOT_ELIGIBLE');
    expect(await prisma.review.count({where:{bookingId:booking.id}})).toBe(0);
  });
  it('serializes concurrent duplicate submissions and retries, returning a clear 409',async()=>{
    const {booking}=await fixture();
    const results=await Promise.all([1,2].map(()=>http(`/bookings/${booking.id}/review`,'POST',input,guest.token)));
    expect(results.map(r=>r.status).sort()).toEqual([201,409]);
    expect(results.find(r=>r.status===409)!.body.errorCode).toBe('REVIEW_ALREADY_EXISTS');
    expect((await http(`/bookings/${booking.id}/review`,'POST',input,guest.token)).status).toBe(409);
    expect(await prisma.review.count({where:{bookingId:booking.id}})).toBe(1);
  });
  it.each([{cleanliness:0},{location:6},{value:1.5},{cleanliness:'5'},{comment:'  '},{comment:'x'.repeat(2001)},{guestId:randomUUID()}])('validates request %j',async bad=>{
    const {booking}=await fixture();expect((await http(`/bookings/${booking.id}/review`,'POST',{...input,...bad},guest.token)).status).toBe(400);
  });
  it('DB independently rejects wrong guest, non-completed and out-of-range scores',async()=>{
    const {booking}=await fixture();const pending=await fixture('CHECKED_IN');
    for(const [id,userId,score] of [[booking.id,other.id,5],[pending.booking.id,guest.id,5],[booking.id,guest.id,0]] as const){
      await expect(db.query('INSERT INTO reviews(booking_id,guest_id,cleanliness,location,value,comment) VALUES($1,$2,$3,4,4,$4)',[id,userId,score,'Synthetic DB rejection'])).rejects.toThrow();
    }
  });
  it('hides reviews when listing is private/deleted or Host inactive',async()=>{
    const {booking,property}=await fixture();await http(`/bookings/${booking.id}/review`,'POST',input,guest.token);
    for(const status of ['DRAFT','PENDING_REVIEW','HIDDEN','REJECTED','EXPIRED']){
      await prisma.property.update({where:{id:property.id},data:{status}});
      expect((await http(`/properties/${property.slug}/reviews`)).status).toBe(404);
    }
    await prisma.property.update({where:{id:property.id},data:{status:'PUBLISHED',deletedAt:new Date()}});
    expect((await http(`/properties/${property.slug}/reviews`)).status).toBe(404);
    await prisma.property.update({where:{id:property.id},data:{deletedAt:null}});
    await prisma.user.update({where:{id:host.id},data:{status:'BANNED'}});
    expect((await http(`/properties/${property.slug}/reviews`)).status).toBe(404);
    await prisma.user.update({where:{id:host.id},data:{status:'ACTIVE'}});
  });
  it('validates identifiers/pagination and documents real routes and response types',async()=>{
    expect((await http('/bookings/not-uuid/review','POST',input,guest.token)).status).toBe(400);
    const {property}=await fixture();
    for(const query of ['page=0','limit=101','page=1.5'])expect((await http(`/properties/${property.slug}/reviews?${query}`)).status).toBe(400);
    const document=SwaggerModule.createDocument(app,new DocumentBuilder().build());
    expect(document.paths['/api/v1/bookings/{id}/review'].post).toBeDefined();
    expect(document.paths['/api/v1/properties/{slug}/reviews'].get).toBeDefined();
    expect(document.components?.schemas?.ReviewResponseDto).toBeDefined();
  });
  it('allows score bounds, returns empty/out-of-range pages without fabricated ratings',async()=>{
    const {property,booking}=await fixture();
    expect((await http(`/properties/${property.slug}/reviews`)).body).toMatchObject({data:[],meta:{total:0,totalPages:0}});
    expect((await http(`/bookings/${booking.id}/review`,'POST',{...input,cleanliness:1,location:1,value:5},guest.token)).status).toBe(201);
    expect((await http(`/properties/${property.slug}/reviews?page=2&limit=1`)).body).toMatchObject({data:[],meta:{total:1,totalPages:1,page:2}});
  });
  it('rejects inactive guest in Auth and DB, without creating a review',async()=>{
    const {booking}=await fixture('COMPLETED',other.id);
    await prisma.user.update({where:{id:other.id},data:{status:'BANNED'}});
    expect((await http(`/bookings/${booking.id}/review`,'POST',input,other.token)).status).toBe(401);
    await expect(db.query('INSERT INTO reviews(booking_id,guest_id,cleanliness,location,value,comment) VALUES($1,$2,5,4,4,$3)',[booking.id,other.id,'Synthetic inactive rejection'])).rejects.toThrow();
    await prisma.user.update({where:{id:other.id},data:{status:'ACTIVE'}});
    expect(await prisma.review.count({where:{bookingId:booking.id}})).toBe(0);
  });
  it('keeps verified review, scores and public totals unchanged after guest ban/unban',async()=>{
    const {booking,property}=await fixture('COMPLETED',other.id);
    expect((await http(`/bookings/${booking.id}/review`,'POST',input,other.token)).status).toBe(201);
    const before=(await http(`/properties/${property.slug}/reviews`)).body;
    const record=await prisma.review.findUniqueOrThrow({where:{bookingId:booking.id}});
    for(const status of ['BANNED','ACTIVE']) {
      await prisma.user.update({where:{id:other.id},data:{status}});
      expect((await http(`/properties/${property.slug}/reviews`)).body).toEqual(before);
      expect(await prisma.review.findUniqueOrThrow({where:{bookingId:booking.id}})).toEqual(record);
    }
  });
});
