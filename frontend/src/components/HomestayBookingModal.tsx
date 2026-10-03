"use client";

import { useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type HomestayItem, formatVND } from "@/lib/data";

type Props = {
  homestay: HomestayItem | null;
  onClose: () => void;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
};

export default function HomestayBookingModal({ homestay, onClose, initialCheckIn, initialCheckOut, initialGuests = 2 }: Props) {
  const returnFocus = useRef<HTMLElement | null>(null);
  if (!homestay) return null;
  const arrival = new Date();
  arrival.setDate(arrival.getDate() + 3);
  const departure = new Date();
  departure.setDate(departure.getDate() + 6);
  const checkIn = initialCheckIn || arrival.toISOString().slice(0, 10);
  const checkOut = initialCheckOut || departure.toISOString().slice(0, 10);
  const firstDay = new Date(checkIn + "T00:00:00Z");
  const nights = (new Date(checkOut + "T00:00:00Z").getTime() - firstDay.getTime()) / 86_400_000;
  const valid = Number.isInteger(nights) && nights > 0 && nights <= 90 && Number.isInteger(initialGuests) && initialGuests > 0 && initialGuests <= homestay.capacity;
  const priceGroups: Record<number, number> = {};
  let subtotal = 0;
  if (valid) {
    for (let i = 0; i < nights; i++) {
      const day = new Date(firstDay.getTime() + i * 86_400_000).getUTCDay();
      const rate = day === 5 || day === 6 ? Math.round(homestay.price * 1.25 / 1000) * 1000 : homestay.price;
      priceGroups[rate] = (priceGroups[rate] || 0) + 1;
      subtotal += rate;
    }
  }
  const serviceFee = Math.round(subtotal * 0.05);

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="booking-preview" onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement | null; }} onCloseAutoFocus={(event) => { if (returnFocus.current?.isConnected) { event.preventDefault(); returnFocus.current.focus(); } }}>
      <DialogTitle>{homestay.title}</DialogTitle>
      <DialogDescription className="mt-1">{homestay.location}</DialogDescription>
      <p className="text-xs text-gray-600 mt-3 p-3 bg-bg rounded-lg border border-gray-200">Dự kiến {checkIn} đến {checkOut} · {initialGuests} khách (tối đa {homestay.capacity}). Giá dưới đây là minh họa.</p>
      {valid ? <div className="mt-4 border-t border-gray-200 pt-3 divide-y divide-gray-200 text-sm">
        {Object.entries(priceGroups).map(([rate, count]) => <div key={rate} className="py-2 flex justify-between gap-3"><span className="text-gray-600">{count} đêm × {formatVND(Number(rate))}</span><span>{formatVND(Number(rate) * count)}</span></div>)}
        <div className="py-2 flex justify-between"><span className="text-gray-600">Phí vệ sinh</span><span>{formatVND(homestay.cleaningFee)}</span></div>
        <div className="py-2 flex justify-between"><span className="text-gray-600">Phí dịch vụ</span><span>{formatVND(serviceFee)}</span></div>
        <div className="py-3 flex justify-between font-bold text-base"><span>Tổng dự kiến</span><span className="text-brand">{formatVND(subtotal + homestay.cleaningFee + serviceFee)}</span></div>
      </div> : <p className="mt-4 text-error" role="alert">Chọn khoảng lưu trú từ 1–90 đêm và số khách phù hợp để xem giá mẫu.</p>}
      <button type="button" disabled className="w-full py-2.5 bg-brand text-white rounded-lg font-medium text-sm mt-4 disabled:opacity-60 disabled:cursor-not-allowed">{homestay.mode === "instant" ? "Giữ phòng 15 phút" : "Gửi yêu cầu đặt phòng"}</button>
      <p className="mt-3 text-xs text-gray-600">Đặt phòng chưa khả dụng. Không có phòng được giữ hoặc yêu cầu gửi tới chủ nhà trong bản demo.</p>
    </DialogContent>
  </Dialog>;
}
