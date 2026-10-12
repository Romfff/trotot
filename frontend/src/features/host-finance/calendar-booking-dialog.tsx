"use client";

import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apiError } from "@/lib/api/client";
import { hostCalendarApi } from "@/lib/api/host-calendar";

const statuses: Record<string, string> = {
  PENDING_PAYMENT: "Chờ thanh toán", PENDING_HOST_APPROVAL: "Chờ chủ nhà duyệt",
  CONFIRMED: "Đã xác nhận", CHECKED_IN: "Đã nhận phòng", COMPLETED: "Đã hoàn tất",
  CANCELLED_TIMEOUT: "Hết hạn thanh toán", CANCELLED_HOST_TIMEOUT: "Hết hạn chủ nhà duyệt",
  REJECTED_BY_HOST: "Chủ nhà từ chối", CANCELLED_BY_GUEST: "Khách đã hủy", CANCELLED: "Đã hủy",
  NOT_CONFIGURED: "Chưa kết nối thanh toán", PENDING: "Chờ thanh toán", PAID: "Đã thanh toán",
  REFUNDED: "Đã hoàn tiền", PARTIALLY_REFUNDED: "Đã hoàn một phần", FAILED: "Thanh toán thất bại",
};

export function CalendarBookingDialog({ sessionId, unitId, bookingId, date, onClose, returnFocus }:
  { sessionId: string; unitId: string; bookingId: string; date: string; onClose: () => void; returnFocus: HTMLElement | null }) {
  const title = useRef<HTMLHeadingElement>(null);
  const query = useQuery({ queryKey: ["host-calendar-booking", sessionId, unitId, bookingId, date],
    queryFn: ({ signal }) => hostCalendarApi.booking(unitId, bookingId, date, signal), retry: false, gcTime: 0 });
  const rows = query.data ? [
    ["Mã đơn", query.data.bookingCode], ["Khách đặt", query.data.guestName], ["Số điện thoại", query.data.guestPhone],
    ["Nhận phòng", query.data.checkInDate], ["Trả phòng", query.data.checkOutDate],
    ["Trạng thái đơn", statuses[query.data.bookingStatus] ?? query.data.bookingStatus],
    ["Thanh toán", statuses[query.data.paymentStatus] ?? query.data.paymentStatus],
  ] : [];
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[80dvh] overflow-y-auto" onOpenAutoFocus={event => { event.preventDefault(); title.current?.focus(); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus?.isConnected) returnFocus.focus(); }}>
      <DialogHeader><DialogTitle ref={title} tabIndex={-1}>Thông tin đơn đặt phòng</DialogTitle>
        <DialogDescription className="mt-2 text-sm/6">Thông tin hiện tại từ máy chủ, chỉ dành cho chủ phòng.</DialogDescription></DialogHeader>
      {query.isPending ? <div className="mt-4 space-y-3" role="status" aria-label="Đang tải thông tin đơn" aria-busy="true">
        {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-8 rounded-lg bg-background motion-safe:animate-pulse" />)}
      </div> : query.isError ? <div className="mt-4 space-y-3"><Alert>{apiError(query.error).message}</Alert><Button type="button" variant="secondary" onClick={() => void query.refetch()}>Thử lại thông tin đơn</Button></div>
        : <dl className="@container mt-4 space-y-3 text-sm">{rows.map(([label, value]) => <div key={label} className="grid gap-1 @sm:grid-cols-[7rem_minmax(0,1fr)] @sm:items-baseline @sm:gap-6">
          <dt className="text-gray-600">{label}</dt><dd className="min-w-0 font-medium [overflow-wrap:anywhere]">{value}</dd>
        </div>)}</dl>}
    </DialogContent>
  </Dialog>;
}
