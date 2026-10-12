import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiExtraModels, ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags, getSchemaPath, type SchemaObject } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto, ListingsPageDto } from '../listings/listings.dto.js';
import { AppointmentActionDto, AppointmentPageDto, AppointmentResponseDto, CreateAppointmentDto, HostAppointmentResponseDto, NotificationResponseDto } from './appointments.dto.js';
import { AppointmentsService } from './appointments.service.js';

function response(type: typeof AppointmentResponseDto | typeof HostAppointmentResponseDto | typeof NotificationResponseDto, list=false,status=200) {
  const item={$ref:getSchemaPath(type)};
  const schema:SchemaObject={type:'object',required:['success','message','data'],properties:{success:{type:'boolean'},message:{type:'string'},data:list?{type:'array',items:item}:item}};
  if(list) schema.properties!.meta={type:'object',required:['page','limit','total','totalPages'],properties:{page:{type:'integer'},limit:{type:'integer'},total:{type:'integer'},totalPages:{type:'integer'},...(type===NotificationResponseDto?{unreadCount:{type:'integer'}}:{})}};
  return ApiResponse({status,schema});
}
const uuid = () => ApiParam({name:'id',format:'uuid'});

@ApiTags('viewing-appointments') @ApiBearerAuth()
@ApiExtraModels(AppointmentResponseDto,HostAppointmentResponseDto,NotificationResponseDto)
@ApiResponse({status:400,description:'Validation/appointment time error'})
@ApiResponse({status:401,description:'Authentication required'})
@ApiResponse({status:403,description:'Wrong role/inactive account'})
@ApiResponse({status:404,description:'Resource missing or not owned by caller'})
@ApiResponse({status:409,description:'STALE_APPOINTMENT_STATUS (data.currentStatus), APPOINTMENT_ALREADY_EXISTS, quota/state conflict, IDEMPOTENCY_KEY_REUSED, IDEMPOTENCY_IN_PROGRESS'})
@ApiResponse({status:429,description:'RATE_LIMITED; Retry-After header in seconds'})
@Controller() @UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Roles('TENANT')
export class AppointmentsController {
  constructor(private readonly appointments:AppointmentsService) {}
  @Post('appointments') @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true,schema:{type:'string',minLength:1,maxLength:128,pattern:'^[!-~]+$'}})
  @ApiOperation({summary:'Create PENDING appointment and Host notification atomically; Vietnam time; not a room reservation'})
  @response(AppointmentResponseDto,false,201)
  create(@Req() req:Request,@Body() body:CreateAppointmentDto,@Headers('idempotency-key') key:string) {return this.appointments.create(req.user!.id,body,key,req.body);}
  @Get('appointments') @Header('Cache-Control','no-store') @response(AppointmentResponseDto,true)
  @ApiOperation({summary:'Own appointments sorted by Vietnam date/time'})
  list(@Req() req:Request,@Query() query:AppointmentPageDto) {return this.appointments.list(req.user!.id,query);}
  @Get('appointments/:id') @uuid() @Header('Cache-Control','no-store') @response(AppointmentResponseDto)
  read(@Req() req:Request,@Param() params:ListingIdDto) {return this.appointments.read(req.user!.id,params.id);}
  @Post('appointments/:id/cancel') @uuid() @HttpCode(200) @Header('Cache-Control','no-store') @response(AppointmentResponseDto)
  cancel(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:AppointmentActionDto) {return this.appointments.action(req.user!.id,params.id,'cancel',body);}
  @Get('host/appointments') @Roles('HOST') @Header('Cache-Control','no-store') @response(HostAppointmentResponseDto,true)
  hostList(@Req() req:Request,@Query() query:AppointmentPageDto) {return this.appointments.list(req.user!.id,query,true);}
  @Get('host/appointments/:id') @uuid() @Roles('HOST') @Header('Cache-Control','no-store') @response(HostAppointmentResponseDto)
  hostRead(@Req() req:Request,@Param() params:ListingIdDto) {return this.appointments.read(req.user!.id,params.id,true);}
  @Post('host/appointments/:id/accept') @uuid() @Roles('HOST') @HttpCode(200) @Header('Cache-Control','no-store') @response(HostAppointmentResponseDto)
  accept(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:AppointmentActionDto) {return this.appointments.action(req.user!.id,params.id,'accept',body,true);}
  @Post('host/appointments/:id/reject') @uuid() @Roles('HOST') @HttpCode(200) @Header('Cache-Control','no-store') @response(HostAppointmentResponseDto)
  reject(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:AppointmentActionDto) {return this.appointments.action(req.user!.id,params.id,'reject',body,true);}
  @Post('host/appointments/:id/complete') @uuid() @Roles('HOST') @HttpCode(200) @Header('Cache-Control','no-store') @response(HostAppointmentResponseDto)
  complete(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:AppointmentActionDto) {return this.appointments.action(req.user!.id,params.id,'complete',body,true);}
  @Post('host/appointments/:id/cancel') @uuid() @Roles('HOST') @HttpCode(200) @Header('Cache-Control','no-store') @response(HostAppointmentResponseDto)
  hostCancel(@Req() req:Request,@Param() params:ListingIdDto,@Body() body:AppointmentActionDto) {return this.appointments.action(req.user!.id,params.id,'cancel',body,true);}
  @Get('notifications') @Roles('TENANT','HOST') @Header('Cache-Control','no-store') @response(NotificationResponseDto,true)
  notifications(@Req() req:Request,@Query() query:ListingsPageDto) {return this.appointments.notifications(req.user!.id,query);}
  @Post('notifications/:id/read') @uuid() @Roles('TENANT','HOST') @HttpCode(200) @Header('Cache-Control','no-store') @response(NotificationResponseDto)
  markRead(@Req() req:Request,@Param() params:ListingIdDto) {return this.appointments.markRead(req.user!.id,params.id);}
}
