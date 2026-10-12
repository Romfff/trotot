"use client";

import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/stores/auth-store";
import { apiError } from "@/lib/api/client";
import { appointmentsApi } from "@/lib/api/appointments";
import type { AppointmentResponseDto, CreateAppointmentDto, HostAppointmentResponseDto } from "@/lib/api/appointment-types.generated";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import "@/features/homestays/stitch-guest.css";

type Status = AppointmentResponseDto["status"];
type Action = "accept" | "reject" | "cancel" | "complete";
export const appointmentLabels: Record<Status, string> = { PENDING: "Chờ chủ nhà xác nhận", ACCEPTED: "Đã xác nhận", REJECTED: "Bị từ chối", COMPLETED: "Đã hoàn thành", CANCELLED: "Đã hủy" };
const tones: Record<Status, string> = { PENDING: "bg-amber-50 text-amber-800", ACCEPTED: "bg-brand-tint text-brand", REJECTED: "bg-gray-100 text-gray-700", COMPLETED: "bg-brand-tint text-brand", CANCELLED: "bg-gray-100 text-gray-700" };
const actions: Record<Action, string> = { accept: "Xác nhận lịch", reject: "Từ chối lịch", cancel: "Hủy lịch", complete: "Hoàn thành lịch" };

export function availableAppointmentActions(record: AppointmentResponseDto, host: boolean, now = Date.now()): Action[] {
  const at = Date.parse(`${record.scheduledDate}T${record.scheduledTime}+07:00`);
  if (!Number.isFinite(at)) return [];
  if (!host) return ["PENDING", "ACCEPTED"].includes(record.status) && now < at ? ["cancel"] : [];
  if (record.status === "PENDING") return now < at ? ["accept", "reject"] : [];
  if (record.status === "ACCEPTED") return now > at ? ["complete", "cancel"] : ["cancel"];
  return [];
}

function SessionGate({ host, children }: { host?: boolean; children: ReactNode }) {
  const { user, status } = useAuthStore();
  if (status === "initializing") return <p role="status">Đang kiểm tra phiên…</p>;
  if (!user) return <div className="space-y-4"><Alert>{status === "unavailable" ? "Chưa kiểm tra được phiên đăng nhập. Vui lòng tải lại trang." : "Cần đăng nhập để xem lịch hẹn và thông báo."}</Alert><Link href="/login" className="button">Đăng nhập</Link></div>;
  if (user.status !== "ACTIVE" || (host === undefined ? !["TENANT", "HOST"].includes(user.role) : user.role !== (host ? "HOST" : "TENANT")))
    return <Alert>Vai trò tài khoản hiện tại không được dùng chức năng này.</Alert>;
  return children;
}

function Frame({ children, title }: { children: ReactNode; title: string }) {
  const user = useAuthStore(state => state.user);
  return <div className="stitch-workflow-page mx-auto max-w-5xl px-4 py-6 sm:px-6 space-y-6">
    <h1 className="text-xl font-semibold">{title}</h1>
    <nav aria-label="Lịch xem trọ và thông báo" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {user?.role === "HOST" ? <Link className="text-link inline-flex min-h-11 items-center" href="/host/appointments">Lịch khách xem trọ</Link> : <Link className="text-link inline-flex min-h-11 items-center" href="/my-appointments">Lịch xem trọ của tôi</Link>}
      <Link className="text-link inline-flex min-h-11 items-center" href="/notifications">Thông báo</Link>
    </nav>{children}
  </div>;
}

function Pages({ page, totalPages, busy, change }: { page: number; totalPages: number; busy: boolean; change: (page: number) => void }) {
  return <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-end gap-3 text-sm">
    <Button variant="secondary" disabled={busy || page <= 1} onClick={() => change(page - 1)}>Trang trước</Button>
    <span>Trang {page} / {Math.max(1, totalPages)}</span>
    <Button variant="secondary" disabled={busy || page >= totalPages} onClick={() => change(page + 1)}>Trang sau</Button>
  </nav>;
}

export function AppointmentStatus({ status }: { status: Status }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${tones[status]}`}>{appointmentLabels[status]}</span>;
}

export function AppointmentSummary({ record }: { record: AppointmentResponseDto | HostAppointmentResponseDto }) {
  return <div className="space-y-3 min-w-0">
    <h2 className="text-base font-semibold break-words">{record.title}</h2>
    <AppointmentStatus status={record.status} />
    <p className="text-sm tabular-nums">{record.scheduledDate.split("-").reverse().join("/")} · {record.scheduledTime.slice(0, 5)} (giờ Việt Nam)</p>
    {"tenantName" in record && <p className="text-sm break-words">Khách: {record.tenantName} · <a className="hover:underline" href={`tel:${record.tenantPhone}`}>{record.tenantPhone}</a></p>}
    {"simultaneousAppointments" in record && record.simultaneousAppointments > 0 && <p className="text-sm text-amber-800">Có {record.simultaneousAppointments} lịch khác cùng giờ. Đây không phải giữ phòng.</p>}
    {record.notes && <p className="text-sm whitespace-pre-wrap break-words">Ghi chú: {record.notes}</p>}
    {record.reason && <p className="text-sm whitespace-pre-wrap break-words">Lý do: {record.reason}</p>}
    {record.cancelledBy && <p className="text-xs text-gray-600">Hủy bởi: {record.cancelledBy === "HOST" ? "Chủ nhà" : record.cancelledBy === "TENANT" ? "Khách" : "Hệ thống"}</p>}
  </div>;
}

export function AppointmentsScreen({ host = false }: { host?: boolean }) {
  const sessionId = useAuthStore(state => state.sessionId);
  return <Frame title={host ? "Quản lý lịch khách xem trọ" : "Lịch xem trọ của tôi"}><SessionGate host={host}><AppointmentList key={`${sessionId}:${host}`} sessionId={sessionId} host={host} /></SessionGate></Frame>;
}

function AppointmentList({ sessionId, host }: { sessionId: string | null; host: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [selection, setSelection] = useState<{ record: AppointmentResponseDto; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState("");
  const cache = useQueryClient();
  const list = useQuery({ queryKey: ["appointments", sessionId, host, page, status], queryFn: ({ signal }) => appointmentsApi.list(page, status, host, signal), retry: false, refetchOnWindowFocus: "always" });
  const mutation = useMutation({ mutationFn: (selected: NonNullable<typeof selection>) => appointmentsApi.action(selected.record.id, selected.action, { expectedStatus: selected.record.status, ...(reason.trim() ? { reason: reason.trim() } : {}) }, host),
    onSuccess: async () => { setSelection(null); setMessage("Đã cập nhật lịch hẹn."); await Promise.all([cache.invalidateQueries({ queryKey: ["appointments", sessionId] }), cache.invalidateQueries({ queryKey: ["appointment-notifications", sessionId] })]); },
    onError: error => { if (apiError(error).errorCode === "STALE_APPOINTMENT_STATUS") setStale(true); },
  });
  async function reload() { const response = await list.refetch(); if (response.isSuccess) { setStale(false); mutation.reset(); setSelection(null); setMessage(""); } }
  const busy = mutation.isPending || list.isFetching || stale || list.isError;
  return <>
    <label className="field max-w-sm">Trạng thái lịch<select aria-label="Trạng thái lịch" className="field-control" value={status} onChange={event => { setStatus(event.target.value); setPage(1); setMessage(""); }}>
      <option value="">Tất cả</option>{Object.entries(appointmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {message && <p role="status" className="text-sm">{message}</p>}
    {list.error && <Alert>{apiError(list.error).message}</Alert>}
    <Button variant="secondary" disabled={list.isFetching} onClick={() => void reload()}>Tải lại lịch</Button>
    {list.isPending ? <p role="status" className="py-6 text-sm text-gray-600">Đang tải lịch hẹn…</p> : list.data && <>
      {list.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Không có lịch hẹn trong mục này.</p> : <ul className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
        {list.data.data.map(record => <li key={record.id} className="p-5 sm:p-6 space-y-4">
          <AppointmentSummary record={record} />
          <div className="flex flex-wrap gap-3">{availableAppointmentActions(record, host).map(action => <Button key={action} variant="secondary" disabled={busy} onClick={() => { mutation.reset(); setReason(""); setSelection({ record, action }); }}>{actions[action]}</Button>)}</div>
        </li>)}
      </ul>}
      <Pages page={page} totalPages={list.data.meta.totalPages} busy={list.isFetching || mutation.isPending} change={setPage} />
    </>}
    <Dialog open={Boolean(selection)} onOpenChange={open => { if (!open && !mutation.isPending) { setSelection(null); mutation.reset(); } }}><DialogContent className="max-h-[90dvh] overflow-y-auto" onInteractOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>{selection ? actions[selection.action] : "Lịch hẹn"}?</DialogTitle><DialogDescription>{selection?.record.title} · {selection?.record.scheduledDate} · {selection?.record.scheduledTime.slice(0, 5)} (giờ Việt Nam). Thao tác chỉ có hiệu lực khi máy chủ xác nhận.</DialogDescription></DialogHeader>
      {selection && ["reject", "cancel"].includes(selection.action) && <Input id="appointment-reason" label={host && selection.action === "cancel" ? "Lý do hủy (bắt buộc)" : "Lý do (không bắt buộc)"} value={reason} maxLength={500} required={host && selection.action === "cancel"} onChange={event => setReason(event.target.value)} error={mutation.error ? apiError(mutation.error).fieldErrors.reason : undefined} />}
      {mutation.error && <Alert>{apiError(mutation.error).message}</Alert>}
      {stale && <Button variant="secondary" disabled={list.isFetching} onClick={() => void reload()}>Tải lại trạng thái mới nhất</Button>}
      <DialogFooter><Button variant="secondary" disabled={mutation.isPending} onClick={() => setSelection(null)}>Đóng</Button><Button disabled={!selection || busy || Boolean(host && selection.action === "cancel" && !reason.trim())} onClick={() => selection && mutation.mutate(selection)}>{mutation.isPending ? "Đang xử lý…" : selection ? actions[selection.action] : "Xác nhận"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}

export function AppointmentRequest({ propertyId, title, isAvailable }: { propertyId: string; title: string; isAvailable: boolean }) {
  const { user, status, sessionId } = useAuthStore();
  const [open, setOpen] = useState(false);
  const attempt = useRef<{ json: string; key: string; sessionId: string | null } | null>(null);
  if (!isAvailable) return <p className="text-sm text-gray-600">Tin đã hết phòng, không nhận lịch mới.</p>;
  if (status === "initializing") return <p role="status" className="text-sm">Đang kiểm tra phiên…</p>;
  if (!user) return <Link href="/login" className="button button-secondary">Đăng nhập để hẹn xem trọ</Link>;
  if (user.role !== "TENANT" || user.status !== "ACTIVE") return <p className="text-sm text-gray-600">Đặt lịch xem trọ dành cho tài khoản khách đang hoạt động.</p>;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="secondary">Đặt lịch xem trọ</Button></DialogTrigger><DialogContent className="max-h-[90dvh] overflow-y-auto" onInteractOutside={event => event.preventDefault()}>
    <DialogHeader><DialogTitle>Đặt lịch xem trọ</DialogTitle><DialogDescription>{title}. Lịch cần chủ nhà xác nhận; không giữ phòng và không thu tiền.</DialogDescription></DialogHeader>
    <RequestForm key={sessionId} attempt={attempt} propertyId={propertyId} userName={user.fullName} userPhone={user.phone} />
  </DialogContent></Dialog>;
}

function RequestForm({ propertyId, userName, userPhone, attempt }: { propertyId: string; userName: string; userPhone: string; attempt: RefObject<{ json: string; key: string; sessionId: string | null } | null> }) {
  const cache = useQueryClient();
  const sessionId = useAuthStore(state => state.sessionId);
  const mutation = useMutation({ mutationFn: (body: CreateAppointmentDto) => {
    const json = JSON.stringify(body);
    if (attempt.current?.json !== json || attempt.current.sessionId !== sessionId) attempt.current = { json, key: crypto.randomUUID(), sessionId };
    return appointmentsApi.create(body, attempt.current.key);
  }, onSuccess: async () => { await Promise.all([cache.invalidateQueries({ queryKey: ["appointments", sessionId] }), cache.invalidateQueries({ queryKey: ["appointment-notifications", sessionId] })]); } });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (mutation.isPending || mutation.isSuccess) return;
    const form = new FormData(event.currentTarget); const text = (name: string) => String(form.get(name) || "").trim();
    const time = text("scheduledTime");
    mutation.mutate({ propertyId, tenantName: text("tenantName"), tenantPhone: text("tenantPhone"), scheduledDate: text("scheduledDate"), scheduledTime: time.length === 5 ? `${time}:00` : time, ...(text("notes") ? { notes: text("notes") } : {}) });
  }
  if (mutation.isSuccess) return <div className="space-y-4"><p role="status" className="text-sm">Đã gửi yêu cầu xem trọ. Chờ chủ nhà xác nhận; chưa gửi SMS/Zalo.</p><AppointmentSummary record={mutation.data.data} /><Link className="button button-secondary" href="/my-appointments">Xem lịch hẹn của tôi</Link></div>;
  const requestError = mutation.error ? apiError(mutation.error) : null;
  const fields = requestError?.fieldErrors ?? {};
  return <form onSubmit={submit} className="space-y-4">
    <fieldset disabled={mutation.isPending} className="space-y-4">
      <Input name="tenantName" label="Tên người đến xem" defaultValue={userName} required maxLength={150} error={fields.tenantName} autoFocus />
      <Input name="tenantPhone" label="Số điện thoại liên hệ" defaultValue={userPhone} type="tel" required maxLength={20} error={fields.tenantPhone} />
      <Input name="scheduledDate" label="Ngày xem trọ (giờ Việt Nam)" type="date" required error={fields.scheduledDate} />
      <Input name="scheduledTime" label="Giờ xem trọ (giờ Việt Nam)" type="time" required error={fields.scheduledTime} hint="Mặc định mỗi 30 phút, ví dụ 10:30 hoặc 11:00. Máy chủ kiểm tra khung giờ và thời gian báo trước." />
      <Input name="notes" label="Ghi chú (không bắt buộc)" maxLength={500} error={fields.notes} />
    </fieldset>
    {requestError && <Alert>{requestError.message}{(requestError.status === 0 || requestError.status >= 500) && " Giữ nguyên thông tin và gửi lại để thử lại cùng yêu cầu."}</Alert>}
    <DialogFooter><Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Đang gửi…" : "Gửi yêu cầu xem trọ"}</Button></DialogFooter>
  </form>;
}

export function NotificationsScreen() {
  const sessionId = useAuthStore(state => state.sessionId);
  return <Frame title="Thông báo lịch xem trọ"><SessionGate><NotificationList key={sessionId} sessionId={sessionId} /></SessionGate></Frame>;
}

function NotificationList({ sessionId }: { sessionId: string | null }) {
  const [page, setPage] = useState(1); const router = useRouter(); const cache = useQueryClient();
  const user = useAuthStore(state => state.user);
  const list = useQuery({ queryKey: ["appointment-notifications", sessionId, page], queryFn: ({ signal }) => appointmentsApi.notifications(page, signal), retry: false, refetchOnWindowFocus: "always" });
  const mutation = useMutation({ mutationFn: appointmentsApi.markRead, onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["appointment-notifications", sessionId] }); router.push(user?.role === "HOST" ? "/host/appointments" : "/my-appointments"); } });
  return <>
    {list.error && <Alert>{apiError(list.error).message}</Alert>}{mutation.error && <Alert>{apiError(mutation.error).message}</Alert>}
    <Button variant="secondary" disabled={list.isFetching} onClick={() => void list.refetch()}>Tải lại thông báo</Button>
    {list.isPending ? <p role="status" className="py-6 text-sm text-gray-600">Đang tải thông báo…</p> : list.data && <>
      <p className="text-sm text-gray-600">{list.data.meta.unreadCount ?? 0} thông báo chưa đọc</p>
      {list.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Chưa có thông báo nào.</p> : <ul className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-200">
        {list.data.data.map(item => <li key={item.id}><button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(item.id)} className="w-full min-h-11 p-5 sm:p-6 text-left hover:bg-gray-50 transition-colors">
          <p className={item.readAt ? "text-sm text-gray-600" : "text-sm font-medium"}>{item.message}{!item.readAt && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-ink" aria-label="Chưa đọc" />}</p>
          <p className="mt-2 text-xs text-gray-600">{new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))}</p>
        </button></li>)}
      </ul>}
      <Pages page={page} totalPages={list.data.meta.totalPages} busy={list.isFetching || mutation.isPending} change={setPage} />
    </>}
  </>;
}
