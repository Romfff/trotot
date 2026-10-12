import { BadRequestException,Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Put,Query,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiBody,ApiExtraModels,ApiHeader,ApiOperation,ApiResponse,ApiTags,getSchemaPath,type SchemaObject } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto,ListingsPageDto } from '../listings/listings.dto.js';
import { BankAccountsService } from './bank-accounts.service.js';
import { SubmitBankDto,ReviewBankDto,BankNotificationDto,HostBankAccountDto,HostBankStateDto,AdminBankListItemDto,AdminBankDetailDto,AdminBankReviewResultDto,AdminBankEventDto } from './bank-accounts.dto.js';
function adminResponse(model:typeof AdminBankListItemDto|typeof AdminBankDetailDto|typeof AdminBankReviewResultDto,list=false) {
  const item={$ref:getSchemaPath(model)};
  const schema:SchemaObject={type:'object',required:['success','message','data'],properties:{success:{type:'boolean'},message:{type:'string'},data:list?{type:'array',items:item}:item}};
  if(list) {
    schema.required!.push('meta');
    schema.properties!.meta={type:'object',required:['page','limit','total','totalPages'],properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}};
  }
  return ApiResponse({status:200,schema});
}
function ownResponse() {
  return ApiResponse({status:200,schema:{type:'object',required:['success','message','data'],properties:{
    success:{type:'boolean'},message:{type:'string'},data:{$ref:getSchemaPath(HostBankStateDto)},
  }}});
}
function noticeResponse(list=false) {
  const item={$ref:getSchemaPath(BankNotificationDto)};
  const schema:SchemaObject={type:'object',required:['success','message','data'],properties:{success:{type:'boolean'},message:{type:'string'},data:list?{type:'array',items:item}:item}};
  if(list) schema.properties!.meta={type:'object',required:['page','limit','total','totalPages','unreadCount'],properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'},unreadCount:{type:'integer'}}};
  return ApiResponse({status:200,schema});
}
@ApiTags('finance-bank') @ApiBearerAuth()
@ApiExtraModels(BankNotificationDto,HostBankAccountDto,HostBankStateDto,AdminBankListItemDto,AdminBankDetailDto,AdminBankReviewResultDto,AdminBankEventDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller()
export class BankAccountsController {
  constructor(private readonly banks:BankAccountsService) {}
  @Get('host/bank-notifications') @Roles('HOST') @Header('Cache-Control','no-store')
  @noticeResponse(true)
  notifications(@Req() req:Request,@Query() q:ListingsPageDto) {return this.banks.notifications(req.user!.id,q.page,q.limit);}
  @Post('host/bank-notifications/:id/read') @HttpCode(200) @Roles('HOST') @Header('Cache-Control','no-store')
  @noticeResponse() @ApiBody({schema:{type:'object',additionalProperties:false}})
  markRead(@Req() req:Request,@Param() p:ListingIdDto,@Body() body:unknown) {
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length) throw new BadRequestException({errorCode:'INVALID_NOTIFICATION_BODY',message:'Yêu cầu đánh dấu đã đọc chỉ nhận body rỗng.'});
    return this.banks.markNotificationRead(req.user!.id,p.id);
  }
  @Get('host/bank-account') @Roles('HOST') @Header('Cache-Control','no-store')
  @ownResponse()
  own(@Req() req:Request) {return this.banks.own(req.user!.id);}
  @Put('host/bank-account') @Roles('HOST') @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true}) @ApiOperation({summary:'Submit a new PENDING bank version; never reuse old verified bank while pending'})
  @ownResponse()
  submit(@Req() req:Request,@Body() dto:SubmitBankDto,@Headers('idempotency-key') key:string) {return this.banks.submit(req.user!.id,dto,key,req.body);}
  @Get('admin/finance/bank-accounts') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @adminResponse(AdminBankListItemDto,true)
  list(@Query() q:ListingsPageDto) {return this.banks.list(q.page,q.limit);}
  @Get('admin/finance/bank-accounts/:id') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @adminResponse(AdminBankDetailDto)
  read(@Param() p:ListingIdDto) {return this.banks.read(p.id);}
  @Post('admin/finance/bank-accounts/:id/verify') @HttpCode(200) @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @adminResponse(AdminBankReviewResultDto)
  verify(@Req() req:Request,@Param() p:ListingIdDto,@Body() dto:ReviewBankDto,@Headers('idempotency-key') key:string) {return this.banks.review(req.user!.id,p.id,'VERIFY',dto,key,req.body);}
  @Post('admin/finance/bank-accounts/:id/reject') @HttpCode(200) @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @adminResponse(AdminBankReviewResultDto)
  reject(@Req() req:Request,@Param() p:ListingIdDto,@Body() dto:ReviewBankDto,@Headers('idempotency-key') key:string) {return this.banks.review(req.user!.id,p.id,'REJECT',dto,key,req.body);}
}
