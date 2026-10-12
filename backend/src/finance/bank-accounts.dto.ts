import { ApiProperty,OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt,IsString,Length,Matches,Max,Min } from 'class-validator';
export class BankVersionDto {
  @ApiProperty({minimum:0}) @IsInt() @Min(0) @Max(2147483646) expectedVersion!:number;
}
export class SubmitBankDto extends BankVersionDto {
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim().toUpperCase():value) @Matches(/^[A-Z0-9_-]{1,20}$/) bankCode!:string;
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @Matches(/^[A-Za-z0-9]{1,50}$/) accountNumber!:string;
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,150) accountName!:string;
}
export class ReviewBankDto extends BankVersionDto {
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) reason!:string;
  @ApiProperty() @Transform(({value})=>typeof value==='string'?value.trim():value) @IsString() @Length(1,500) evidenceNote!:string;
}
export class BankNotificationDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) accountId!:string;
  @ApiProperty({enum:['SUBMITTED','VERIFIED','REJECTED']}) type!:string;
  @ApiProperty() message!:string;
  @ApiProperty({type:String,format:'date-time',nullable:true}) readAt!:string|null;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class HostBankAccountDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) hostId!:string;
  @ApiProperty() bankCode!:string;
  @ApiProperty({description:'Private owner response only; never log or persist in browser storage'}) accountNumber!:string;
  @ApiProperty() accountName!:string;
  @ApiProperty({enum:['PENDING','VERIFIED','REJECTED']}) status!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class HostBankStateDto {
  @ApiProperty({minimum:0}) version!:number;
  @ApiProperty({type:HostBankAccountDto,nullable:true}) account!:HostBankAccountDto|null;
  @ApiProperty({description:'Current bank verified only; not a withdrawable balance or payout entitlement'}) payoutReady!:boolean;
}
export class AdminBankListItemDto extends OmitType(HostBankAccountDto,['accountName'] as const) {
  @ApiProperty({description:'Masked account number; only the last four characters are exposed'}) declare accountNumber:string;
  @ApiProperty({type:Number,minimum:0,description:'Current Host bank state version, including for historical accounts'}) version!:number;
  @ApiProperty() isCurrent!:boolean;
}
export class AdminBankEventDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({format:'uuid'}) actorId!:string;
  @ApiProperty({enum:['SUBMITTED','VERIFIED','REJECTED']}) action!:string;
  @ApiProperty() reason!:string;
  @ApiProperty() evidenceNote!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
}
export class AdminBankDetailDto extends HostBankAccountDto {
  @ApiProperty({description:'Full account number for authorized Admin review only; never log or persist in browser storage'}) declare accountNumber:string;
  @ApiProperty({minimum:0}) version!:number;
  @ApiProperty() isCurrent!:boolean;
  @ApiProperty({type:[AdminBankEventDto]}) events!:AdminBankEventDto[];
}
export class AdminBankReviewResultDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({minimum:1}) version!:number;
  @ApiProperty({enum:['VERIFIED','REJECTED']}) status!:string;
  @ApiProperty({description:'Current bank gate only, not a payout entitlement'}) payoutReady!:boolean;
}
