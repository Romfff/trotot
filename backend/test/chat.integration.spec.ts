import '../src/config/load-env.js';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe,type INestApplication } from '@nestjs/common';
import { SwaggerModule,DocumentBuilder } from '@nestjs/swagger';
import { randomUUID,createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { SignJWT } from 'jose';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ApiEnvelopeInterceptor } from '../src/common/api-envelope.interceptor.js';
import { ApiExceptionFilter } from '../src/common/api-exception.filter.js';
import { RedisService } from '../src/redis/redis.service.js';
import { ChatRealtimeService } from '../src/chat/chat-realtime.service.js';

describe.skipIf(process.env.CHAT_INTEGRATION!=='1')('S5 chat API/socket with isolated real DB',()=>{
  const name=`trotot_chat_test_${randomUUID().replaceAll('-','')}`;
  const original={...process.env};let admin:Pool,db:Pool,app:INestApplication,prisma:PrismaService,base:string,created=false;
  let guest:Awaited<ReturnType<typeof account>>,host:Awaited<ReturnType<typeof account>>,other:Awaited<ReturnType<typeof account>>,operator:Awaited<ReturnType<typeof account>>;
  let counter=0;
  async function account(role='TENANT') {
    const user=await prisma.user.create({data:{phone:`09900${String(counter++).padStart(5,'0')}`,fullName:`Synthetic ${role}`,role,passwordHash:'fixture-only'}});
    const token=await new SignJWT({tokenType:'access',sessionVersion:0}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setExpirationTime('10m').sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
    return {id:user.id,role,token};
  }
  async function fixture() {
    const property=await prisma.property.create({data:{hostId:host.id,slug:`chat-${randomUUID()}`,title:'Chat fixture',description:'Synthetic only',propertyType:'PHONG_TRO',rentalMode:'LONG_TERM',addressDetail:'Fixture',provinceCode:'TEST',wardCode:'TEST',latitude:10,longitude:106,status:'PUBLISHED'}});
    const response=await http('/conversations','POST',{propertyId:property.id},guest.token);expect(response.status).toBe(201);
    return {property,id:response.body.data.id as string};
  }
  async function http(path:string,method='GET',body?:unknown,token?:string) {
    const r=await fetch(`${base}/api/v1${path}`,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:r.status,body:await r.json(),headers:r.headers};
  }
  const send=(id:string,token=guest.token,text='Synthetic private text',key=randomUUID())=>http(`/conversations/${id}/messages`,'POST',{clientMessageId:key,text},token);
  beforeAll(async()=>{
    const source=new URL(process.env.DATABASE_URL!);
    if(process.env.NODE_ENV!=='test'||!['localhost','127.0.0.1'].includes(source.hostname)||source.port!=='58491')throw new Error('Use isolated test port 58491 and NODE_ENV=test');
    admin=new Pool({connectionString:source.toString()});await admin.query(`CREATE DATABASE "${name}"`);created=true;
    source.pathname=`/${name}`;process.env.DATABASE_URL=source.toString();process.env.REDIS_KEY_PREFIX=`chat-test:${name}:`;
    process.env.JWT_ACCESS_SECRET='chat-test-access-secret-32chars-only';process.env.REALTIME_ENABLED='true';process.env.CORS_ORIGINS='http://localhost:3000';
    process.env.JWT_REFRESH_SECRET='chat-test-refresh-secret-32chars-only';process.env.BFF_PROXY_SECRET='chat-test-bff-proxy-secret-32chars-only';
    await promisify(execFile)(process.execPath,[resolve('node_modules/prisma/build/index.js'),'migrate','deploy'],{env:process.env,timeout:90000});
    db=new Pool({connectionString:source.toString()});
    app=await NestFactory.create(AppModule,{logger:false});app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}));app.useGlobalInterceptors(new ApiEnvelopeInterceptor());app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0,'127.0.0.1');base=await app.getUrl();prisma=app.get(PrismaService);
    await prisma.addressProvince.create({data:{code:'TEST',name:'Synthetic'}});await prisma.addressWard.create({data:{code:'TEST',provinceCode:'TEST',name:'Synthetic'}});
    guest=await account();host=await account('HOST');other=await account();operator=await account('ADMIN');
  },120000);
  afterAll(async()=>{
    await app?.close();await db?.end();
    if(created&&/^trotot_chat_test_[a-f0-9]{32}$/.test(name))await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin?.end();for(const key of ['DATABASE_URL','REDIS_KEY_PREFIX','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','BFF_PROXY_SECRET','REALTIME_ENABLED','CORS_ORIGINS']){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}
  });
  beforeEach(async()=>{
    // Independent cases must not consume each other's one-minute quota; rate limiting has its own test.
    for(const ip of ['127.0.0.1','::ffff:127.0.0.1'])
      await app.get(RedisService).client.del(`sprint2:limit:ip:${createHash('sha256').update(ip).digest('hex')}`);
    for(const u of [guest,host,other,operator])for(const scope of ['write','read'])
      await app.get(RedisService).client.del(`sprint2:limit:${scope}:${createHash('sha256').update(u.id).digest('hex')}`);
  });
  it('enforces roles, ownership, no self-chat and no private contact in response',async()=>{
    const f=await fixture();
    expect((await http('/conversations','POST',{propertyId:f.property.id})).status).toBe(401);
    expect((await http('/conversations','POST',{propertyId:f.property.id},operator.token)).status).toBe(403);
    expect((await http('/conversations','POST',{propertyId:f.property.id},host.token)).body.errorCode).toBe('CHAT_SELF_NOT_ALLOWED');
    expect((await http(`/conversations/${f.id}/messages`,'GET',undefined,other.token)).status).toBe(404);
    expect((await send(f.id,other.token)).status).toBe(404);
    expect((await send(f.id,operator.token)).status).toBe(403);
    const read=await http(`/conversations/${f.id}/messages`,'GET',undefined,operator.token);
    expect(read.status).toBe(200);expect(read.body.data.conversation.canSend).toBe(false);
    expect(JSON.stringify(read.body)).not.toMatch(/phone|email|password|token|bank/);
    expect((await http('/conversations','GET',undefined,other.token)).body.meta.total).toBe(0);
  });
  it.skipIf(process.env.CHAT_BROWSER!=='1')('browser uses real BFF to read and persist chat with isolated DB',async()=>{
    const f=await fixture();const title=`Browser chat ${randomUUID()}`;
    await prisma.property.update({where:{id:f.property.id},data:{title}});
    const conversation=(await http('/conversations','POST',{propertyId:f.property.id},guest.token)).body.data;
    const user=await prisma.user.findUniqueOrThrow({where:{id:guest.id}});
    const password='S5BrowserFixtureOnly!42',passwordHash=await bcrypt.hash(password,12);
    const credentials=await prisma.user.findMany({where:{id:{in:[guest.id,host.id,other.id]}},select:{id:true,phone:true,role:true}});
    await prisma.user.updateMany({where:{id:{in:credentials.map(u=>u.id)}},data:{passwordHash,isPhoneVerified:true}});
    const login=(id:string)=>{const u=credentials.find(u=>u.id===id)!;return {phone:u.phone,role:u.role,password};};
    const result=await promisify(execFile)(process.execPath,[resolve('../frontend/tests/chat-browser-check.mjs'),resolve(process.env.CHAT_FRONTEND_BUILD||'../frontend'),process.env.PLAYWRIGHT_MODULE||'playwright'],{
      env:{...process.env,CHAT_BROWSER_FIXTURE:JSON.stringify({api:base,conversation,login:login(guest.id),hostLogin:login(host.id),otherLogin:login(other.id),
        user:{id:user.id,phone:user.phone,email:user.email,fullName:user.fullName,role:user.role,status:user.status,avatarUrl:user.avatarUrl,isPhoneVerified:user.isPhoneVerified,isIdentityVerified:user.isIdentityVerified,createdAt:user.createdAt,updatedAt:user.updatedAt}})},timeout:90000,windowsHide:true});
    expect(result.stdout).toContain('REAL PASS');expect(await prisma.chatMessage.count({where:{conversationId:f.id}})).toBe(3);
  },100000);
  it.skipIf(process.env.ADMIN_BROWSER!=='1')('browser Admin dashboard and ban/unban use real protected BFF and persist one audit per action',async()=>{
    const target=await account('HOST'),fullName=`Admin browser target ${randomUUID().slice(0,8)}`;
    await prisma.user.update({where:{id:target.id},data:{fullName}});
    const user=await prisma.user.findUniqueOrThrow({where:{id:operator.id}}),before=await prisma.financeJournal.count();
    const password='S5BrowserFixtureOnly!42';
    await prisma.user.update({where:{id:operator.id},data:{passwordHash:await bcrypt.hash(password,12),isPhoneVerified:true}});
    const result=await promisify(execFile)(process.execPath,[resolve('../frontend/tests/admin-dashboard-browser-check.mjs'),resolve('../frontend'),process.env.PLAYWRIGHT_MODULE||'playwright'],{
      env:{...process.env,ADMIN_BROWSER_FIXTURE:JSON.stringify({api:base,login:{phone:user.phone,role:user.role,password},target:{id:target.id,fullName},
        user:{id:user.id,phone:user.phone,email:user.email,fullName:user.fullName,role:user.role,status:user.status,avatarUrl:user.avatarUrl,isPhoneVerified:user.isPhoneVerified,isIdentityVerified:user.isIdentityVerified,createdAt:user.createdAt,updatedAt:user.updatedAt}})},timeout:90000,windowsHide:true});
    expect(result.stdout).toContain('REAL PASS');
    expect(await prisma.user.findUniqueOrThrow({where:{id:target.id}})).toMatchObject({status:'ACTIVE',sessionVersion:2});
    expect(await prisma.userModerationEvent.count({where:{targetId:target.id}})).toBe(2);
    expect(await prisma.financeJournal.count()).toBe(before);
  },100000);
  it('concurrent opens and sends/retries persist exactly once, rejects same key different content',async()=>{
    const f=await fixture();
    const opened=await Promise.all([1,2,3].map(()=>http('/conversations','POST',{propertyId:f.property.id},guest.token)));
    expect(opened.every(r=>r.body.data.id===f.id)).toBe(true);expect(await prisma.chatConversation.count({where:{propertyId:f.property.id}})).toBe(1);
    const caseUser=await account();const canonical=await Promise.all([f.property.id,f.property.id.toUpperCase()].map(propertyId=>http('/conversations','POST',{propertyId},caseUser.token)));
    expect(canonical.every(r=>r.status===201&&r.body.data.id===canonical[0].body.data.id)).toBe(true);
    const key=randomUUID(),rows=await Promise.all([1,2,3].map(()=>send(f.id,guest.token,'Synthetic retry',key)));
    expect(rows.every(r=>r.status===201&&r.body.data.id===rows[0].body.data.id)).toBe(true);
    expect(await prisma.chatMessage.count({where:{conversationId:f.id}})).toBe(1);
    expect((await send(f.id,guest.token,'Different text',key)).body.errorCode).toBe('CHAT_MESSAGE_KEY_REUSED');
  });
  for(const status of ['DRAFT','PENDING_REVIEW','PUBLISHED','HIDDEN','REJECTED','EXPIRED']) {
    it.each([false,true])(`${status} × deletedAt=%s: new/history/send policy`,async deleted=>{
      const f=await fixture();const newcomer=await account();
      await prisma.property.update({where:{id:f.property.id},data:{status,deletedAt:deleted?new Date():null}});
      const opened=await http('/conversations','POST',{propertyId:f.property.id},newcomer.token);
      expect(opened.status).toBe(!deleted&&status==='PUBLISHED'?201:409);
      const canSend=!deleted&&['PUBLISHED','HIDDEN','EXPIRED'].includes(status);
      const read=await http(`/conversations/${f.id}/messages`,'GET',undefined,guest.token);expect(read.status).toBe(200);
      expect(read.body.data.conversation.canSend).toBe(canSend);
      if(!canSend)expect(read.body.data.conversation.readOnlyReason).toBeTruthy();
      const posted=await send(f.id);expect(posted.status).toBe(canSend?201:409);
      expect(await prisma.chatMessage.count({where:{conversationId:f.id}})).toBe(canSend?1:0);
      expect((await http(`/conversations/${f.id}/messages`,'GET',undefined,operator.token)).status).toBe(200);
    });
  }
  it('resumes new/existing chat when hidden/expired/deleted listing is restored',async()=>{
    const f=await fixture();for(const change of [{status:'HIDDEN'},{status:'EXPIRED'},{deletedAt:new Date()}]) {
      await prisma.property.update({where:{id:f.property.id},data:change});
      await prisma.property.update({where:{id:f.property.id},data:{status:'PUBLISHED',deletedAt:null}});
      expect((await send(f.id)).status).toBe(201);
    }
    expect((await http('/conversations','POST',{propertyId:f.property.id},other.token)).status).toBe(201);
  });
  it('persists unread per participant; own messages, cursor retry/race and new arrivals never lose unread',async()=>{
    const f=await fixture();const first=(await send(f.id,host.token,'First unread')).body.data;
    const second=(await send(f.id,host.token,'Second unread')).body.data;
    const own=(await send(f.id,guest.token,'Own message')).body.data;
    const count=async(token=guest.token)=>(await http('/conversations/unread','GET',undefined,token)).body.data.conversations.find((c:{conversationId:string})=>c.conversationId===f.id)?.unreadCount||0;
    expect(await count()).toBe(2);expect(await count(host.token)).toBe(1);
    const read=(messageId:string,token=guest.token)=>http(`/conversations/${f.id}/read`,'POST',{messageId},token);
    expect((await read(first.id)).status).toBe(201);expect(await count()).toBe(1);
    const race=await Promise.all([read(own.id),read(first.id),read(second.id)]);expect(race.every(r=>r.status===201)).toBe(true);
    expect(await count()).toBe(0);expect(await count(host.token)).toBe(1);
    const receipt=await prisma.chatReadCursor.findUniqueOrThrow({where:{conversationId_userId:{conversationId:f.id,userId:guest.id}}});expect(receipt.messageId).toBe(own.id);
    expect((await read(first.id)).body.data.messageId).toBe(own.id);expect(await count()).toBe(0);
    const [posted]=await Promise.all([send(f.id,host.token,'Arrives during read'),read(own.id)]);expect(posted.status).toBe(201);expect(await count()).toBe(1);
    const unrelated=await fixture();const wrong=(await send(unrelated.id,host.token)).body.data;
    expect((await read(wrong.id)).status).toBe(404);expect((await read(own.id,other.token)).status).toBe(404);
    expect((await read(own.id,operator.token)).status).toBe(403);expect((await http('/conversations/unread','GET',undefined,operator.token)).status).toBe(403);
    expect((await read('not-a-uuid')).status).toBe(400);
    await prisma.property.update({where:{id:f.property.id},data:{deletedAt:new Date()}});
    expect((await read(posted.body.data.id)).status).toBe(201);expect(await count()).toBe(0);
    const doc=SwaggerModule.createDocument(app,new DocumentBuilder().build());expect(doc.paths['/api/v1/conversations/unread'].get).toBeDefined();expect(doc.paths['/api/v1/conversations/{id}/read'].post).toBeDefined();
  });
  it('delivers inbox hints without a joined room, only to active conversation participants',async()=>{
    const f=await fixture();const {io}=createRequire(resolve('../frontend/package.json'))('socket.io-client');
    const connect=(token:string)=>io(`${base}/chat`,{transports:['websocket'],auth:{token},extraHeaders:{Origin:'http://localhost:3000'},reconnection:false,timeout:2000});
    const a=connect(guest.token),b=connect(other.token);const events:unknown[]=[],otherEvents:unknown[]=[];
    try {
      await Promise.all([a,b].map(socket=>new Promise<void>((done,fail)=>{socket.once('connect',done);socket.once('connect_error',fail);})));a.on('NEW_CHAT_MESSAGE',v=>events.push(v));b.on('NEW_CHAT_MESSAGE',v=>otherEvents.push(v));
      const response=await send(f.id,host.token,'Inbox while closed');expect(response.status).toBe(201);
      await vi.waitFor(()=>expect(events).toEqual([{conversationId:f.id,message:response.body.data.id}]));expect(otherEvents).toEqual([]);
      await prisma.user.update({where:{id:guest.id},data:{status:'BANNED'}});
      expect((await send(f.id,host.token,'No banned delivery')).status).toBe(201);
      await vi.waitFor(()=>expect(a.connected).toBe(false));expect(events).toHaveLength(1);
      expect((await http('/conversations/unread','GET',undefined,guest.token)).status).toBe(401);
      expect((await http(`/conversations/${f.id}/read`,'POST',{messageId:response.body.data.id},guest.token)).status).toBe(401);
    } finally {a.disconnect();b.disconnect();await prisma.user.update({where:{id:guest.id},data:{status:'ACTIVE'}});}
  },30000);
  it('validates DTO/cursor, stable pagination and unknown fields',async()=>{
    const f=await fixture();
    for(const body of [{clientMessageId:randomUUID(),text:'  '},{clientMessageId:'bad',text:'x'},{clientMessageId:randomUUID(),text:'x'.repeat(3001)},{clientMessageId:randomUUID(),text:'x',senderId:other.id}])
      expect((await http(`/conversations/${f.id}/messages`,'POST',body,guest.token)).status).toBe(400);
    const older=(await send(f.id,host.token,' Older ')).body.data;
    const first=await http(`/conversations/${f.id}/messages?limit=1`,'GET',undefined,guest.token);
    expect(first.body.data.messages[0].text).toBe('Older');
    const newer=(await send(f.id,host.token,'Newer')).body.data;
    const top=(await http(`/conversations/${f.id}/messages?limit=1`,'GET',undefined,guest.token)).body.data;
    expect(top.messages[0].id).toBe(newer.id);expect(top.nextCursor).toBe(newer.id);
    await send(f.id,host.token,'Newest');
    expect((await http(`/conversations/${f.id}/messages?limit=1&before=${top.nextCursor}`,'GET',undefined,guest.token)).body.data.messages[0].id).toBe(older.id);
    const otherChat=await fixture();expect((await http(`/conversations/${otherChat.id}/messages?before=${older.id}`,'GET',undefined,guest.token)).status).toBe(404);
    for(const query of ['limit=0','limit=51','before=bad'])expect((await http(`/conversations/${f.id}/messages?${query}`,'GET',undefined,guest.token)).status).toBe(400);
    const doc=SwaggerModule.createDocument(app,new DocumentBuilder().build());expect(doc.paths['/api/v1/conversations/{id}/messages'].post).toBeDefined();
    expect(doc.components?.schemas?.ConversationResponseDto).toBeDefined();
  });
  it('rejects inactive user/session even if they call API directly with old token',async()=>{
    const f=await fixture();await prisma.user.update({where:{id:guest.id},data:{status:'BANNED'}});
    expect((await send(f.id)).status).toBe(401);expect((await http(`/conversations/${f.id}/messages`,'GET',undefined,guest.token)).status).toBe(401);
    await prisma.user.update({where:{id:guest.id},data:{status:'ACTIVE',sessionVersion:1}});expect((await send(f.id)).status).toBe(401);
    await prisma.user.update({where:{id:guest.id},data:{sessionVersion:0}});
  });
  it('rate limits API writes with Retry-After without storing further messages',async()=>{
    const f=await fixture(),fresh=await account();
    const c=(await http('/conversations','POST',{propertyId:f.property.id},fresh.token)).body.data.id;
    for(let i=0;i<29;i++)expect((await send(c,fresh.token,`Synthetic limited ${i}`)).status).toBe(201);
    const limited=await send(c,fresh.token);expect(limited.status).toBe(429);expect(limited.headers.get('retry-after')).toBe('60');
    expect(await prisma.chatMessage.count({where:{conversationId:c}})).toBe(29);
  });
  it('Admin user listing and ban endpoint enforce role, UUID, reason, state and no secrets',async()=>{
    expect((await http('/admin/users')).status).toBe(401);
    for(const user of [guest,host])expect((await http('/admin/users','GET',undefined,user.token)).status).toBe(403);
    const result=await http('/admin/users?page=1&limit=2','GET',undefined,operator.token);
    expect(result.status).toBe(200);expect(result.body.data).toHaveLength(2);expect(result.body.meta.total).toBeGreaterThan(2);
    expect(JSON.stringify(result.body)).not.toMatch(/phone|email|password|sessionVersion|token|bank/);
    for(const body of [{expectedStatus:'ACTIVE',reason:' '},{expectedStatus:'ACTIVE',reason:'x'.repeat(501)},{expectedStatus:'ACTIVE',reason:'x',role:'ADMIN'},{expectedStatus:'UNKNOWN',reason:'x'}])
      expect((await http(`/admin/users/${other.id}/ban`,'POST',body,operator.token)).status).toBe(400);
    expect((await http('/admin/users/no-uuid/ban','POST',{expectedStatus:'ACTIVE',reason:'Synthetic'},operator.token)).status).toBe(400);
    expect((await http(`/admin/users/${operator.id}/ban`,'POST',{expectedStatus:'ACTIVE',reason:'Synthetic'},operator.token)).body.errorCode).toBe('CANNOT_MODERATE_SELF');
    expect((await http(`/admin/users/${randomUUID()}/ban`,'POST',{expectedStatus:'ACTIVE',reason:'Synthetic'},operator.token)).status).toBe(404);
  });
  it('Admin dashboard checks roles, date validation, privacy, no-store and Swagger',async()=>{
    expect((await http('/admin/dashboard?from=2026-01-01&to=2026-01-01')).status).toBe(401);
    for(const user of [guest,host])expect((await http('/admin/dashboard?from=2026-01-01&to=2026-01-01','GET',undefined,user.token)).status).toBe(403);
    for(const query of ['', '?from=2026-02-30&to=2026-03-01','?from=2026-02-02&to=2026-02-01','?from=2024-01-01&to=2025-01-01','?from=2026-01-01&to=2026-01-01&hostId='+host.id])
      expect((await http('/admin/dashboard'+query,'GET',undefined,operator.token)).status).toBe(400);
    const result=await http('/admin/dashboard?from=2026-01-01&to=2026-12-31','GET',undefined,operator.token);
    expect(result).toMatchObject({status:200,body:{success:true,data:{money:{gmv:'0'},timeZone:'Asia/Ho_Chi_Minh',isComplete:true}}});
    expect(result.headers.get('cache-control')).toBe('no-store');expect(JSON.stringify(result.body)).not.toMatch(/guestName|phone|email|bookingId|bankAccount|token/);
    const doc=SwaggerModule.createDocument(app,new DocumentBuilder().addBearerAuth().build());
    expect(doc.paths['/api/v1/admin/dashboard'].get!.parameters).toEqual(expect.arrayContaining(['from','to'].map(name=>expect.objectContaining({name,required:true,in:'query'}))));
  });
  it('Admin ban disconnects an idle real socket without needing a message or join',async()=>{
    const target=await account(),{io}=createRequire(resolve('../frontend/package.json'))('socket.io-client');
    const socket=io(`${base}/chat`,{transports:['websocket'],auth:{token:target.token},extraHeaders:{Origin:'http://localhost:3000'},reconnection:false});
    try{
      await new Promise<void>((done,fail)=>{socket.once('connect',done);socket.once('connect_error',fail);});
      const disconnected=new Promise<void>(done=>socket.once('disconnect',()=>done()));
      expect((await http(`/admin/users/${target.id}/ban`,'POST',{expectedStatus:'ACTIVE',reason:'Synthetic idle revocation'},operator.token)).status).toBe(200);
      await disconnected;expect(socket.connected).toBe(false);
    }finally{socket.disconnect();}
  },10000);
  it('ban/unban are conditional, concurrent retry records once; old credentials never revive',async()=>{
    const target=await account(),body={expectedStatus:'ACTIVE',reason:'  Synthetic reason  '};
    await prisma.refreshToken.create({data:{userId:target.id,tokenHash:'a'.repeat(64),expiresAt:new Date(Date.now()+60000)}});
    const responses=await Promise.all([1,2].map(()=>http(`/admin/users/${target.id}/ban`,'POST',body,operator.token)));
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    expect(await prisma.userModerationEvent.count({where:{targetId:target.id}})).toBe(1);
    expect((await prisma.userModerationEvent.findFirstOrThrow({where:{targetId:target.id}})).reason).toBe('Synthetic reason');
    expect((await prisma.refreshToken.findFirstOrThrow({where:{userId:target.id}})).revokedAt).not.toBeNull();
    expect((await http('/conversations','GET',undefined,target.token)).status).toBe(401);
    expect((await http(`/admin/users/${target.id}/unban`,'POST',{expectedStatus:'BANNED',reason:'Synthetic restore'},operator.token)).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({where:{id:target.id}})).sessionVersion).toBe(2);
    expect((await http('/conversations','GET',undefined,target.token)).status).toBe(401);
    expect((await http(`/admin/users/${target.id}/unban`,'POST',{expectedStatus:'BANNED',reason:'Retry'},operator.token)).body.errorCode).toBe('STALE_USER_STATUS');
    const event=await prisma.userModerationEvent.findFirstOrThrow({where:{targetId:target.id}});
    await expect(db.query('UPDATE user_moderation_events SET reason=$1 WHERE id=$2',['Modified',event.id])).rejects.toThrow();
    await expect(db.query('DELETE FROM user_moderation_events WHERE id=$1',[event.id])).rejects.toThrow();
  });
  it('serializes two Admins banning each other and retains an active Admin',async()=>{
    const a=await account('ADMIN'),b=await account('ADMIN');
    const results=await Promise.all([[a,b],[b,a]].map(([actor,target])=>http(`/admin/users/${target.id}/ban`,'POST',{expectedStatus:'ACTIVE',reason:'Synthetic race'},actor.token)));
    expect(results.filter(r=>r.status===200)).toHaveLength(1);
    expect(await prisma.user.count({where:{id:{in:[a.id,b.id]},status:'ACTIVE'}})).toBe(1);
  });
  it('ban hides published Host listings even after cache warmup and unban preserves listing state',async()=>{
    const owner=await account('HOST');
    const property=await prisma.property.create({data:{hostId:owner.id,slug:`ban-${randomUUID()}`,title:'Synthetic ban listing',description:'Fixture',propertyType:'PHONG_TRO',rentalMode:'LONG_TERM',addressDetail:'Fixture',provinceCode:'TEST',wardCode:'TEST',latitude:10,longitude:106,status:'PUBLISHED',
      longTermDetail:{create:{monthlyPrice:1000,depositAmount:100,areaSqm:20,electricityCost:1,waterCost:1,garbageCost:0,internetCost:0,parkingFee:0,contactPhone:'0990000000'}}}});
    expect((await http(`/properties/${property.slug}`)).status).toBe(200);
    expect((await http(`/properties/${property.slug}`)).status).toBe(200);
    const before=await prisma.property.findUniqueOrThrow({where:{id:property.id}});
    expect((await http(`/admin/users/${owner.id}/ban`,'POST',{expectedStatus:'ACTIVE',reason:'Synthetic'},operator.token)).status).toBe(200);
    for(const suffix of ['', '/contact','/cost-estimate','/reviews'])expect((await http(`/properties/${property.slug}${suffix}`)).status).toBe(404);
    const search=await http('/properties/long-term/search');expect(search.body.data.some((p:{id:string})=>p.id===property.id)).toBe(false);
    expect(await prisma.property.findUniqueOrThrow({where:{id:property.id}})).toEqual(before);
    expect((await http(`/admin/users/${owner.id}/unban`,'POST',{expectedStatus:'BANNED',reason:'Synthetic'},operator.token)).status).toBe(200);
    expect((await http(`/properties/${property.slug}`)).status).toBe(200);
  });
  it('audit insertion failure rolls back status/version/refresh and never revokes chat',async()=>{
    const target=await account();const before=await prisma.user.findUniqueOrThrow({where:{id:target.id}});
    const revoke=vi.spyOn(app.get(ChatRealtimeService),'revokeUser');
    await db.query(`CREATE FUNCTION ban_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit failure'; END; $$;
      CREATE TRIGGER ban_test_reject BEFORE INSERT ON user_moderation_events FOR EACH ROW EXECUTE FUNCTION ban_test_reject()`);
    try{
      expect((await http(`/admin/users/${target.id}/ban`,'POST',{expectedStatus:'ACTIVE',reason:'Synthetic'},operator.token)).status).toBeGreaterThanOrEqual(500);
      expect(await prisma.user.findUniqueOrThrow({where:{id:target.id}})).toEqual(before);expect(revoke).not.toHaveBeenCalled();
    }finally{revoke.mockRestore();await db.query('DROP TRIGGER ban_test_reject ON user_moderation_events; DROP FUNCTION ban_test_reject()');}
  });
  it('rolls back DB insertion failure without publishing a realtime success or leaking text',async()=>{
    const f=await fixture();const published=vi.spyOn(app.get(ChatRealtimeService),'publishCommitted');
    await db.query(`CREATE FUNCTION chat_test_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic insert failure'; END; $$;
      CREATE TRIGGER chat_test_reject BEFORE INSERT ON chat_messages FOR EACH ROW EXECUTE FUNCTION chat_test_reject()`);
    try {
      const result=await send(f.id,guest.token,'Synthetic rollback private text');expect(result.status).toBe(503);
      expect(JSON.stringify(result.body)).not.toContain('Synthetic rollback private text');
      expect(await prisma.chatMessage.count({where:{conversationId:f.id}})).toBe(0);expect(published).not.toHaveBeenCalled();
    }finally{published.mockRestore();await db.query('DROP TRIGGER chat_test_reject ON chat_messages; DROP FUNCTION chat_test_reject()');}
    expect((await send(f.id)).status).toBe(201);
  });
  it('real sockets enforce Origin/token/participant, commit before hint, hidden chat and ban/revocation',async()=>{
    const {io}=createRequire(resolve('../frontend/package.json'))('socket.io-client');const sockets:Array<ReturnType<typeof io>>=[];
    const connect=(token:string,origin='http://localhost:3000',query?:Record<string,string>)=>{const s=io(`${base}/chat`,{transports:['websocket'],auth:{token},extraHeaders:{Origin:origin},reconnection:false,timeout:2000,query});sockets.push(s);return s;};
    const opened=(s:ReturnType<typeof io>)=>new Promise<void>((done,fail)=>{s.once('connect',done);s.once('connect_error',fail);});
    const emit=(s:ReturnType<typeof io>,event:string,body:unknown)=>new Promise<{ok:boolean;errorCode?:string;message?:{id:string}}>((done,fail)=>s.timeout(3000).emit(event,body,(error:unknown,ack:{ok:boolean;errorCode?:string;message?:{id:string}})=>error?fail(error):done(ack)));
    const f=await fixture();
    try {
      const a=connect(guest.token),b=connect(host.token),outsider=connect(other.token);await Promise.all([opened(a),opened(b),opened(outsider)]);
      await expect(opened(connect(guest.token,'https://untrusted.example'))).rejects.toBeDefined();
      await expect(opened(connect(guest.token,'http://localhost:3000',{token:'forbidden'}))).rejects.toBeDefined();
      await expect(opened(connect(operator.token))).rejects.toBeDefined();
      const expired=await new SignJWT({tokenType:'access',sessionVersion:0}).setProtectedHeader({alg:'HS256'}).setSubject(guest.id).setExpirationTime(Math.floor(Date.now()/1000)-1).sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
      await expect(opened(connect(expired))).rejects.toBeDefined();
      expect(await emit(a,'joinConversation',{conversationId:f.id})).toEqual({ok:true});expect(await emit(b,'joinConversation',{conversationId:f.id})).toEqual({ok:true});
      expect(await emit(outsider,'joinConversation',{conversationId:f.id})).toEqual({ok:false,errorCode:'CONVERSATION_NOT_FOUND'});
      const events:unknown[]=[],otherEvents:unknown[]=[];b.on('NEW_CHAT_MESSAGE',(v:unknown)=>events.push(v));outsider.on('NEW_CHAT_MESSAGE',(v:unknown)=>otherEvents.push(v));
      await prisma.property.update({where:{id:f.property.id},data:{status:'HIDDEN'}});
      const sent=await emit(a,'NEW_CHAT_MESSAGE',{conversationId:f.id,clientMessageId:randomUUID(),text:'Synthetic hidden message'});expect(sent.ok).toBe(true);
      await vi.waitFor(()=>expect(events).toEqual([{conversationId:f.id,message:sent.message!.id}]));
      expect(await prisma.chatMessage.findUnique({where:{id:sent.message!.id}})).not.toBeNull();expect(otherEvents).toEqual([]);
      expect(JSON.stringify(events)).not.toContain('Synthetic hidden message');
      const before=events.length;await prisma.property.update({where:{id:f.property.id},data:{deletedAt:new Date()}});
      expect((await emit(a,'NEW_CHAT_MESSAGE',{conversationId:f.id,clientMessageId:randomUUID(),text:'Do not save'})).errorCode).toBe('CHAT_READ_ONLY');
      expect(events.length).toBe(before);expect(await prisma.chatMessage.count({where:{conversationId:f.id}})).toBe(1);
      await prisma.property.update({where:{id:f.property.id},data:{deletedAt:null}});
      const aEvents:unknown[]=[];a.on('NEW_CHAT_MESSAGE',(v:unknown)=>aEvents.push(v));await prisma.user.update({where:{id:guest.id},data:{status:'BANNED'}});
      const disconnected=new Promise<void>(done=>a.once('disconnect',()=>done()));expect((await send(f.id,host.token)).status).toBe(201);await disconnected;expect(aEvents).toEqual([]);
      await expect(opened(connect(guest.token))).rejects.toBeDefined();
      await prisma.user.update({where:{id:guest.id},data:{status:'ACTIVE'}});
      const revoked=new Promise<void>(done=>b.once('disconnect',()=>done()));await prisma.user.update({where:{id:host.id},data:{sessionVersion:1}});
      b.emit('joinConversation',{conversationId:f.id},()=>{});await revoked;
      await prisma.user.update({where:{id:host.id},data:{sessionVersion:0}});
      const reconnected=connect(guest.token);await opened(reconnected);expect(await emit(reconnected,'joinConversation',{conversationId:f.id})).toEqual({ok:true});
      expect((await http(`/conversations/${f.id}/messages`,'GET',undefined,guest.token)).body.data.messages.length).toBe(2);
    }finally{for(const s of sockets)s.disconnect();await prisma.user.update({where:{id:guest.id},data:{status:'ACTIVE'}});await prisma.user.update({where:{id:host.id},data:{sessionVersion:0}});}
    expect(await prisma.financeJournal.count()).toBe(0);expect(await prisma.booking.count()).toBe(0);
  },30000);
  it('Admin ban revokes an idle chat socket on another real API instance via Redis after commit',async()=>{
    const {io}=createRequire(resolve('../frontend/package.json'))('socket.io-client');
    const target=await account(),peer=await NestFactory.create(AppModule,{logger:false});let socket:ReturnType<typeof io>|undefined;
    try{
      await peer.listen(0,'127.0.0.1');
      socket=io(`${await peer.getUrl()}/chat`,{transports:['websocket'],auth:{token:target.token},extraHeaders:{Origin:'http://localhost:3000'},reconnection:false,timeout:2000});
      await new Promise<void>((done,fail)=>{socket!.once('connect',done);socket!.once('connect_error',fail);});
      expect(socket.connected).toBe(true);
      const response=await http(`/admin/users/${target.id}/ban`,'POST',{expectedStatus:'ACTIVE',reason:'Synthetic cross-instance idle ban'},operator.token);
      expect(response.status).toBe(200);await vi.waitFor(()=>expect(socket!.connected).toBe(false));
      expect(await prisma.userModerationEvent.count({where:{targetId:target.id}})).toBe(1);
      expect((await http('/conversations','GET',undefined,target.token)).status).toBe(401);
    }finally{socket?.disconnect();await peer.close();}
  },30000);
});
