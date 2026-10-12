import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class HostRevenueQueryDto {
  @ApiProperty({minimum:2000,maximum:2100,example:2026})
  @Transform(({value}:{value:unknown})=>typeof value==='string' && /^\d{4}$/.test(value)?Number(value):value)
  @IsInt() @Min(2000) @Max(2100)
  year!:number;
}
export class HostRevenueMonthDto {
  @ApiProperty({example:'2026-01'}) month!:string;
  @ApiProperty({type:String}) roomAndCleaning!:string;
  @ApiProperty({type:String,description:'Net commission posted; may be negative in a reversal month'}) commission!:string;
  @ApiProperty({type:String,description:'Refund obligation recognized once, not the later cash transfer'}) refundRecognized!:string;
  @ApiProperty({type:String,description:'Net earned, excludes payouts; not withdrawable balance'}) hostEarned!:string;
  @ApiProperty({type:String,description:'Manually evidenced payouts; not revenue'}) paidOut!:string;
  @ApiProperty({minimum:0}) reviewCount!:number;
  @ApiProperty() isComplete!:boolean;
}
export class HostRevenueDto {
  @ApiProperty() year!:number;
  @ApiProperty({enum:['Asia/Ho_Chi_Minh']}) timeZone!:string;
  @ApiProperty({enum:['LEDGER_POSTED']}) basis!:string;
  @ApiProperty({enum:['VND']}) currency!:string;
  @ApiProperty({type:[HostRevenueMonthDto],minItems:12,maxItems:12}) months!:HostRevenueMonthDto[];
}
export class HostFinanceBalancesDto {
  @ApiProperty({type:String,description:'VND integer string; waiting for completion or financial resolution'}) waitingCompletion!:string;
  @ApiProperty({type:String,description:'VND integer string; 72-hour hold'}) pendingHold!:string;
  @ApiProperty({type:String,description:'VND integer string; not withdrawable until debt/bank/batch gates pass'}) eligibleBeforeDeductions!:string;
  @ApiProperty({type:String,description:'VND integer string; only bookings with OPEN complaints'}) frozen!:string;
}
export class HostFinanceSummaryDto {
  @ApiProperty({enum:['VND']}) currency!:string;
  @ApiProperty({enum:['LEDGER']}) source!:string;
  @ApiProperty({format:'date-time'}) serverTime!:string;
  @ApiProperty({enum:[72]}) holdHours!:number;
  @ApiProperty() bankVerified!:boolean;
  @ApiProperty({type:Boolean,description:'False until payout/debt/batch consumers are implemented'}) payoutOperationsReady!:boolean;
  @ApiProperty({type:HostFinanceBalancesDto}) balances!:HostFinanceBalancesDto;
  @ApiProperty({minimum:0}) reviewCount!:number;
}
export class HostFinanceEntryDto {
  @ApiProperty() account!:string;
  @ApiProperty({enum:['DEBIT','CREDIT']}) side!:string;
  @ApiProperty({type:String,description:'Exact VND integer string; never a JS float'}) amount!:string;
}
export class HostFinanceJournalDto {
  @ApiProperty({format:'uuid'}) id!:string;
  @ApiProperty({type:String,format:'uuid',nullable:true}) bookingId!:string|null;
  @ApiProperty({enum:['PAYMENT','REFUND','PAYOUT','ADJUSTMENT']}) kind!:string;
  @ApiProperty({format:'date-time'}) createdAt!:string;
  @ApiProperty({type:[HostFinanceEntryDto]}) entries!:HostFinanceEntryDto[];
}
