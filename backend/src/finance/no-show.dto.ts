import { ApiProperty } from '@nestjs/swagger';
import { IsIn,IsString,Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { VersionActionDto } from '../listings/listings.dto.js';
export class NoShowReportDto extends VersionActionDto {
  @ApiProperty({minLength:1,maxLength:500}) @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!:string;
}
export class ResolveNoShowDto extends NoShowReportDto {
  @ApiProperty({enum:['NO_SHOW']}) @IsIn(['NO_SHOW']) decision!:'NO_SHOW';
  @ApiProperty({minLength:1,maxLength:500}) @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) evidenceNote!:string;
}

// Response documentation only; these classes do not transform service output.
export class NoShowReportCreatedDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({type:'integer',minimum:2,maximum:2147483647}) bookingVersion!:number;
  @ApiProperty({minLength:1,maxLength:500}) reason!:string;
  @ApiProperty({format:'date-time'}) reportedAt!:string;
}
export class NoShowReportRowDto extends NoShowReportCreatedDto {
  @ApiProperty({type:Boolean}) resolved!:boolean;
}
export class NoShowResolutionDto {
  @ApiProperty({format:'uuid'}) actorId!:string;
  @ApiProperty({minLength:1,maxLength:500}) reason!:string;
  @ApiProperty({minLength:1,maxLength:500}) evidenceNote!:string;
  @ApiProperty({format:'date-time'}) resolvedAt!:string;
}
export class NoShowReportDetailDto extends NoShowReportCreatedDto {
  @ApiProperty({type:NoShowResolutionDto,nullable:true}) resolution!:NoShowResolutionDto|null;
}
export class NoShowResolvedDto {
  @ApiProperty({format:'uuid'}) bookingId!:string;
  @ApiProperty({type:'integer',minimum:3,maximum:2147483647}) bookingVersion!:number;
  @ApiProperty({enum:['NO_SHOW']}) decision!:'NO_SHOW';
  @ApiProperty({type:String,enum:['0'],description:'Zero refund under the approved no-show decision; no bank transfer is executed'}) refundAmount!:'0';
  @ApiProperty({format:'date-time'}) resolvedAt!:string;
  @ApiProperty({format:'date-time',description:'72 hours after resolution; not permission to pay out'}) holdUntil!:string;
}
