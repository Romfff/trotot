import { HttpException, Injectable, OnApplicationBootstrap, OnModuleDestroy, ValidationPipe } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { Namespace, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RedisService } from '../redis/redis.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { PaymentRealtimeService } from '../payments/payment-realtime.service.js';
import { ChatService } from './chat.service.js';
import { SocketChatMessageDto } from './chat.dto.js';

const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
type ChatSocket=Socket&{data:{token:string;userId:string}};
type Ack=(value:{ok:true;message?:unknown}|{ok:false;errorCode:string})=>void;
const room=(id:string)=>`conversation:${id}`;

@Injectable()
export class ChatRealtimeService implements OnApplicationBootstrap,OnModuleDestroy {
  private namespace?:Namespace;
  private subscriber?:Redis;
  private readonly channel=`${process.env.REDIS_KEY_PREFIX||''}chat:committed`;
  private readonly revocations=`${process.env.REDIS_KEY_PREFIX||''}chat:revoked`;
  private readonly validation=new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
  constructor(private readonly transport:PaymentRealtimeService,private readonly auth:AccessTokenGuard,
    private readonly chat:ChatService,private readonly redis:RedisService,private readonly prisma:PrismaService) {}
  async onApplicationBootstrap() {
    const namespace=this.transport.chatNamespace();if(!namespace)return;
    this.namespace=namespace;
    namespace.use((raw,next)=>{void(async()=>{
      const socket=raw as ChatSocket,ip=socket.conn.remoteAddress;
      if(!isIP(ip)||Object.keys(socket.handshake.query).some(k=>/token|authorization/i.test(k)))throw new Error('unauthorized');
      if(await this.redis.incrementWithTtl(`chat:connect-ip:${createHash('sha256').update(ip).digest('hex')}`,60)>30)throw new Error('limited');
      const token=socket.handshake.auth?.token;
      if(typeof token!=='string'||token.length>8192||Object.keys(socket.handshake.auth).some(k=>k!=='token'))throw new Error('unauthorized');
      const identity=await this.auth.authenticate(token);
      if(identity.user.role==='ADMIN'||!Number.isSafeInteger(identity.expiresAt)||identity.expiresAt!<=Date.now()/1000)throw new Error('unauthorized');
      if(await this.redis.incrementWithTtl(`chat:connect-user:${identity.user.id}`,60)>30)throw new Error('limited');
      socket.data={token,userId:identity.user.id};
      const expiry=setTimeout(()=>socket.disconnect(true),Math.min(2147483647,Math.max(1,identity.expiresAt!*1000-Date.now())));
      expiry.unref();socket.once('disconnect',()=>clearTimeout(expiry));
    })().then(()=>next(),()=>next(new Error('CHAT_UNAVAILABLE')));});
    namespace.on('connection',raw=>{
      const socket=raw as ChatSocket;
      socket.on('joinConversation',(body:unknown,ack:unknown)=>void this.join(socket,body,typeof ack==='function'?ack as Ack:()=>{}));
      socket.on('NEW_CHAT_MESSAGE',(body:unknown,ack:unknown)=>void this.send(socket,body,typeof ack==='function'?ack as Ack:()=>{}));
    });
    this.subscriber=this.redis.client.duplicate({lazyConnect:true});this.subscriber.on('error',()=>{});
    this.subscriber.on('message',(channel,payload)=>{if(!uuid.test(payload))return;if(channel===this.channel)void this.deliver(payload);if(channel===this.revocations)this.disconnectUser(payload);});
    try{if(this.subscriber.status==='wait')await this.subscriber.connect();await this.subscriber.subscribe(this.channel,this.revocations);}
    catch{await this.onModuleDestroy();throw new Error('Chat subscription unavailable');}
  }
  private async join(socket:ChatSocket,body:unknown,ack:Ack) {
    try {
      const {user}=await this.auth.authenticate(socket.data.token);
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('conversationId'in body)||typeof body.conversationId!=='string'||!uuid.test(body.conversationId))return ack({ok:false,errorCode:'INVALID_CONVERSATION_ID'});
      if(await this.redis.incrementWithTtl(`chat:join:${user.id}`,60)>60)return ack({ok:false,errorCode:'CHAT_RATE_LIMITED'});
      await this.chat.membership(user,body.conversationId);
      if(!socket.connected)return;
      if(!socket.rooms.has(room(body.conversationId))&&socket.rooms.size>=21)return ack({ok:false,errorCode:'CHAT_ROOM_LIMIT'});
      await socket.join(room(body.conversationId));ack({ok:true});
    }catch(error){this.fail(socket,error,ack);}
  }
  private async send(socket:ChatSocket,body:unknown,ack:Ack) {
    try {
      const {user}=await this.auth.authenticate(socket.data.token);
      if(await this.redis.incrementWithTtl(`chat:send:${user.id}`,60)>30)return ack({ok:false,errorCode:'CHAT_RATE_LIMITED'});
      const input=await this.validation.transform(body,{type:'body',metatype:SocketChatMessageDto}) as SocketChatMessageDto;
      const message=await this.chat.send(user,input.conversationId,input);
      await this.publishCommitted(message.id);if(socket.connected)ack({ok:true,message});
    }catch(error){this.fail(socket,error,ack);}
  }
  private fail(socket:ChatSocket,error:unknown,ack:Ack) {
    const status=error instanceof HttpException?error.getStatus():503;
    const body=error instanceof HttpException?error.getResponse():null;
    const errorCode=body&&typeof body==='object'&&'errorCode'in body?String(body.errorCode):status===400?'VALIDATION_ERROR':'CHAT_UNAVAILABLE';
    ack({ok:false,errorCode});if(status===401||status===403)socket.disconnect(true);
  }
  // The HTTP/socket caller invokes this only after the transaction resolved.
  async publishCommitted(messageId:string) {
    if(!this.namespace||!uuid.test(messageId))return;
    try{await this.redis.client.publish(this.channel,messageId);}catch{/* ponytail: missed hint is repaired by reconnect/API refresh; not a durable message loss. */}
  }
  private disconnectUser(userId:string) {
    for(const socket of this.namespace?.sockets.values()||[])if(socket.data.userId===userId)socket.disconnect(true);
  }
  async revokeUser(userId:string) {
    this.disconnectUser(userId);
    try{await this.redis.client.publish(this.revocations,userId);}catch{/* Remote delivery still rechecks DB authorization; never emit to a banned session. */}
  }
  private async deliver(messageId:string) {
    try {
      const message=await this.prisma.chatMessage.findUnique({where:{id:messageId},select:{id:true,conversationId:true,conversation:{select:{guestId:true,hostId:true}}}});
      const namespace=this.namespace;if(!message||!namespace)return;
      // Inbox delivery does not depend on a conversation panel/room being open.
      for(const socket of namespace.sockets.values() as Iterable<ChatSocket>) {
        if(socket.data.userId!==message.conversation.guestId && socket.data.userId!==message.conversation.hostId)continue;
        try {
          const {user}=await this.auth.authenticate(socket.data.token);
          await this.chat.membership(user,message.conversationId);
          if(socket.connected)socket.emit('NEW_CHAT_MESSAGE',{conversationId:message.conversationId,message:message.id});
        }catch{socket.disconnect(true);}
      }
    }catch{/* Fail closed: never emit using stale authorization when DB is unavailable. */}
  }
  async onModuleDestroy() {this.subscriber?.disconnect();this.subscriber=undefined;this.namespace?.disconnectSockets(true);this.namespace=undefined;}
}
