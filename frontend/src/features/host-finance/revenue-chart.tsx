"use client";

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft,ChevronRight,RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { hostFinanceApi,type HostRevenue } from '@/lib/api/host-finance';
import { apiError } from '@/lib/api/client';
import { revenueBarLayout,revenueMoneyLabel,type RevenueMetric } from './revenue-chart-layout';

const metrics:Record<RevenueMetric,string>={roomAndCleaning:'Tiền phòng + vệ sinh',commission:'Hoa hồng',refundRecognized:'Nghĩa vụ hoàn tiền',hostEarned:'Thu nhập ghi sổ',paidOut:'Đã chi trả thủ công'};
export function HostRevenueChart({sessionId}:{sessionId:string}) {
  const [year,setYear]=useState(()=>Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Ho_Chi_Minh'}).format(new Date())));
  const [metric,setMetric]=useState<RevenueMetric>('hostEarned');
  const query=useQuery({queryKey:['host-finance-revenue',sessionId,year],queryFn:({signal})=>hostFinanceApi.revenue(year,signal),
    retry:false,gcTime:0,refetchOnWindowFocus:true});
  return <section aria-labelledby="host-revenue-title" className="relative rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id="host-revenue-title" className="text-base font-semibold">Tài chính theo tháng ghi sổ</h2>
        <p className="mt-2 max-w-[75ch] text-sm text-gray-600 text-pretty">Hoàn tiền ghi ở tháng phát sinh, không sửa ngược tháng lưu trú. Tiền đã chi trả không phải doanh thu hay số dư có thể rút.</p></div>
      <div className="flex items-center gap-2" aria-label="Chọn năm báo cáo">
        <Button variant="secondary" size="icon" aria-label="Năm trước" disabled={year<=2000} onClick={()=>setYear(year-1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
        <span className="min-w-12 text-center text-sm font-medium tabular-nums">{year}</span>
        <Button variant="secondary" size="icon" aria-label="Năm sau" disabled={year>=2100} onClick={()=>setYear(year+1)}><ChevronRight className="size-4" aria-hidden="true" /></Button>
      </div>
    </header>
    <div className="my-4 flex flex-wrap gap-2" role="group" aria-label="Chỉ số biểu đồ">
      {(Object.keys(metrics) as RevenueMetric[]).map(key=><Button key={key} variant={key===metric?'primary':'secondary'} aria-pressed={key===metric} onClick={()=>setMetric(key)}>{metrics[key]}</Button>)}
    </div>
    {query.isFetching && query.data ? <p role="status" className="mb-3 text-xs text-gray-600">Đang cập nhật số liệu…</p> : null}
    {query.isError ? <div className="space-y-3"><Alert>Chưa tải được báo cáo năm {year}. {apiError(query.error).message}</Alert>
      <Button variant="secondary" onClick={()=>void query.refetch()}><RotateCw className="size-4" aria-hidden="true" />Thử lại</Button></div> : null}
    {!query.data && !query.isError ? <ul role="status" aria-label="Đang tải báo cáo tháng" aria-busy="true" className="space-y-4">
      {Array.from({length:12},(_,i)=><li key={i} aria-hidden="true" className="space-y-2"><div className="h-3 w-1/3 rounded bg-gray-200 animate-pulse motion-reduce:animate-none" /><div className="h-3 w-2/3 rounded bg-gray-200 animate-pulse motion-reduce:animate-none" /></li>)}
    </ul> : query.data ? <RevenueBars data={query.data} metric={metric} busy={query.isFetching} /> : null}
  </section>;
}

export function RevenueBars({data,metric,busy=false}:{data:HostRevenue;metric:RevenueMetric;busy?:boolean}) {
  const layout=revenueBarLayout(data.months.map(row=>row.isComplete?row[metric]:null));
  const review=data.months.some(row=>!row.isComplete);
  const empty=!review && layout.rows.every(row=>row.value==='0');
  const maximum=layout.rows.reduce((max,row)=>{
    const value=row.value===null?BigInt(0):BigInt(row.value);
    const magnitude=value<BigInt(0)?-value:value;
    return magnitude>max?magnitude:max;
  },BigInt(0));
  const baseline=layout.signed?132:242;
  const span=layout.signed?110:220;
  const amount=(value:string|null)=>value===null?'Cần đối soát':`${revenueMoneyLabel(value)}đ`;
  const ticks=layout.signed
    ? [{y:22,value:maximum},{y:77,value:null},{y:132,value:BigInt(0)},{y:187,value:null},{y:242,value:-maximum}]
    : [{y:22,value:maximum},{y:77,value:null},{y:132,value:null},{y:187,value:null},{y:242,value:BigInt(0)}];
  return <div aria-busy={busy} className="host-revenue-columns space-y-4">
    {review ? <Alert tone="notice">Tháng có bút toán chưa xác minh được ghi “Cần đối soát”, không biểu diễn thành 0đ.</Alert> : null}
    <p className="text-xs text-gray-600">Đơn vị: VND · Giờ Việt Nam{layout.signed?' · Giá trị âm nằm dưới mốc 0':''}.</p>
    <figure className="space-y-2">
      <div className="revenue-chart-scroll" role="region" tabIndex={0} aria-label="Biểu đồ 12 tháng, cuộn ngang để xem đủ các tháng">
        <svg className="revenue-column-chart" viewBox="0 0 640 286" role="img" aria-label={`${metrics[metric]}, 12 tháng năm ${data.year}`}>
          <desc>{layout.rows.map((row,index)=>`Tháng ${index+1}: ${amount(row.value)}`).join('; ')}. Số tiền đầy đủ trong bảng bên dưới.</desc>
          {ticks.map(tick=><g key={tick.y}>
            <line className="revenue-gridline" x1={220} x2={628} y1={tick.y} y2={tick.y} />
            {tick.value!==null && (maximum>BigInt(0) || tick.y===baseline) ? <text className="revenue-axis-label" x={208} y={tick.y+4} textAnchor="end">{revenueMoneyLabel(tick.value.toString())}</text>:null}
          </g>)}
          <line className="revenue-zero-line" x1={220} x2={628} y1={baseline} y2={baseline} />
          {layout.rows.map((row,index)=>{
            const x=228+index*33;
            const height=row.width*span/100;
            return <g key={data.months[index].month}>
              {row.value===null ? <text className="revenue-review-mark" x={x+9} y={baseline-12} textAnchor="middle">?<title>Tháng {index+1}: Cần đối soát</title></text>
                : height>0 ? <rect className={`revenue-column ${row.negative?'revenue-column-negative':''}`} data-month={index+1} data-negative={row.negative} x={x} y={row.negative?baseline:baseline-height} width={18} height={height} rx={2}>
                  <title>Tháng {index+1}: {amount(row.value)}</title>
                </rect>:null}
              <text className="revenue-month-label" x={x+9} y={270} textAnchor="middle">T{index+1}</text>
            </g>;
          })}
        </svg>
      </div>
      <figcaption className="text-xs text-gray-600">Trục ngang: tháng 1–12. Cột cùng màu thể hiện chỉ số đang chọn; dấu ? là tháng cần đối soát. Cuộn ngang trên màn hình nhỏ để xem đủ năm.</figcaption>
    </figure>
    {empty ? <p className="text-sm text-gray-600">Chưa có {metrics[metric].toLowerCase()} trong năm {data.year}. Số liệu chỉ xuất hiện khi có bút toán hợp lệ.</p> : null}
    <table className="revenue-amount-table">
      <caption>{metrics[metric]} — số tiền đầy đủ, 12 tháng năm {data.year}</caption>
      <thead><tr><th scope="col">Tháng</th><th scope="col">Số tiền (VND)</th></tr></thead>
      <tbody>{layout.rows.map((row,index)=><tr key={data.months[index].month}>
        <th scope="row">Tháng {index+1}</th>
        <td className={row.value!==null && /^-?\d{13,18}$/.test(row.value)?'revenue-long-amount':undefined}>{amount(row.value)}{row.value===null ? <span className="revenue-review-detail">{data.months[index].reviewCount} bút toán cần kiểm tra.</span>:null}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
