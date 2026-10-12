"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Alert} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {apiError} from "@/lib/api/client";
import {ApiError} from "@/lib/auth-types";
import {adminRefundsApi,type RefundEvidence,type RefundDetail} from "@/lib/api/admin-refunds";
import {useAuthStore} from "@/stores/auth-store";
import {decimalPriceLabel} from "@/lib/decimal-price-label";
import {bankNeedsReplay} from "@/features/host-finance/bank-form";
import {reviewFieldErrors} from "./bank-review";
import './stitch-finance-batch.css';
const labels={PENDING:"Chờ hoàn tiền",PAID:"Admin đã ghi nhận chuyển trả",CANCELLED:"Nghĩa vụ hoàn đã hủy"};
const dateLabel=(v:string)=>new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",dateStyle:"short",timeStyle:"short"}).format(new Date(v));
export function AdminRefundScreen() {
  const {user,status,sessionId}=useAuthStore();
  return <div className="admin-finance-batch mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6"><header><h1 className="text-xl font-semibold">Hoàn tiền thủ công</h1>
    <p className="mt-2 text-sm text-gray-600 text-pretty">Ghi nhận khoản đã chuyển trả bên ngoài. Hệ thống không tự chuyển tiền cho khách.</p></header>
    {status==="initializing"?<p role="status">Đang kiểm tra phiên…</p>:status==="unavailable"?<Alert>Chưa kiểm tra được phiên. Hãy tải lại trang.</Alert>
      :!user?<p><Link href="/login" className="text-link underline">Đăng nhập</Link> để xem trang quản trị.</p>
      :user.role!=="ADMIN"||user.status!=="ACTIVE"||!sessionId?<Alert>Trang này chỉ dành cho Admin đang hoạt động.</Alert>:<Refunds key={sessionId} sessionId={sessionId}/>}</div>;
}
function Refunds({sessionId}:{sessionId:string}) {
  const [page,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null),[locked,setLocked]=useState(false);
  const list=useQuery({queryKey:["admin-refunds",sessionId,page],queryFn:({signal})=>adminRefundsApi.list(page,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  return <div className="finance-review-grid"><section aria-labelledby="refund-list-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5"><h2 id="refund-list-title" className="text-base font-semibold">Các khoản hoàn</h2>
    {list.isError?<div className="mt-4 space-y-3"><Alert>{apiError(list.error).message}</Alert><Button variant="secondary" disabled={locked} onClick={()=>void list.refetch()}>Thử lại danh sách</Button></div>
      :!list.data?<p role="status" className="py-4">Đang tải khoản hoàn…</p>:<div aria-busy={list.isFetching}>
        {list.data.data.length===0?<p className="py-6 text-sm text-gray-600">Chưa có khoản hoàn ở trang này.</p>:<ul className="finance-list mt-4 divide-y divide-gray-200">{list.data.data.map(row=><li key={row.id} className="finance-row space-y-2 py-4" data-selected={selected===row.id}>
          <h3 className="text-lg font-semibold tabular-nums wrap-anywhere">{decimalPriceLabel(row.amount)}đ</h3><p className="finance-status text-sm text-gray-600">{labels[row.status]}</p>
          <dl className="text-xs text-gray-600"><dt>ID khoản hoàn</dt><dd className="font-mono wrap-anywhere">{row.id}</dd><dt className="mt-1">Booking</dt><dd className="font-mono wrap-anywhere">{row.bookingId}</dd></dl>
          <Button variant="secondary" disabled={locked} aria-pressed={selected===row.id} aria-controls="refund-detail" onClick={()=>setSelected(row.id)}>Xem khoản hoàn</Button>
        </li>)}</ul>}
        {list.data.meta.totalPages>1?<nav aria-label="Phân trang khoản hoàn" className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <Button variant="secondary" disabled={locked||list.isFetching||page<=1} onClick={()=>{setSelected(null);setPage(page-1);}}>Trang trước</Button>
          <span className="text-sm tabular-nums" aria-current="page">{page} / {list.data.meta.totalPages}</span>
          <Button variant="secondary" disabled={locked||list.isFetching||page>=list.data.meta.totalPages} onClick={()=>{setSelected(null);setPage(page+1);}}>Trang sau</Button></nav>:null}
      </div>}</section>
    <section id="refund-detail" aria-label="Chi tiết khoản hoàn" className="finance-detail rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <h2 className="finance-detail-heading text-base font-semibold">Chi tiết khoản hoàn</h2>
      {selected?<RefundReview key={selected} id={selected} sessionId={sessionId} setLocked={setLocked}/>:<p className="text-sm text-gray-600">Chọn một khoản để kiểm tra chứng cứ và xử lý.</p>}
    </section></div>;
}
function RefundSnapshot({row}:{row:RefundDetail}) {
  return <div className="space-y-4 text-sm"><dl className="finance-snapshot @container space-y-3">{[["Booking",row.bookingId],["Số tiền phải hoàn",`${decimalPriceLabel(row.amount)}đ`],["Trạng thái",labels[row.status]],
    ["Người hủy",row.cancelledBy==="HOST"?"Chủ nhà":"Khách"],["Lý do hủy",row.reason||"Không có ghi chú"],["Cập nhật",`${dateLabel(row.updatedAt)} (giờ Việt Nam)`]].map(([label,value])=><div key={label} className="grid gap-1 @sm:grid-cols-[10rem_minmax(0,1fr)] @sm:gap-4"><dt className="text-gray-600">{label}</dt><dd className="font-medium wrap-anywhere">{value}</dd></div>)}</dl>
    {row.confirmation?<div className="finance-evidence space-y-2"><h3 className="text-base font-semibold">Chứng cứ chuyển trả</h3>
      <p className="wrap-anywhere">Mã giao dịch: {row.confirmation.bankReference}</p><p className="wrap-anywhere">Chứng cứ: {row.confirmation.evidenceNote}</p><p className="wrap-anywhere">Lý do: {row.confirmation.reason}</p>
      <p className="font-mono text-xs wrap-anywhere">Người xác nhận: {row.confirmation.actorId}</p><p className="font-mono text-xs wrap-anywhere">Bút toán: {row.confirmation.journalId}</p>
      <time dateTime={row.confirmation.createdAt} className="text-xs text-gray-600">{dateLabel(row.confirmation.createdAt)} (giờ Việt Nam)</time>
      <p className="text-gray-600">Đây là ghi nhận thủ công của Admin, không phải xác minh tự động từ ngân hàng.</p></div>:<p className="text-gray-600">Chưa có xác nhận chuyển trả.</p>}</div>;
}
function RefundReview({id,sessionId,setLocked}:{id:string;sessionId:string;setLocked:(v:boolean)=>void}) {
  const client=useQueryClient(),form=useRef<HTMLFormElement>(null),inFlight=useRef(false);
  const detail=useQuery({queryKey:["admin-refund-detail",sessionId,id],queryFn:({signal})=>adminRefundsApi.detail(id,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  const [fields,setFields]=useState({reason:"",bankReference:"",evidenceNote:""}),[errors,setErrors]=useState<Partial<Record<keyof typeof fields,string>>>({});
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState(""),[saved,setSaved]=useState(false);
  const attempt=useRef<{body:RefundEvidence;key:string;bookingId:string;amount:string}|null>(null);
  const current=()=>{const s=useAuthStore.getState();return s.sessionId===sessionId&&s.status==="authenticated"&&s.user?.role==="ADMIN"&&s.user.status==="ACTIVE";};
  const mayConfirm=detail.data?.status==="PENDING"&&detail.data.version<2147483647&&!detail.isFetching&&!detail.isError;
  async function confirm() {
    if(inFlight.current||!current())return;
    if(!attempt.current) {
      if(!mayConfirm||!detail.data)return;
      const invalid:typeof errors=reviewFieldErrors(fields);
      if(!fields.bankReference.trim()||fields.bankReference.trim().length>200)invalid.bankReference="Nhập từ 1 đến 200 ký tự.";
      setErrors(invalid);const first=Object.keys(invalid)[0];if(first){form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();return;}
      attempt.current={body:{...fields,expectedVersion:detail.data.version},key:crypto.randomUUID(),bookingId:detail.data.bookingId,amount:detail.data.amount};
    }
    const sent=attempt.current;inFlight.current=true;setBusy(true);setLocked(true);setSaved(false);setMessage("");
    try {
      const result=await adminRefundsApi.confirm(id,sent.body,sent.key);
      if(result.bookingId!==sent.bookingId||result.amount!==sent.amount)throw new ApiError(502,"INVALID_REFUND_RESPONSE","Chưa thể xác nhận kết quả ghi sổ.");
      if(!current())return;
      attempt.current=null;setUncertain(false);setLocked(false);setSaved(true);setFields({reason:"",bankReference:"",evidenceNote:""});
      await client.invalidateQueries({queryKey:["admin-refund-detail",sessionId,id]});void client.invalidateQueries({queryKey:["admin-refunds",sessionId]});
    }catch(failure){
      if(!current())return;
      const error=apiError(failure),replay=bankNeedsReplay(error);setUncertain(replay);setLocked(replay);setErrors(error.fieldErrors);
      setMessage(replay?"Chưa rõ kết quả ghi sổ. Thử lại cùng yêu cầu; không chuyển trả ngân hàng lần nữa và không đổi khoản hoàn.":error.message);
      if(!replay){attempt.current=null;void detail.refetch();void client.invalidateQueries({queryKey:["admin-refunds",sessionId]});}
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const row=detail.data;
  return <div className="space-y-5">{detail.isError?<div className="space-y-3"><Alert>{apiError(detail.error).message}</Alert><Button variant="secondary" onClick={()=>void detail.refetch()}>Thử lại chi tiết</Button></div>
    :!row?<p role="status">Đang tải chi tiết…</p>:<RefundSnapshot row={row}/>}
    <form ref={form} onSubmit={e=>e.preventDefault()} aria-label="Xác nhận khoản hoàn" className="space-y-4 border-t border-gray-200 pt-4">
      <Alert tone="notice">Chỉ xác nhận sau khi đã chuyển trả đúng số tiền và kiểm tra mã giao dịch, chứng cứ bên ngoài.</Alert>
      {message?<Alert>{message}</Alert>:null}{saved?<Alert tone="success">Máy chủ đã ghi nhận thao tác. Xem trạng thái hiện tại ở phần chi tiết.</Alert>:null}
      {uncertain||!row||row.status==="PENDING"?<>{(["reason","bankReference","evidenceNote"] as const).map(name=><Input key={name} id={`refund-${id}-${name}`} name={name}
        label={{reason:"Lý do xác nhận",bankReference:"Mã giao dịch ngân hàng",evidenceNote:"Ghi chú chứng cứ"}[name]} value={fields[name]} error={errors[name]} required maxLength={name==="bankReference"?200:500}
        autoComplete="off" readOnly={busy||uncertain} className="text-base md:text-sm" onChange={e=>{setFields(v=>({...v,[name]:e.target.value}));setErrors(v=>({...v,[name]:undefined}));}}/>)}
        <div className="flex justify-end"><Button type="button" disabled={busy||(!uncertain&&!mayConfirm)} onClick={()=>void confirm()}>{busy?"Đang ghi nhận…":uncertain?"Thử lại cùng yêu cầu":"Xác nhận đã chuyển trả"}</Button></div></>
        :<p className="text-sm text-gray-600">Khoản này không còn chờ xác nhận chuyển trả.</p>}
    </form></div>;
}
