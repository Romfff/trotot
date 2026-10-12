import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
export class DashboardQueryDto {
  @ApiProperty({format:'date'}) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from!:string;
  @ApiProperty({format:'date'}) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to!:string;
}
export class DashboardMoneyDto {
  @ApiProperty({type:String,description:'Original verified PAYMENT cash posted in range, integer VND'}) gmv!:string;
  @ApiProperty({type:String,description:'Approved refund obligations posted in range'}) refundApproved!:string;
  @ApiProperty({type:String,description:'Evidenced cash refunds posted in range, not approvals'}) refundTransferred!:string;
  @ApiProperty({type:String,description:'Current verified refund obligations still outstanding, all dates'}) refundPendingTransfer!:string;
  @ApiProperty({type:String,description:'Informational flow: GMV less approved refunds in range; may be negative'}) gmvLessApprovedRefunds!:string;
  @ApiProperty({type:String,description:'Commission CREDIT from original PAYMENT in range; not GMV'}) commissionRecognized!:string;
}
export class DashboardResponseDto {
  @ApiProperty({format:'date'}) from!:string;
  @ApiProperty({format:'date'}) to!:string;
  @ApiProperty({enum:['Asia/Ho_Chi_Minh']}) timeZone!:string;
  @ApiProperty({enum:['VND']}) currency!:string;
  @ApiProperty({format:'date-time'}) serverTime!:string;
  @ApiProperty({type:DashboardMoneyDto}) money!:DashboardMoneyDto;
  @ApiProperty({description:'Current non-deleted listing counts keyed by stored status',type:'object',additionalProperties:{type:'integer'}}) listings!:Record<string,number>;
  @ApiProperty() deletedListings!:number;
  @ApiProperty({type:'array',items:{type:'object',properties:{role:{type:'string'},status:{type:'string',nullable:true},count:{type:'integer'}}}}) users!:{role:string;status:string|null;count:number}[];
  @ApiProperty({description:'Unsupported financial source journals, all dates'}) reviewCount!:number;
  @ApiProperty() isComplete!:boolean;
}
