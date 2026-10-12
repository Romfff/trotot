import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Server, type Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { PrismaService } from '../database/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';

const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type Ack = (value: {ok:true}|{ok:false;errorCode:string}) => void;
type Identity = Awaited<ReturnType<AccessTokenGuard['authenticate']>>;
type PaymentSocket = Socket & {data:{token:string;identity:Identity;bookings:Set<string>;units:Set<string>}};

@Injectable()
export class PaymentRealtimeService implements OnApplicationBootstrap, OnModuleDestroy {
  private io?: Server;
  private subscriber?: Redis;
  private readonly channel = `${process.env.REDIS_KEY_PREFIX || ''}payments:committed`;
  constructor(private readonly adapter:HttpAdapterHost, private readonly auth:AccessTokenGuard,
    private readonly prisma:PrismaService, private readonly redis:RedisService) {}

  // Reuse one Socket.io transport; payment rooms/events and authorization stay unchanged.
  chatNamespace() {return this.io?.of('/chat');}

  async onApplicationBootstrap() {
    if(process.env.REALTIME_ENABLED !== 'true') return;
    const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(v=>v.trim()).filter(Boolean);
    this.io = new Server(this.adapter.httpAdapter.getHttpServer(), {
      maxHttpBufferSize:16384, transports:['websocket'], serveClient:false,
      allowRequest:(req,done)=>done(null,typeof req.headers.origin==='string' && origins.includes(req.headers.origin)),
    });
    const namespace = this.io.of('/payments');
    namespace.use((raw,next)=>{void (async()=>{
      const socket=raw as PaymentSocket, ip=socket.conn.remoteAddress;
      if(!isIP(ip) || Object.keys(socket.handshake.query).some(key=>/token|authorization/i.test(key))) throw new Error('unauthorized');
      if(await this.redis.incrementWithTtl(`rt:connect:${createHash('sha256').update(ip).digest('hex')}`,60)>30) throw new Error('limited');
      const token=socket.handshake.auth?.token;
      if(typeof token!=='string' || token.length>8192 || Object.keys(socket.handshake.auth).some(key=>key!=='token')) throw new Error('unauthorized');
      const identity=await this.auth.authenticate(token);
      if(!Number.isSafeInteger(identity.expiresAt) || identity.expiresAt!<=Date.now()/1000) throw new Error('unauthorized');
      if(await this.redis.incrementWithTtl(`rt:user-connect:${identity.user.id}`,60)>30) throw new Error('limited');
      socket.data={token,identity,bookings:new Set(),units:new Set()};
    })().then(()=>next(),()=>next(new Error('REALTIME_UNAVAILABLE')));});
    namespace.on('connection',raw=>{
      const socket=raw as PaymentSocket;
      const expiry=setTimeout(()=>socket.disconnect(true),Math.min(2147483647,Math.max(1,socket.data.identity.expiresAt!*1000-Date.now())));
      expiry.unref(); socket.once('disconnect',()=>clearTimeout(expiry));
      socket.on('joinBooking',(body:unknown,ack:unknown)=>{void this.join(socket,body,typeof ack==='function'?ack as Ack:()=>{});});
      socket.on('joinUnit',(body:unknown,ack:unknown)=>{void this.joinUnit(socket,body,typeof ack==='function'?ack as Ack:()=>{});});
    });
    this.subscriber=this.redis.client.duplicate({lazyConnect:true});
    this.subscriber.on('error',()=>{}); // Never log token, identifiers, connection arguments or provider evidence.
    this.subscriber.on('message',(channel,payload)=>{
      if(channel!==this.channel) return;
      try {const value=JSON.parse(payload) as unknown;
        if(typeof value==='string' && uuid.test(value)) void this.deliver(value);
      }catch {/* An invalid hint never mutates payment state. */}
    });
    try {if(this.subscriber.status==='wait') await this.subscriber.connect();await this.subscriber.subscribe(this.channel);}
    catch {await this.onModuleDestroy();throw new Error('Realtime subscription unavailable');}
  }

  private async join(socket:PaymentSocket,body:unknown,ack:Ack) {
    try {
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1 || !('bookingId' in body)
        || typeof body.bookingId!=='string' || !uuid.test(body.bookingId)) return ack({ok:false,errorCode:'INVALID_BOOKING_ID'});
      const identity=await this.auth.authenticate(socket.data.token);
      if(await this.redis.incrementWithTtl(`rt:join:${identity.user.id}`,60)>60) return ack({ok:false,errorCode:'REALTIME_RATE_LIMITED'});
      if(!socket.data.bookings.has(body.bookingId) && socket.data.bookings.size+socket.data.units.size>=4) return ack({ok:false,errorCode:'REALTIME_ROOM_LIMIT'});
      const booking=await this.prisma.booking.findUnique({where:{id:body.bookingId},select:{guestId:true,unit:{select:{property:{select:{hostId:true}}}}}});
      if(!booking || !(booking.guestId===identity.user.id || (identity.user.role==='HOST' && booking.unit.property.hostId===identity.user.id)))
        return ack({ok:false,errorCode:'BOOKING_NOT_FOUND'});
      if(!socket.connected) return;
      // Another concurrent join may have completed while the ownership query was running.
      if(!socket.data.bookings.has(body.bookingId) && socket.data.bookings.size+socket.data.units.size>=4) return ack({ok:false,errorCode:'REALTIME_ROOM_LIMIT'});
      socket.data.identity=identity;socket.data.bookings.add(body.bookingId);
      ack({ok:true});
    } catch {socket.disconnect(true);}
  }

  private async joinUnit(socket:PaymentSocket,body:unknown,ack:Ack) {
    try {
      if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length!==1 || !('unitId' in body)
        || typeof body.unitId!=='string' || !uuid.test(body.unitId)) return ack({ok:false,errorCode:'INVALID_UNIT_ID'});
      const identity=await this.auth.authenticate(socket.data.token);
      if(await this.redis.incrementWithTtl(`rt:join:${identity.user.id}`,60)>60) return ack({ok:false,errorCode:'REALTIME_RATE_LIMITED'});
      const unit=identity.user.role==='HOST' ? await this.prisma.homestayUnit.findFirst({where:{id:body.unitId,property:{hostId:identity.user.id}},select:{id:true}}) : null;
      if(!unit) return ack({ok:false,errorCode:'UNIT_NOT_FOUND'});
      if(!socket.connected) return;
      if(!socket.data.units.has(unit.id) && socket.data.bookings.size+socket.data.units.size>=4) return ack({ok:false,errorCode:'REALTIME_ROOM_LIMIT'});
      socket.data.identity=identity;socket.data.units.add(unit.id);ack({ok:true});
    }catch{socket.disconnect(true);}
  }

  // Call only after the durable payment consumer resolves (including replay).
  async publishCommitted(bookingId:string) {
    if(!this.io || !uuid.test(bookingId)) return;
    try {await this.redis.client.publish(this.channel,JSON.stringify(bookingId));}
    catch {/* Payment is already committed. Reconnect/focus/manual refresh repairs a missed hint. */}
  }
  private async deliver(bookingId:string) {
    try {
      const booking=await this.prisma.booking.findUnique({where:{id:bookingId},select:{guestId:true,homestayUnitId:true,paymentStatus:true,unit:{select:{property:{select:{hostId:true}}}}}});
      if(!booking || !['PAID','REFUNDED'].includes(booking.paymentStatus)) return;
      const namespace=this.io?.of('/payments'); if(!namespace) return;
      for(const raw of namespace.sockets.values()) {
        const socket=raw as PaymentSocket;
        const followsBooking=socket.data.bookings.has(bookingId),followsUnit=socket.data.units.has(booking.homestayUnitId);
        if(!followsBooking && !followsUnit) continue;
        try {
          const {user}=await this.auth.authenticate(socket.data.token);
          if(!socket.connected) continue;
          if(followsBooking && user.id===booking.guestId) socket.emit('PAYMENT_SUCCESS',{bookingId});
          else if(followsBooking && user.role==='HOST' && user.id===booking.unit.property.hostId) socket.emit('CALENDAR_UPDATED',{bookingId});
          else if(followsBooking) socket.data.bookings.delete(bookingId);
          if(followsUnit) {
            if(user.role==='HOST' && user.id===booking.unit.property.hostId) socket.emit('CALENDAR_UPDATED',{unitId:booking.homestayUnitId});
            else socket.data.units.delete(booking.homestayUnitId);
          }
        }catch {socket.disconnect(true);}
      }
    } catch {/* Unavailable DB: do not emit success based on a stale cached identity. */}
  }
  async onModuleDestroy() {
    this.subscriber?.disconnect();this.subscriber=undefined;
    const server=this.io;this.io=undefined;
    if(server) await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
