"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiError } from "@/lib/api/client";
import { adminPayoutsApi, type PayoutListItem, type AdminPayoutDetail } from "@/lib/api/payouts";
import { PayoutActions } from "./payout-actions";
import { decimalPriceLabel } from "@/lib/decimal-price-label";
import { useAuthStore } from "@/stores/auth-store";
import {FinanceRecordAction} from './record-action';
import './stitch-finance-batch.css';

const labels: Record<PayoutListItem["status"], string> = { DRAFT: "Lô nháp", APPROVED: "Đã duyệt, chưa xác nhận chi trả", CANCELLED: "Lô đã hủy", PAID: "Admin đã xác nhận chi trả" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
export function AdminPayoutScreen() {
  const { user, status, sessionId } = useAuthStore();
  return <div className="admin-finance-batch mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
    <header><h1 className="text-xl font-semibold">Lô chi trả chủ nhà</h1>
      <p className="mt-2 text-sm text-gray-600 text-pretty">Đã duyệt không có nghĩa là đã chuyển tiền. Chi trả được Admin thực hiện thủ công.</p></header>
    {status === "initializing" ? <p role="status">Đang kiểm tra phiên…</p> : status === "unavailable" ? <Alert>Chưa kiểm tra được phiên. Hãy tải lại trang.</Alert>
      : !user ? <p><Link className="text-link underline" href="/login">Đăng nhập</Link> để xem trang quản trị.</p>
      : user.role !== "ADMIN" || user.status !== "ACTIVE" || !sessionId ? <Alert>Trang này chỉ dành cho Admin đang hoạt động.</Alert>
      : <PayoutList key={sessionId} sessionId={sessionId} />}
  </div>;
}
function PayoutList({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [locked,setLocked]=useState(false);
  const list = useQuery({ queryKey: ["admin-payouts", sessionId, page], queryFn: ({ signal }) => adminPayoutsApi.list(page, signal), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  return <div className="space-y-6"><div className="finance-entry-grid"><section aria-label="Tạo lô" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <PayoutActions sessionId={sessionId} creating locked={locked} setLocked={setLocked} onCreated={id=>{setPage(1);setSelected(id);}} />
  </section><FinanceRecordAction kind="reverse" sessionId={sessionId}/></div><div className="finance-review-grid"><section aria-labelledby="admin-payout-list-title" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <h2 id="admin-payout-list-title" className="text-base font-semibold">Danh sách lô</h2>
    {list.isError ? <div className="mt-4 space-y-3"><Alert>{apiError(list.error).message}</Alert><Button variant="secondary" onClick={() => void list.refetch()}>Thử lại</Button></div>
      : !list.data ? <p role="status" className="py-4">Đang tải lô chi trả…</p>
      : <div aria-busy={list.isFetching}>
        {list.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Chưa có lô ở trang này.</p>
          : <ul className="finance-list mt-4 divide-y divide-gray-200">{list.data.data.map(row => <li key={row.id} className="finance-row space-y-2 py-4" data-selected={selected === row.id}>
            <h3 className="text-lg font-semibold tabular-nums wrap-anywhere">{decimalPriceLabel(row.amount)}đ</h3>
            <p className={`finance-status text-sm font-medium ${row.status === "PAID" ? "text-brand" : "text-gray-600"}`}>{labels[row.status]}</p>
            <p className="text-sm text-gray-600">{row.bankCode} · {row.accountNumber}</p>
            <dl className="space-y-1 text-xs text-gray-600"><div><dt>Host</dt><dd className="font-mono wrap-anywhere">{row.hostId}</dd></div>
              <div><dt>ID lô</dt><dd className="font-mono wrap-anywhere">{row.id}</dd></div></dl>
            <Button variant="secondary" disabled={locked} aria-expanded={selected === row.id} aria-controls="admin-payout-detail"
              onClick={() => setSelected(selected === row.id ? null : row.id)}>{selected === row.id ? "Đóng chi tiết" : "Xem chi tiết"}</Button>
          </li>)}</ul>}
        {list.data.meta.totalPages > 1 ? <nav aria-label="Phân trang lô Admin" className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <Button variant="secondary" disabled={locked || list.isFetching || page <= 1} onClick={() => { setSelected(null); setPage(page - 1); }}>Trang trước</Button>
          <span className="text-sm tabular-nums" aria-current="page">{page} / {list.data.meta.totalPages}</span>
          <Button variant="secondary" disabled={locked || list.isFetching || page >= list.data.meta.totalPages} onClick={() => { setSelected(null); setPage(page + 1); }}>Trang sau</Button>
        </nav> : null}
      </div>}
  </section><section id="admin-payout-detail" aria-label="Chi tiết lô" className="finance-detail rounded-xl border border-gray-200 bg-white p-4 sm:p-5">
    <h2 className="finance-detail-heading text-base font-semibold">Chi tiết lô</h2>
    {selected?<PayoutDetail key={selected} id={selected} sessionId={sessionId} locked={locked} setLocked={setLocked}/>:<p className="text-sm text-gray-600">Chọn một lô để xem chi tiết và xử lý.</p>}
  </section></div></div>;
}
function PayoutDetail({ id, sessionId,locked,setLocked }: { id: string; sessionId: string;locked:boolean;setLocked:(value:boolean)=>void }) {
  const detail = useQuery({ queryKey: ["admin-payout-detail", sessionId, id], queryFn: ({ signal }) => adminPayoutsApi.detail(id, signal), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  return <div className="space-y-5">{detail.isError?<div className="space-y-3 py-4"><Alert>{apiError(detail.error).message}</Alert><Button variant="secondary" onClick={() => void detail.refetch()}>Thử lại chi tiết</Button></div>
    :!detail.data?<p role="status" className="py-4">Đang tải chi tiết lô…</p>:<PayoutSnapshot row={detail.data} fetching={detail.isFetching}/>}
    <PayoutActions sessionId={sessionId} row={detail.isError?undefined:detail.data} readBusy={detail.isFetching||detail.isError} locked={locked} setLocked={setLocked}/>
  </div>;
}
function PayoutSnapshot({row,fetching}:{row:AdminPayoutDetail;fetching:boolean}) {
  return <div className="space-y-4 text-sm" aria-busy={fetching}>
    <dl className="finance-snapshot @container space-y-3">{[["Chủ tài khoản", row.accountName], ["Số tài khoản", row.accountNumber], ["Phiên bản ngân hàng", String(row.bankVersion)],
      ["Mốc đối soát", `${dateLabel(row.cutoff)} (giờ Việt Nam)`]].map(([label, value]) => <div key={label} className="grid gap-1 @sm:grid-cols-[10rem_minmax(0,1fr)] @sm:gap-4">
        <dt className="text-gray-600">{label}</dt><dd className="min-w-0 font-medium wrap-anywhere">{value}</dd></div>)}</dl>
    {row.operations.reviewRequired ? <Alert tone="notice">Điều kiện chi trả đã thay đổi; cần kiểm tra lại lô. Không chuyển tiền theo ảnh chụp cũ.</Alert> : null}
    {row.confirmation ? <div className="finance-evidence space-y-1"><p className="font-medium text-brand">Admin đã ghi nhận chi trả thủ công</p>
      <p className="wrap-anywhere">Mã giao dịch: {row.confirmation.bankReference}</p><p className="wrap-anywhere">Chứng cứ: {row.confirmation.evidenceNote}</p>
      <p className="wrap-anywhere">Lý do: {row.confirmation.reason}</p><time dateTime={row.confirmation.confirmedAt}>{dateLabel(row.confirmation.confirmedAt)}</time>
      <p className="text-gray-600">Đây là ghi nhận của Admin, không phải xác minh tự động từ ngân hàng.</p></div>
      : <p className="text-gray-600">Lô chưa có xác nhận đã chi trả.</p>}
    <h4 className="font-medium">Các đơn trong lô</h4>
    <ul className="finance-bookings space-y-3">{row.items.map(item => <li key={item.bookingId}><p className="font-mono text-xs wrap-anywhere">{item.bookingId}</p>
      <p className="font-medium tabular-nums">{decimalPriceLabel(item.amount)}đ · {item.status === "RELEASED" ? "Đã nhả khỏi lô" : "Thuộc lô này"}</p></li>)}</ul>
    <h4 className="font-medium">Lịch sử xử lý</h4>
    <ul className="finance-timeline space-y-3">{row.events.map((event, index) => <li key={index}>
      <p>{({ CREATED: "Tạo lô", APPROVED: "Duyệt lô", CANCELLED: "Hủy lô", PAID: "Xác nhận chi trả" })[event.action]}</p>
      <time dateTime={event.createdAt} className="text-xs text-gray-600">{dateLabel(event.createdAt)} (giờ Việt Nam)</time>
      <p className="text-xs font-mono text-gray-600 wrap-anywhere">{event.actorId}</p><p className="text-gray-600 wrap-anywhere">{event.reason}</p>
    </li>)}</ul>
  </div>;
}
