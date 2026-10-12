"use client";
import { useEffect,useRef,useState,type ReactNode,type FormEvent } from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { ChevronLeft,ChevronRight,RotateCw,ShieldCheck,ShieldOff } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { adminApi,type AdminUser,type Dashboard } from '@/lib/api/admin';
import { apiError } from '@/lib/api/client';

export const listingStatusLabel:Record<string,string>={DRAFT:'Nháp',PENDING_REVIEW:'Chờ duyệt',PUBLISHED:'Đang hiển thị',HIDDEN:'Tạm ẩn',REJECTED:'Bị từ chối',EXPIRED:'Hết hạn'};
function Loading(){return <div role="status" aria-label="Đang tải quản trị" aria-busy="true" className="space-y-3 py-5"><span className="sr-only">Đang tải dữ liệu</span>{[1,2,3].map(n=><div key={n} aria-hidden="true" className="h-12 rounded-xl bg-bg motion-safe:animate-pulse" />)}</div>;}
function ReadError({error,retry}:{error:unknown;retry:()=>void}){return <div className="space-y-3 py-4"><Alert>{apiError(error).message}</Alert><Button variant="secondary" onClick={retry}><RotateCw size={16} aria-hidden="true"/>Thử lại</Button></div>;}
export function AdminAccess({children}:{children:(sessionId:string,userId:string)=>ReactNode}){
  const {user,status,sessionId}=useAuthStore();
  return status==='initializing'?<Loading/>:status==='unavailable'?<Alert>Chưa kiểm tra được phiên đăng nhập. Hãy tải lại trang.</Alert>
    :!user?<Link className="button" href="/login">Đăng nhập</Link>:user.role!=='ADMIN'||user.status!=='ACTIVE'||!sessionId?<Alert>Trang này chỉ dành cho Admin đang hoạt động.</Alert>:children(sessionId,user.id);
}
export function AdminNavigation(){const pathname=usePathname();return <nav aria-label="Quản trị" className="flex flex-wrap gap-2 text-sm">
  {[['/admin','Tổng quan'],['/admin/users','Người dùng'],['/admin/properties','Duyệt tin trọ'],['/admin/homestays','Duyệt homestay'],['/admin/finance/complaints','Khiếu nại'],['/admin/finance/refunds','Hoàn tiền'],['/admin/finance/payouts','Chi trả']].map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} className={`inline-flex min-h-11 items-center border-b-2 px-3 hover:bg-brand-tint ${pathname===href?'border-brand font-medium text-brand':'border-transparent'}`}>{label}</Link>)}
</nav>;}
export function AdminUsersScreen(){return <section className="mx-auto max-w-5xl space-y-6 px-4 py-8"><header><h1 className="text-xl font-semibold">Quản lý người dùng</h1><p className="mt-2 max-w-[65ch] text-sm text-gray-600">Khóa hoặc mở tài khoản có lý do. Khóa thu hồi phiên, không xóa đơn hay sổ tiền.</p></header><AdminNavigation/>
  <AdminAccess>{(sessionId,userId)=><Users key={sessionId} sessionId={sessionId} actorId={userId}/>}</AdminAccess></section>;}
function Users({sessionId,actorId}:{sessionId:string;actorId:string}){
  const [page,setPage]=useState(1),[role,setRole]=useState(''),[status,setStatus]=useState(''),[selected,setSelected]=useState<AdminUser|null>(null);
  const client=useQueryClient();
  const trigger=useRef<HTMLButtonElement|null>(null);
  const users=useQuery({queryKey:['admin-users',sessionId,page,role,status],queryFn:({signal})=>adminApi.users(page,role,status,signal),retry:false,gcTime:0});
  return <>
    <div className="flex flex-wrap items-end gap-3"><label className="grid gap-2 text-sm">Vai trò<select value={role} onChange={e=>{setRole(e.target.value);setPage(1);}} className="field-control text-base md:text-sm"><option value="">Tất cả</option><option value="TENANT">Tenant</option><option value="HOST">Host</option><option value="ADMIN">Admin</option></select></label>
      <label className="grid gap-2 text-sm">Trạng thái<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}} className="field-control text-base md:text-sm"><option value="">Tất cả</option><option value="ACTIVE">Đang hoạt động</option><option value="BANNED">Đã khóa</option></select></label>
      <Button variant="secondary" disabled={users.isFetching} onClick={()=>void users.refetch()}><RotateCw size={16} aria-hidden="true"/>Tải lại</Button></div>
    <div className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      {users.error?<ReadError error={users.error} retry={()=>void users.refetch()}/>:!users.data?<Loading/>:<>
        <p className="text-sm text-gray-600">{users.data.meta.total} tài khoản · trang {page}/{Math.max(1,users.data.meta.totalPages)}</p>
        {users.data.data.length===0?<p className="py-6 text-sm text-gray-600">Không có tài khoản phù hợp bộ lọc.</p>:<ul className="mt-3 divide-y divide-gray-200">{users.data.data.map(row=><li key={row.id} className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{row.fullName}</h2>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${row.status==='ACTIVE'?'bg-emerald-50 text-emerald-700':row.status==='BANNED'?'bg-red-50 text-red-700':'bg-gray-100 text-gray-600'}`}>
                {row.status==='ACTIVE'?'Đang hoạt động':row.status==='BANNED'?'Đã khóa':row.status||'Chưa xác định'}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-600">{row.role}{row.id===actorId?' · Tài khoản của bạn':''}</p>
          </div>
          {row.id!==actorId&&['ACTIVE','BANNED'].includes(row.status||'')&&<Button variant="secondary" onClick={event=>{trigger.current=event.currentTarget;setSelected(row);}}>{row.status==='ACTIVE'?<ShieldOff size={16} aria-hidden="true"/>:<ShieldCheck size={16} aria-hidden="true"/>}{row.status==='ACTIVE'?'Khóa tài khoản':'Mở tài khoản'}</Button>}
        </li>)}</ul>}
        {users.data.meta.totalPages>1&&<nav aria-label="Phân trang người dùng" className="mt-4 flex items-center justify-end gap-2"><Button variant="secondary" size="icon" aria-label="Người dùng trang trước" disabled={page<=1||users.isFetching} onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></Button><span className="text-sm tabular-nums">{page}/{users.data.meta.totalPages}</span><Button variant="secondary" size="icon" aria-label="Người dùng trang sau" disabled={page>=users.data.meta.totalPages||users.isFetching} onClick={()=>setPage(page+1)}><ChevronRight size={16}/></Button></nav>}
      </>}
    </div>
    {selected&&<ModerateUser key={selected.id+selected.status} user={selected} sessionId={sessionId} restoreFocus={()=>trigger.current?.isConnected&&trigger.current.focus()} close={()=>setSelected(null)} saved={()=>{setSelected(null);void client.invalidateQueries({queryKey:['admin-users',sessionId]});}}/>}
  </>;
}
function ModerateUser({user,sessionId,close,saved,restoreFocus}:{user:AdminUser;sessionId:string;close:()=>void;saved:()=>void;restoreFocus:()=>void}){
  const [reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[stale,setStale]=useState(false);
  const pending=useRef(false),input=useRef<HTMLTextAreaElement>(null);
  const mounted=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
  const current=()=>{const auth=useAuthStore.getState();return mounted.current&&auth.sessionId===sessionId&&auth.user?.role==='ADMIN'&&auth.user.status==='ACTIVE';};
  const ban=user.status==='ACTIVE';
  async function submit(event:FormEvent){event.preventDefault();if(pending.current||stale)return;const value=reason.trim();
    if(!value||value.length>500){setError('Nhập lý do từ 1 đến 500 ký tự.');input.current?.focus();return;}
    if(!current())return;pending.current=true;controller.current=new AbortController();setBusy(true);setError('');
    try{await adminApi.moderate(user,value,controller.current.signal);if(current())saved();}
    catch(failure){if(!current())return;const result=apiError(failure);setError(result.message);if(result.errorCode==='STALE_USER_STATUS')setStale(true);}
    finally{pending.current=false;if(current())setBusy(false);}
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)close();}}><DialogContent onCloseAutoFocus={event=>{event.preventDefault();restoreFocus();}} onInteractOutside={event=>event.preventDefault()} onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
    <DialogHeader><DialogTitle>{ban?'Khóa tài khoản':'Mở tài khoản'}</DialogTitle><DialogDescription>{user.fullName}. {ban?'Các phiên đăng nhập sẽ bị thu hồi; tin của Host sẽ ngừng hiển thị.':'Người dùng cần đăng nhập lại; phiên cũ không được khôi phục.'}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4"><label htmlFor="admin-user-reason" className="block text-sm font-medium">Lý do</label><textarea ref={input} id="admin-user-reason" name="reason" required maxLength={500} rows={3} value={reason} readOnly={busy||stale} onChange={e=>setReason(e.target.value)} className="field-control w-full text-base md:text-sm"/>
      {error&&<Alert>{error}</Alert>}{stale&&<p className="text-sm text-gray-600">Đóng hộp và tải lại danh sách trước khi xử lý.</p>}
      <div className="flex flex-wrap justify-end gap-3"><Button type="button" variant="secondary" disabled={busy} onClick={close}>Đóng</Button><Button type="submit" disabled={busy||stale} className={ban?'bg-red-700 hover:bg-red-800':''}>{busy?'Đang xử lý…':ban?'Xác nhận khóa':'Xác nhận mở'}</Button></div>
    </form></DialogContent></Dialog>;
}
export function AdminDashboardScreen(){return <section className="mx-auto max-w-6xl space-y-6 px-4 py-8"><header><h1 className="text-xl font-semibold">Tổng quan quản trị</h1><p className="mt-2 text-sm text-gray-600">Số liệu giao dịch theo ngày ghi sổ, giờ Việt Nam. GMV không phải doanh thu sàn.</p></header><AdminNavigation/><AdminAccess>{sessionId=><DashboardContent key={sessionId} sessionId={sessionId}/>}</AdminAccess></section>;}
const vnd=(value:string)=>new Intl.NumberFormat('vi-VN').format(BigInt(value))+' đ';
export function DashboardFigures({data}:{data:Dashboard}){
  return <>
    {!data.isComplete&&<Alert>{data.reviewCount} giao dịch thiếu chứng cứ hợp lệ đã được loại khỏi số tiền. Cần đối soát.</Alert>}
    <dl className="grid gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200 sm:grid-cols-2 lg:grid-cols-4">{[['GMV gốc',data.money.gmv],['Hoa hồng ghi nhận',data.money.commissionRecognized],['Hoàn đã duyệt trong kỳ',data.money.refundApproved],['Hoàn đã chuyển trong kỳ',data.money.refundTransferred]].map(([label,value])=><div key={label} className="min-w-0 bg-white p-5"><dt className="text-sm text-gray-600">{label}</dt><dd className="mt-3 text-xl font-semibold tabular-nums [overflow-wrap:anywhere]">{vnd(value)}</dd></div>)}</dl>
    <section className="rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-base font-semibold">Hoàn tiền và số tham khảo</h2><dl className="mt-4 space-y-3 text-sm">
      <div><dt className="text-gray-600">GMV trừ hoàn đã duyệt trong kỳ · chỉ tham khảo</dt><dd className="mt-1 font-medium tabular-nums">{vnd(data.money.gmvLessApprovedRefunds)}</dd></div>
      <div><dt className="text-gray-600">Đã duyệt còn chờ chuyển · số dư hiện tại, mọi ngày</dt><dd className="mt-1 font-medium tabular-nums">{vnd(data.money.refundPendingTransfer)}</dd></div></dl><p className="mt-4 max-w-[70ch] text-xs text-gray-600">Hoàn của đơn thanh toán ở kỳ trước có thể làm số tham khảo âm. Không sửa GMV gốc; phê duyệt hoàn không đồng nghĩa đã chuyển tiền.</p></section>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"><section className="rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-base font-semibold">Tin đăng hiện tại</h2><p className="mt-2 text-xs text-gray-600">Theo trạng thái, không gồm tin đã xóa mềm.</p><dl className="mt-4 grid gap-3 sm:grid-cols-2">{Object.entries(data.listings).map(([status,count])=><div key={status} className="flex items-baseline justify-between gap-3 text-sm"><dt className="text-gray-600">{listingStatusLabel[status]||status}</dt><dd className="font-medium tabular-nums">{count}</dd></div>)}<div className="flex items-baseline justify-between gap-3 text-sm"><dt className="text-gray-600">Đã xóa mềm · riêng</dt><dd className="font-medium tabular-nums">{data.deletedListings}</dd></div></dl></section>
      <section className="rounded-2xl border border-gray-200 bg-white p-5"><h2 className="text-base font-semibold">Người dùng hiện tại</h2><dl className="mt-4 space-y-3 text-sm">{data.users.map(row=><div key={row.role+':'+row.status} className="flex items-baseline justify-between gap-3"><dt className="text-gray-600">{row.role} · {row.status==='ACTIVE'?'Hoạt động':row.status==='BANNED'?'Đã khóa':row.status||'Chưa xác định'}</dt><dd className="font-medium tabular-nums">{row.count}</dd></div>)}</dl></section></div>
  </>;
}
function DashboardContent({sessionId}:{sessionId:string}){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [range,setRange]=useState({from:today.slice(0,8)+'01',to:today});
  const [applied,setApplied]=useState(range);
  const data=useQuery({queryKey:['admin-dashboard',sessionId,applied.from,applied.to],queryFn:({signal})=>adminApi.dashboard(applied.from,applied.to,signal),retry:false,gcTime:0});
  return <><form onSubmit={event=>{event.preventDefault();setApplied({...range});}} className="flex flex-wrap items-end gap-3">{(['from','to'] as const).map(name=><label key={name} className="grid gap-2 text-sm">{name==='from'?'Từ ngày':'Đến ngày'}<input type="date" name={name} required value={range[name]} className="field-control text-base md:text-sm" onChange={e=>setRange({...range,[name]:e.target.value})}/></label>)}<Button type="submit">Xem báo cáo</Button><Button type="button" variant="secondary" disabled={data.isFetching} onClick={()=>void data.refetch()}><RotateCw size={16} aria-hidden="true"/>Tải lại</Button></form>
    {data.error?<ReadError error={data.error} retry={()=>void data.refetch()}/>:!data.data?<Loading/>:<div aria-busy={data.isFetching} className="space-y-4"><p className="text-sm text-gray-600">{data.data.from} – {data.data.to} · Asia/Ho_Chi_Minh · VND</p><DashboardFigures data={data.data}/></div>}
  </>;
}
