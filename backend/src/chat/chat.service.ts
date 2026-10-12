import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ChatMessagesQueryDto, SendChatMessageDto } from './chat.dto.js';
import { chatPolicy } from './chat-policy.js';
import { PaginatedResult } from '../common/paginated-result.js';

type Actor={id:string;role:string};
const select={id:true,propertyId:true,guestId:true,hostId:true,createdAt:true,
  property:{select:{title:true,status:true,deletedAt:true,hostId:true}},guest:{select:{id:true,fullName:true}},host:{select:{id:true,fullName:true}}} as const;
type Conversation=Prisma.ChatConversationGetPayload<{select:typeof select}>;
function present(c:Conversation,actor:Actor) {
  const policy=chatPolicy(c.property);
  return {id:c.id,propertyId:c.propertyId,title:c.property.title,guest:c.guest,host:c.host,createdAt:c.createdAt.toISOString(),
    canSend:actor.role!=='ADMIN'&&policy.canSend,readOnlyReason:actor.role==='ADMIN'?'Admin chỉ đọc lịch sử.':policy.reason};
}
const missing=()=>new NotFoundException({errorCode:'CONVERSATION_NOT_FOUND',message:'Không tìm thấy cuộc trò chuyện.'});
const messageSelect={id:true,conversationId:true,senderId:true,clientMessageId:true,text:true,createdAt:true} as const;

@Injectable()
export class ChatService {
  constructor(private readonly prisma:PrismaService) {}
  private async active(tx:Prisma.TransactionClient,id:string) {
    const [user]=await tx.$queryRaw<{status:string}[]>`SELECT status FROM users WHERE id=${id}::uuid FOR SHARE`;
    if(user?.status!=='ACTIVE')throw new ForbiddenException({errorCode:'ACCOUNT_INACTIVE',message:'Tài khoản không được phép chat.'});
  }
  private async conversation(tx:Prisma.TransactionClient,actor:Actor,id:string,write=false) {
    const c=await tx.chatConversation.findUnique({where:{id},select});
    if(!c||(actor.role!=='ADMIN'&&actor.id!==c.guestId&&actor.id!==c.hostId))throw missing();
    if(write&&actor.role==='ADMIN')throw new ForbiddenException({errorCode:'CHAT_READ_ONLY',message:'Admin chỉ đọc lịch sử.'});
    if(c.property.hostId!==c.hostId)throw new ConflictException({errorCode:'CHAT_HOST_CHANGED',message:'Chủ tin đã thay đổi; cần hỗ trợ để xử lý cuộc trò chuyện.'});
    return c;
  }
  async open(actor:Actor,propertyId:string) {
    return this.prisma.$transaction(async tx=>{
      const [property]=await tx.$queryRaw<{id:string;host_id:string;status:string;deleted_at:Date|null}[]>`
        SELECT id,host_id,status,deleted_at FROM properties WHERE id=${propertyId}::uuid FOR SHARE`;
      if(!property)throw new NotFoundException({errorCode:'PROPERTY_NOT_FOUND',message:'Không tìm thấy tin.'});
      if(property.host_id===actor.id)throw new ConflictException({errorCode:'CHAT_SELF_NOT_ALLOWED',message:'Không thể chat với chính mình.'});
      const users=await tx.$queryRaw<{id:string;status:string;role:string}[]>`
        SELECT id,status,role FROM users WHERE id IN (${actor.id}::uuid,${property.host_id}::uuid) ORDER BY id FOR SHARE`;
      if(users.some(u=>u.status!=='ACTIVE')||users.length!==2||users.find(u=>u.id===property.host_id)?.role!=='HOST')throw new ForbiddenException({errorCode:'CHAT_ACCOUNT_UNAVAILABLE',message:'Tài khoản không được phép mở cuộc trò chuyện.'});
      const key={propertyId:property.id,guestId:actor.id,hostId:property.host_id};
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chat:${property.id}:${actor.id}`},0))`;
      const existing=await tx.chatConversation.findUnique({where:{propertyId_guestId_hostId:key},select});
      if(existing)return present(existing,actor); // Opening history is not creating a new chat.
      if(!chatPolicy({status:property.status,deletedAt:property.deleted_at}).canStart)throw new ConflictException({errorCode:'CHAT_NEW_UNAVAILABLE',message:'Tin không nhận cuộc trò chuyện mới.'});
      const c=await tx.chatConversation.upsert({where:{propertyId_guestId_hostId:key},create:key,update:{},select});
      return present(c,actor);
    });
  }
  async list(actor:Actor,page:number,limit:number) {
    return this.prisma.$transaction(async tx=>{
      const where=actor.role==='ADMIN'?{}:{OR:[{guestId:actor.id},{hostId:actor.id}]};
      const total=await tx.chatConversation.count({where});
      const rows=await tx.chatConversation.findMany({where,select,orderBy:[{createdAt:'desc'},{id:'desc'}],skip:(page-1)*limit,take:limit});
      return new PaginatedResult(rows.map(c=>present(c,actor)),{page,limit,total,totalPages:Math.ceil(total/limit)});
    },{isolationLevel:'RepeatableRead'});
  }
  async read(actor:Actor,id:string,query:ChatMessagesQueryDto) {
    return this.prisma.$transaction(async tx=>{
      const c=await this.conversation(tx,actor,id);
      const before=query.before?await tx.chatMessage.findFirst({where:{id:query.before,conversationId:id},select:{id:true,createdAt:true}}):null;
      if(query.before&&!before)throw missing();
      const rows=await tx.chatMessage.findMany({where:{conversationId:id,...(before?{OR:[{createdAt:{lt:before.createdAt}},{createdAt:before.createdAt,id:{lt:before.id}}]}:{})},
        orderBy:[{createdAt:'desc'},{id:'desc'}],take:query.limit+1,select:messageSelect});
      const hasMore=rows.length>query.limit;const data=rows.slice(0,query.limit);
      return {conversation:present(c,actor),messages:data.map(m=>({...m,createdAt:m.createdAt.toISOString()})),nextCursor:hasMore?data.at(-1)!.id:null};
    },{isolationLevel:'RepeatableRead'});
  }
  async membership(actor:Actor,id:string) {
    return this.prisma.$transaction(tx=>this.conversation(tx,actor,id,true));
  }
  async unread(actor:Actor) {
    const rows=await this.prisma.$queryRaw<{conversationId:string;unreadCount:bigint}[]>`
      SELECT c.id AS "conversationId",count(m.id) AS "unreadCount"
      FROM chat_conversations c
      JOIN properties p ON p.id=c.property_id AND p.host_id=c.host_id
      LEFT JOIN chat_read_cursors r ON r.conversation_id=c.id AND r.user_id=${actor.id}::uuid
      LEFT JOIN chat_messages seen ON seen.id=r.message_id
      JOIN chat_messages m ON m.conversation_id=c.id AND m.sender_id<>${actor.id}::uuid
        AND (seen.id IS NULL OR (m.created_at,m.id)>(seen.created_at,seen.id))
      WHERE c.guest_id=${actor.id}::uuid OR c.host_id=${actor.id}::uuid
      GROUP BY c.id`;
    const conversations=rows.map(row=>({conversationId:row.conversationId,unreadCount:Number(row.unreadCount)}));
    return {totalUnread:conversations.reduce((sum,row)=>sum+row.unreadCount,0),conversations};
  }
  async markRead(actor:Actor,id:string,messageId:string) {
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM chat_conversations WHERE id=${id}::uuid FOR UPDATE`;
      await this.conversation(tx,actor,id,true);await this.active(tx,actor.id);
      const message=await tx.chatMessage.findFirst({where:{id:messageId,conversationId:id},select:{id:true,createdAt:true}});
      if(!message)throw missing();
      const old=await tx.chatReadCursor.findUnique({where:{conversationId_userId:{conversationId:id,userId:actor.id}},include:{message:{select:{id:true,createdAt:true}}}});
      if(old && (old.message.createdAt>message.createdAt || old.message.createdAt.getTime()===message.createdAt.getTime() && old.messageId>=message.id))
        return {conversationId:id,messageId:old.messageId};
      await tx.chatReadCursor.upsert({where:{conversationId_userId:{conversationId:id,userId:actor.id}},create:{conversationId:id,userId:actor.id,messageId},update:{messageId}});
      return {conversationId:id,messageId};
    });
  }
  async send(actor:Actor,id:string,input:SendChatMessageDto) {
    return this.prisma.$transaction(async tx=>{
      // Serialize retries and check policy while listing visibility cannot change underneath us.
      await tx.$queryRaw`SELECT id FROM chat_conversations WHERE id=${id}::uuid FOR UPDATE`;
      const c=await this.conversation(tx,actor,id,true);
      const [property]=await tx.$queryRaw<{status:string;deletedAt:Date|null}[]>`
        SELECT status,deleted_at AS "deletedAt" FROM properties WHERE id=${c.propertyId}::uuid FOR SHARE`;
      await this.active(tx,actor.id);
      const key={conversationId:id,senderId:actor.id,clientMessageId:input.clientMessageId};
      const old=await tx.chatMessage.findUnique({where:{conversationId_senderId_clientMessageId:key},select:messageSelect});
      if(old) {
        if(old.text!==input.text)throw new ConflictException({errorCode:'CHAT_MESSAGE_KEY_REUSED',message:'Mã gửi đã dùng cho nội dung khác.'});
        return {...old,createdAt:old.createdAt.toISOString()};
      }
      const policy=chatPolicy(property);
      if(!policy.canSend)throw new ConflictException({errorCode:'CHAT_READ_ONLY',message:policy.reason});
      const message=await tx.chatMessage.create({data:{...key,text:input.text},select:messageSelect});
      return {...message,createdAt:message.createdAt.toISOString()};
    }).catch(error=>{
      if(error instanceof HttpException)throw error;
      // Do not let Prisma argument dumps expose private message text in error logs.
      throw new ServiceUnavailableException({errorCode:'CHAT_UNAVAILABLE',message:'Chưa gửi được tin nhắn. Vui lòng thử lại.'});
    });
  }
}
