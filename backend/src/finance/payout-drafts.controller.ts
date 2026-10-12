import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiHeader, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { ListingIdDto, ListingsPageDto } from '../listings/listings.dto.js';
import { PayoutDraftsService } from './payout-drafts.service.js';
import { ConfirmPayoutDto,PayoutPaidResultDto,PayoutHostConfirmationDto,PayoutAdminConfirmationDto,PayoutOperationsDto } from './payout-drafts.dto.js';
import { CreatePayoutDraftDto,CancelPayoutDraftDto,PayoutDraftSummaryDto,PayoutDraftListItemDto,PayoutDraftItemDto,
  PayoutDraftHostEventDto,PayoutDraftAdminEventDto,PayoutDraftHostDetailDto,PayoutDraftAdminDetailDto,PayoutDraftCancelResultDto,ApprovePayoutDraftDto,PayoutDraftApproveResultDto,PayoutCsvExportDto } from './payout-drafts.dto.js';
const response=(type:typeof PayoutDraftListItemDto|typeof PayoutDraftHostDetailDto|typeof PayoutDraftAdminDetailDto,list=false)=>ApiResponse({status:200,schema:{
  type:'object',required:['success','message','data',...(list?['meta']:[])],properties:{success:{type:'boolean'},message:{type:'string'},
    data:list?{type:'array',items:{$ref:getSchemaPath(type)}}:{$ref:getSchemaPath(type)},
    ...(list?{meta:{type:'object' as const,required:['page','limit','total','totalPages'],properties:{page:{type:'integer' as const},limit:{type:'integer' as const},total:{type:'integer' as const},totalPages:{type:'integer' as const}}}}:{}),
  },
}});
@ApiTags('payout-drafts') @ApiBearerAuth()
@ApiExtraModels(PayoutDraftSummaryDto,PayoutDraftListItemDto,PayoutDraftItemDto,PayoutDraftHostEventDto,PayoutDraftAdminEventDto,PayoutDraftHostDetailDto,PayoutDraftAdminDetailDto,PayoutDraftCancelResultDto,PayoutDraftApproveResultDto,PayoutCsvExportDto,PayoutPaidResultDto,PayoutHostConfirmationDto,PayoutAdminConfirmationDto,PayoutOperationsDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller()
export class PayoutDraftsController {
  constructor(private readonly drafts:PayoutDraftsService) {}
  @Post('admin/finance/payouts') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(PayoutDraftSummaryDto)}]},201,[400,401,403,404,409,429,503])
  create(@Req() req:Request,@Body() dto:CreatePayoutDraftDto,@Headers('idempotency-key') key:string) {return this.drafts.create(req.user!.id,dto,key,req.body);}
  @Get('admin/finance/payouts') @Roles('ADMIN') @Header('Cache-Control','no-store') @response(PayoutDraftListItemDto,true)
  adminList(@Query() query:ListingsPageDto) {return this.drafts.list(null,query.page,query.limit);}
  @Get('host/payouts') @Roles('HOST') @Header('Cache-Control','no-store') @response(PayoutDraftListItemDto,true)
  ownList(@Req() req:Request,@Query() query:ListingsPageDto) {return this.drafts.list(req.user!.id,query.page,query.limit);}
  @Get('admin/finance/payouts/:id') @Roles('ADMIN') @Header('Cache-Control','no-store') @response(PayoutDraftAdminDetailDto)
  adminRead(@Param() params:ListingIdDto) {return this.drafts.read(params.id,null);}
  @Get('host/payouts/:id') @Roles('HOST') @Header('Cache-Control','no-store') @response(PayoutDraftHostDetailDto)
  ownRead(@Req() req:Request,@Param() params:ListingIdDto) {return this.drafts.read(params.id,req.user!.id);}
  @Post('admin/finance/payouts/:id/cancel') @Roles('ADMIN') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(PayoutDraftCancelResultDto)}]},200,[400,401,403,404,409,429,503])
  cancel(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:CancelPayoutDraftDto,@Headers('idempotency-key') key:string) {return this.drafts.cancel(req.user!.id,params.id,dto,key,req.body);}
  @Post('admin/finance/payouts/:id/approve') @Roles('ADMIN') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(PayoutDraftApproveResultDto)}]},200,[400,401,403,404,409,429,503])
  approve(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:ApprovePayoutDraftDto,@Headers('idempotency-key') key:string) {return this.drafts.approve(req.user!.id,params.id,dto,key,req.body);}
  @Get('admin/finance/payouts/:id/export') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(PayoutCsvExportDto)}]},200,[400,401,403,404,409,429,503])
  exportCsv(@Req() req:Request,@Param() params:ListingIdDto) {return this.drafts.exportCsv(req.user!.id,params.id);}
  @Post('admin/finance/payouts/:id/confirm-paid') @Roles('ADMIN') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(PayoutPaidResultDto)}]},200,[400,401,403,404,409,429,503])
  confirmPaid(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:ConfirmPayoutDto,@Headers('idempotency-key') key:string) {
    return this.drafts.confirmPaid(req.user!.id,params.id,dto,key,req.body);
  }
}
