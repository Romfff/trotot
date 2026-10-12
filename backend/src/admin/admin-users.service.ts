import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { PaginatedResult } from '../common/paginated-result.js';
import { ChatRealtimeService } from '../chat/chat-realtime.service.js';
import type { AdminUsersQueryDto, ModerateUserDto } from './admin-users.dto.js';

const select={id:true,fullName:true,role:true,status:true,createdAt:true,updatedAt:true} as const;
@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma:PrismaService,private readonly chat:ChatRealtimeService) {}
  async list(query:AdminUsersQueryDto) {
    return this.prisma.$transaction(async tx=>{
      const where={...(query.role?{role:query.role}:{}),...(query.status?{status:query.status}:{})};
      const [data,total]=await Promise.all([tx.user.findMany({where,select,orderBy:[{createdAt:'desc'},{id:'desc'}],take:query.limit,skip:(query.page-1)*query.limit}),tx.user.count({where})]);
      return new PaginatedResult(data,{page:query.page,limit:query.limit,total,totalPages:Math.ceil(total/query.limit)});
    },{isolationLevel:'RepeatableRead'});
  }
  async moderate(actorId:string,id:string,action:'ban'|'unban',body:ModerateUserDto) {
    const result=await this.prisma.$transaction(async tx=>{
      // Serialize Admin moderation, including two Admins trying to ban each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('admin:user-moderation'))`;
      await tx.$queryRaw`SELECT id FROM users WHERE id IN (${actorId}::uuid,${id}::uuid) ORDER BY id FOR UPDATE`;
      if(!await tx.user.findFirst({where:{id:actorId,role:'ADMIN',status:'ACTIVE'}}))throw new ForbiddenException();
      const target=await tx.user.findUnique({where:{id},select});
      if(!target)throw new NotFoundException({errorCode:'USER_NOT_FOUND',message:'Không tìm thấy tài khoản.'});
      if(actorId.toLowerCase()===target.id)throw new ConflictException({errorCode:'CANNOT_MODERATE_SELF',message:'Không thể khóa hoặc mở chính tài khoản của bạn.'});
      const after=action==='ban'?'BANNED':'ACTIVE';
      if(target.status!==body.expectedStatus||target.status===after)throw new ConflictException({errorCode:'STALE_USER_STATUS',message:'Trạng thái tài khoản đã thay đổi. Hãy tải lại danh sách.',data:{currentStatus:target.status}});
      if(action==='ban'&&target.role==='ADMIN'&&await tx.user.count({where:{role:'ADMIN',status:'ACTIVE'}})<=1)
        throw new ConflictException({errorCode:'LAST_ADMIN_PROTECTED',message:'Không thể khóa Admin đang hoạt động cuối cùng.'});
      const changed=await tx.user.updateMany({where:{id:target.id,status:body.expectedStatus},data:{status:after,sessionVersion:{increment:1}}});
      if(changed.count!==1)throw new ConflictException({errorCode:'STALE_USER_STATUS',message:'Trạng thái đã thay đổi. Hãy tải lại.'});
      await tx.refreshToken.updateMany({where:{userId:target.id,revokedAt:null},data:{revokedAt:new Date()}});
      await tx.userModerationEvent.create({data:{actorId,targetId:target.id,statusBefore:body.expectedStatus,statusAfter:after,reason:body.reason}});
      return tx.user.findUniqueOrThrow({where:{id:target.id},select});
    }).catch(error=>{
      if(error instanceof HttpException)throw error;
      // Prisma diagnostics can contain the supplied reason. Never expose/log that SQL.
      throw new ServiceUnavailableException({errorCode:'USER_MODERATION_UNAVAILABLE',message:'Chưa xử lý được tài khoản. Hãy tải lại trạng thái trước khi thử lại.'});
    });
    // Never disconnect or publish a successful ban before DB commit.
    await this.chat.revokeUser(result.id);
    return result;
  }
}
