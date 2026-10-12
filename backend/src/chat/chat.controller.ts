import { Body,Controller,Get,Header,Param,Post,Query,Req,UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth,ApiExtraModels,ApiResponse,ApiTags,getSchemaPath } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { ListingIdDto,ListingsPageDto } from '../listings/listings.dto.js';
import { ChatMessagesQueryDto,CreateConversationDto,SendChatMessageDto,ReadChatDto,ConversationResponseDto,ChatMessageResponseDto } from './chat.dto.js';
import { ChatService } from './chat.service.js';
import { ChatRealtimeService } from './chat-realtime.service.js';

const conversation={$ref:getSchemaPath(ConversationResponseDto)},message={$ref:getSchemaPath(ChatMessageResponseDto)};
@ApiTags('chat') @ApiBearerAuth() @ApiExtraModels(ConversationResponseDto,ChatMessageResponseDto)
@Controller('conversations')
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
export class ChatController {
  constructor(private readonly chat:ChatService,private readonly realtime:ChatRealtimeService) {}
  @Post() @Header('Cache-Control','no-store') @Roles('TENANT','HOST') @ApiEnvelopedResponses({allOf:[conversation]},201,[400,401,403,404,409,429])
  open(@Req() req:Request,@Body() body:CreateConversationDto){return this.chat.open(req.user!,body.propertyId);}
  @Get() @Header('Cache-Control','no-store') @Roles('TENANT','HOST','ADMIN')
  @ApiResponse({status:200,schema:{type:'object',properties:{success:{type:'boolean'},message:{type:'string'},data:{type:'array',items:conversation},meta:{type:'object',properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}}}}})
  list(@Req() req:Request,@Query() query:ListingsPageDto){return this.chat.list(req.user!,query.page,query.limit);}
  @Get('unread') @Header('Cache-Control','no-store') @Roles('TENANT','HOST')
  @ApiEnvelopedResponses({type:'object',properties:{totalUnread:{type:'integer'},conversations:{type:'array',items:{type:'object',properties:{conversationId:{type:'string',format:'uuid'},unreadCount:{type:'integer'}}}}}},200,[401,403,429])
  unread(@Req() req:Request){return this.chat.unread(req.user!);}
  @Post(':id/read') @Header('Cache-Control','no-store') @Roles('TENANT','HOST')
  @ApiEnvelopedResponses({type:'object',properties:{conversationId:{type:'string',format:'uuid'},messageId:{type:'string',format:'uuid'}}},201,[400,401,403,404,409,429])
  markRead(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:ReadChatDto){return this.chat.markRead(req.user!,params.id,body.messageId);}
  @Get(':id/messages') @Header('Cache-Control','no-store') @Roles('TENANT','HOST','ADMIN')
  @ApiEnvelopedResponses({type:'object',properties:{conversation,messages:{type:'array',items:message},nextCursor:{type:'string',format:'uuid',nullable:true}}},200,[400,401,403,404,409,429])
  read(@Req() req:Request,@Param() params:ListingIdDto,@Query() query:ChatMessagesQueryDto){return this.chat.read(req.user!,params.id,query);}
  @Post(':id/messages') @Header('Cache-Control','no-store') @Roles('TENANT','HOST') @ApiEnvelopedResponses({allOf:[message]},201,[400,401,403,404,409,429])
  async send(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:SendChatMessageDto){
    const value=await this.chat.send(req.user!,params.id,body);await this.realtime.publishCommitted(value.id);return value;
  }
}
