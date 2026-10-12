"use client";
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Alert} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {apiError} from '@/lib/api/client';
import {debtSettlementsApi} from '@/lib/api/debt-settlements';
import {decimalPriceLabel} from '@/lib/decimal-price-label';
const date=(v:string)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',dateStyle:'short',timeStyle:'short'}).format(new Date(v));
export function DebtHistory({sessionId}:{sessionId:string}){
 return <div className="space-y-6"><DebtList sessionId={sessionId}/><SettlementList sessionId={sessionId}/></div>;
}
function DebtList({sessionId}:{sessionId:string}){
 const [page,setPage]=useState(1);
 const q=useQuery({queryKey:['host-debts',sessionId,page],queryFn:({signal})=>debtSettlementsApi.debts(page,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
 return <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="host-debt-title">
  <h2 id="host-debt-title" className="text-base font-semibold">Công nợ do hoàn tiền sau chi trả</h2>
  <p className="mt-2 max-w-[75ch] text-sm text-gray-600 text-pretty">Chỉ bù vào khoản đủ điều kiện của bạn, nợ còn lại chuyển tiếp. Hệ thống không trừ tiền ngân hàng.</p>
  {q.isError?<Alert className="mt-4">{apiError(q.error).message}</Alert>:null}
  {!q.data&&!q.isError?<p role="status" className="py-6 text-sm text-gray-600">Đang tải công nợ…</p>:null}
  {q.data?<><ul className="mt-4 divide-y divide-gray-200" aria-busy={q.isFetching}>{q.data.data.map(r=><li key={r.id} className="space-y-2 py-4">
   <p className="text-sm font-medium tabular-nums">Còn bù: {decimalPriceLabel(r.remainingAmount)}đ</p>
   <p className="text-sm text-gray-600 tabular-nums">Ghi nhận ban đầu: {decimalPriceLabel(r.amount)}đ · {date(r.createdAt)}</p>
   <p className="text-xs text-gray-600 wrap-anywhere">Đơn: {r.bookingId}</p>
  </li>)}</ul>{!q.data.data.length?<p className="py-6 text-sm text-gray-600">Chưa có công nợ ở trang này.</p>:null}</>:null}
  <Footer page={page} pages={q.data?.meta.totalPages??0} busy={q.isFetching} retry={()=>void q.refetch()} change={setPage}/>
 </section>;
}
function SettlementList({sessionId}:{sessionId:string}){
 const [page,setPage]=useState(1);
 const q=useQuery({queryKey:['host-settlements',sessionId,page],queryFn:({signal})=>debtSettlementsApi.settlements(page,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
 return <section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5" aria-labelledby="host-settlement-title">
  <h2 id="host-settlement-title" className="text-base font-semibold">Lịch sử bù trừ</h2>
  <p className="mt-2 text-sm text-gray-600 text-pretty">Đã bù trừ khác với đã chi trả. Phần thực trả, nếu có, theo trạng thái lô bên dưới.</p>
  {q.isError?<Alert className="mt-4">{apiError(q.error).message}</Alert>:null}
  {!q.data&&!q.isError?<p role="status" className="py-6 text-sm text-gray-600">Đang tải quyết toán…</p>:null}
  {q.data?<><ul className="mt-4 divide-y divide-gray-200" aria-busy={q.isFetching}>{q.data.data.map(r=><li key={r.id} className="space-y-2 py-4">
   <h3 className={`text-sm font-medium ${r.status==='OFFSET'?'text-brand':'text-gray-600'}`}>{({OFFSET:'Đã bù trừ · không chuyển tiền',ALLOCATED:'Đã bù, phần còn lại thuộc lô',REVERSED:'Đã đảo bù trừ'})[r.status]}</h3>
   <dl className="grid gap-2 text-sm sm:grid-cols-3">{[['Đủ điều kiện',r.grossEligible],['Bù nợ',r.debtOffset],['Phần thực trả',r.netPayout]].map(([label,value])=><div key={label}><dt className="text-gray-600">{label}</dt><dd className="font-medium tabular-nums wrap-anywhere">{decimalPriceLabel(value)}đ</dd></div>)}</dl>
   <p className="text-xs text-gray-600">Mốc đối soát: {date(r.cutoff)} (giờ Việt Nam)</p>
   {r.batchId?<p className="text-xs text-gray-600 wrap-anywhere">Lô: {r.batchId}</p>:null}
  </li>)}</ul>{!q.data.data.length?<p className="py-6 text-sm text-gray-600">Chưa có quyết toán ở trang này.</p>:null}</>:null}
  <Footer page={page} pages={q.data?.meta.totalPages??0} busy={q.isFetching} retry={()=>void q.refetch()} change={setPage}/>
 </section>;
}
function Footer({page,pages,busy,retry,change}:{page:number;pages:number;busy:boolean;retry:()=>void;change:(page:number)=>void}){
 return <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
  <Button variant="secondary" disabled={busy} onClick={retry}>Tải lại</Button>
  {pages>1?<nav aria-label="Phân trang công nợ" className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={busy||page<=1} onClick={()=>change(page-1)}>Trang trước</Button><span className="text-sm tabular-nums">{page} / {pages}</span><Button variant="secondary" disabled={busy||page>=pages} onClick={()=>change(page+1)}>Trang sau</Button></nav>:null}
 </div>;
}
