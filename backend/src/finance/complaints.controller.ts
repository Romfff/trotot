import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req,UseGuards } from '@nestjs/common';
import { ApiBearerAuth,ApiHeader,ApiOperation,ApiResponse,ApiTags,ApiExtraModels,getSchemaPath,type SchemaObject } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto,ListingsPageDto } from '../listings/listings.dto.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { ComplaintsService } from './complaints.service.js';
import { CreateAdminLateRefundCaseDto,CreateComplaintDto,RespondComplaintDto,AssignComplaintDto,ResolveComplaintDto,ComplaintRowDto,ComplaintEventDto,ComplaintResolutionDto,AdminComplaintResolutionDto,ComplaintDetailDto,AdminComplaintDetailDto,ComplaintResolvedDto } from './complaints.dto.js';
const complaintList:SchemaObject={type:'object',required:['success','message','data','meta'],properties:{
  success:{type:'boolean'},message:{type:'string'},data:{type:'array',items:{$ref:getSchemaPath(ComplaintRowDto)}},
  meta:{type:'object',required:['page','limit','total','totalPages'],properties:{page:{type:'integer',minimum:1},limit:{type:'integer',minimum:1},total:{type:'integer',minimum:0},totalPages:{type:'integer',minimum:0}}},
}};
@ApiTags('finance-complaints') @ApiBearerAuth()
@ApiExtraModels(ComplaintRowDto,ComplaintEventDto,ComplaintResolutionDto,AdminComplaintResolutionDto,ComplaintDetailDto,AdminComplaintDetailDto,ComplaintResolvedDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller()
export class ComplaintsController {
  constructor(private readonly complaints:ComplaintsService) {}
  @Post('admin/finance/bookings/:id/late-refund-cases') @Roles('ADMIN') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Admin mở sau hạn: hồ sơ có bằng chứng, không thực hiện chuyển tiền hoặc đổi COMPLETED'})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(ComplaintRowDto)},{type:'object',required:['caseType','caseLabel'],properties:{caseType:{type:'string',enum:['ADMIN_LATE_REFUND']},caseLabel:{type:'string',enum:['Admin mở sau hạn']}}}]},201,[400,401,403,404,409,429,503])
  createLate(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:CreateAdminLateRefundCaseDto,@Headers('idempotency-key') key:string) {return this.complaints.createAdminLate(r.user!.id,p.id,dto,key,r.body);}
  @Post('bookings/:id/complaints') @Roles('TENANT','HOST') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(ComplaintRowDto)}]},201,[400,401,403,404,409,429,503])
  create(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:CreateComplaintDto,@Headers('idempotency-key') key:string) {return this.complaints.create(r.user!.id,p.id,dto,key,r.body);}
  @Get('bookings/:id/complaints') @Roles('TENANT','HOST') @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({type:'array',items:{$ref:getSchemaPath(ComplaintDetailDto)}},200,[400,401,403,404,429,503])
  own(@Req() r:Request,@Param() p:ListingIdDto) {return this.complaints.bookingComplaints(r.user!.id,p.id);}
  @Get('host/finance/complaints') @Roles('HOST') @Header('Cache-Control','no-store')
  @ApiResponse({status:200,schema:complaintList})
  hostList(@Req() r:Request,@Query() q:ListingsPageDto) {return this.complaints.list(r.user!.id,q.page,q.limit);}
  @Get('host/finance/complaints/:id') @Roles('HOST') @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(ComplaintDetailDto)}]},200,[400,401,403,404,429,503])
  hostRead(@Req() r:Request,@Param() p:ListingIdDto) {return this.complaints.read(p.id,r.user!.id);}
  @Post('host/finance/complaints/:id/respond') @HttpCode(200) @Roles('HOST') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(ComplaintRowDto)}]},200,[400,401,403,404,409,429,503])
  respond(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:RespondComplaintDto,@Headers('idempotency-key') key:string) {return this.complaints.act(r.user!.id,p.id,'RESPOND',dto,key,r.body);}
  @Get('admin/finance/complaints') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiResponse({status:200,schema:complaintList})
  adminList(@Query() q:ListingsPageDto) {return this.complaints.list(null,q.page,q.limit);}
  @Get('admin/finance/complaints/:id') @Roles('ADMIN') @Header('Cache-Control','no-store')
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(AdminComplaintDetailDto)}]},200,[400,401,403,404,429,503])
  adminRead(@Param() p:ListingIdDto) {return this.complaints.read(p.id,null);}
  @Post('admin/finance/complaints/:id/assign') @HttpCode(200) @Roles('ADMIN') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(ComplaintRowDto)}]},200,[400,401,403,404,409,429,503])
  assign(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:AssignComplaintDto,@Headers('idempotency-key') key:string) {return this.complaints.act(r.user!.id,p.id,'ASSIGN',dto,key,r.body);}
  @Post('admin/finance/complaints/:id/resolve') @HttpCode(200) @Roles('ADMIN') @Header('Cache-Control','no-store') @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Resolve OPEN complaint; refund approval creates a pending obligation, not a bank transfer or completed stay'})
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(ComplaintResolvedDto)}]},200,[400,401,403,404,409,429,503])
  resolve(@Req() r:Request,@Param() p:ListingIdDto,@Body() dto:ResolveComplaintDto,@Headers('idempotency-key') key:string) {return this.complaints.resolve(r.user!.id,p.id,dto,key,r.body);}
}
