type PayoutCsvSnapshot = {
  id:string; hostId:string; bankCode:string; accountNumber:string; accountName:string;
  amount:string; bookingIds:string[]; cutoff:string; version:number;
};

// CSV quoting is not formula protection. Text prefixes also preserve bank
// account leading zeros and VND integers beyond spreadsheet numeric precision.
export function csvCell(value:string, text=false) {
  // eslint-disable-next-line no-control-regex -- Detect control-prefixed spreadsheet formulas, not only printable whitespace.
  const safe=(text || /^[\s\u0000-\u001f]*[=+\-@]/.test(value)? "'":'')+value;
  return '"'+safe.replaceAll('"','""')+'"';
}
export function payoutCsv(row:PayoutCsvSnapshot):string {
  const header=['payout_id','host_id','bank_code','account_number','account_name','amount_vnd','currency','booking_ids','cutoff_utc','version','status'];
  const values=[csvCell(row.id),csvCell(row.hostId),csvCell(row.bankCode),csvCell(row.accountNumber,true),csvCell(row.accountName),
    csvCell(row.amount,row.amount.length>15),csvCell('VND'),csvCell(row.bookingIds.join('|')),csvCell(row.cutoff),csvCell(String(row.version)),csvCell('APPROVED')];
  // Exactly one transfer row per batch: never repeat the total for each booking.
  return '\ufeff'+header.map(x=>csvCell(x)).join(',')+'\r\n'+values.join(',')+'\r\n';
}
