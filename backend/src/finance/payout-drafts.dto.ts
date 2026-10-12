import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';
import { VersionActionDto } from '../listings/listings.dto.js';
import { ConfirmRefundDto } from './manual-refunds.dto.js';
export class ConfirmPayoutDto extends ConfirmRefundDto {
  @ApiProperty({description:'Bank-qualified transfer reference; unique across payout confirmations'}) declare bankReference:string;
  @ApiProperty({minimum:2,maximum:2147483646}) declare expectedVersion:number;
}
export class CreatePayoutDraftDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() hostId!: string;
  @ApiProperty({ minLength: 1, maxLength: 500 }) @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!: string;
}
export class CancelPayoutDraftDto extends VersionActionDto {
  @ApiProperty({ minLength: 1, maxLength: 500 }) @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!: string;
}
export class ApprovePayoutDraftDto extends CancelPayoutDraftDto {}
export class PayoutDraftSummaryDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) hostId!:string;
  @ApiProperty({description:'Exact integer VND string'}) amount!:string;
  @ApiProperty({enum:['DRAFT','APPROVED','CANCELLED','PAID']}) status!:string;
  @ApiProperty({minimum:1}) version!:number;
  @ApiProperty({format:'date-time'}) cutoff!:string;
}
export class PayoutDraftListItemDto extends PayoutDraftSummaryDto {
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty() bankCode!:string;
  @ApiProperty({description:'Masked, only last four characters'}) accountNumber!:string;
}
export class PayoutDraftItemDto {
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({description:'Exact integer VND string'}) amount!:string;
  @ApiProperty({format:'date-time'}) eligibleAt!:string;
  @ApiProperty({enum:['ACTIVE','RELEASED']}) status!:string;
}
export class PayoutDraftHostEventDto {
  @ApiProperty({enum:['CREATED','APPROVED','CANCELLED','PAID']}) action!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class PayoutDraftAdminEventDto extends PayoutDraftHostEventDto {
  @ApiProperty({format:'uuid'}) actorId!:string;
  @ApiProperty() reason!:string;
}
export class PayoutDraftHostDetailDto extends PayoutDraftListItemDto {
  @ApiProperty({type:[PayoutDraftItemDto]}) items!:PayoutDraftItemDto[];
  @ApiProperty({type:[PayoutDraftHostEventDto]}) events!:PayoutDraftHostEventDto[];
  @ApiProperty({type:()=>PayoutHostConfirmationDto,nullable:true}) confirmation!:PayoutHostConfirmationDto|null;
}
export class PayoutHostConfirmationDto {
  @ApiProperty({format:'date-time'}) confirmedAt!:string;
}
export class PayoutAdminConfirmationDto extends PayoutHostConfirmationDto {
  @ApiProperty({format:'uuid'}) actorId!:string;
  @ApiProperty() bankReference!:string;
  @ApiProperty() evidenceNote!:string;
  @ApiProperty() reason!:string;
}
export class PayoutOperationsDto {
  @ApiProperty() canApprove!:boolean;
  @ApiProperty() canExport!:boolean;
  @ApiProperty() canConfirmPaid!:boolean;
  @ApiProperty() canCancel!:boolean;
  @ApiProperty() reviewRequired!:boolean;
}
export class PayoutDraftAdminDetailDto extends PayoutDraftHostDetailDto {
  @ApiProperty({type:()=>PayoutOperationsDto,description:'Snapshot hints only; actions revalidate current gates under locks'}) operations!:PayoutOperationsDto;
  @ApiProperty({description:'Admin-only full private bank snapshot'}) declare accountNumber:string;
  @ApiProperty() accountName!:string;
  @ApiProperty({format:'uuid'}) bankAccountId!:string;
  @ApiProperty({minimum:1}) bankVersion!:number;
  @ApiProperty({type:[PayoutDraftAdminEventDto]}) declare events:PayoutDraftAdminEventDto[];
  @ApiProperty({type:()=>PayoutAdminConfirmationDto,nullable:true}) declare confirmation:PayoutAdminConfirmationDto|null;
}
export class PayoutPaidResultDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({enum:['PAID']}) status!:string;
  @ApiProperty({minimum:3}) version!:number;
  @ApiProperty({description:'Exact integer VND string'}) amount!:string;
  @ApiProperty() message!:string;
}
export class PayoutDraftCancelResultDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({enum:['CANCELLED']}) status!:string;
  @ApiProperty({minimum:2}) version!:number;
}
export class PayoutDraftApproveResultDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({enum:['APPROVED']}) status!:string;
  @ApiProperty({minimum:2}) version!:number;
}
export class PayoutCsvExportDto {
  @ApiProperty({description:'Safe server-generated .csv filename'}) filename!:string;
  @ApiProperty({enum:['UTF-8']}) encoding!:string;
  @ApiProperty({description:'Private CSV text with UTF-8 BOM, CRLF and spreadsheet formula protection'}) csv!:string;
}
