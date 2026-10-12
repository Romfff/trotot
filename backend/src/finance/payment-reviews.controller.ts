import { Controller, Get, Header, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiProperty, ApiResponse, ApiTags, getSchemaPath } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { Sprint2IpRateLimitGuard, Sprint2UserRateLimitGuard } from '../common/sprint2-rate-limit.guard.js';
import { ListingIdDto, ListingsPageDto } from '../listings/listings.dto.js';
import { PaymentReviewsService } from './payment-reviews.service.js';

export class PaymentReviewDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) sessionId!:string;
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({minLength:1,maxLength:32}) bookingCode!:string;
  @ApiProperty({enum:['VNPAY_SANDBOX']}) provider!:string;
  @ApiProperty({pattern:'^[1-9][0-9]{0,14}$'}) transactionNo!:string;
  @ApiProperty({description:'Immutable session amount, integer VND string',pattern:'^[1-9][0-9]{0,9}$'}) expectedAmount!:string;
  @ApiProperty({description:'Verified receipt amount, integer VND string',pattern:'^[1-9][0-9]{0,9}$'}) receivedAmount!:string;
  @ApiProperty({enum:['AMOUNT_MISMATCH','BOOKING_NOT_PAYABLE','SESSION_CHANGED','PAYMENT_TIME_INVALID','SOURCE_EXISTS']}) reasonCode!:string;
  @ApiProperty({type:'integer',minimum:1,maximum:2147483647}) sessionBookingVersion!:number;
  @ApiProperty({type:'integer',minimum:1,maximum:2147483647,description:'Current booking version; not permission to reconfirm'}) bookingVersion!:number;
  @ApiProperty({enum:['PENDING_HOST_APPROVAL','PENDING_PAYMENT','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','CANCELLED_BY_GUEST','REJECTED_BY_HOST','CANCELLED_HOST_TIMEOUT','CANCELLED_TIMEOUT']}) bookingStatus!:string;
  @ApiProperty({enum:['NOT_CONFIGURED','PENDING','PAID','REFUNDED'],description:'Current booking flag, not a resolution of the REVIEW receipt'}) paymentStatus!:string;
  @ApiProperty({format:'date-time'}) sessionExpiresAt!:string;
  @ApiProperty({type:String,format:'date-time',nullable:true}) payDate!:string|null;
  @ApiProperty({format:'date-time'}) receivedAt!:string;
}
function response(list=false) {
  const item={$ref:getSchemaPath(PaymentReviewDto)};
  return ApiResponse({status:200,schema:{type:'object',required:['success','message','data',...(list?['meta']:[])],properties:{
    success:{type:'boolean'},message:{type:'string'},data:list?{type:'array',items:item}:item,
    ...(list?{meta:{type:'object' as const,required:['page','limit','total','totalPages'],properties:{
      page:{type:'integer' as const},limit:{type:'integer' as const},total:{type:'integer' as const},totalPages:{type:'integer' as const},
    }}}:{}),
  }}});
}
@ApiTags('payment-reviews') @ApiBearerAuth() @Roles('ADMIN') @ApiExtraModels(PaymentReviewDto)
@UseGuards(Sprint2IpRateLimitGuard,AccessTokenGuard,RolesGuard,Sprint2UserRateLimitGuard)
@Controller('admin/finance/payment-reviews')
export class PaymentReviewsController {
  constructor(private readonly reviews:PaymentReviewsService) {}
  @Get() @Header('Cache-Control','no-store') @response(true)
  list(@Query() query:ListingsPageDto) {return this.reviews.list(query.page,query.limit);}
  @Get(':id') @Header('Cache-Control','no-store') @response()
  read(@Param() params:ListingIdDto) {return this.reviews.read(params.id);}
}
