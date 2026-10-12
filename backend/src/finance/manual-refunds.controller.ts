import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiHeader,ApiOperation,ApiTags,ApiExtraModels,ApiResponse,getSchemaPath } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { ListingIdDto,ListingsPageDto } from '../listings/listings.dto.js';
import { ConfirmRefundDto,RefundRowDto,RefundDetailDto,RefundConfirmationDto,RefundPaidResultDto } from './manual-refunds.dto.js';
import { ManualRefundsService } from './manual-refunds.service.js';
@ApiTags('admin-finance') @ApiBearerAuth() @Roles('ADMIN')
@ApiExtraModels(RefundRowDto,RefundDetailDto,RefundConfirmationDto,RefundPaidResultDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller('admin/finance/refunds')
export class ManualRefundsController {
  constructor(private readonly refunds:ManualRefundsService) {}
  @Get() @Header('Cache-Control','no-store')
  @ApiResponse({status:200,schema:{type:'object',required:['success','message','data','meta'],properties:{success:{type:'boolean'},message:{type:'string'},
    data:{type:'array',items:{$ref:getSchemaPath(RefundRowDto)}},meta:{type:'object',required:['page','limit','total','totalPages'],properties:{
      page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}}}}})
  list(@Query() query:ListingsPageDto) {return this.refunds.list(query.page,query.limit);}
  @Get(':id') @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(RefundDetailDto)}]},200,[401,403,404,429,503])
  read(@Param() params:ListingIdDto) {return this.refunds.read(params.id);}
  @Post(':id/confirm-paid') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Admin records an actual external manual refund with evidence; no bank transfer is executed'})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(RefundPaidResultDto)}]},200,[400,401,403,404,409,429,503])
  confirm(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:ConfirmRefundDto,@Headers('idempotency-key') key:string) {
    return this.refunds.confirm(req.user!.id,params.id,dto,key,req.body);
  }
}
