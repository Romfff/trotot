import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizePhone } from '../auth/phone.js';
import { VersionActionDto } from '../listings/listings.dto.js';

export class HoldBookingDto {
  @ApiProperty() @IsUUID() unitId!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) checkInDate!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) checkOutDate!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) numAdults!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(10000) numChildren!: number;
  @ApiProperty() @IsString() @Length(1,2048) quoteToken!: string;
  @ApiProperty() @Transform(({value}) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1,150) guestName!: string;
  @ApiProperty() @Transform(({value}) => typeof value === 'string' ? normalizePhone(value) : value) @Matches(/^\+?[0-9]{9,15}$/) guestPhone!: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(255) guestEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) guestNotes?: string;
}
export class BookingActionDto extends VersionActionDto {}
export class BookingPaymentSessionDto {
  @ApiProperty({enum:['VNPAY_SANDBOX']}) provider!:string;
  @ApiProperty({enum:['REDIRECT']}) mode!:string;
  @ApiProperty({format:'uuid'}) sessionId!:string;
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({pattern:'^[a-f0-9]{32}$'}) transactionRef!:string;
  @ApiProperty({type:String,pattern:'^[1-9][0-9]{0,9}$'}) amountVnd!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty({format:'date-time'}) expiresAt!:string;
  @ApiProperty({format:'uri',description:'Signed sandbox redirect, not payment proof'}) redirectUrl!:string;
}
export class BookingVerifiedPaymentDto {
  @ApiProperty({enum:['VNPAY_SANDBOX']}) provider!:string;
  @ApiProperty({enum:[true]}) verified!:boolean;
  @ApiProperty({format:'uuid'}) sessionId!:string;
  @ApiProperty({pattern:'^[1-9][0-9]*$'}) amountVnd!:string;
  @ApiProperty({format:'date-time'}) paidAt!:string;
}
export class BookingPaymentStatusDto {
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty() bookingCode!:string;
  @ApiProperty({minimum:1}) version!:number;
  @ApiProperty() bookingStatus!:string;
  @ApiProperty({description:'Stored booking flag, not proof of a verified provider callback'}) paymentStatus!:string;
  @ApiProperty({pattern:'^[0-9]+$',description:'Exact snapshot amount, integer VND string'}) amount!:string;
  @ApiProperty({enum:['VND']}) currency!:string;
  @ApiProperty({format:'date-time'}) serverTime!:string;
  @ApiProperty({type:String,format:'date-time',nullable:true,description:'Only pending reservations have an active deadline'}) reservationExpiresAt!:string|null;
  @ApiProperty({description:'Pending reservation deadline has passed; read does not expire or extend booking'}) reservationExpired!:boolean;
  @ApiProperty({description:'Current valid Sandbox configuration, not payment evidence'}) providerConnected!:boolean;
  @ApiProperty({type:BookingVerifiedPaymentDto,nullable:true,description:'Only verified immutable APPLIED provider receipt and exact journal; PAID flag alone is insufficient'}) payment!:BookingVerifiedPaymentDto|null;
}
export class PaidGuestCancellationDto extends BookingActionDto {
  @ApiProperty() @IsString() @Length(1,2048) refundQuoteToken!: string;
  @ApiPropertyOptional() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsOptional() @IsString() @Length(1,500) reason?: string;
}
export class PaidHostCancellationDto extends BookingActionDto {
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!: string;
}

export class RefundAmountsDto {
  @ApiProperty({description:'Integer VND'}) room!: number;
  @ApiProperty({description:'Integer VND'}) cleaning!: number;
  @ApiProperty({description:'Integer VND; only refunded for a full refund'}) service!: number;
  @ApiProperty({description:'Integer VND'}) tax!: number;
  @ApiProperty({description:'Sum of rounded refund lines, integer VND'}) total!: number;
}
export class RefundQuoteResponseDto {
  @ApiProperty({format:'uuid'}) bookingId!: string;
  @ApiProperty() version!: number;
  @ApiProperty({enum:['FLEXIBLE','MODERATE','STRICT']}) policy!: string;
  @ApiProperty({enum:[0,50,100]}) refundPercent!: number;
  @ApiProperty({format:'date-time'}) checkInAt!: string;
  @ApiProperty() refundQuoteToken!: string;
  @ApiProperty({format:'date-time'}) quoteExpiresAt!: string;
  @ApiProperty({type:RefundAmountsDto}) refund!: RefundAmountsDto;
  @ApiProperty() disclaimer!: string;
}
