import { Body,Controller,Get,Header,Headers,HttpCode,Param,Post,Query,Req,UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth,ApiExtraModels,ApiHeader,ApiOperation,ApiTags,getSchemaPath } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard,Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ApiEnvelopedResponses } from '../common/api-docs.js';
import { ListingIdDto,ListingsPageDto } from '../listings/listings.dto.js';
import { HoldBookingDto,BookingActionDto,BookingPaymentStatusDto,RefundQuoteResponseDto,RefundAmountsDto,PaidGuestCancellationDto,PaidHostCancellationDto } from './bookings.dto.js';
import { BookingsService } from './bookings.service.js';
import { ClientIp } from '../auth/client-ip.js';
import { BookingPaymentSessionDto } from './bookings.dto.js';

@ApiTags('bookings') @ApiBearerAuth()
@Controller() @UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Roles('TENANT','HOST')
export class BookingsController {
  constructor(private readonly bookings:BookingsService) {}
  @Post('bookings/hold') @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Signed quote → DB exclusion and per-night Redis reservation; configured Sandbox PENDING, local unconfigured NOT_CONFIGURED; no automatic payment'})
  @ApiEnvelopedResponses({type:'object'},201,[400,401,403,404,409,429,503])
  hold(@Req() req:Request,@Body() dto:HoldBookingDto,@Headers('idempotency-key') key:string) {return this.bookings.hold(req.user!.id,dto,key,req.body);}
  @Get('bookings') @Header('Cache-Control','no-store')
  list(@Req() req:Request,@Query() query:ListingsPageDto) {return this.bookings.list(req.user!.id,query.page,query.limit);}
  @Get('bookings/:id/payment-status') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'Own booking payment recovery snapshot and immutable provider proof; read-only, stored PAID flag alone is not proof'})
  @ApiExtraModels(BookingPaymentStatusDto)
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(BookingPaymentStatusDto)}]},200,[400,401,403,404,429,503])
  paymentStatus(@Req() req:Request,@Param() params:ListingIdDto) {return this.bookings.paymentStatus(req.user!.id,params.id);}
  @Get('bookings/:id/payment-session') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'Recover existing own/current sandbox session; read-only, configured provider and verified client IP required'})
  @ApiExtraModels(BookingPaymentSessionDto)
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(BookingPaymentSessionDto)}]},200,[400,401,403,404,409,429,503])
  paymentSession(@Req() req:Request,@Param() params:ListingIdDto,@ClientIp() ip?:string) {return this.bookings.paymentSession(req.user!.id,params.id,undefined,ip);}
  @Post('bookings/:id/payment-session') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Create/replay own unpaid sandbox session; redirect is not successful payment evidence'})
  @ApiExtraModels(BookingPaymentSessionDto)
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(BookingPaymentSessionDto)}]},200,[400,401,403,404,409,429,503])
  createPaymentSession(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:BookingActionDto,@Headers('idempotency-key') key:string,@ClientIp() ip?:string) {return this.bookings.paymentSession(req.user!.id,params.id,{version:dto.expectedVersion,key},ip);}
  @Get('bookings/:id/refund-quote') @Header('Cache-Control','no-store')
  @ApiOperation({summary:'Own paid confirmed booking: signed cancellation preview only; no money/inventory mutation'})
  @ApiExtraModels(RefundQuoteResponseDto,RefundAmountsDto)
  @ApiEnvelopedResponses({allOf:[{$ref:getSchemaPath(RefundQuoteResponseDto)}]},200,[400,401,403,404,409,429,503])
  refundQuote(@Req() req:Request,@Param() params:ListingIdDto) {return this.bookings.refundQuote(req.user!.id,params.id);}
  @Post('bookings/:id/cancel-paid') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Own paid cancellation: locked reprice, refund obligation, release inventory; no transfer'})
  @ApiEnvelopedResponses({type:'object'},200,[400,401,403,404,409,429,503])
  cancelPaid(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:PaidGuestCancellationDto,@Headers('idempotency-key') key:string) {
    return this.bookings.cancelPaid(req.user!.id,params.id,'GUEST',dto.expectedVersion,key,req.body,dto.refundQuoteToken,dto.reason);
  }
  @Post('host/bookings/:id/cancel-paid') @HttpCode(200) @Roles('HOST') @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  @ApiOperation({summary:'Owning Host cancels before check-in with reason; full refund obligation, no transfer'})
  @ApiEnvelopedResponses({type:'object'},200,[400,401,403,404,409,429,503])
  hostCancelPaid(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:PaidHostCancellationDto,@Headers('idempotency-key') key:string) {
    return this.bookings.cancelPaid(req.user!.id,params.id,'HOST',dto.expectedVersion,key,req.body,undefined,dto.reason);
  }
  @Get('bookings/:id') @Header('Cache-Control','no-store')
  read(@Req() req:Request,@Param() params:ListingIdDto) {return this.bookings.read(req.user!.id,params.id);}
  @Post('bookings/:id/cancel') @HttpCode(200) @Header('Cache-Control','no-store')
  @ApiHeader({name:'Idempotency-Key',required:true})
  cancel(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:BookingActionDto,@Headers('idempotency-key') key:string) {return this.bookings.action(req.user!.id,params.id,'cancel',dto.expectedVersion,key,req.body);}
  @Get('host/bookings') @Roles('HOST') @Header('Cache-Control','no-store')
  hostList(@Req() req:Request,@Query() query:ListingsPageDto) {return this.bookings.list(req.user!.id,query.page,query.limit,true);}
  @Get('host/bookings/:id') @Roles('HOST') @Header('Cache-Control','no-store')
  hostRead(@Req() req:Request,@Param() params:ListingIdDto) {return this.bookings.read(req.user!.id,params.id,true);}
  @Post('host/bookings/:id/accept') @HttpCode(200) @Roles('HOST')
  @ApiHeader({name:'Idempotency-Key',required:true}) @Header('Cache-Control','no-store')
  accept(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:BookingActionDto,@Headers('idempotency-key') key:string) {return this.bookings.action(req.user!.id,params.id,'accept',dto.expectedVersion,key,req.body);}
  @Post('host/bookings/:id/reject') @HttpCode(200) @Roles('HOST')
  @ApiHeader({name:'Idempotency-Key',required:true}) @Header('Cache-Control','no-store')
  reject(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:BookingActionDto,@Headers('idempotency-key') key:string) {return this.bookings.action(req.user!.id,params.id,'reject',dto.expectedVersion,key,req.body);}
  @Post('host/bookings/:id/check-in') @HttpCode(200) @Roles('HOST')
  @ApiHeader({name:'Idempotency-Key',required:true}) @Header('Cache-Control','no-store')
  checkIn(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:BookingActionDto,@Headers('idempotency-key') key:string) {return this.bookings.action(req.user!.id,params.id,'check-in',dto.expectedVersion,key,req.body);}
  @Post('host/bookings/:id/complete') @HttpCode(200) @Roles('HOST')
  @ApiHeader({name:'Idempotency-Key',required:true}) @Header('Cache-Control','no-store')
  complete(@Req() req:Request,@Param() params:ListingIdDto,@Body() dto:BookingActionDto,@Headers('idempotency-key') key:string) {return this.bookings.action(req.user!.id,params.id,'complete',dto.expectedVersion,key,req.body);}
}
