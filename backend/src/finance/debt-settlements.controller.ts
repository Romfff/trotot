import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiHeader,ApiResponse,ApiTags,ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString,Length } from 'class-validator';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto,ListingsPageDto } from '../listings/listings.dto.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { CreatePayoutDraftDto } from './payout-drafts.dto.js';
import { DebtSettlementsService } from './debt-settlements.service.js';
class ReverseSettlementDto {
  @ApiProperty({minLength:1,maxLength:500}) @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!:string;
}
const money={type:'string' as const,pattern:'^(0|[1-9][0-9]{0,17})$'},uuid={type:'string' as const,format:'uuid'};
const settlement={type:'object' as const,required:['id','hostId','cutoff','grossEligible','debtOffset','netPayout','batchId'],properties:{id:uuid,hostId:uuid,cutoff:{type:'string' as const,format:'date-time'},grossEligible:money,debtOffset:money,netPayout:money,batchId:{...uuid,nullable:true}}};
@ApiTags('finance-settlements') @ApiBearerAuth()
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller()
export class DebtSettlementsController {
  constructor(private readonly settlements:DebtSettlementsService) {}
  @Post('admin/finance/settlements') @Roles('ADMIN') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses(settlement,201,[400,401,403,404,409,429,503])
  create(@Req() r:Request,@Body() dto:CreatePayoutDraftDto,@Headers('idempotency-key') key:string) {return this.settlements.create(r.user!.id,dto.hostId,dto.reason,key,r.body);}
  @Post('admin/finance/settlements/:id/reverse') @HttpCode(200) @Roles('ADMIN') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({type:'object',required:['id','status','reversedOffsets'],properties:{id:uuid,status:{type:'string',enum:['REVERSED']},reversedOffsets:{type:'integer',minimum:1}}},200,[400,401,403,404,409,429,503])
  reverse(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:ReverseSettlementDto,@Headers('idempotency-key') key:string) {return this.settlements.reverse(r.user!.id,p.id,dto.reason,key,r.body);}
  @Get('host/finance/debts') @Roles('HOST') @Header('Cache-Control','no-store')
  @ApiResponse({status:200,schema:{type:'object',required:['success','message','data','meta'],properties:{success:{type:'boolean'},message:{type:'string'},data:{type:'array',items:{type:'object',required:['id','bookingId','amount','remainingAmount','createdAt'],properties:{id:uuid,bookingId:uuid,amount:money,remainingAmount:money,createdAt:{type:'string',format:'date-time'}}}},meta:{type:'object',required:['page','limit','total','totalPages'],properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}}}}})
  debts(@Req() r:Request,@Query() q:ListingsPageDto) {return this.settlements.list(r.user!.id,'debts',q.page,q.limit);}
  @Get('host/finance/settlements') @Roles('HOST') @Header('Cache-Control','no-store')
  @ApiResponse({status:200,schema:{type:'object',required:['success','message','data','meta'],properties:{success:{type:'boolean'},message:{type:'string'},data:{type:'array',items:{type:'object',required:['id','cutoff','grossEligible','debtOffset','netPayout','batchId','status','createdAt'],properties:{id:uuid,cutoff:{type:'string',format:'date-time'},grossEligible:money,debtOffset:money,netPayout:money,batchId:{...uuid,nullable:true},status:{type:'string',enum:['OFFSET','ALLOCATED','REVERSED']},createdAt:{type:'string',format:'date-time'}}}},meta:{type:'object',required:['page','limit','total','totalPages'],properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'}}}}}})
  history(@Req() r:Request,@Query() q:ListingsPageDto) {return this.settlements.list(r.user!.id,'settlements',q.page,q.limit);}
}
