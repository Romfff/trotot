import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString,Length } from 'class-validator';
import { VersionActionDto } from '../listings/listings.dto.js';
export class ConfirmRefundDto extends VersionActionDto {
  @ApiProperty({description:'Bank-qualified transaction reference; unique across manual refunds'})
  @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,200) bankReference!:string;
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) evidenceNote!:string;
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!:string;
}
// Response documentation only: no persistence or request-contract changes.
export class RefundRowDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({type:String,pattern:'^[1-9][0-9]{0,17}$'}) amount!:string;
  @ApiProperty({enum:['PENDING','PAID','CANCELLED']}) status!:string;
  @ApiProperty({minimum:1,maximum:2147483647}) version!:number;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class RefundConfirmationDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) journalId!:string;
  @ApiProperty({format:'uuid'}) actorId!:string;
  @ApiProperty({maxLength:200}) bankReference!:string;
  @ApiProperty({maxLength:500}) evidenceNote!:string;
  @ApiProperty({maxLength:500}) reason!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class RefundDetailDto extends RefundRowDto {
  @ApiProperty({enum:['GUEST','HOST','ADMIN']}) cancelledBy!:string;
  @ApiProperty() reason!:string;
  @ApiProperty({format:'date-time'}) updatedAt!:string;
  @ApiProperty({type:RefundConfirmationDto,nullable:true}) confirmation!:RefundConfirmationDto|null;
}
export class RefundPaidResultDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({type:String,pattern:'^[1-9][0-9]{0,17}$'}) amount!:string;
  @ApiProperty({enum:['PAID']}) status!:string;
  @ApiProperty({minimum:2,maximum:2147483647}) version!:number;
  @ApiProperty({format:'uuid'}) journalId!:string;
  @ApiProperty() message!:string;
}
