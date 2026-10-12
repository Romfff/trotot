import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiExtraModels, ApiProperty, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto, ListingsPageDto } from '../listings/listings.dto.js';
import { PayoutNotificationsService } from './payout-notifications.service.js';

export class PayoutNotificationDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) batchId!:string;
  @ApiProperty({enum:['CREATED','APPROVED','CANCELLED','PAID']}) type!:string;
  @ApiProperty({description:'Fixed message; PAID records manual evidence, not an automated transfer'}) message!:string;
  @ApiProperty({type:String,format:'date-time',nullable:true}) readAt!:string|null;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
function response(list=false) {
  const item={$ref:getSchemaPath(PayoutNotificationDto)};
  return ApiResponse({status:200,schema:{type:'object',required:['success','message','data',...(list?['meta']:[])],properties:{
    success:{type:'boolean'},message:{type:'string'},data:list?{type:'array',items:item}:item,
    ...(list?{meta:{type:'object' as const,required:['page','limit','total','totalPages','unreadCount'],properties:{
      page:{type:'integer' as const},limit:{type:'integer' as const},total:{type:'integer' as const},totalPages:{type:'integer' as const},unreadCount:{type:'integer' as const},
    }}}:{}),
  }}});
}
@ApiTags('payout-notifications') @ApiBearerAuth() @Roles('HOST') @ApiExtraModels(PayoutNotificationDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller('host/payout-notifications')
export class PayoutNotificationsController {
  constructor(private readonly notices:PayoutNotificationsService) {}
  @Get() @Header('Cache-Control','no-store') @response(true)
  list(@Req() req:Request,@Query() query:ListingsPageDto) {return this.notices.list(req.user!.id,query.page,query.limit);}
  @Post(':id/read') @HttpCode(200) @Header('Cache-Control','no-store') @response()
  @ApiBody({schema:{type:'object',additionalProperties:false,maxProperties:0},required:true})
  read(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:unknown) {
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==0)
      throw new BadRequestException({errorCode:'INVALID_NOTIFICATION_BODY',message:'Yêu cầu đánh dấu đã đọc cần body rỗng {}.'});
    return this.notices.markRead(req.user!.id,params.id);
  }
}
