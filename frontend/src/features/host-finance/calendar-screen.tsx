"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiError } from "@/lib/api/client";
import { hostCalendarApi, type HostCalendar } from "@/lib/api/host-calendar";
import { useAuthStore } from "@/stores/auth-store";
import { bankNeedsReplay } from "./bank-form";
import { calendarCells, calendarPriceError, calendarRange, shiftCalendarMonth } from "./calendar-form";
import { CalendarBookingDialog } from "./calendar-booking-dialog";
import { subscribeCalendarRealtime } from "@/lib/booking-realtime";
import './stitch-finance.css';

const labels: Record<HostCalendar["days"][number]["status"], string> = {
  AVAILABLE: "Còn phòng", HELD: "Đang giữ", PENDING_HOST_APPROVAL: "Chờ duyệt", BOOKED: "Đã đặt", BLOCKED: "Đã khóa",
};
const tones = { AVAILABLE: "bg-brand-tint text-brand", HELD: "bg-amber-50 text-amber-800", PENDING_HOST_APPROVAL: "bg-amber-50 text-amber-800", BOOKED: "bg-orange-50 text-orange-800", BLOCKED: "bg-background text-gray-600" };
const todayMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(new Date());
type Attempt = { key: string; action: "price" | "reset" | "block" | "unblock"; body: { expectedVersion: number; dates: string[]; customPrice?: number | null; isBlocked?: boolean } };

export function HostCalendarScreen({ unitId }: { unitId?: string }) {
  const { user, status, sessionId } = useAuthStore();
  return <div className="stitch-finance-page stitch-calendar-page mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold">Lịch và giá phòng</h1><p className="mt-2 text-sm text-gray-600">Quản lý lịch từng phòng theo giờ Việt Nam. Giá mới không đổi giá của đơn đã đặt.</p></header>
    {status === "initializing" ? <p role="status">Đang kiểm tra phiên…</p>
      : status === "unavailable" ? <Alert>Chưa kiểm tra được phiên đăng nhập. Hãy tải lại trang.</Alert>
      : !user ? <p><Link href="/login" className="text-link underline">Đăng nhập</Link> để quản lý lịch.</p>
      : user.role !== "HOST" || user.status !== "ACTIVE" || !sessionId ? <Alert>Trang này chỉ dành cho chủ nhà đang hoạt động.</Alert>
      : unitId ? <CalendarContent key={`${sessionId}:${unitId}`} sessionId={sessionId} unitId={unitId} /> : <RoomList key={sessionId} sessionId={sessionId} />}
  </div>;
}
function RoomList({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["host-calendar-rooms", sessionId, page], queryFn: ({ signal }) => hostCalendarApi.homestays(page, signal), retry: false, gcTime: 0 });
  return <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <h2 className="text-base font-semibold">Chọn phòng để quản lý</h2>
    {query.isPending ? <p role="status">Đang tải phòng…</p> : query.isError ? <><Alert>{apiError(query.error).message}</Alert><Button variant="secondary" onClick={() => void query.refetch()}>Thử lại</Button></> : <>
      {!query.data.data.length ? <p>Chưa có homestay để quản lý lịch.</p> : query.data.data.map(property => <div key={property.id} className="space-y-2 border-b border-gray-200 py-3 last:border-0"><h3 className="break-words font-medium">{property.title}</h3>
        {property.homestayUnits.length ? property.homestayUnits.map(unit => <Link key={unit.id} href={`/host/calendar/${unit.id}`} className="block min-h-11 rounded-lg p-3 text-link underline underline-offset-4 hover:bg-background">{unit.unitName}</Link>) : <p className="text-gray-600">Chưa có phòng.</p>}</div>)}
      {query.data.meta.totalPages > 1 ? <nav aria-label="Trang homestay" className="flex items-center justify-between gap-3"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</Button><span>Trang {page} / {query.data.meta.totalPages}</span><Button variant="secondary" disabled={page >= query.data.meta.totalPages} onClick={() => setPage(page + 1)}>Sau</Button></nav> : null}
    </>}
  </section>;
}
function CalendarContent({ sessionId, unitId }: { sessionId: string; unitId: string }) {
  const client = useQueryClient();
  const [month, setMonth] = useState(todayMonth);
  const [selected, setSelected] = useState<string[]>([]);
  const [price, setPrice] = useState("");
  const [action, setAction] = useState<Attempt["action"]>("price");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const editTrigger = useRef<HTMLElement | null>(null);
  const [booking, setBooking] = useState<{ id: string; date: string; trigger: HTMLElement } | null>(null);
  const attempt = useRef<Attempt | null>(null), inFlight = useRef(false), anchor = useRef<string | null>(null), dragged = useRef(false);
  const queryKey = ["host-calendar", sessionId, unitId, month];
  const query = useQuery({ queryKey, queryFn: ({ signal }) => hostCalendarApi.read(unitId, month, signal), retry: false, gcTime: 0 });
  useEffect(()=>subscribeCalendarRealtime(unitId,()=>{
    if(useAuthStore.getState().sessionId===sessionId) void client.invalidateQueries({queryKey:["host-calendar",sessionId,unitId]});
  }),[client,sessionId,unitId]);
  const locked = busy || uncertain;
  const current = () => { const state = useAuthStore.getState(); return state.sessionId === sessionId && state.status === "authenticated" && state.user?.role === "HOST" && state.user.status === "ACTIVE"; };
  function changeMonth(value: string) { if (!locked) { setMonth(value); setSelected([]); anchor.current = null; setMessage(""); } }
  function select(date: string, range = false) {
    if (locked || !query.data || query.isError || query.isFetching) return;
    setSelected(values => range && anchor.current ? calendarRange(query.data.days, anchor.current, date) : values.includes(date) ? values.filter(value => value !== date) : [...values, date].sort());
    if (!range) anchor.current = date;
    setMessage("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !current()) return;
    if (!attempt.current) {
      if (!query.data || query.isError || query.isFetching || !selected.length) return;
      const invalid = action === "price" ? calendarPriceError(price) : "";
      setError(invalid); if (invalid) { event.currentTarget.querySelector<HTMLInputElement>("[name=price]")?.focus(); return; }
      attempt.current = { key: crypto.randomUUID(), action, body: { expectedVersion: query.data.version, dates: [...selected],
        ...(action === "price" || action === "reset" ? { customPrice: action === "reset" ? null : Number(price) } : { isBlocked: action === "block" }) } };
    }
    const sent = attempt.current; inFlight.current = true; setBusy(true); setMessage(""); setSaved(false);
    try {
      if (sent.action === "price" || sent.action === "reset") await hostCalendarApi.pricing(unitId, { ...sent.body, customPrice: sent.body.customPrice! }, sent.key);
      else await hostCalendarApi.block(unitId, { ...sent.body, isBlocked: sent.body.isBlocked! }, sent.key);
      if (!current()) return;
      attempt.current = null; setUncertain(false); setSelected([]); setSaved(true); setMessage("Máy chủ đã ghi nhận. Đang đọc lại lịch hiện tại.");
      await client.invalidateQueries({ queryKey: ["host-calendar", sessionId, unitId] });
    } catch (failure) {
      if (!current()) return;
      const problem = apiError(failure), replay = bankNeedsReplay(problem);
      setUncertain(replay); setMessage(replay ? "Chưa rõ kết quả. Giữ nguyên yêu cầu và thử lại; không đổi phòng, tháng hoặc ngày lúc này." : problem.message);
      if (!replay) { attempt.current = null; void query.refetch(); }
    } finally { inFlight.current = false; if (current()) setBusy(false); }
  }
  return <>
    <Link href="/host/calendar" onClick={event => { if (locked) event.preventDefault(); }} aria-disabled={locked} className="inline-flex min-h-11 items-center text-link underline">Chọn phòng khác</Link>
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3"><div className="w-40"><Input id="calendar-month" key={month} label="Tháng (YYYY-MM)" defaultValue={month} readOnly={locked} onBlur={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value) && !event.target.value.startsWith("0000")) changeMonth(event.target.value); else event.target.value = month; }} /></div>
        <Button variant="secondary" disabled={locked} onClick={() => changeMonth(todayMonth())}>Tháng này</Button>
        <Button variant="plain" size="icon" aria-label="Tháng trước" disabled={locked || month === "0001-01"} onClick={() => changeMonth(shiftCalendarMonth(month, -1))}><ChevronLeft size={20} aria-hidden="true" /></Button>
        <Button variant="plain" size="icon" aria-label="Tháng sau" disabled={locked || month === "9999-12"} onClick={() => changeMonth(shiftCalendarMonth(month, 1))}><ChevronRight size={20} aria-hidden="true" /></Button></div>
      {query.isError ? <><Alert>{apiError(query.error).message}</Alert><Button variant="secondary" onClick={() => void query.refetch()}>Thử lại lịch</Button></> : null}
      <p className="text-sm text-gray-600">Chọn từng ngày hoặc giữ Shift để chọn khoảng. Trên máy tính có thể kéo qua các ngày.</p>
      {query.isPending ? <div role="status" className="grid grid-cols-7 gap-1" aria-label="Đang tải lịch">{Array.from({ length: 42 }, (_, index) => <div key={index} className="h-12 rounded-lg bg-background motion-safe:animate-pulse" />)}</div> : query.data ? <>
        {query.isFetching ? <p role="status">Đang cập nhật lịch…</p> : null}
        <div className="grid grid-cols-7 gap-1" role="group" aria-label={`Lịch ${month}`}>
          {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map(day => <span key={day} className="py-2 text-center text-sm text-gray-600">{day}</span>)}
          {calendarCells(month, query.data.days).map((day, index) => day ? <button key={day.date} type="button" data-date={day.date} aria-pressed={selected.includes(day.date)} disabled={locked || query.isError || query.isFetching}
            aria-label={`${day.date}: ${labels[day.status]}, ${day.price.toLocaleString("vi-VN")} đồng`}
            className={`flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg p-1 text-xs lg:h-24 lg:p-2 ${selected.includes(day.date) ? "bg-brand text-white" : tones[day.status]} hover:opacity-80`}
            onClick={event => { if (!dragged.current) { select(day.date, event.shiftKey); if (event.shiftKey) { editTrigger.current = event.currentTarget; setEditing(true); } else if (day.bookingId) setBooking({ id: day.bookingId, date: day.date, trigger: event.currentTarget }); } dragged.current = false; }} onPointerDown={event => { dragged.current = false; if (event.pointerType === "mouse" && !locked && !event.shiftKey) anchor.current = day.date; }} onPointerEnter={event => { if (event.buttons === 1 && event.pointerType === "mouse") { dragged.current = true; select(day.date, true); } }} onPointerUp={event => { if (dragged.current && !locked) { editTrigger.current = event.currentTarget; setEditing(true); } }}>
            <span className="text-sm font-medium">{Number(day.date.slice(-2))}</span><span className="hidden lg:block">{labels[day.status]}</span><span className="hidden max-w-full break-all tabular-nums lg:block">{day.price.toLocaleString("vi-VN")}đ</span><span className="lg:hidden" aria-hidden="true">{day.status === "AVAILABLE" ? "●" : day.status === "BLOCKED" ? "×" : "◆"}</span>
          </button> : <div key={`blank-${index}`} className="h-14 lg:h-24" aria-hidden="true" />)}
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-5">{Object.entries(labels).map(([status, label]) => <span key={status} className={`rounded-lg px-2 py-1 ${tones[status as keyof typeof tones]}`}>{label}</span>)}</div>
        {selected.length ? <ul className="max-h-48 overflow-y-auto divide-y divide-gray-200 text-sm" aria-label="Ngày đã chọn">{query.data.days.filter(day => selected.includes(day.date)).map(day => <li key={day.date} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{day.date} · {labels[day.status]}</span><span className="tabular-nums">{day.price.toLocaleString("vi-VN")}đ</span>{day.bookingId ? <Button type="button" variant="secondary" onClick={event => setBooking({ id: day.bookingId!, date: day.date, trigger: event.currentTarget })}>Xem thông tin đơn</Button> : null}</li>)}</ul> : null}
      </> : null}
    </section>
    <Button type="button" variant="secondary" disabled={locked || !selected.length || !query.data || query.isError || query.isFetching} onClick={event => { editTrigger.current = event.currentTarget; setEditing(true); }}>Chỉnh ngày đã chọn</Button>
    <Dialog open={editing} onOpenChange={open => { if (!locked) setEditing(open); }}>
      <DialogContent className="max-h-[80dvh] overflow-y-auto" onInteractOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onOpenAutoFocus={event => { event.preventDefault(); document.getElementById(action === "price" ? "calendar-price" : "calendar-edit-title")?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); if (editTrigger.current?.isConnected) editTrigger.current.focus(); }}>
    <form onSubmit={submit} noValidate aria-label="Cập nhật lịch" className="space-y-4">
      <DialogHeader className="pr-8"><DialogTitle id="calendar-edit-title" tabIndex={-1}>Đã chọn {selected.length} ngày</DialogTitle><DialogDescription className="mt-2 text-sm/6">Đổi giá hoặc khóa/mở phòng cho các ngày đã chọn.</DialogDescription></DialogHeader>
      {selected.length ? <p className="max-h-24 overflow-y-auto break-words text-sm tabular-nums" aria-label="Các ngày sẽ cập nhật">{selected.join(", ")}</p> : null}
      <div className="grid grid-cols-2 gap-2">{([["price", "Đặt giá riêng"], ["reset", "Giá mặc định"], ["block", "Khóa ngày"], ["unblock", "Mở ngày"]] as const).map(([value, label]) => <Button type="button" key={value} variant="secondary" aria-pressed={action === value} disabled={locked} style={action === value ? { background: "var(--soft-green)", color: "var(--primary-dark)", borderColor: "var(--primary-dark)" } : undefined} onClick={() => { setAction(value); setError(""); }}>{label}</Button>)}</div>
      {action === "price" ? <Input id="calendar-price" name="price" label="Giá mỗi đêm (VND)" inputMode="decimal" value={price} error={error} readOnly={locked} onChange={event => { setPrice(event.target.value); setError(""); }} /> : null}
      <p className="text-sm text-gray-600">Máy chủ kiểm tra phiên bản và các đơn còn hiệu lực. Không thể khóa ngày đang có đơn giữ phòng hoặc đã xác nhận.</p>
      {message ? <Alert tone={uncertain ? "notice" : saved ? "success" : "error"}>{message}</Alert> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="secondary" disabled={locked} onClick={() => setEditing(false)}>Đóng</Button><Button type="submit" disabled={busy || (!uncertain && (!selected.length || !query.data || query.isError || query.isFetching))} className="w-full sm:w-auto" aria-busy={busy}>{busy ? "Đang lưu…" : uncertain ? "Thử lại cùng yêu cầu" : "Áp dụng cho ngày đã chọn"}</Button></div>
    </form>
      </DialogContent>
    </Dialog>
    {booking ? <CalendarBookingDialog key={`${booking.id}:${booking.date}`} sessionId={sessionId} unitId={unitId} bookingId={booking.id} date={booking.date} returnFocus={booking.trigger} onClose={() => setBooking(null)} /> : null}
  </>;
}
