import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DashboardFigures} from '../src/features/admin/admin-screens';
import {validateDashboard,type Dashboard} from '../src/lib/api/admin';
export const data:Dashboard={from:'2026-01-01',to:'2026-01-31',currency:'VND',timeZone:'Asia/Ho_Chi_Minh',serverTime:'2026-01-31T00:00:00Z',
  money:{gmv:'9007199254740993',refundApproved:'0',refundTransferred:'0',refundPendingTransfer:'500',commissionRecognized:'10',gmvLessApprovedRefunds:'-10'},
  listings:{PUBLISHED:3,HIDDEN:1},deletedListings:2,users:[{role:'ADMIN',status:'ACTIVE',count:1}],isComplete:true,reviewCount:0};
describe('S5 Admin dashboard rendering/response validation',()=>{
  it('renders integer VND beyond JS safe number, negative reference, current pending and deleted separately',()=>{
    const html=renderToStaticMarkup(createElement(DashboardFigures,{data}));
    expect(html).toContain('9.007.199.254.740.993');expect(html).toContain('-10');expect(html).toContain('số dư hiện tại');expect(html).toContain('Đã xóa mềm');
    expect(validateDashboard(data)).toBe(data);
  });
  it.each(['1.5','NaN','Infinity','','<script>1</script>',12])('rejects malformed money %j before BigInt rendering',money=>{
    expect(()=>validateDashboard({...data,money:{...data.money,gmv:money as string}})).toThrow();
  });
  it.each([{timeZone:'UTC'},{currency:'USD'},{deletedListings:-1},{reviewCount:1.5},{users:[{role:'HOST',count:NaN}]}])('rejects invalid report shape %j',bad=>{
    expect(()=>validateDashboard({...data,...bad} as Dashboard)).toThrow();
  });
  it('escapes status labels and shows incomplete warning instead of claiming balanced complete data',()=>{
    const html=renderToStaticMarkup(createElement(DashboardFigures,{data:{...data,isComplete:false,reviewCount:2,listings:{'<script>window.x=1</script>':1}}}));
    expect(html).toContain('2 giao dịch');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');
  });
});
