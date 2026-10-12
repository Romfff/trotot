"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {FileText,MessageSquare,UserRoundCheck,Check} from "lucide-react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Alert} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {apiError} from "@/lib/api/client";
import {ApiError} from "@/lib/auth-types";
import {complaintsApi,type ComplaintDetail,type AdminComplaintDetail,type ComplaintAssignInput,type ComplaintResolveInput} from "@/lib/api/complaints";
import {useAuthStore} from "@/stores/auth-store";
import {bankNeedsReplay} from "@/features/host-finance/bank-form";
import {complaintFieldErrors,emptyRefund,refundFieldErrors,refundLabels,resolveComplaintBody,type RefundFields,type ComplaintFields} from "./complaint-form";
import {FinanceRecordAction} from './record-action';
const empty:ComplaintFields={assigneeId:"",reason:"",evidenceNote:""};
const bookingLabels:Record<string,string>={PENDING_HOST_APPROVAL:"Chờ chủ nhà duyệt",PENDING_PAYMENT:"Chờ thanh toán",CONFIRMED:"Đã xác nhận",CHECKED_IN:"Đã nhận phòng",COMPLETED:"Đã hoàn thành",
  CANCELLED:"Đã hủy",CANCELLED_BY_GUEST:"Khách đã hủy",REJECTED_BY_HOST:"Chủ nhà từ chối",CANCELLED_HOST_TIMEOUT:"Hủy do chủ nhà quá hạn phản hồi",CANCELLED_TIMEOUT:"Hủy do hết hạn thanh toán"};
const paymentLabels:Record<string,string>={NOT_CONFIGURED:"Chưa kết nối thanh toán",PENDING:"Chờ thanh toán",PAID:"Đã ghi nhận thanh toán",REFUNDED:"Đã ghi nhận hoàn tiền"};
const dateLabel=(v:string)=>new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",dateStyle:"short",timeStyle:"short"}).format(new Date(v));
const labels={CREATED:"Khách mở khiếu nại",RESPONDED:"Chủ nhà phản hồi",ASSIGNED:"Phân công xử lý",RESOLVED:"Đã chốt quyết định"};
const icons={CREATED:FileText,RESPONDED:MessageSquare,ASSIGNED:UserRoundCheck,RESOLVED:Check};
type Attempt={key:string;bookingId:string}&({action:"assign";body:ComplaintAssignInput}|{action:"resolve";body:ComplaintResolveInput});
export function ComplaintStatus({row}:{row:Pick<ComplaintDetail,"status"|"overdue">}) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${row.status==="RESOLVED"?"bg-emerald-50 text-emerald-700":row.overdue?"bg-amber-50 text-amber-700":"bg-gray-100 text-gray-600"}`}>
    {row.status==="RESOLVED"?"Đã xử lý":row.overdue?"Quá hạn xử lý 7 ngày":"Đang mở"}</span>;
}
export function AdminComplaintScreen() {
  const {user,status,sessionId}=useAuthStore();
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6"><header><h1 className="text-xl font-semibold">Xử lý khiếu nại</h1>
    <p className="mt-2 max-w-[55ch] text-sm text-gray-600 text-pretty">Kiểm tra lịch sử, phân công Admin và duyệt khoản hoàn. Thao tác này không chuyển tiền hay hoàn tất lưu trú.</p></header>
    {status==="initializing"?<p role="status">Đang kiểm tra phiên…</p>:status==="unavailable"?<Alert>Chưa kiểm tra được phiên. Hãy tải lại trang.</Alert>
      :!user?<p><Link href="/login" className="text-link underline">Đăng nhập</Link> để xem trang quản trị.</p>
      :user.role!=="ADMIN"||user.status!=="ACTIVE"||!sessionId?<Alert>Trang này chỉ dành cho Admin đang hoạt động.</Alert>:<Complaints key={sessionId} sessionId={sessionId}/>}</div>;
}
function Complaints({sessionId}:{sessionId:string}) {
  const [page,setPage]=useState(1),[selected,setSelected]=useState<string|null>(null),[locked,setLocked]=useState(false);
  const list=useQuery({queryKey:["admin-complaints",sessionId,page],queryFn:({signal})=>complaintsApi.list("admin",page,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  return <><FinanceRecordAction kind="late" sessionId={sessionId} onCreated={id=>{setPage(1);setSelected(id);}}/><section aria-labelledby="complaint-list-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5"><h2 id="complaint-list-title" className="text-lg font-semibold">Danh sách khiếu nại</h2>
    {list.isError?<div className="mt-4 space-y-3"><Alert>{apiError(list.error).message}</Alert><Button variant="secondary" disabled={locked} onClick={()=>void list.refetch()}>Thử lại danh sách</Button></div>
      :!list.data?<p role="status" className="py-4">Đang tải khiếu nại…</p>:<div aria-busy={list.isFetching}>
        {list.data.data.length===0?<p className="py-6 text-sm text-gray-600">Chưa có khiếu nại ở trang này.</p>:<ul className="mt-4 divide-y divide-gray-200">{list.data.data.map(row=><li key={row.id} className="space-y-3 py-4">
          <div className="space-y-1"><p className="line-clamp-2 max-w-[55ch] text-sm font-medium text-pretty">{row.reason}</p><ComplaintStatus row={row}/></div>
          <p className="font-mono text-xs text-gray-600 wrap-anywhere">ID: {row.id}</p>
          <div className="flex flex-wrap items-center justify-between gap-3"><time dateTime={row.createdAt} className="text-xs text-gray-600 tabular-nums">{dateLabel(row.createdAt)} (giờ Việt Nam)</time>
            <Button variant="secondary" disabled={locked} aria-pressed={selected===row.id} aria-controls="complaint-detail" onClick={()=>setSelected(row.id)}>Xem khiếu nại</Button></div>
        </li>)}</ul>}
        {list.data.meta.totalPages>1?<nav aria-label="Phân trang khiếu nại" className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <Button variant="secondary" disabled={locked||list.isFetching||page<=1} onClick={()=>{setSelected(null);setPage(page-1);}}>Trang trước</Button>
          <span className="text-sm tabular-nums" aria-current="page">{page} / {list.data.meta.totalPages}</span>
          <Button variant="secondary" disabled={locked||list.isFetching||page>=list.data.meta.totalPages} onClick={()=>{setSelected(null);setPage(page+1);}}>Trang sau</Button></nav>:null}
      </div>}</section>
    <section id="complaint-detail" aria-label="Chi tiết khiếu nại" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      {selected?<ComplaintReview key={selected} id={selected} sessionId={sessionId} setLocked={setLocked}/>:<p className="text-sm text-gray-600">Chọn khiếu nại để xem lịch sử và xử lý.</p>}
    </section></>;
}
export function ComplaintSnapshot({row}:{row:ComplaintDetail|AdminComplaintDetail}) {
  const [visible,setVisible]=useState(10),events=[...row.events].reverse(),resolution=row.resolution;
  return <div className="space-y-6">{row.settlementReviewStatus==="PENDING"?<Alert tone="notice">Đang đối soát</Alert>:null}<h2 className="text-lg font-semibold">Nội dung khiếu nại</h2><dl className="@container space-y-3 text-sm">{[
    ["Booking",row.bookingId],["Lý do",row.reason],["Admin phụ trách",row.assigneeId||"—"],["Mở lúc",`${dateLabel(row.createdAt)} (giờ Việt Nam)`],
  ].map(([label,value])=><div key={label} className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:gap-6 @xl:grid-cols-[10rem_minmax(0,1fr)]"><dt className="text-gray-600">{label}</dt><dd className={`min-w-0 font-medium wrap-anywhere ${label==="Booking"||label==="Admin phụ trách"?"font-mono":"text-pretty"}`}>{value}</dd></div>)}
    <div className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:gap-6 @xl:grid-cols-[10rem_minmax(0,1fr)] @sm:items-baseline"><dt className="text-gray-600">Trạng thái</dt><dd><ComplaintStatus row={row}/></dd></div></dl>
    <div><h3 className="mb-4 text-base font-semibold">Lịch sử xử lý</h3>{events.length===0?<p className="text-sm text-gray-600">Chưa có lịch sử.</p>:<ol className="text-sm">{events.slice(0,visible).map((event,index)=>{
      const Icon=icons[event.action];return <li key={event.id} className="relative flex gap-3 pb-6 last:pb-0">
        {index<Math.min(events.length,visible)-1?<span aria-hidden="true" className="absolute top-10 bottom-1 left-[15px] w-0.5 bg-gray-200"/>:null}
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${event.action==="RESOLVED"?"bg-emerald-50 text-emerald-700":"bg-gray-100 text-gray-600"}`}><Icon size={16} aria-hidden="true"/></span>
        <div className="min-w-0 flex-1 pt-1.5"><div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"><p className="font-medium">{labels[event.action]}</p>
          <time dateTime={event.createdAt} className="shrink-0 text-xs whitespace-nowrap text-gray-600 tabular-nums">{dateLabel(event.createdAt)}</time></div><p className="mt-1 max-w-[55ch] text-gray-600 text-pretty wrap-anywhere">{event.message}</p></div>
      </li>;
    })}</ol>}{events.length>visible?<Button variant="plain" className="mt-4" onClick={()=>setVisible(v=>v+10)}>Xem hoạt động cũ hơn</Button>:null}</div>
    {resolution?<div className="space-y-2"><h3 className="text-base font-semibold">{resolution.decision==="HOST"?"Quyết định cho chủ nhà":resolution.decision==="FULL_REFUND"?"Hoàn toàn bộ":"Hoàn một phần"}</h3><p className="text-sm text-pretty wrap-anywhere">{resolution.reason}</p>
      {resolution.refundObligation?<><p className="text-sm font-medium tabular-nums">Khoản hoàn: {BigInt(resolution.refundObligation.amount).toLocaleString("vi-VN")}đ</p>
        <p className="text-sm text-gray-600">{resolution.refundObligation.status==="PENDING"?"Chờ Admin chuyển trả và xác nhận bằng chứng. Chưa xác nhận đã hoàn tiền.":"Admin đã ghi nhận bằng chứng chuyển trả thủ công."}</p>
        {resolution.holdUntil?<p className="text-sm text-gray-600">Phần Host giữ lại chờ đến {dateLabel(resolution.holdUntil)} (giờ Việt Nam); vẫn phải đủ điều kiện chi trả.</p>:null}</>:null}
      {"evidenceNote" in resolution?<><p className="text-sm text-gray-600 text-pretty wrap-anywhere">Chứng cứ nội bộ: {resolution.evidenceNote}</p><p className="font-mono text-xs text-gray-600 wrap-anywhere">Admin chốt: {resolution.actorId}</p></>:null}
      <time dateTime={resolution.resolvedAt} className="text-xs text-gray-600 tabular-nums">{dateLabel(resolution.resolvedAt)} (giờ Việt Nam)</time></div>:null}
  </div>;
}
function ComplaintReview({id,sessionId,setLocked}:{id:string;sessionId:string;setLocked:(v:boolean)=>void}) {
  const client=useQueryClient(),form=useRef<HTMLFormElement>(null),inFlight=useRef(false),attempt=useRef<Attempt|null>(null);
  const detail=useQuery({queryKey:["admin-complaint-detail",sessionId,id],queryFn:({signal})=>complaintsApi.adminDetail(id,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  const [fields,setFields]=useState(empty),[errors,setErrors]=useState<Partial<Record<keyof ComplaintFields,string>>>({});
  const [refund,setRefund]=useState(emptyRefund),[refundErrors,setRefundErrors]=useState<Partial<Record<keyof RefundFields,string>>>({});
  const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[message,setMessage]=useState(""),[saved,setSaved]=useState(false);
  const current=()=>{const s=useAuthStore.getState();return s.sessionId===sessionId&&s.status==="authenticated"&&s.user?.role==="ADMIN"&&s.user.status==="ACTIVE";};
  const mayAct=detail.data?.status==="OPEN"&&detail.data.version<2147483647&&!detail.isFetching&&!detail.isError;
  async function act(action:"assign"|"resolve") {
    if(inFlight.current||!current())return;
    if(!attempt.current) {
      if(!mayAct||!detail.data)return;
      if(action==="resolve"&&detail.data.settlementReview){setMessage("Khoản đang đối soát; chưa có thao tác chốt trên web.");return;}
      if(action==="resolve"&&refund.decision!=="HOST"&&(!detail.data.bookingSnapshot||detail.data.bookingSnapshot.reviewRequired||refund.expectedBookingVersion!==String(detail.data.bookingSnapshot.version))) {
        setRefund(v=>({...v,expectedBookingVersion:""}));setMessage("Snapshot đơn đã thay đổi hoặc cần đối soát. Xem lại dữ liệu trước khi duyệt hoàn.");return;
      }
      const invalid=complaintFieldErrors(fields,action),invalidRefund=action==="resolve"?refundFieldErrors(refund):{};
      setErrors(invalid);setRefundErrors(invalidRefund);const first=Object.keys({...invalid,...invalidRefund})[0];
      if(first){form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();return;}
      const shared={expectedVersion:detail.data.version,reason:fields.reason};
      attempt.current={key:crypto.randomUUID(),bookingId:detail.data.bookingId,...(action==="assign"?{action,body:{...shared,assigneeId:fields.assigneeId.trim()}}:{action,body:resolveComplaintBody(fields,refund,detail.data.version)})};
    }
    const sent=attempt.current;inFlight.current=true;setBusy(true);setLocked(true);setSaved(false);setMessage("");
    try {
      const result=sent.action==="assign"?await complaintsApi.assign(id,sent.body,sent.key):await complaintsApi.resolve(id,sent.body,sent.key);
      if(result.bookingId!==sent.bookingId)throw new ApiError(502,"INVALID_COMPLAINT_RESPONSE","Chưa thể xác nhận kết quả xử lý.");
      if(!current())return;
      attempt.current=null;setUncertain(false);setLocked(false);setSaved(true);setFields(empty);setRefund(emptyRefund);setRefundErrors({});
      await client.invalidateQueries({queryKey:["admin-complaint-detail",sessionId,id]});void client.invalidateQueries({queryKey:["admin-complaints",sessionId]});
    }catch(failure){
      if(!current())return;const error=apiError(failure),replay=bankNeedsReplay(error);setUncertain(replay);setLocked(replay);setErrors(error.fieldErrors);
      setMessage(replay?"Chưa rõ kết quả xử lý. Thử lại cùng yêu cầu; không đổi khiếu nại, nội dung hay thao tác.":error.message);
      if(error.errorCode==="STALE_BOOKING_VERSION"||error.errorCode==="STALE_COMPLAINT_VERSION")setRefund(v=>({...v,expectedBookingVersion:""}));
      if(!replay){attempt.current=null;void detail.refetch();void client.invalidateQueries({queryKey:["admin-complaints",sessionId]});}
    }finally{inFlight.current=false;if(current())setBusy(false);}
  }
  const row=detail.data;
  return <div className="space-y-6">{detail.isError?<div className="space-y-3"><Alert>{apiError(detail.error).message}</Alert><Button variant="secondary" onClick={()=>void detail.refetch()}>Thử lại chi tiết</Button></div>
    :!row?<p role="status">Đang tải chi tiết…</p>:<><ComplaintSnapshot key={`${row.id}-${row.version}`} row={row}/>
      {row.lateCase?<Alert tone="notice">{row.lateCase.caseLabel}. Bằng chứng nội bộ: {row.lateCase.evidenceNote}</Alert>:null}
      {row.settlementReview?<section aria-label="Đối soát khoản đã bù và đã chi" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h3 className="font-semibold">Đang đối soát{row.overdue?" · quá 7 ngày":""}</h3>
        <p className="max-w-[65ch] text-sm">Khoản đã bù nợ và chi trả: tạm khóa hoàn tự động và lô mới. Chưa có thao tác chốt trên web; không tự tạo nợ hay đảo bù.</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">{([
          ["Phần Host gốc",row.settlementReview.originalHostAmount],["Đã bù nợ",row.settlementReview.offsetAmount],
          ["Đã chi trả",row.settlementReview.paidAmount],["Phần có thể vượt tiền đã chi khi hoàn toàn bộ",row.settlementReview.potentialExcessAmount],
        ] as const).map(([label,value])=><div key={label}><dt className="text-gray-600">{label}</dt><dd className="font-semibold tabular-nums">{BigInt(value).toLocaleString("vi-VN")}đ</dd></div>)}</dl>
      </section>:null}
      <section aria-label="Snapshot đơn cho Admin" className="space-y-4"><h3 className="text-base font-semibold">Dữ liệu đơn đã lưu</h3>
        <dl className="@container space-y-3 text-sm">{[
          ["Trạng thái đơn",bookingLabels[row.bookingSnapshot.bookingStatus]],["Thanh toán",paymentLabels[row.bookingSnapshot.paymentStatus]],
          ["Trả phòng",row.bookingSnapshot.checkoutAt?`${dateLabel(row.bookingSnapshot.checkoutAt)} (giờ Việt Nam)`:"Thiếu mốc trả phòng"],
          ...Object.entries(refundLabels).map(([name,label])=>[label.replace(" hoàn (đ)",""),`${BigInt(row.bookingSnapshot.amounts[name as keyof typeof refundLabels]).toLocaleString("vi-VN")}đ gốc · còn ${row.bookingSnapshot.remainingRefundableAmounts?`${BigInt(row.bookingSnapshot.remainingRefundableAmounts[name as keyof typeof refundLabels]).toLocaleString("vi-VN")}đ`:"cần đối soát"}`]),
          ["Tổng giá đã lưu",`${BigInt(row.bookingSnapshot.amounts.totalAmount).toLocaleString("vi-VN")}đ`],
          ["Đã xác nhận chuyển trả",`${BigInt(row.bookingSnapshot.refundedAmount).toLocaleString("vi-VN")}đ`],
          ["Khoản hoàn đang chờ trả",`${BigInt(row.bookingSnapshot.pendingRefundAmount).toLocaleString("vi-VN")}đ`],
        ].map(([label,value])=><div key={label} className="grid gap-1 @sm:grid-cols-[10rem_minmax(0,1fr)] @sm:items-baseline @sm:gap-6"><dt className="text-gray-600 text-pretty">{label}</dt><dd className="min-w-0 font-medium tabular-nums wrap-anywhere">{value}</dd></div>)}</dl>
        {row.bookingSnapshot.reviewRequired?<Alert>Chứng cứ tài chính cần đối soát; chưa thể duyệt khoản hoàn từ snapshot này.</Alert>:null}
      </section></>}
    <form ref={form} onSubmit={e=>e.preventDefault()} aria-label="Xử lý khiếu nại" className="space-y-4 border-t border-gray-200 pt-4">
      <Alert tone="notice" className="text-pretty">Duyệt hoàn tạo khoản chờ chuyển trả, không tự chuyển tiền. Hoàn toàn bộ hủy phần lưu trú còn hiệu lực; hoàn một phần giữ lịch và trạng thái đơn.</Alert>
      {message?<Alert>{message}</Alert>:null}{saved?<Alert tone="success">Máy chủ đã ghi nhận thao tác. Xem lịch sử và trạng thái hiện tại ở trên.</Alert>:null}
      {uncertain||!row||row.status==="OPEN"?<><Input id={`complaint-${id}-assigneeId`} name="assigneeId" label="UUID Admin phụ trách (khi phân công)" value={fields.assigneeId} error={errors.assigneeId}
        autoComplete="off" maxLength={36} readOnly={busy||uncertain} className="text-base md:text-sm" onChange={e=>{setFields(v=>({...v,assigneeId:e.target.value}));setErrors(v=>({...v,assigneeId:undefined}));}}/>
        {(["reason","evidenceNote"] as const).map(name=><Input key={name} id={`complaint-${id}-${name}`} name={name} label={name==="reason"?"Lý do xử lý":"Ghi chú chứng cứ (khi chốt quyết định)"} value={fields[name]} error={errors[name]} autoComplete="off" maxLength={500}
          readOnly={busy||uncertain} className="text-base md:text-sm" onChange={e=>{setFields(v=>({...v,[name]:e.target.value}));setErrors(v=>({...v,[name]:undefined}));}}/>)}
        <fieldset disabled={busy||uncertain} className="space-y-3"><legend className="mb-2 text-sm font-medium">Quyết định xử lý</legend>
          {([["HOST","Quyết định cho chủ nhà"],["FULL_REFUND","Hoàn toàn bộ"],["PARTIAL_REFUND","Hoàn một phần"]] as const).map(([value,label])=><label key={value} className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm has-disabled:opacity-50">
            <input type="radio" name="decision" value={value} checked={refund.decision===value} onChange={()=>{setRefund(v=>({...v,decision:value,expectedBookingVersion:v.expectedBookingVersion||String(row?.bookingSnapshot.version??"")}));setRefundErrors({});}}
              className="size-5 shrink-0 cursor-pointer appearance-none rounded-full border border-gray-300 bg-white checked:border-[6px] checked:border-primary disabled:cursor-not-allowed"/>{label}</label>)}
        </fieldset>
        {refund.decision!=="HOST"?<div className="space-y-4"><p className="max-w-[65ch] text-sm text-gray-600 text-pretty">Đối chiếu snapshot và phiên bản đơn trước khi nhập. Máy chủ kiểm từng khoản; không tự suy số tiền. Hoàn một phần phải để phí dịch vụ bằng 0.</p>
          <p className="text-sm text-gray-600">Phiên bản đang đối chiếu: {refund.expectedBookingVersion||"cần xem lại snapshot"}. Máy chủ vẫn kiểm tra phiên bản và trần hoàn.</p>
          {row&&refund.expectedBookingVersion!==String(row.bookingSnapshot.version)?<Button type="button" variant="secondary" name="expectedBookingVersion" disabled={busy||uncertain||!mayAct||row.bookingSnapshot.reviewRequired}
            onClick={()=>{setRefund(v=>({...v,expectedBookingVersion:String(row.bookingSnapshot.version)}));setRefundErrors({});setMessage("");}}>Đã xem lại snapshot đơn</Button>:null}
          {(Object.keys(refundLabels) as (keyof typeof refundLabels)[]).map(name=><Input key={name} id={`complaint-${id}-${name}`} name={name} label={refundLabels[name]} inputMode="numeric" value={refund[name]} error={refundErrors[name]} hint="Số nguyên VND; không hoàn khoản này thì nhập 0."
            readOnly={busy||uncertain} className="text-base md:text-sm" onChange={e=>{setRefund(v=>({...v,[name]:e.target.value}));setRefundErrors(v=>({...v,[name]:undefined}));}}/>)}</div>:null}
        <div className="flex flex-wrap justify-end gap-3">{uncertain?<Button type="button" disabled={busy} onClick={()=>void act(attempt.current!.action)}>{busy?"Đang ghi nhận…":"Thử lại cùng yêu cầu"}</Button>
          :<><Button type="button" variant="secondary" disabled={busy||!mayAct} onClick={()=>void act("assign")}>Phân công</Button><Button type="button" disabled={busy||!mayAct||!!row?.settlementReview||refund.decision!=="HOST"&&(!row||row.bookingSnapshot.reviewRequired||refund.expectedBookingVersion!==String(row.bookingSnapshot.version))} onClick={()=>void act("resolve")}>{busy?"Đang ghi nhận…":refund.decision==="HOST"?"Chốt quyết định cho chủ nhà":"Duyệt khoản hoàn"}</Button></>}</div></>
        :<p className="text-sm text-gray-600">Khiếu nại đã xử lý, không còn thao tác phân công hay chốt lại.</p>}
    </form></div>;
}
