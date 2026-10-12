"use client";
import {useRef,useState} from "react";
import Link from "next/link";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Alert} from "@/components/ui/alert";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {complaintsApi,type ComplaintInput,type ComplaintResponseInput} from "@/lib/api/complaints";
import {apiError} from "@/lib/api/client";
import {ApiError} from "@/lib/auth-types";
import {useAuthStore} from "@/stores/auth-store";
import {ComplaintSnapshot,ComplaintStatus} from "@/features/admin-finance/complaint-screen";
import {bankNeedsReplay} from "./bank-form";
import {canRequestComplaint,complaintTextError} from "./complaint-form";
import "@/features/homestays/stitch-guest.css";
type Scope={sessionId:string;host:boolean};
export function ComplaintScreen({bookingId}:{bookingId?:string}) {
  const {status,user,sessionId}=useAuthStore(),host=!bookingId;
  const allowed=user?.status==="ACTIVE"&&(host?user.role==="HOST":user.role==="TENANT"||user.role==="HOST");
  return <div className="stitch-workflow-page mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6"><header className="space-y-2"><Link href={host?"/host/bookings":"/bookings"} className="text-link underline">Về danh sách đơn</Link>
    <h1 className="text-xl font-semibold">{host?"Khiếu nại của khách":"Khiếu nại về đơn đặt phòng"}</h1><p className="max-w-[55ch] text-sm text-gray-600 text-pretty">{host?"Xem nội dung và gửi phản hồi để Admin xử lý. Phản hồi không đóng khiếu nại.":"Gửi nội dung để Admin xem xét. Việc gửi khiếu nại không tự hoàn tiền hay hủy đơn."}</p></header>
    {status==="initializing"?<p role="status">Đang kiểm tra phiên…</p>:status==="unavailable"?<Alert>Chưa kiểm tra được phiên. Hãy tải lại trang.</Alert>:!user?<p><Link href="/login" className="text-link underline">Đăng nhập</Link> để xem khiếu nại.</p>
      :!allowed||!sessionId?<Alert>Tài khoản không có quyền xem trang này.</Alert>:host?<HostComplaints key={sessionId} sessionId={sessionId} host/>:<GuestComplaint key={`${sessionId}:${bookingId}`} sessionId={sessionId} host={false} id={bookingId!}/>}</div>;
}
function HostComplaints(scope:Scope) {
  const [page,setPage]=useState(1),[id,setId]=useState<string|null>(null),[locked,setLocked]=useState(false);
  const list=useQuery({queryKey:["host-complaints",scope.sessionId,page],queryFn:({signal})=>complaintsApi.list("host",page,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  return <><section aria-label="Danh sách khiếu nại của khách" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    {list.isError?<><Alert>{apiError(list.error).message}</Alert><Button variant="secondary" className="mt-3" disabled={locked} onClick={()=>void list.refetch()}>Thử lại danh sách</Button></>:!list.data?<p role="status">Đang tải khiếu nại…</p>:<>
      {!list.data.data.length?<p className="text-sm text-gray-600">Chưa có khiếu nại ở trang này.</p>:<ul className="divide-y divide-gray-200">{list.data.data.map(row=><li key={row.id} className="space-y-3 py-4"><p className="max-w-[55ch] line-clamp-2 text-sm font-medium text-pretty">{row.reason}</p><ComplaintStatus row={row}/><p className="text-xs font-mono text-gray-600 wrap-anywhere">ID: {row.id}</p>
        <Button variant="secondary" disabled={locked} aria-pressed={id===row.id} aria-controls="host-complaint-detail" onClick={()=>setId(row.id)}>Xem khiếu nại</Button></li>)}</ul>}
      {list.data.meta.totalPages>1?<nav aria-label="Phân trang khiếu nại" className="mt-4 flex flex-wrap justify-end gap-3"><Button variant="secondary" disabled={locked||page<=1||list.isFetching} onClick={()=>{setId(null);setPage(v=>v-1);}}>Trang trước</Button><span className="text-sm tabular-nums">{page} / {list.data.meta.totalPages}</span><Button variant="secondary" disabled={locked||page>=list.data.meta.totalPages||list.isFetching} onClick={()=>{setId(null);setPage(v=>v+1);}}>Trang sau</Button></nav>:null}
    </>}</section><section id="host-complaint-detail" aria-label="Chi tiết khiếu nại" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">{id?<HostReply key={id} {...scope} id={id} setLocked={setLocked}/>:<p className="text-sm text-gray-600">Chọn khiếu nại để xem lịch sử và phản hồi.</p>}</section></>;
}
function HostReply({id,setLocked,...scope}:Scope&{id:string;setLocked:(v:boolean)=>void}) {
  const detail=useQuery({queryKey:["host-complaint-detail",scope.sessionId,id],queryFn:({signal})=>complaintsApi.hostDetail(id,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  const row=detail.data;
  return <div className="space-y-6">{detail.isError?<><Alert>{apiError(detail.error).message}</Alert><Button variant="secondary" onClick={()=>void detail.refetch()}>Thử lại chi tiết</Button></>:!row?<p role="status">Đang tải chi tiết…</p>:<ComplaintSnapshot key={`${row.id}:${row.version}`} row={row}/>}
    <ComplaintWrite {...scope} id={id} bookingId={row?.bookingId} version={row?.version} allowed={Boolean(row?.status==="OPEN"&&row.version<2147483647&&!detail.isError&&!detail.isFetching)} setLocked={setLocked}/></div>;
}
function GuestComplaint({id,...scope}:Scope&{id:string}) {
  const booking=useQuery({queryKey:["complaint-booking",scope.sessionId,id],queryFn:({signal})=>complaintsApi.ownBooking(id,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  const history=useQuery({queryKey:["guest-complaints",scope.sessionId,id],queryFn:({signal})=>complaintsApi.booking(id,signal),retry:false,gcTime:0,refetchOnWindowFocus:true});
  const hasOpen=Boolean(history.data?.some(row=>row.status==="OPEN"));
  const allowed=Boolean(booking.data&&history.data&&!booking.isError&&!history.isError&&!booking.isFetching&&!history.isFetching&&canRequestComplaint(booking.data,hasOpen));
  return <><section className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-4" aria-label="Gửi khiếu nại">
    {booking.isError||history.isError?<><Alert>{apiError(booking.error||history.error).message}</Alert><Button variant="secondary" onClick={()=>{void booking.refetch();void history.refetch();}}>Thử lại dữ liệu</Button></>:!booking.data||!history.data?<p role="status">Đang tải dữ liệu khiếu nại…</p>:<><p className="text-sm font-medium wrap-anywhere">Mã đơn: {booking.data.bookingCode}</p><p className="max-w-[55ch] text-sm text-gray-600 text-pretty">{hasOpen?"Đơn đang có khiếu nại mở. Theo dõi lịch sử bên dưới.":"Chỉ đơn đã trả tiền và đang được xác nhận, đang lưu trú hoặc hoàn tất mới được gửi. Đơn hoàn tất có thời hạn 72 giờ; máy chủ kiểm tra thời hạn khi gửi."}</p></>}
    <ComplaintWrite {...scope} id={id} bookingId={id} version={booking.data?.version} allowed={allowed}/>
  </section><section aria-label="Lịch sử khiếu nại của đơn" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5 space-y-6">
    <h2 className="text-lg font-semibold">Khiếu nại đã gửi</h2>{history.data?.length===0?<p className="text-sm text-gray-600">Chưa có khiếu nại cho đơn này.</p>:history.data?.map(row=><article key={row.id} className="border-b border-gray-200 pb-6 last:border-0 last:pb-0"><ComplaintSnapshot key={`${row.id}:${row.version}`} row={row}/></article>)}
  </section></>;
}
function ComplaintWrite({id,bookingId,version,allowed,setLocked,...scope}:Scope&{id:string;bookingId?:string;version?:number;allowed:boolean;setLocked?:(v:boolean)=>void}) {
  const [text,setText]=useState(""),[error,setError]=useState<string>(),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[saved,setSaved]=useState(false);
  const form=useRef<HTMLFormElement>(null),flight=useRef(false),attempt=useRef<{key:string;body:ComplaintInput|ComplaintResponseInput;bookingId:string}|null>(null),client=useQueryClient();
  const current=()=>{const s=useAuthStore.getState();return s.sessionId===scope.sessionId&&s.status==="authenticated"&&s.user?.status==="ACTIVE"&&(scope.host?s.user.role==="HOST":s.user.role==="TENANT"||s.user.role==="HOST");};
  async function send() {
    if(flight.current||!current())return;
    if(!attempt.current){if(!allowed||!bookingId||!version||version>=2147483647)return;const invalid=complaintTextError(text);setError(invalid);if(invalid){form.current?.querySelector<HTMLInputElement>("input")?.focus();return;}attempt.current={key:crypto.randomUUID(),bookingId,body:scope.host?{expectedVersion:version,message:text}:{expectedVersion:version,reason:text}};}
    const sent=attempt.current;flight.current=true;setBusy(true);setLocked?.(true);setSaved(false);setMessage("");
    try {const result=scope.host?await complaintsApi.respond(id,sent.body as ComplaintResponseInput,sent.key):await complaintsApi.create(id,sent.body as ComplaintInput,sent.key);
      if(result.bookingId!==sent.bookingId)throw new ApiError(502,"INVALID_COMPLAINT_RESPONSE","Chưa thể xác nhận kết quả xử lý.");if(!current())return;
      attempt.current=null;setUncertain(false);setLocked?.(false);setText("");setSaved(true);
      if(scope.host){await client.invalidateQueries({queryKey:["host-complaint-detail",scope.sessionId,id]});void client.invalidateQueries({queryKey:["host-complaints",scope.sessionId]});}
      else {await client.invalidateQueries({queryKey:["guest-complaints",scope.sessionId,id]});void client.invalidateQueries({queryKey:["complaint-booking",scope.sessionId,id]});}
    }catch(failure){if(!current())return;const e=apiError(failure),replay=bankNeedsReplay(e);setUncertain(replay);setLocked?.(replay);setMessage(replay?"Chưa rõ kết quả gửi. Thử lại cùng yêu cầu; không sửa nội dung hoặc rời trang.":e.message);if(!replay){attempt.current=null;void client.invalidateQueries({queryKey:[scope.host?"host-complaint-detail":"guest-complaints",scope.sessionId,id]});if(!scope.host)void client.invalidateQueries({queryKey:["complaint-booking",scope.sessionId,id]});}}
    finally{flight.current=false;if(current())setBusy(false);}
  }
  return <form ref={form} aria-label={scope.host?"Gửi phản hồi khiếu nại":"Tạo khiếu nại"} onSubmit={e=>{e.preventDefault();void send();}} className="space-y-4 border-t border-gray-200 pt-4">
    {message?<Alert>{message}</Alert>:null}{saved?<Alert tone="success">Máy chủ đã ghi nhận. Trạng thái hiện tại nằm trong lịch sử.</Alert>:null}
    <Input id={`complaint-text-${id}`} name={scope.host?"message":"reason"} label={scope.host?"Nội dung phản hồi":"Nội dung khiếu nại"} value={text} error={error} maxLength={500} autoComplete="off" readOnly={busy||uncertain} className="text-base md:text-sm" onChange={e=>{setText(e.target.value);setError(undefined);}}/>
    <p className="text-xs text-gray-600">Tối đa 500 ký tự. Không nhập mật khẩu hoặc thông tin ngân hàng.</p>
    <div className="flex justify-end"><Button type="submit" disabled={busy||!uncertain&&!allowed}>{busy?"Đang gửi…":uncertain?"Thử lại cùng yêu cầu":scope.host?"Gửi phản hồi":"Gửi khiếu nại"}</Button></div>
  </form>;
}
