import {describe,expect,it} from 'vitest';
import {csvCell,payoutCsv} from './payout-csv.js';
describe('private payout CSV encoding',()=>{
  it.each(['=1+1','+cmd','-1','@SUM(A1)',' =formula','\t=cmd','\r\n+formula','\ufeff@formula'])('neutralizes formula prefix %j even behind whitespace/control',value=>{
    expect(csvCell(value)).toBe('"\''+value+'"');
  });
  it('quotes delimiters, embedded quotes/newlines and Unicode without a formula workaround',()=>{
    expect(csvCell('Tên, "A"\nB')).toBe('"Tên, ""A""\nB"');
    expect(csvCell('normal')).toBe('"normal"');
  });
  const row={id:'batch',hostId:'host',bankCode:'FIXTURE',accountNumber:'001234',accountName:'Synthetic',amount:'990',
    bookingIds:['a','b'],cutoff:'2026-10-05T02:00:00.000Z',version:2};
  it('uses BOM/CRLF and one transfer row containing all booking IDs',()=>{
    const result=payoutCsv(row);
    expect(result.startsWith('\ufeff')).toBe(true);
    expect(result.split('\r\n')).toHaveLength(3);
    expect(result).toContain('"a|b"');expect(result.match(/"990"/g)).toHaveLength(1);
    expect(result).toContain('"\'001234"');expect(result).toContain('"APPROVED"');
    expect(result).not.toContain('="001234"');
  });
  it('keeps exact large VND strings as text instead of spreadsheet numeric rounding',()=>{
    expect(payoutCsv({...row,amount:'9007199254740993'})).toContain('"\'9007199254740993"');
  });
});
