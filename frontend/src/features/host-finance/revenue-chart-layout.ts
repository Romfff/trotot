export type RevenueMetric='roomAndCleaning'|'commission'|'refundRecognized'|'hostEarned'|'paidOut';
export function revenueMoneyLabel(value:string) {
  if(!/^(0|-?[1-9]\d*)$/.test(value)) throw new Error('Invalid ledger value');
  return new Intl.NumberFormat('vi-VN').format(BigInt(value));
}
// Display geometry only: never sums revenue, derives a wallet, or rounds financial amounts.
export function revenueBarLayout(values:(string|null)[]) {
  const numbers=values.map(value=>value===null?null:BigInt(value));
  const zero=BigInt(0);
  const absolute=(value:bigint)=>value<zero?-value:value;
  const maximum=numbers.reduce<bigint>((max,value)=>value!==null && absolute(value)>max?absolute(value):max,zero);
  return {signed:numbers.some(value=>value!==null && value<zero),rows:values.map((value,index)=>({
    value,negative:numbers[index]!==null && numbers[index]!<zero,
    width:numbers[index]===null || maximum===zero?0:Number(absolute(numbers[index]!)*BigInt(10000)/maximum)/100,
  }))};
}
