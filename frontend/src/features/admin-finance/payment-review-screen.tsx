"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Eye, RotateCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiError } from "@/lib/api/client";
import { paymentReviewsApi, type PaymentReview } from "@/lib/api/payment-reviews";
import { decimalPriceLabel } from "@/lib/decimal-price-label";
import { useAuthStore } from "@/stores/auth-store";

const reasons: Record<PaymentReview["reasonCode"], string> = {
  AMOUNT_MISMATCH: "Số tiền không khớp",
  BOOKING_NOT_PAYABLE: "Đơn không còn đủ điều kiện thanh toán",
  SESSION_CHANGED: "Thông tin đơn hoặc phiên thanh toán đã thay đổi",
  PAYMENT_TIME_INVALID: "Thời điểm thanh toán chưa hợp lệ",
  SOURCE_EXISTS: "Đơn đã có nguồn thanh toán khác",
};
const bookingLabels: Record<string, string> = {
  PENDING_HOST_APPROVAL: "Chờ chủ nhà duyệt", PENDING_PAYMENT: "Chờ thanh toán",
  CONFIRMED: "Đã xác nhận", CHECKED_IN: "Đã nhận phòng", COMPLETED: "Đã hoàn thành",
  CANCELLED: "Đã hủy", CANCELLED_BY_GUEST: "Khách đã hủy", REJECTED_BY_HOST: "Chủ nhà từ chối",
  CANCELLED_HOST_TIMEOUT: "Hủy do chủ nhà quá hạn phản hồi", CANCELLED_TIMEOUT: "Hủy do hết hạn thanh toán",
};
const paymentLabels: Record<string, string> = {
  NOT_CONFIGURED: "Chưa kết nối thanh toán", PENDING: "Chờ thanh toán",
  PAID: "Đơn đã ghi nhận thanh toán", REFUNDED: "Đơn đã ghi nhận hoàn tiền",
};
const dateLabel = (value: string) => new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
}).format(new Date(value));
const card = "rounded-xl border border-gray-200 bg-white p-4 sm:p-5";

export function AdminPaymentReviewScreen() {
  const { user, status, sessionId } = useAuthStore();
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
    <header className="space-y-2">
      <h1 className="text-xl font-semibold">Giao dịch cần đối soát</h1>
      <p className="max-w-[75ch] text-sm text-gray-600 text-pretty">Xem chứng cứ từ VNPay Sandbox. Các giao dịch này chưa được xử lý xong; xem thông tin không xác nhận thanh toán hoặc hoàn tiền.</p>
    </header>
    {status === "initializing" ? <p role="status">Đang kiểm tra phiên…</p>
      : status === "unavailable" ? <Alert>Chưa kiểm tra được phiên. Hãy tải lại trang.</Alert>
      : !user ? <p><Link className="text-link underline" href="/login">Đăng nhập</Link> để xem trang quản trị.</p>
      : user.role !== "ADMIN" || user.status !== "ACTIVE" || !sessionId ? <Alert>Trang này chỉ dành cho Admin đang hoạt động.</Alert>
      : <ReviewList key={sessionId} sessionId={sessionId} />}
  </div>;
}

function LoadingRows({ detail = false }: { detail?: boolean }) {
  return <div role="status" aria-label={detail ? "Đang tải chi tiết giao dịch" : "Đang tải giao dịch"} aria-busy="true">
    <span className="sr-only">{detail ? "Đang tải chi tiết giao dịch…" : "Đang tải giao dịch…"}</span>
    <div aria-hidden="true" className="divide-y divide-gray-200">
      {Array.from({ length: detail ? 4 : 6 }, (_, index) => <div key={index} className="space-y-3 py-4">
        <div className={`h-3 rounded-full bg-foreground/5 animate-pulse motion-reduce:animate-none ${index % 2 ? "w-1/2" : "w-2/5"}`} />
        <div className="h-3 w-1/3 rounded-full bg-foreground/5 animate-pulse motion-reduce:animate-none" />
        <div className="h-3 w-2/3 rounded-full bg-foreground/5 animate-pulse motion-reduce:animate-none" />
      </div>)}
    </div>
  </div>;
}

function ReadError({ error, retry, busy }: { error: unknown; retry: () => void; busy: boolean }) {
  return <div className="space-y-3 py-6">
    <Alert>{apiError(error).message}</Alert>
    <Button variant="secondary" aria-disabled={busy || undefined} onClick={() => { if (!busy) retry(); }}>
      <RotateCw size={16} aria-hidden="true" />Thử lại
    </Button>
  </div>;
}

function ReviewList({ sessionId }: { sessionId: string }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["admin-payment-reviews", sessionId, page],
    queryFn: ({ signal }) => paymentReviewsApi.list(page, signal), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  return <div className="space-y-6">
    <section className={card} aria-labelledby="payment-review-list-title">
      <h2 id="payment-review-list-title" className="text-base font-semibold">Danh sách giao dịch</h2>
      {list.isError ? <ReadError error={list.error} busy={list.isFetching} retry={() => void list.refetch()} />
        : !list.data ? <LoadingRows />
        : <div aria-busy={list.isFetching}>
          {list.isFetching ? <p role="status" className="mt-3 text-sm text-gray-600">Đang cập nhật danh sách…</p> : null}
          {list.data.data.length === 0 ? <p className="py-6 text-sm text-gray-600">Không có giao dịch cần đối soát ở trang này.</p>
            : <ul className="mt-4 divide-y divide-gray-200">{list.data.data.map(row => <li key={row.id} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-semibold wrap-anywhere">Đơn <span className="font-mono">{row.bookingCode}</span></h3>
                  <p className="text-sm text-gray-600 wrap-anywhere">{reasons[row.reasonCode]}</p>
                </div>
                <Button variant="secondary" aria-label={`${selected === row.id ? "Đóng chi tiết" : "Xem giao dịch"} ${row.transactionNo}`} aria-expanded={selected === row.id}
                  aria-controls="payment-review-detail" onClick={() => setSelected(selected === row.id ? null : row.id)}>
                  <Eye size={16} aria-hidden="true" />{selected === row.id ? "Đóng chi tiết" : "Xem giao dịch"}
                </Button>
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 text-sm">
                <div><dt className="text-gray-600">Tiền dự kiến của phiên</dt><dd className="font-medium tabular-nums">{decimalPriceLabel(row.expectedAmount)}đ</dd></div>
                <div><dt className="text-gray-600">Tiền nhận theo chứng cứ</dt><dd className="font-semibold tabular-nums">{decimalPriceLabel(row.receivedAmount)}đ</dd></div>
              </dl>
              <p className="text-xs text-gray-600">Nhận chứng cứ: <time dateTime={row.receivedAt}>{dateLabel(row.receivedAt)}</time> (giờ Việt Nam)</p>
            </li>)}</ul>}
          {(list.data.meta.totalPages > 1 || page > 1) ? <nav aria-label="Phân trang giao dịch" className="mt-4 flex items-center justify-end gap-3 border-t border-gray-200 pt-3">
            <Button variant="secondary" size="icon" aria-label="Trang trước" disabled={list.isFetching || page <= 1}
              onClick={() => { setSelected(null); setPage(page - 1); }}><ChevronLeft size={16} aria-hidden="true" /></Button>
            <span className="text-sm tabular-nums" aria-current="page">Trang {page}<span className="sr-only">; {list.data.meta.totalPages} trang dữ liệu</span></span>
            <Button variant="secondary" size="icon" aria-label="Trang sau" disabled={list.isFetching || page >= list.data.meta.totalPages || page >= 1000000}
              onClick={() => { setSelected(null); setPage(page + 1); }}><ChevronRight size={16} aria-hidden="true" /></Button>
          </nav> : null}
        </div>}
    </section>
    <section id="payment-review-detail" className={card} aria-labelledby="payment-review-detail-title">
      <h2 id="payment-review-detail-title" className="mb-4 text-base font-semibold">Chi tiết chứng cứ đối soát</h2>
      {selected ? <ReviewDetail key={selected} id={selected} sessionId={sessionId} />
        : <p className="text-sm text-gray-600">Chọn một giao dịch để xem chứng cứ và trạng thái đơn hiện tại.</p>}
    </section>
  </div>;
}

function ReviewDetail({ id, sessionId }: { id: string; sessionId: string }) {
  const detail = useQuery({ queryKey: ["admin-payment-review-detail", sessionId, id],
    queryFn: ({ signal }) => paymentReviewsApi.read(id, signal), retry: false, gcTime: 0, refetchOnWindowFocus: true });
  return detail.isError ? <ReadError error={detail.error} busy={detail.isFetching} retry={() => void detail.refetch()} />
    : !detail.data ? <LoadingRows detail /> : <div aria-busy={detail.isFetching}>
      {detail.isFetching ? <p role="status" className="mb-3 text-sm text-gray-600">Đang cập nhật trạng thái đơn…</p> : null}
      <PaymentReviewSnapshot row={detail.data} />
    </div>;
}

export function PaymentReviewSnapshot({ row }: { row: PaymentReview }) {
  const fields = [
    ["Mã đơn", row.bookingCode], ["Mã giao dịch nhà cung cấp", row.transactionNo],
    ["Nhà cung cấp", "VNPay Sandbox"], ["Lý do cần đối soát", reasons[row.reasonCode]],
    ["Tiền dự kiến của phiên", `${decimalPriceLabel(row.expectedAmount)}đ`],
    ["Tiền nhận theo chứng cứ", `${decimalPriceLabel(row.receivedAmount)}đ`],
    ["Hạn phiên thanh toán", `${dateLabel(row.sessionExpiresAt)} (giờ Việt Nam)`],
    ["Thời điểm nhà cung cấp ghi nhận", row.payDate ? `${dateLabel(row.payDate)} (giờ Việt Nam)` : "Không có thời điểm hợp lệ trong chứng cứ"],
    ["Thời điểm nhận chứng cứ", `${dateLabel(row.receivedAt)} (giờ Việt Nam)`],
    ["Phiên bản đơn lúc tạo phiên", String(row.sessionBookingVersion)],
    ["Phiên bản đơn hiện tại", String(row.bookingVersion)],
    ["Trạng thái đơn hiện tại", bookingLabels[row.bookingStatus]],
    ["Thanh toán của đơn hiện tại", paymentLabels[row.paymentStatus]],
    ["ID chứng cứ", row.id], ["ID phiên thanh toán", row.sessionId], ["ID đơn", row.bookingId],
  ];
  return <div className="space-y-5">
    <p className="max-w-[75ch] text-sm text-gray-600 text-pretty">Số tiền và hạn phiên là ảnh chụp lúc tạo thanh toán; trạng thái đơn là dữ liệu hiện tại. Đơn đã trả tiền không có nghĩa chứng cứ này đã được đối soát. Trang chỉ đọc, không chuyển tiền hoặc thay đổi đơn.</p>
    <dl className="@container space-y-3 text-sm">{fields.map(([label, value]) => <div key={label}
      className="grid gap-1 @sm:grid-cols-[10rem_minmax(0,1fr)] @sm:items-baseline @sm:gap-4">
      <dt className="text-gray-600 text-pretty">{label}</dt>
      <dd className={`min-w-0 font-medium wrap-anywhere ${label.startsWith("ID ") || label.startsWith("Mã ") ? "font-mono" : "tabular-nums"}`}>{value}</dd>
    </div>)}</dl>
  </div>;
}
