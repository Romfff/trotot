import { Controller,Get,Header,Query,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiExtraModels,ApiResponse,ApiTags,getSchemaPath,type SchemaObject } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingsPageDto } from '../listings/listings.dto.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { HostRevenueQueryDto,HostRevenueDto,HostRevenueMonthDto } from './host-finance.dto.js';
import { HostFinanceService } from './host-finance.service.js';
import { HostFinanceSummaryDto,HostFinanceBalancesDto,HostFinanceJournalDto,HostFinanceEntryDto } from './host-finance.dto.js';
function financeResponse(list=false) {
  const item={$ref:getSchemaPath(list?HostFinanceJournalDto:HostFinanceSummaryDto)};
  const schema:SchemaObject={type:'object',required:['success','message','data'],properties:{success:{type:'boolean'},message:{type:'string'},data:list?{type:'array',items:item}:item}};
  if(list) schema.properties!.meta={type:'object',required:['page','limit','total','totalPages'],properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}};
  return ApiResponse({status:200,schema});
}
@ApiTags('host-finance') @ApiBearerAuth() @Roles('HOST')
@ApiExtraModels(HostFinanceSummaryDto,HostFinanceBalancesDto,HostFinanceJournalDto,HostFinanceEntryDto,HostRevenueDto,HostRevenueMonthDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller('host/finance')
export class HostFinanceController {
  constructor(private readonly finance:HostFinanceService) {}
  @Get() @Header('Cache-Control','no-store')
  @financeResponse()
  summary(@Req() r:Request) {return this.finance.summary(r.user!.id);}
  @Get('transactions') @Header('Cache-Control','no-store')
  @financeResponse(true)
  transactions(@Req() r:Request,@Query() q:ListingsPageDto) {return this.finance.transactions(r.user!.id,q.page,q.limit);}
  @Get('revenue') @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(HostRevenueDto)}]},200,[400,401,403,429,503])
  revenue(@Req() r:Request,@Query() q:HostRevenueQueryDto) {return this.finance.revenue(r.user!.id,q.year);}
}
