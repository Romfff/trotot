import { describe,expect,it,vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RevenueBars } from '@/features/host-finance/revenue-chart';
import { revenueBarLayout,revenueMoneyLabel } from '@/features/host-finance/revenue-chart-layout';
import type { HostRevenue } from '@/lib/api/host-finance';
vi.mock('@/lib/api/client',()=>({apiError:vi.fn(),managementRequest:vi.fn()}));
const data=():HostRevenue=>({year:2026,basis:'LEDGER_POSTED',currency:'VND',timeZone:'Asia/Ho_Chi_Minh',months:Array.from({length:12},(_,i)=>({month:`2026-${String(i+1).padStart(2,'0')}`,roomAndCleaning:'0',commission:'0',refundRecognized:'0',hostEarned:'0',paidOut:'0',reviewCount:0,isComplete:true}))});
describe('S4 revenue presentation, fixture amounts only',()=>{
  it('formats money beyond floating precision and negative reversals exactly',()=>{
    expect(revenueMoneyLabel('999999999999999999')).toBe('999.999.999.999.999.999');expect(revenueMoneyLabel('-9007199254740993')).toBe('-9.007.199.254.740.993');
  });
  it('keeps unknown separate from zero; zero/empty never divides by zero',()=>{
    expect(revenueBarLayout(['0',null])).toEqual({signed:false,rows:[{value:'0',negative:false,width:0},{value:null,negative:false,width:0}]});
    expect(revenueBarLayout([])).toEqual({signed:false,rows:[]});
  });
  it('scales only visual geometry using integer money, including negative values',()=>{
    expect(revenueBarLayout(['100','-50','0',null]).rows.map(row=>row.width)).toEqual([100,50,0,0]);
    expect(revenueBarLayout(['999999999999999999','999999999999999998']).rows.every(row=>Number.isFinite(row.width)&&row.width<=100)).toBe(true);
  });
  it('does not present an incomplete month as zero revenue',()=>{
    const value=data();value.months[0].reviewCount=1;value.months[0].isComplete=false;
    const html=renderToStaticMarkup(<RevenueBars data={value} metric="hostEarned"/>);expect(html).toContain('Cần đối soát');expect(html).toContain('1 bút toán cần kiểm tra');expect(html).not.toContain('Chưa có thu nhập ghi sổ');
  });
  it('labels paid payouts separately and never manufactures a withdrawable balance',()=>{
    const value=data();value.months[0].paidOut='12345';const html=renderToStaticMarkup(<RevenueBars data={value} metric="paidOut"/>);
    expect(html).toContain('Đã chi trả thủ công');expect(html).toContain('12.345đ');expect(html).not.toContain('Số dư');expect(html).not.toContain('NaN');
  });
  it('keeps the chart frame, grid, zero baseline and all twelve months with no fake zero bars',()=>{
    const html=renderToStaticMarkup(<RevenueBars data={data()} metric="refundRecognized"/>);
    expect(html).toContain('revenue-zero-line');expect(html.match(/class="revenue-gridline"/g)).toHaveLength(5);
    expect(html.match(/class="revenue-month-label"/g)).toHaveLength(12);expect(html).not.toContain('<rect');
    expect(html).toContain('Nghĩa vụ hoàn tiền — số tiền đầy đủ');expect(html.match(/<tr>/g)).toHaveLength(13);
    expect(html.match(/<td>0đ<\/td>/g)).toHaveLength(12);expect(html).not.toContain('<ol');
  });
  it('places positive and negative columns on opposite sides of zero and preserves exact table values',()=>{
    const value=data();value.months[0].hostEarned='999999999999999999';value.months[1].hostEarned='-499999999999999999';
    value.months[2].isComplete=false;value.months[2].reviewCount=2;
    const html=renderToStaticMarkup(<RevenueBars data={value} metric="hostEarned"/>);
    expect(html).toContain('data-month="1" data-negative="false" x="228" y="22"');
    expect(html).toContain('data-month="2" data-negative="true" x="261" y="132"');
    expect(html).toContain('>999.999.999.999.999.999đ</td>');expect(html).toContain('>-499.999.999.999.999.999đ</td>');
    expect(html).toContain('Giá trị âm nằm dưới mốc 0');expect(html).toContain('2 bút toán cần kiểm tra.');
    expect(html.match(/<rect/g)).toHaveLength(2);expect(html.match(/class="revenue-review-mark"/g)).toHaveLength(1);
    expect(html).not.toContain('data-month="3"');expect(html).not.toContain('NaN');
  });
  it('shows unknown months as review markers and table labels, never empty-year zeros',()=>{
    const value=data();value.months.forEach(row=>{row.isComplete=false;row.reviewCount=1;});
    const html=renderToStaticMarkup(<RevenueBars data={value} metric="commission"/>);
    expect(html.match(/class="revenue-review-mark"/g)).toHaveLength(12);expect(html).not.toContain('<rect');
    expect(html).not.toContain('<td>0đ');expect(html).not.toContain('Chưa có hoa hồng');expect(html).toContain('scope="row"');
  });
  it('labels exact axis endpoints for a single dong without rounded intermediate zeros',()=>{
    const value=data();value.months[0].hostEarned='1';
    const html=renderToStaticMarkup(<RevenueBars data={value} metric="hostEarned"/>);
    expect(html.match(/class="revenue-axis-label"/g)).toHaveLength(2);expect(html).toContain('<td>1đ</td>');expect(html.match(/<rect/g)).toHaveLength(1);
  });
});
