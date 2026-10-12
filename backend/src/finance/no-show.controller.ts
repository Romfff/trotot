import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiHeader,ApiTags,ApiExtraModels,ApiOperation,ApiResponse,getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto,ListingsPageDto } from '../listings/listings.dto.js';
import { NoShowReportDto,ResolveNoShowDto,NoShowReportCreatedDto,NoShowReportRowDto,NoShowReportDetailDto,NoShowResolutionDto,NoShowResolvedDto } from './no-show.dto.js';
import { NoShowService } from './no-show.service.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
@ApiTags('finance-no-show') @ApiBearerAuth()
@ApiExtraModels(NoShowReportCreatedDto,NoShowReportRowDto,NoShowReportDetailDto,NoShowResolutionDto,NoShowResolvedDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard) @Controller()
export class NoShowController {
  constructor(private readonly noShow:NoShowService) {}
  @Post('host/bookings/:id/no-show-report') @Roles('HOST') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Own Host reports a paid confirmed guest missing from check-in; does not complete the booking'})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(NoShowReportCreatedDto)}]},201,[400,401,403,404,409,429,503])
  report(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:NoShowReportDto,@Headers('idempotency-key') key:string) {return this.noShow.report(r.user!.id,p.id,dto,key,r.body);}
  @Post('admin/finance/bookings/:id/resolve-stay') @Roles('ADMIN') @HttpCode(200) @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Admin verifies NO_SHOW after checkout with payment provenance; no automatic completion or money movement'})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(NoShowResolvedDto)}]},200,[400,401,403,404,409,429,503])
  resolve(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:ResolveNoShowDto,@Headers('idempotency-key') key:string) {return this.noShow.resolve(r.user!.id,p.id,dto,key,r.body);}
  @Get('admin/finance/no-show-reports') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiResponse({status:200,schema:{type:'object',required:['success','message','data','meta'],properties:{success:{type:'boolean'},message:{type:'string'},
    data:{type:'array',items:{$ref:getSchemaPath(NoShowReportRowDto)}},meta:{type:'object',required:['page','limit','total','totalPages'],properties:{
      page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}}}}})
  @ApiEnvelopedResponses({type:'array',items:{$ref:getSchemaPath(NoShowReportRowDto)}},200,[400,401,403,429,503])
  list(@Query() q:ListingsPageDto) {return this.noShow.list(q.page,q.limit);}
  @Get('admin/finance/no-show-reports/:id') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'Admin reads report UUID and private resolution evidence; this ID is not the booking UUID'})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(NoShowReportDetailDto)}]},200,[400,401,403,404,429,503])
  read(@Param() p:ListingIdDto) {return this.noShow.read(p.id);}
}
