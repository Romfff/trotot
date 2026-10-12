import { ApiProperty,ApiPropertyOptional } from '@nestjs/swagger';
import { Transform,Type } from 'class-transformer';
import { IsIn,IsString,IsUUID,Length,Matches,ValidateIf,ValidateNested,IsDefined,IsInt,Min,Max } from 'class-validator';
import { VersionActionDto } from '../listings/listings.dto.js';
export class CreateComplaintDto extends VersionActionDto {
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!:string;
}
export class CreateAdminLateRefundCaseDto extends CreateComplaintDto {
  @ApiProperty({maxLength:500}) @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) evidenceNote!:string;
}
export class RespondComplaintDto extends VersionActionDto {
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) message!:string;
}
export class AssignComplaintDto extends CreateComplaintDto {
  @ApiProperty({format:'uuid'}) @IsUUID() assigneeId!:string;
}
export class ComplaintRefundAllocationDto {
  @ApiProperty({type:String,pattern:'^(0|[1-9]\\d{0,12})$'}) @IsString() @Matches(/^(0|[1-9]\d{0,12})$/) baseAmount!:string;
  @ApiProperty({type:String,pattern:'^(0|[1-9]\\d{0,12})$'}) @IsString() @Matches(/^(0|[1-9]\d{0,12})$/) cleaningFee!:string;
  @ApiProperty({type:String,pattern:'^(0|[1-9]\\d{0,12})$'}) @IsString() @Matches(/^(0|[1-9]\d{0,12})$/) serviceFee!:string;
  @ApiProperty({type:String,pattern:'^(0|[1-9]\\d{0,12})$'}) @IsString() @Matches(/^(0|[1-9]\d{0,12})$/) taxAmount!:string;
}
export class ResolveComplaintDto extends CreateComplaintDto {
  @ApiProperty({enum:['HOST','FULL_REFUND','PARTIAL_REFUND']}) @IsIn(['HOST','FULL_REFUND','PARTIAL_REFUND']) decision!:'HOST'|'FULL_REFUND'|'PARTIAL_REFUND';
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) evidenceNote!:string;
  @ApiPropertyOptional({type:'integer',minimum:1,maximum:2147483646}) @ValidateIf(o=>o.decision!=='HOST'||o.expectedBookingVersion!==undefined) @IsDefined() @IsInt() @Min(1) @Max(2147483646) expectedBookingVersion?:number;
  @ApiPropertyOptional({type:ComplaintRefundAllocationDto}) @ValidateIf(o=>o.decision!=='HOST'||o.allocation!==undefined) @IsDefined() @ValidateNested() @Type(()=>ComplaintRefundAllocationDto) allocation?:ComplaintRefundAllocationDto;
}

// Response documentation only; private Admin evidence is not part of Guest/Host detail.
export class ComplaintRowDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({maxLength:500}) reason!:string;
  @ApiProperty({enum:['OPEN','RESOLVED']}) status!:string;
  @ApiProperty({type:String,format:'uuid',nullable:true}) assigneeId!:string|null;
  @ApiProperty({type:'integer',minimum:1,maximum:2147483647}) version!:number;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty() overdue!:boolean;
}
export class ComplaintEventDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({enum:['CREATED','RESPONDED','ASSIGNED','RESOLVED']}) action!:string;
  @ApiProperty({maxLength:500}) message!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class ComplaintResolutionDto {
  @ApiProperty({enum:['HOST','FULL_REFUND','PARTIAL_REFUND']}) decision!:'HOST'|'FULL_REFUND'|'PARTIAL_REFUND';
  @ApiProperty({maxLength:500}) reason!:string;
  @ApiProperty({format:'date-time'}) resolvedAt!:string;
  @ApiPropertyOptional({type:'object',properties:{id:{type:'string',format:'uuid'},amount:{type:'string'},status:{type:'string',enum:['PENDING','PAID']}}}) refundObligation?:{id:string;amount:string;status:string};
  @ApiPropertyOptional({type:String,format:'date-time',nullable:true}) holdUntil?:string|null;
}
export class AdminComplaintResolutionDto extends ComplaintResolutionDto {
  @ApiProperty({format:'uuid'}) actorId!:string;
  @ApiProperty({maxLength:500}) evidenceNote!:string;
}
export class ComplaintDetailDto extends ComplaintRowDto {
  @ApiPropertyOptional({enum:['PENDING'],description:'Host-only review indicator; no financial evidence.'}) settlementReviewStatus?:string;
  @ApiProperty({type:[ComplaintEventDto]}) events!:ComplaintEventDto[];
  @ApiProperty({type:ComplaintResolutionDto,nullable:true}) resolution!:ComplaintResolutionDto|null;
}
export class AdminComplaintDetailDto extends ComplaintRowDto {
  @ApiPropertyOptional({type:'object',required:['originalHostAmount','offsetAmount','paidAmount','potentialExcessAmount'],properties:{originalHostAmount:{type:'string'},offsetAmount:{type:'string'},paidAmount:{type:'string'},potentialExcessAmount:{type:'string'}},description:'Read-only mixed-source review. Excess is maximum exposure on full refund, not an approved refund.'}) settlementReview?:object;
  @ApiPropertyOptional({type:'object',properties:{caseType:{type:'string',enum:['ADMIN_LATE_REFUND']},caseLabel:{type:'string'},actorId:{type:'string',format:'uuid'},evidenceNote:{type:'string'},bookingVersionAtOpen:{type:'integer'},openedAt:{type:'string',format:'date-time'}}}) lateCase?:object;
  @ApiProperty({type:'object',required:['version','bookingStatus','paymentStatus','checkoutAt','amounts','approvedRefundAmounts','refundedAmount','pendingRefundAmount','remainingRefundableAmounts','reviewRequired'],properties:{
    version:{type:'integer',minimum:1,maximum:2147483647},bookingStatus:{type:'string'},paymentStatus:{type:'string'},checkoutAt:{type:'string',format:'date-time',nullable:true},
    amounts:{type:'object',additionalProperties:{type:'string',pattern:'^(0|[1-9]\\d{0,12})$'}},approvedRefundAmounts:{type:'object',additionalProperties:{type:'string'}},
    refundedAmount:{type:'string'},pendingRefundAmount:{type:'string'},remainingRefundableAmounts:{type:'object',nullable:true,additionalProperties:{type:'string'}},reviewRequired:{type:'boolean'},
  }}) bookingSnapshot!:object;
  @ApiProperty({type:[ComplaintEventDto]}) events!:ComplaintEventDto[];
  @ApiProperty({type:AdminComplaintResolutionDto,nullable:true}) resolution!:AdminComplaintResolutionDto|null;
}
export class ComplaintResolvedDto extends ComplaintRowDto {
  @ApiProperty({enum:['RESOLVED']}) declare status:'RESOLVED';
  @ApiProperty({type:'integer',minimum:2,maximum:2147483647}) declare version:number;
  @ApiProperty({enum:[false]}) declare overdue:boolean;
  @ApiProperty({type:ComplaintResolutionDto}) resolution!:ComplaintResolutionDto;
}
