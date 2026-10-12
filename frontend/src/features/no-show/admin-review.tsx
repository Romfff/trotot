"use client";

import {useCallback,useEffect,useRef,useState,type FormEvent} from "react";
import Link from "next/link";
import {LoaderCircle,RotateCw} from "lucide-react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Alert} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {apiError} from "@/lib/api/client";
import {noShowApi,type NoShowDecision,type NoShowDetail,type NoShowResolved} from "@/lib/api/no-show";
import {useAuthStore} from "@/stores/auth-store";
import {bankNeedsReplay} from "@/features/host-finance/bank-form";
import {canResolveNoShow,noShowFieldErrors,type NoShowFields} from "./form";

const dateLabel=(value:string)=>new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value));
const empty:NoShowFields={reason:"",evidenceNote:""};
function Status({resolved}:{resolved:boolean}) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${resolved?"bg-emerald-50 text-emerald-700":"bg-gray-100 text-gray-600"}`}>{resolved?"Đã xác minh":"Chờ xác minh"}</span>;
}
export function AdminNoShowScreen() {
  const {user,status,sessionId}=useAuthStore();
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold text-balance">Xác minh khách không đến</h1><p className="mt-2 max-w-[55ch] text-sm text-gray-600 text-pretty">Xem báo cáo của chủ nhà và ghi nhận bằng chứng sau giờ trả phòng. Không tự hoàn tất đơn hoặc chuyển tiền.</p></header>
    {status==="initializing"?<p role="status">Đang kiểm tra phiên…</p>:status==="unavailable"?<Alert>Chưa kiểm tra được phiên. Hãy tải lại trang.</Alert>
      :!user?<p><Link href="/login" className="text-link underline">Đăng nhập</Link> để xem trang quản trị.</p>
      :user.role!=="ADMIN"||user.status!=="ACTIVE"||!sessionId?<Alert>Trang này chỉ dành cho Admin đang hoạt động.</Alert>:<Reports key={sessionId} sessionId={sessionId}/>}
  </div>;
}
function Reports({sessionId}:{sessionId:string}) {
  const [page,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null),[locked,setLocked]=useState(false);
  const lock=useRef<string|null>(null);
  const setLock=useCallback((id:string,value:boolean)=>{
    if(value&&lock.current!==null&&lock.current!==id)return false;
    if(value){lock.current=id;setLocked(true);}else if(lock.current===id){lock.current=null;setLocked(false);}
    return true;
  },[]);
  const list=useQuery({queryKey:["admin-no-show-reports",sessionId,page],queryFn:({signal})=>noShowApi.list(page,signal),retry:false,gcTime:0,staleTime:0,refetchOnWindowFocus:true});
  return <><section aria-labelledby="no-show-list-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <h2 id="no-show-list-title" className="text-lg font-semibold">Báo cáo của chủ nhà</h2>
    {list.isError?<div className="mt-4 space-y-3"><Alert>{apiError(list.error).message}</Alert><Button variant="secondary" disabled={locked} onClick={()=>void list.refetch()}><RotateCw size={16} aria-hidden="true"/>Thử lại danh sách</Button></div>:null}
    {!list.data&&!list.isError?<p role="status" className="py-6 text-sm text-gray-600">Đang tải báo cáo…</p>:list.data?<div aria-busy={list.isFetching}>
      {list.data.data.length===0?<p className="py-6 text-sm text-gray-600">Chưa có báo cáo ở trang này.</p>:<ul className="mt-4 divide-y divide-gray-200">{list.data.data.map(row=><li key={row.id} data-report-id={row.id} className="space-y-3 py-4">
        <div className="space-y-2"><p className="line-clamp-2 max-w-[55ch] text-sm font-medium text-pretty wrap-anywhere">{row.reason}</p><Status resolved={row.resolved}/></div>
        <p className="font-mono text-xs text-gray-600 wrap-anywhere">ID: {row.id}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><time dateTime={row.reportedAt} className="text-xs text-gray-600 tabular-nums">{dateLabel(row.reportedAt)} (giờ Việt Nam)</time>
          <Button variant="secondary" disabled={locked} aria-pressed={selected===row.id} aria-controls="no-show-detail" onClick={()=>{if(!lock.current)setSelected(row.id);}}>Xem báo cáo</Button></div>
      </li>)}</ul>}
      {list.data.meta.total>0?<footer className="mt-4 flex items-center justify-between gap-2 border-t border-gray-200 pt-4">
        <p className="text-sm text-gray-600 tabular-nums">{list.data.meta.total.toLocaleString("vi-VN")} báo cáo</p>
        {list.data.meta.totalPages>1?<nav aria-label="Phân trang báo cáo" className="flex items-center gap-2">
          <Button variant="secondary" aria-label="Trang trước" disabled={locked||list.isFetching||page<=1} onClick={()=>{if(!lock.current){setSelected(null);setPage(page-1);}}}>‹</Button>
          <span className="text-sm tabular-nums" aria-current="page">{page} / {list.data.meta.totalPages}</span>
          <Button variant="secondary" aria-label="Trang sau" disabled={locked||list.isFetching||page>=list.data.meta.totalPages} onClick={()=>{if(!lock.current){setSelected(null);setPage(page+1);}}}>›</Button>
        </nav>:null}</footer>:null}
    </div>:null}
  </section><section id="no-show-detail" aria-label="Chi tiết báo cáo" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    {selected?<Review key={selected} id={selected} sessionId={sessionId} setLock={setLock}/>:<p className="text-sm text-gray-600">Chọn báo cáo để xem và xác minh.</p>}
  </section></>;
}
export function NoShowSnapshot({row}:{row:NoShowDetail}) {
  const resolution=row.resolution;
  return <div className="space-y-4"><h2 className="text-lg font-semibold">Nội dung báo cáo</h2><dl className="@container space-y-3 text-sm">{[
    ["Mã đơn",row.bookingId],["Lý do chủ nhà",row.reason],["Báo cáo lúc",`${dateLabel(row.reportedAt)} (giờ Việt Nam)`],
    ...(resolution?[["Lý do xác minh",resolution.reason],["Chứng cứ nội bộ",resolution.evidenceNote],["Admin xác minh",resolution.actorId],["Xác minh lúc",`${dateLabel(resolution.resolvedAt)} (giờ Việt Nam)`]]:[]),
  ].map(([label,value])=><div key={label} className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:gap-6 @xl:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-gray-600">{label}</dt><dd className={`min-w-0 font-medium wrap-anywhere ${label==="Mã đơn"||label==="Admin xác minh"?"font-mono":"text-pretty"}`}>{value}</dd></div>)}
    <div className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:gap-6 @xl:grid-cols-[10rem_minmax(0,1fr)] @sm:items-baseline"><dt className="text-gray-600">Trạng thái</dt><dd><Status resolved={!!resolution}/></dd></div>
  </dl></div>;
}
function Review({id,sessionId,setLock}:{id:string;sessionId:string;setLock:(id:string,value:boolean)=>boolean}) {
  const client=useQueryClient(),form=useRef<HTMLFormElement>(null);
  const attempt=useRef<{key:string;bookingId:string;body:NoShowDecision}|null>(null),inFlight=useRef(false),mounted=useRef(false),ownsLock=useRef(false);
  const [fields,setFields]=useState(empty),[errors,setErrors]=useState<Partial<Record<keyof NoShowFields,string>>>({});
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState(""),[receipt,setReceipt]=useState<NoShowResolved|null>(null);
  const detail=useQuery({queryKey:["admin-no-show-detail",sessionId,id],queryFn:({signal})=>noShowApi.detail(id,signal),retry:false,gcTime:0,staleTime:0,refetchOnWindowFocus:true});
  useEffect(()=>{mounted.current=true;return ()=>{mounted.current=false;if(ownsLock.current){setLock(id,false);ownsLock.current=false;}};},[id,setLock]);
  const current=()=>{const state=useAuthStore.getState();return mounted.current&&state.sessionId===sessionId&&state.status==="authenticated"&&state.user?.role==="ADMIN"&&state.user.status==="ACTIVE";};
  const release=()=>{if(ownsLock.current){setLock(id,false);ownsLock.current=false;}};
  const mayAct=!!detail.data&&canResolveNoShow(detail.data)&&!detail.isFetching&&!detail.isError&&!receipt;
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(inFlight.current||!current()||receipt)return;
    if(!attempt.current){
      if(!mayAct||!detail.data)return;
      const invalid=noShowFieldErrors(fields,"admin");setErrors(invalid);const first=Object.keys(invalid)[0];
      if(first){form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();return;}
      if(!setLock(id,true))return;ownsLock.current=true;
      attempt.current={key:crypto.randomUUID(),bookingId:detail.data.bookingId,body:{expectedVersion:detail.data.bookingVersion,decision:"NO_SHOW",...fields}};
    }
    const sent=attempt.current;inFlight.current=true;setBusy(true);setMessage("");
    try {
      const saved=await noShowApi.resolve(sent.bookingId,sent.body,sent.key);if(!current())return;
      attempt.current=null;setReceipt(saved);setUncertain(false);release();
      void client.invalidateQueries({queryKey:["admin-no-show-detail",sessionId,id]});
      void client.invalidateQueries({queryKey:["admin-no-show-reports",sessionId]});
    }catch(failure){
      if(!current())return;const issue=apiError(failure),replay=bankNeedsReplay(issue);setUncertain(replay);setErrors(issue.fieldErrors);
      setMessage(replay?"Chưa xác nhận được kết quả. Giữ nguyên nội dung và thử lại cùng yêu cầu; chưa chuyển sang báo cáo khác.":issue.message);
      if(!replay){attempt.current=null;release();void detail.refetch();void client.invalidateQueries({queryKey:["admin-no-show-reports",sessionId]});}
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const row=detail.data;
  return <div className="space-y-6">
    {detail.isError?<div className="space-y-3"><Alert>{apiError(detail.error).message}</Alert><Button variant="secondary" disabled={busy} onClick={()=>void detail.refetch()}><RotateCw size={16} aria-hidden="true"/>Thử lại chi tiết</Button></div>:null}
    {row?<NoShowSnapshot row={row}/>:!detail.isError?<p role="status" className="text-sm text-gray-600">Đang tải chi tiết…</p>:null}
    {receipt?<p role="status" className="text-sm text-primary-dark text-pretty">Đã ghi nhận xác minh khách không đến; mức hoàn 0đ. Giữ khoản đến {dateLabel(receipt.holdUntil)} (giờ Việt Nam), chưa có chuyển tiền.</p>:null}
    {uncertain||row&&canResolveNoShow(row)&&!receipt?<form ref={form} onSubmit={submit} noValidate aria-label="Xác minh khách không đến" className="space-y-4 border-t border-gray-200 pt-4">
      <p className="max-w-[55ch] text-sm text-gray-600 text-pretty">Chỉ xác nhận khi bằng chứng cho thấy khách không đến. Máy chủ kiểm tra giờ trả phòng và giao dịch; nhánh này không xử lý lưu trú một phần.</p>
      {message?<Alert>{message}</Alert>:null}
      {(["reason","evidenceNote"] as const).map(name=><Input key={name} id={`no-show-${id}-${name}`} name={name} label={name==="reason"?"Lý do xác minh":"Ghi chú chứng cứ"} required value={fields[name]} error={errors[name]}
        hint={fields[name].trim().length>=400?`${fields[name].trim().length}/500 ký tự; tối đa 500 ký tự.`:"Từ 1 đến 500 ký tự. Không nhập số điện thoại hoặc thông tin ngân hàng."}
        readOnly={busy||uncertain} autoComplete="off" className="text-base md:text-sm" onChange={event=>{setFields(previous=>({...previous,[name]:event.target.value}));setErrors(previous=>({...previous,[name]:undefined}));}}/>)}
      <div className="flex justify-end"><Button type="submit" className="w-full sm:w-auto" aria-busy={busy} aria-disabled={busy||!uncertain&&!mayAct} onClick={event=>{if(busy||!uncertain&&!mayAct)event.preventDefault();}}>
        {busy?<LoaderCircle size={16} aria-hidden="true" className="animate-spin motion-reduce:animate-none"/>:null}{busy?"Đang ghi nhận…":uncertain?"Thử lại cùng yêu cầu":"Xác nhận khách không đến"}
      </Button></div>
    </form>:message?<Alert>{message}</Alert>:null}
  </div>;
}
