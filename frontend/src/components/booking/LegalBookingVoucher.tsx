"use client";

import { useState } from "react";
import {
  Copy,
  Check,
  FileCheck2,
  Printer,
  Scale,
  ShieldCheck,
  Building2,
  UserCheck,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Booking } from "@/lib/api/homestays";
import type { BookingPaymentStatus } from "@/lib/api/booking-payments";
import type {
  AppointmentResponseDto,
  HostAppointmentResponseDto,
} from "@/lib/api/appointment-types.generated";

const vndFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

const vnDateTime = (iso: string) => {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
};

const vnDateOnly = (dateStr: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-");
    return `${d}/${m}/${y}`;
  }
  return vnDateTime(dateStr);
};

const DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

function readThreeDigits(n: number, showZeroHundred: boolean): string {
  const hundred = Math.floor(n / 100);
  const ten = Math.floor((n % 100) / 10);
  const unit = n % 10;
  const parts: string[] = [];

  if (hundred > 0 || showZeroHundred) {
    parts.push(`${DIGITS[hundred]} trăm`);
  }

  if (ten > 1) {
    parts.push(`${DIGITS[ten]} mươi`);
    if (unit === 1) parts.push("mốt");
    else if (unit === 4) parts.push("tư");
    else if (unit === 5) parts.push("lăm");
    else if (unit > 0) parts.push(DIGITS[unit]);
  } else if (ten === 1) {
    parts.push("mười");
    if (unit === 5) parts.push("lăm");
    else if (unit > 0) parts.push(DIGITS[unit]);
  } else if (ten === 0 && unit > 0) {
    if (hundred > 0 || showZeroHundred) {
      parts.push("lẻ");
    }
    parts.push(DIGITS[unit]);
  }

  return parts.join(" ");
}

/**
 * Chuyển số tiền VNĐ sang chữ tiếng Việt chuẩn kế toán - pháp lý
 */
export function numberToVietnameseWords(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "Không đồng";
  const rounded = Math.round(amount);
  const units = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ"];
  const groups: number[] = [];
  let temp = rounded;
  while (temp > 0) {
    groups.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  const textParts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const grp = groups[i];
    if (grp > 0) {
      const showZeroHundred = i < groups.length - 1;
      const chunk = readThreeDigits(grp, showZeroHundred);
      const unitLabel = units[i] || "";
      textParts.push(unitLabel ? `${chunk} ${unitLabel}` : chunk);
    }
  }

  const raw = textParts.join(" ").trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1) + " đồng chẵn.";
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  PENDING_PAYMENT: "Đang giữ chỗ — Chờ thanh toán",
  PENDING_HOST_APPROVAL: "Đang giữ chỗ — Chờ chủ nhà phê duyệt",
  CONFIRMED: "Đã xác nhận đặt phòng hợp lệ",
  CHECKED_IN: "Khách đã nhận phòng (Checked-in)",
  COMPLETED: "Đã hoàn tất hợp đồng lưu trú",
  CANCELLED_TIMEOUT: "Hết thời hạn thanh toán",
  CANCELLED_HOST_TIMEOUT: "Hết thời hạn chủ nhà phê duyệt",
  REJECTED_BY_HOST: "Chủ nhà từ chối tiếp nhận",
  CANCELLED_BY_GUEST: "Khách đã hủy đơn",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  NOT_CONFIGURED: "Chưa thanh toán (Thanh toán tại cổng giao dịch)",
  PENDING: "Đang chờ xác nhận từ cổng thanh toán",
  PAID: "ĐÃ THANH TOÁN & KÝ QUỸ ĐỐI SOÁT",
  REFUNDED: "ĐÃ HOÀN TIỀN CHO KHÁCH ĐẶT",
};

function calcNights(checkIn: string, checkOut: string, fallbackNights?: number): number {
  const start = Date.parse(checkIn);
  const end = Date.parse(checkOut);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return Math.max(1, Math.round((end - start) / 86400000));
  }
  return fallbackNights && fallbackNights > 0 ? fallbackNights : 1;
}

export function LegalBookingVoucher({
  booking,
}: {
  booking: Booking;
}) {
  const [copied, setCopied] = useState(false);
  const nights = calcNights(
    booking.checkInDate,
    booking.checkOutDate,
    booking.nightlyPrices?.length,
  );
  const isPaid = booking.paymentStatus === "PAID";
  const isConfirmed =
    booking.bookingStatus === "CONFIRMED" ||
    booking.bookingStatus === "CHECKED_IN" ||
    booking.bookingStatus === "COMPLETED";

  function handleCopyCode() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(booking.bookingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handlePrint() {
    if (typeof window !== "undefined") {
      window.print();
    }
  }

  return (
    <article
      className="legal-voucher-sheet relative rounded-md border-2 border-slate-800/90 bg-white text-slate-900 shadow-lg print:border-slate-900 print:shadow-none"
      aria-label={`Phiếu xác nhận đơn đặt phòng pháp lý ${booking.bookingCode}`}
    >
      {/* Top Action Toolbar (Hidden when printing) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-4 py-3 text-white print:hidden">
        <div className="flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
          <Scale className="size-4 text-sky-400 shrink-0" aria-hidden="true" />
          <span>Chứng từ giao dịch lưu trú có giá trị pháp lý</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopyCode}
            className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-100 hover:bg-slate-700 transition-colors"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-400" aria-hidden="true" />
                <span>Đã sao chép mã</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5 text-slate-300" aria-hidden="true" />
                <span>Sao chép mã: {booking.bookingCode}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
          >
            <Printer className="size-3.5" aria-hidden="true" />
            <span>In phiếu / Lưu PDF</span>
          </button>
        </div>
      </div>

      {/* Document Body */}
      <div className="p-5 sm:p-8 space-y-6 text-sm leading-relaxed">
        {/* Quốc hiệu & Tiêu ngữ */}
        <header className="border-b-2 border-double border-slate-800 pb-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
            <div className="space-y-1">
              <p className="text-xs font-bold tracking-widest uppercase text-slate-700">
                HỆ THỐNG SÀN TMĐT LƯU TRÚ TRỌ TỐT
              </p>
              <p className="text-xs text-slate-600">
                Trung tâm Đối soát & Bảo vệ Giao dịch Lưu trú
              </p>
              <p className="text-xs font-mono text-slate-700 pt-1">
                Số chứng từ:{" "}
                <strong className="font-bold text-slate-900">
                  {booking.bookingCode}/2026/TT-ĐP
                </strong>
              </p>
              <p className="text-xs font-mono text-slate-600">
                Mã định danh (UUID): {booking.bookingId.slice(0, 18)}…
              </p>
            </div>

            <div className="text-left md:text-center space-y-1">
              <p className="text-xs sm:text-sm font-bold uppercase tracking-wide text-slate-900">
                CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
              </p>
              <p className="text-xs sm:text-sm font-bold text-slate-900">
                Độc lập - Tự do - Hạnh phúc
              </p>
              <div className="mx-auto md:w-36 w-28 border-b border-slate-800 pt-1" />
              <p className="text-xs italic text-slate-600 pt-1">
                Lập lúc: {vnDateTime(booking.serverTime)} (Giờ Việt Nam)
              </p>
            </div>
          </div>

          <div className="mt-5 text-center space-y-1.5">
            <h3 className="text-base sm:text-lg font-extrabold uppercase tracking-wide text-slate-900">
              PHIẾU XÁC NHẬN ĐƠN ĐẶT PHÒNG &amp; HỢP ĐỒNG GIỮ CHỖ ĐIỆN TỬ
            </h3>
            <p className="text-xs text-slate-600">
              (Ban hành kèm theo Quy chế giao dịch điện tử và Bảo vệ quyền lợi người thuê trên nền tảng Trọ Tốt)
            </p>
          </div>

          {/* Status Summary Strip */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs">
            <div className="flex items-center gap-2">
              <FileCheck2 className="size-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span className="text-slate-600">Trạng thái phiếu:</span>
              <strong className="font-bold text-slate-900">
                {BOOKING_STATUS_LABELS[booking.bookingStatus] || booking.bookingStatus}
              </strong>
            </div>
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={`size-4 shrink-0 ${isPaid ? "text-emerald-700" : "text-amber-700"}`}
                aria-hidden="true"
              />
              <span className="text-slate-600">Thanh toán:</span>
              <strong className={`font-bold ${isPaid ? "text-emerald-800" : "text-amber-800"}`}>
                {PAYMENT_STATUS_LABELS[booking.paymentStatus] || booking.paymentStatus}
              </strong>
            </div>
          </div>
        </header>

        {/* I. Căn cứ pháp lý */}
        <section className="space-y-1.5 text-xs text-slate-700 bg-slate-50/70 p-3.5 rounded border border-slate-200/80">
          <h4 className="font-bold uppercase tracking-wider text-slate-900">
            I. CĂN CỨ PHÁP LÝ ÁP DỤNG
          </h4>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              Căn cứ <strong>Bộ luật Dân sự số 91/2015/QH13</strong> ngày 24/11/2015 của Quốc hội nước CHXHCN Việt Nam về xác lập, thực hiện giao dịch dân sự và hợp đồng thuê tài sản (Điều 385, Điều 401, Điều 472);
            </li>
            <li>
              Căn cứ <strong>Luật Giao dịch điện tử số 20/2023/QH15</strong> quy định về giá trị pháp lý của thông điệp dữ liệu và chứng từ điện tử;
            </li>
            <li>
              Căn cứ <strong>Luật Cư trú số 68/2020/QH14</strong> (Điều 30 về trách nhiệm khai báo và thông báo lưu trú của cơ sở kinh doanh lưu trú);
            </li>
            <li>
              Căn cứ <strong>Luật Bảo vệ quyền lợi người tiêu dùng</strong> và thỏa thuận đặt phòng trực tuyến được xác lập bởi tài khoản định danh của khách hàng trên hệ thống Trọ Tốt.
            </li>
          </ul>
        </section>

        {/* II. Thông tin các bên tham gia giao dịch */}
        <section className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1.5">
            II. THÔNG TIN CÁC BÊN THAM GIA GIAO DỊCH
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded border border-slate-200 p-3.5 space-y-1.5 bg-white">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-blue-900">
                <UserCheck className="size-4 shrink-0" aria-hidden="true" />
                <span>1. Bên Đặt Phòng / Khách Lưu Trú (Bên A)</span>
              </div>
              <dl className="text-xs space-y-1 pt-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Họ và tên khách nhận phòng:</dt>
                  <dd className="font-bold text-slate-900 text-right">{booking.guestName}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Số điện thoại định danh:</dt>
                  <dd className="font-bold text-slate-900 tabular-nums text-right">
                    {booking.guestPhone}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Thư điện tử (Email):</dt>
                  <dd className="font-medium text-slate-800 text-right break-all">
                    {booking.guestEmail || "Nhận chứng từ trực tiếp trên hệ thống"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Tư cách pháp lý:</dt>
                  <dd className="text-slate-800 text-right">Người tiêu dùng / Khách lưu trú hợp pháp</dd>
                </div>
              </dl>
            </div>

            <div className="rounded border border-slate-200 p-3.5 space-y-1.5 bg-white">
              <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-blue-900">
                <Building2 className="size-4 shrink-0" aria-hidden="true" />
                <span>2. Đơn Vị Lưu Trú &amp; Trung Gian Đối Soát (Bên B)</span>
              </div>
              <dl className="text-xs space-y-1 pt-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Đơn vị vận hành sàn:</dt>
                  <dd className="font-bold text-slate-900 text-right">Hệ thống Lưu trú Trọ Tốt</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Mã đơn vị phòng (Unit ID):</dt>
                  <dd className="font-mono font-semibold text-slate-800 text-right">
                    {booking.unitId.slice(0, 13)}…
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Cổng thanh toán đối soát:</dt>
                  <dd className="font-medium text-slate-800 text-right">VNPay Escrow (Tạm giữ bảo vệ)</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600">Phiên bản bản ghi (Version):</dt>
                  <dd className="font-mono text-slate-800 text-right">v{booking.version}</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* III. Chi tiết dịch vụ lưu trú */}
        <section className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1.5">
            III. THÔNG TIN CHI TIẾT KỲ LƯU TRÚ ĐĂNG KÝ
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-600 block">Ngày nhận phòng (Check-in)</span>
              <strong className="mt-1 block text-sm font-bold text-slate-900 tabular-nums">
                {vnDateOnly(booking.checkInDate)}
              </strong>
              <span className="text-[11px] text-slate-600">Từ 14:00 (Giờ VN)</span>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-600 block">Ngày trả phòng (Check-out)</span>
              <strong className="mt-1 block text-sm font-bold text-slate-900 tabular-nums">
                {vnDateOnly(booking.checkOutDate)}
              </strong>
              <span className="text-[11px] text-slate-600">Trước 12:00 (Giờ VN)</span>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-600 block">Thời lượng lưu trú</span>
              <strong className="mt-1 block text-sm font-bold text-slate-900 tabular-nums">
                {nights} đêm
              </strong>
              <span className="text-[11px] text-slate-600">Theo lịch đã khóa</span>
            </div>
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <span className="text-slate-600 block">Số lượng khách đăng ký</span>
              <strong className="mt-1 block text-sm font-bold text-slate-900 tabular-nums">
                {booking.numAdults} người lớn
                {booking.numChildren > 0 ? `, ${booking.numChildren} trẻ em` : ""}
              </strong>
              <span className="text-[11px] text-slate-600">Đúng định mức phòng</span>
            </div>
          </div>
          {booking.bookingStatus.startsWith("PENDING_") && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-2">
              <Clock className="size-4 text-amber-700 shrink-0" aria-hidden="true" />
              <span>
                <strong>Thời hạn giữ chỗ pháp lý:</strong> Đơn đặt phòng được khóa lịch tạm thời đến{" "}
                <strong className="tabular-nums">{vnDateTime(booking.expiresAt)}</strong> (giờ Việt Nam). Quá thời hạn trên mà chưa hoàn tất xác nhận/thanh toán, hệ thống sẽ tự động giải phóng lịch phòng.
              </span>
            </p>
          )}
        </section>

        {/* IV. Bảng kê chi tiết nghĩa vụ tài chính */}
        <section className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1.5">
            IV. BẢNG KÊ CHI TIẾT NGHĨA VỤ TÀI CHÍNH &amp; PHÍ GIAO DỊCH (VNĐ)
          </h4>
          <div className="overflow-x-auto rounded border border-slate-300">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-300 text-slate-800">
                  <th className="py-2.5 px-3 font-bold w-12 text-center">STT</th>
                  <th className="py-2.5 px-3 font-bold">Khoản mục thanh toán</th>
                  <th className="py-2.5 px-3 font-bold">Diễn giải</th>
                  <th className="py-2.5 px-3 font-bold text-right">Thành tiền (VNĐ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="py-2 px-3 text-center tabular-nums">01</td>
                  <td className="py-2 px-3 font-semibold text-slate-900">Tiền thuê phòng lưu trú</td>
                  <td className="py-2 px-3 text-slate-600">
                    Giá thuê tiêu chuẩn cho {nights} đêm ({vnDateOnly(booking.checkInDate)} –{" "}
                    {vnDateOnly(booking.checkOutDate)})
                  </td>
                  <td className="py-2 px-3 text-right font-semibold tabular-nums text-slate-900">
                    {vndFormatter.format(booking.baseAmount)} đ
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-center tabular-nums">02</td>
                  <td className="py-2 px-3 font-medium text-slate-900">Phí vệ sinh &amp; khử khuẩn</td>
                  <td className="py-2 px-3 text-slate-600">Phí chuẩn bị phòng tiêu chuẩn 1 lần/kỳ</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-800">
                    {vndFormatter.format(booking.cleaningFee)} đ
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-center tabular-nums">03</td>
                  <td className="py-2 px-3 font-medium text-slate-900">Phí dịch vụ nền tảng &amp; Bảo vệ</td>
                  <td className="py-2 px-3 text-slate-600">
                    Phí vận hành sàn, bảo hiểm giữ chỗ &amp; đối soát thanh toán
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-800">
                    {vndFormatter.format(booking.serviceFee)} đ
                  </td>
                </tr>
                <tr>
                  <td className="py-2 px-3 text-center tabular-nums">04</td>
                  <td className="py-2 px-3 font-medium text-slate-900">Thuế GTGT &amp; Phí pháp lý</td>
                  <td className="py-2 px-3 text-slate-600">Thuế Giá trị gia tăng theo quy định hiện hành</td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-800">
                    {vndFormatter.format(booking.taxAmount)} đ
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-900 text-white font-bold">
                  <td colSpan={3} className="py-2.5 px-3 uppercase tracking-wide">
                    Tổng giá trị thanh toán theo hợp đồng đặt phòng
                  </td>
                  <td className="py-2.5 px-3 text-right text-sm tabular-nums">
                    {vndFormatter.format(booking.totalAmount)} đ
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-slate-700 italic">
            <strong>Số tiền viết bằng chữ:</strong> {numberToVietnameseWords(booking.totalAmount)}
          </p>
        </section>

        {/* V. Điều khoản pháp lý & Cam kết thực hiện */}
        <section className="space-y-2 text-xs text-slate-700">
          <h4 className="font-bold uppercase tracking-wider text-slate-900 border-b border-slate-200 pb-1.5">
            V. ĐIỀU KHOẢN PHÁP LÝ, TRÁCH NHIỆM CÁC BÊN &amp; GIẢI QUYẾT TRANH CHẤP
          </h4>
          <ol className="list-decimal pl-4 space-y-1.5">
            <li>
              <strong>Nghĩa vụ khai báo lưu trú bắt buộc:</strong> Khi làm thủ tục nhận phòng (Check-in), Bên A và toàn bộ khách đi cùng có nghĩa vụ xuất trình bản gốc Căn cước công dân (CCCD), tài khoản định danh điện tử VNeID mức 2 hoặc Hộ chiếu còn hiệu lực để Chủ cơ sở lưu trú thực hiện thông báo lưu trú theo đúng Điều 30 Luật Cư trú 2020.
            </li>
            <li>
              <strong>Cơ chế phong tỏa tiền &amp; Bảo vệ người đặt phòng:</strong> Khoản tiền thanh toán của Bên A được Hệ thống Trọ Tốt quản lý đối soát. Trường hợp cơ sở lưu trú không đúng địa chỉ, sai lệch nghiêm trọng so với hình ảnh/mô tả công bố hoặc Chủ nhà tự ý hủy phòng trái quy định, Bên A có quyền gửi yêu cầu qua mục <em>“Khiếu nại về đơn này”</em> trong vòng 24 giờ kể từ giờ Check-in để được bảo vệ quyền lợi và hoàn trả 100% số tiền đã thanh toán.
            </li>
            <li>
              <strong>Trách nhiệm an ninh trật tự &amp; Bảo quản tài sản:</strong> Bên A cam kết sử dụng phòng đúng mục đích lưu trú, đúng số lượng người đã đăng ký; tuyệt đối không tàng trữ, sử dụng chất ma túy, chất cấm, vật liệu gây cháy nổ hoặc tổ chức hoạt động vi phạm pháp luật Việt Nam. Nếu gây hư hại tài sản, trang thiết bị trong phòng, Bên A có trách nhiệm bồi thường theo giá trị thực tế hợp lý.
            </li>
            <li>
              <strong>Giá trị pháp lý của chứng từ điện tử:</strong> Phiếu xác nhận này được khởi tạo tự động từ cơ sở dữ liệu máy chủ Trọ Tốt, gắn liền với Mã đơn <strong>{booking.bookingCode}</strong> và có giá trị pháp lý tương đương văn bản xác nhận giao dịch giữa các bên theo Luật Giao dịch điện tử.
            </li>
          </ol>
        </section>

        {/* Chữ ký & Dấu xác thực điện tử */}
        <footer className="pt-4 border-t border-slate-300 grid grid-cols-1 sm:grid-cols-2 gap-6 text-center text-xs">
          <div className="space-y-2">
            <p className="font-bold uppercase text-slate-900">ĐẠI DIỆN BÊN ĐẶT PHÒNG (BÊN A)</p>
            <p className="text-[11px] text-slate-600 italic">(Chữ ký điện tử xác lập khi gửi lệnh giữ phòng)</p>
            <div className="mx-auto my-2 inline-flex flex-col items-center rounded border border-emerald-600/60 bg-emerald-50/70 px-4 py-2 text-emerald-900">
              <span className="text-[10px] font-bold uppercase tracking-wider">ĐÃ KÝ XÁC NHẬN ĐIỆN TỬ</span>
              <span className="font-bold text-sm mt-0.5">{booking.guestName}</span>
              <span className="text-[11px] tabular-nums">SĐT: {booking.guestPhone}</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="font-bold uppercase text-slate-900">XÁC THỰC BỞI HỆ THỐNG TRỌ TỐT (BÊN B)</p>
            <p className="text-[11px] text-slate-600 italic">(Chứng thực tự động bởi Trung tâm Đối soát Giao dịch)</p>
            <div className="mx-auto my-2 inline-flex flex-col items-center rounded border-2 border-red-700/80 bg-red-50/70 px-4 py-2 text-red-900">
              <span className="text-[10px] font-extrabold uppercase tracking-widest">
                {isPaid
                  ? "ĐÃ THU TIỀN & ĐỐI SOÁT HỢP LỆ"
                  : isConfirmed
                  ? "ĐÃ XÁC NHẬN GIỮ PHÒNG"
                  : "CHỨNG TỪ ĐẶT GIỮ CHỖ HỢP LỆ"}
              </span>
              <span className="font-extrabold text-xs mt-0.5">SÀN TMĐT LƯU TRÚ TRỌ TỐT</span>
              <span className="text-[11px] font-mono">Mã số: {booking.bookingCode}</span>
            </div>
          </div>
        </footer>
      </div>
    </article>
  );
}

/**
 * Nút mở Hộp thoại Phiếu Xác Nhận Đặt Phòng Pháp Lý (dùng trong danh sách đơn đặt phòng /bookings & /host/bookings)
 */
export function LegalBookingVoucherModalButton({ booking }: { booking: Booking }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" className="inline-flex items-center gap-1.5 text-xs">
          <Scale className="size-4 text-brand shrink-0" aria-hidden="true" />
          <span>Phiếu đặt phòng pháp lý ({booking.bookingCode})</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[92dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="print:hidden">
          <DialogTitle>Phiếu xác nhận đơn đặt phòng &amp; Chứng từ pháp lý</DialogTitle>
          <DialogDescription>
            Mã đơn {booking.bookingCode} · Bạn có thể in trực tiếp hoặc lưu thành tệp PDF để xuất trình khi nhận phòng và đối soát.
          </DialogDescription>
        </DialogHeader>
        <LegalBookingVoucher booking={booking} defaultExpanded />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Phiếu Chứng Từ Giao Dịch Thanh Toán Pháp Lý trên màn /bookings/[id]/payment
 */
export function LegalPaymentVoucher({
  status,
  guestName,
  guestPhone,
}: {
  status: BookingPaymentStatus;
  guestName?: string;
  guestPhone?: string;
}) {
  const amountNum = Number(status.amount) || 0;
  const verified = status.payment?.verified === true && status.paymentStatus === "PAID";

  return (
    <article
      className="legal-voucher-sheet rounded-md border-2 border-slate-800/90 bg-white text-slate-900 shadow-md print:border-slate-900 print:shadow-none"
      aria-label={`Chứng từ pháp lý giao dịch ${status.bookingCode}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-4 py-2.5 text-white print:hidden">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <Scale className="size-4 text-sky-400" aria-hidden="true" />
          <span>Phiếu xác nhận giao dịch &amp; Đối soát pháp lý</span>
        </div>
        <button
          type="button"
          onClick={() => typeof window !== "undefined" && window.print()}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
        >
          <Printer className="size-3.5" aria-hidden="true" />
          <span>In chứng từ / Xuất PDF</span>
        </button>
      </div>

      <div className="p-5 sm:p-6 space-y-4 text-xs leading-relaxed">
        <div className="text-center border-b border-slate-300 pb-4 space-y-1">
          <p className="font-bold uppercase text-slate-900">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
          <p className="font-bold text-slate-800">Độc lập - Tự do - Hạnh phúc</p>
          <h3 className="pt-2 text-sm sm:text-base font-extrabold uppercase text-slate-900">
            CHỨNG TỪ ĐỐI SOÁT THANH TOÁN &amp; XÁC NHẬN ĐƠN ĐẶT PHÒNG
          </h3>
          <p className="font-mono text-slate-600">
            Mã đơn: <strong className="text-slate-900">{status.bookingCode}</strong> · Phiên bản đối soát: v{status.version}
          </p>
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 p-3.5">
          <div>
            <dt className="text-slate-600">Người thực hiện giao dịch:</dt>
            <dd className="font-bold text-slate-900">{guestName || "Khách hàng định danh trên hệ thống"}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Số điện thoại tài khoản:</dt>
            <dd className="font-bold text-slate-900 tabular-nums">{guestPhone || "Đã xác thực"}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Trạng thái đơn đặt phòng:</dt>
            <dd className="font-bold text-slate-900">
              {BOOKING_STATUS_LABELS[status.bookingStatus] || status.bookingStatus}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Trạng thái thanh toán máy chủ:</dt>
            <dd className={`font-bold ${verified ? "text-emerald-800" : "text-amber-800"}`}>
              {PAYMENT_STATUS_LABELS[status.paymentStatus] || status.paymentStatus}
            </dd>
          </div>
          <div className="sm:col-span-2 border-t border-slate-200 pt-2">
            <dt className="text-slate-600">Tổng nghĩa vụ thanh toán:</dt>
            <dd className="text-sm font-extrabold text-slate-900 tabular-nums">
              {vndFormatter.format(amountNum)} VNĐ{" "}
              <span className="font-normal italic text-slate-700">
                ({numberToVietnameseWords(amountNum)})
              </span>
            </dd>
          </div>
          {status.payment && (
            <div className="sm:col-span-2 border-t border-slate-200 pt-2 text-emerald-900">
              <dt className="font-semibold">Chứng cứ xác thực từ Cổng thanh toán VNPay:</dt>
              <dd className="font-mono mt-0.5">
                Mã phiên giao dịch: {status.payment.sessionId} · Xác nhận lúc: {vnDateTime(status.payment.paidAt)}
              </dd>
            </div>
          )}
        </dl>

        <div className="space-y-1 text-slate-700">
          <p className="font-bold text-slate-900">Cam kết pháp lý &amp; Bảo vệ thanh toán:</p>
          <p>
            Chứng từ này được trích xuất trực tiếp từ trạng thái máy chủ Trọ Tốt lúc{" "}
            <strong className="tabular-nums">{vnDateTime(status.serverTime)}</strong> theo quy định của Luật Giao dịch điện tử 2023 và Bộ luật Dân sự 2015. Mọi giao dịch thanh toán qua cổng VNPay được bảo vệ đối soát hai chiều trước khi tất toán cho Chủ nhà.
          </p>
        </div>
      </div>
    </article>
  );
}

/**
 * Phiếu Xác Nhận Lịch Hẹn Xem Phòng Trọ Dài Hạn (Pháp lý & Bảo vệ người thuê trọ)
 */
export function LegalAppointmentVoucher({
  record,
  tenantNameFallback,
  tenantPhoneFallback,
}: {
  record: AppointmentResponseDto | HostAppointmentResponseDto;
  tenantNameFallback?: string;
  tenantPhoneFallback?: string;
}) {
  const tenantName = "tenantName" in record ? record.tenantName : tenantNameFallback || "Khách hẹn xem phòng";
  const tenantPhone = "tenantPhone" in record ? record.tenantPhone : tenantPhoneFallback || "Đã đăng ký trên hệ thống";

  return (
    <article
      className="legal-voucher-sheet rounded-md border-2 border-slate-800/90 bg-white text-slate-900 shadow-md print:border-slate-900 print:shadow-none"
      aria-label={`Phiếu xác nhận lịch hẹn xem phòng ${record.title}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-900 px-4 py-2.5 text-white print:hidden">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <Scale className="size-4 text-sky-400" aria-hidden="true" />
          <span>Phiếu xác nhận lịch hẹn xem phòng &amp; Bảo vệ pháp lý</span>
        </div>
        <button
          type="button"
          onClick={() => typeof window !== "undefined" && window.print()}
          className="inline-flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500 transition-colors"
        >
          <Printer className="size-3.5" aria-hidden="true" />
          <span>In phiếu hẹn / Xuất PDF</span>
        </button>
      </div>

      <div className="p-5 sm:p-6 space-y-4 text-xs leading-relaxed">
        <header className="text-center border-b border-slate-300 pb-3 space-y-1">
          <p className="font-bold uppercase text-slate-900">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</p>
          <p className="font-bold text-slate-800">Độc lập - Tự do - Hạnh phúc</p>
          <h3 className="pt-2 text-sm sm:text-base font-extrabold uppercase text-slate-900">
            PHIẾU XÁC NHẬN ĐẶT LỊCH XEM PHÒNG TRỌ / NHÀ CHO THUÊ
          </h3>
          <p className="font-mono text-slate-600">
            Mã phiếu hẹn: <strong className="text-slate-900">{record.id.slice(0, 8).toUpperCase()}</strong> · Lập lúc:{" "}
            {vnDateTime(record.createdAt)}
          </p>
        </header>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 p-3.5">
          <div className="sm:col-span-2">
            <dt className="text-slate-600">Bất động sản / Phòng đăng ký xem:</dt>
            <dd className="font-bold text-sm text-slate-900">{record.title}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Họ tên khách đến xem:</dt>
            <dd className="font-bold text-slate-900">{tenantName}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Số điện thoại liên hệ:</dt>
            <dd className="font-bold text-slate-900 tabular-nums">{tenantPhone}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Thời gian hẹn xem thực tế:</dt>
            <dd className="font-bold text-blue-900 tabular-nums">
              {vnDateOnly(record.scheduledDate)} lúc {record.scheduledTime.slice(0, 5)} (Giờ VN)
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Trạng thái xác nhận:</dt>
            <dd className="font-bold text-slate-900">{record.status}</dd>
          </div>
        </dl>

        <div className="rounded border border-amber-300 bg-amber-50/80 p-3 space-y-1.5 text-slate-800">
          <p className="font-bold uppercase text-amber-950">
            KHUYẾN CÁO PHÁP LÝ &amp; CAM KẾT BẢO VỆ NGƯỜI THUÊ TRỌ:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li>
              <strong>Phiếu hẹn xem phòng miễn phí 100%:</strong> Việc đặt lịch xem phòng trên Trọ Tốt hoàn toàn không thu phí môi giới và không yêu cầu chuyển khoản đặt cọc trước.
            </li>
            <li>
              <strong>Nguyên tắc ký hợp đồng thuê nhà (Điều 472 Bộ luật Dân sự 2015):</strong> Khách thuê tuyệt đối không chuyển tiền đặt cọc khi chưa trực tiếp khảo sát hiện trạng phòng, kiểm tra CCCD của Chủ nhà/Người đại diện hợp pháp và thống nhất rõ đơn giá điện, nước, phí dịch vụ bằng văn bản.
            </li>
          </ul>
        </div>
      </div>
    </article>
  );
}

export function LegalAppointmentVoucherModalButton({
  record,
  tenantNameFallback,
  tenantPhoneFallback,
}: {
  record: AppointmentResponseDto | HostAppointmentResponseDto;
  tenantNameFallback?: string;
  tenantPhoneFallback?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" className="inline-flex items-center gap-1.5 text-xs">
          <Scale className="size-4 text-brand shrink-0" aria-hidden="true" />
          <span>Phiếu hẹn pháp lý</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[92dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="print:hidden">
          <DialogTitle>Phiếu xác nhận lịch hẹn xem phòng</DialogTitle>
          <DialogDescription>
            Chứng từ xác nhận lịch hẹn xem trọ trực tiếp và các lưu ý pháp lý bảo vệ người thuê.
          </DialogDescription>
        </DialogHeader>
        <LegalAppointmentVoucher
          record={record}
          tenantNameFallback={tenantNameFallback}
          tenantPhoneFallback={tenantPhoneFallback}
        />
      </DialogContent>
    </Dialog>
  );
}
