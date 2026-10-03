"use client";
import React, { useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import Image from "next/image";
import { ROOMS, formatVND, formatNumber } from "@/lib/data";
import { useToast } from "@/components/ToastContext";
import { MapPin, Share2, Heart, Check, Phone } from "lucide-react";

const amenityLabels: Record<string, string> = {
  ac: "Máy lạnh", loft: "Gác lửng", kitchen: "Kệ bếp nấu ăn",
  washing: "Máy giặt chung", fingerprint: "Khóa vân tay",
  pets: "Cho phép nuôi thú cưng", security: "Camera an ninh",
};

export default function RoomDetailPage() {
  const params = useParams();
  const id = params?.id as string;
  const { showToast } = useToast();

  const room = ROOMS.find((r) => r.id === id);

  const [saved, setSaved] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  });
  const [appointmentTime, setAppointmentTime] = useState("15:30 (Chiều)");
  const [appointmentNote, setAppointmentNote] = useState("");

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("Đã sao chép liên kết");
    } catch {
      showToast("Không thể sao chép. Bạn có thể lấy liên kết trên thanh địa chỉ.");
    }
  };

  const handleSave = () => {
    setSaved(!saved);
    showToast(!saved ? "Đã lưu tạm trong giao diện" : "Đã bỏ lưu tạm");
  };

  const handleSubmitAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!appointmentDate) {
      showToast("Vui lòng chọn ngày muốn đến xem");
      return;
    }
    showToast("Dữ liệu mẫu: yêu cầu hẹn xem chưa được gửi.");
  };

  if (!room) notFound();

  return (
    <div className="bg-bg min-h-screen pb-16">
      <div className="max-w-[1120px] mx-auto px-4 md:px-6 py-6">
        {/* Breadcrumbs */}
        <nav className="text-xs text-gray-600 mb-3 flex items-center gap-1.5 flex-wrap">
          <Link href="/" className="hover:text-ink">Trang chủ</Link>
          <span>/</span>
          <Link href="/thue-phong-tro" className="hover:text-ink">{room.city || "TP. Hồ Chí Minh"}</Link>
          <span>/</span>
          <span>{room.district || "Quận 10"}</span>
          <span>/</span>
          <span className="text-ink truncate max-w-[260px]">{room.title}</span>
        </nav>

        {/* Tiêu đề & Thông tin cơ bản */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {room.isVerified && (
                <span className="bg-brand-tint text-brand text-xs font-medium px-2 py-0.5 rounded">
                  Chính chủ xác minh
                </span>
              )}
              <span className="bg-white border border-gray-200 text-ink text-xs font-medium px-2 py-0.5 rounded">
                {room.amenities.includes("loft") ? "Phòng trọ có gác" : "Phòng cho thuê"}
              </span>
            </div>
            <h1 className="text-2xl font-bold text-ink leading-tight">
              {room.fullTitle || room.title}
            </h1>
            <p className="text-sm text-gray-600 mt-1 flex items-center gap-1.5">
              <MapPin size={16} strokeWidth={1.5} className="text-brand shrink-0" />
              <span>{room.address} (Cách ĐH Bách Khoa {room.km} km)</span>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleShare}
              className="px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-white flex items-center gap-1.5 text-xs font-medium bg-white text-ink transition-colors"
            >
              <Share2 size={16} strokeWidth={1.5} />
              <span>Chia sẻ</span>
            </button>
            <button
              type="button"
              onClick={handleSave}
              className={`px-3 py-1.5 border rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors ${
                saved
                  ? "border-brand bg-brand-tint text-brand"
                  : "border-gray-200 hover:bg-white bg-white text-ink"
              }`}
            >
              <Heart size={16} strokeWidth={1.5} className={saved ? "fill-brand" : ""} />
              <span>{saved ? "Đã lưu" : "Lưu tin"}</span>
            </button>
          </div>
        </div>

        {/* GALLERY ẢNH: 1 LỚN + 4 NHỎ */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-xl overflow-hidden max-h-[400px] mb-8 relative border border-gray-200 bg-white">
          <div className="md:col-span-2 h-[260px] md:h-[400px]">
            <Image unoptimized width={800} height={600}
              src={room.images[0]}
              alt={room.title}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="hidden md:grid col-span-2 grid-cols-2 gap-2 h-[400px]">
            <Image unoptimized width={800} height={600}
              src={room.images[1] || room.images[0]}
              alt="Phòng ngủ"
              className="w-full h-[196px] object-cover"
            />
            <Image unoptimized width={800} height={600}
              src={room.images[2] || room.images[0]}
              alt="Khu vực bếp"
              className="w-full h-[196px] object-cover"
            />
            <Image unoptimized width={800} height={600}
              src={room.images[3] || room.images[0]}
              alt="Nhà vệ sinh"
              className="w-full h-[196px] object-cover"
            />
            <div className="relative h-[196px]">
              <Image unoptimized width={800} height={600}
                src={room.images[4] || room.images[0]}
                alt="Ban công"
                className="w-full h-full object-cover"
              />
              <button
                type="button"
                onClick={() => showToast("Bản demo đang hiển thị các ảnh mẫu của phòng.")}
                className="absolute inset-0 bg-ink/50 text-white font-medium text-xs flex items-center justify-center hover:bg-ink/60 transition-colors"
              >
                Xem tất cả ảnh
              </button>
            </div>
          </div>
        </div>

        {/* NỘI DUNG 2 CỘT */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* CỘT TRÁI (8 CỘT) */}
          <div className="lg:col-span-8 space-y-6">
            {/* 1. Đặc điểm bất động sản */}
            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h2 className="text-base font-bold text-ink mb-4">
                Đặc điểm bất động sản
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className="p-3 bg-bg border border-gray-200 rounded-lg">
                  <span className="text-xs text-gray-600 block">Diện tích</span>
                  <span className="font-bold text-ink mt-0.5 block">{room.area} m²</span>
                </div>
                <div className="p-3 bg-bg border border-gray-200 rounded-lg">
                  <span className="text-xs text-gray-600 block">Tiền cọc</span>
                  <span className="font-bold text-ink mt-0.5 block">{formatVND(room.deposit)}</span>
                </div>
                <div className="p-3 bg-bg border border-gray-200 rounded-lg">
                  <span className="text-xs text-gray-600 block">Sức chứa</span>
                  <span className="font-bold text-ink mt-0.5 block">{room.capacity}</span>
                </div>
                <div className="p-3 bg-bg border border-gray-200 rounded-lg">
                  <span className="text-xs text-gray-600 block">Tình trạng</span>
                  <span className="font-bold text-brand mt-0.5 block">{room.status}</span>
                </div>
              </div>
            </div>

            {/* 2. Biểu phí dịch vụ hàng tháng */}
            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h2 className="text-base font-bold text-ink mb-4">
                Biểu phí dịch vụ hàng tháng
              </h2>
              <div className="divide-y divide-gray-200 text-sm">
                <div className="py-2.5 flex justify-between">
                  <span className="text-gray-600">Tiền điện</span>
                  <span className="text-ink font-medium">{formatNumber(room.electricity)}đ / kWh (đồng hồ riêng)</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-gray-600">Tiền nước</span>
                  <span className="text-ink font-medium">{formatNumber(room.water)}đ / m³</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-gray-600">Internet</span>
                  <span className="text-ink font-medium">{room.internet ? `${formatVND(room.internet)} / phòng / tháng` : "Miễn phí"}</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-gray-600">Phí gửi xe máy</span>
                  <span className="text-ink font-medium">{formatVND(room.parking)} / xe / tháng</span>
                </div>
                <div className="py-2.5 flex justify-between">
                  <span className="text-gray-600">Rác và vệ sinh</span>
                  <span className="text-brand font-medium">Miễn phí</span>
                </div>
              </div>
            </div>

            {/* 3. Tiện nghi có sẵn */}
            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h2 className="text-base font-bold text-ink mb-4">
                Tiện nghi có sẵn
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                {room.amenities.filter((key) => amenityLabels[key]).map((key) => (
                  <div key={key} className="flex items-center gap-2 text-ink">
                    <Check size={16} strokeWidth={1.5} className="text-brand shrink-0" />
                    <span>{amenityLabels[key]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 4. Mô tả chi tiết */}
            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h2 className="text-base font-bold text-ink mb-4">
                Mô tả chi tiết từ chủ nhà
              </h2>
              <div className="text-sm leading-relaxed text-ink space-y-2">
                {room.description.map((line, idx) => (
                  <p key={idx}>{line}</p>
                ))}
              </div>
            </div>

            {/* 5. Vị trí xung quanh */}
            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-ink">
                  Vị trí và tiện ích xung quanh
                </h2>
                <button
                  type="button"
                  onClick={() => showToast("Bản đồ tương tác chưa khả dụng với dữ liệu mẫu.")}
                  className="text-xs text-brand hover:underline font-medium"
                >
                  Xem bản đồ
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-4">
                {room.nearby.map((nb, i) => (
                  <div key={i} className="p-2.5 bg-bg rounded-lg border border-gray-200 flex justify-between">
                    <span className="text-gray-600">{nb.name}</span>
                    <span className="text-ink font-medium">{nb.distance}</span>
                  </div>
                ))}
              </div>
              <div className="w-full h-40 bg-bg border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 text-xs">
                Khu vực {room.district}, TP. Hồ Chí Minh
              </div>
            </div>
          </div>

          {/* CỘT PHẢI STICKY: CARD HÀNH ĐỘNG */}
          <div className="lg:col-span-4">
            <div className="sticky top-20 bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-5">
              {/* Giá niêm yết */}
              <div>
                <span className="text-xs text-gray-600 block">Giá thuê niêm yết</span>
                <div className="text-2xl font-bold text-ink mt-1">
                  {formatVND(room.price)}
                  <span className="text-sm font-normal text-gray-600 ml-1">/ tháng</span>
                </div>
              </div>

              <hr className="border-gray-200" />

              {/* Thông tin Chủ nhà */}
              <div className="flex items-center gap-3">
                <Image unoptimized width={80} height={80}
                  src={room.host.avatar}
                  className="w-10 h-10 rounded-full object-cover border border-gray-200"
                  alt={room.host.name}
                />
                <div>
                  <h3 className="font-medium text-sm text-ink flex items-center gap-1.5">
                    {room.host.name}
                    <span className="text-xs bg-bg border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
                      {room.host.role}
                    </span>
                  </h3>
                </div>
              </div>

              {/* Nút Hiện SĐT & Chat Zalo */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => showToast("Thông tin liên hệ trong bản demo là dữ liệu mẫu.")}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-brand hover:bg-brand-hover text-white rounded-lg font-medium text-sm transition-colors text-center"
                >
                  <Phone size={16} strokeWidth={1.5} />
                  <span>Hiện SĐT</span>
                </button>
                <button
                  type="button"
                  onClick={() => showToast("Liên hệ Zalo sẽ mở khi có tin đăng thật.")}
                  className="flex items-center justify-center py-2.5 px-3 border border-brand text-brand hover:bg-brand-tint rounded-lg font-medium text-sm transition-colors text-center"
                >
                  Chat Zalo
                </button>
              </div>

              {/* Form Đặt Hẹn Xem Phòng */}
              <div className="bg-bg p-4 rounded-lg border border-gray-200 text-sm space-y-3">
                <div className="text-xs font-bold text-ink uppercase tracking-wider">
                  Đặt lịch xem phòng
                </div>

                <form onSubmit={handleSubmitAppointment} className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-600 block mb-1 font-medium" htmlFor="preview-app-phong-tro--id--page-tsx-1">Ngày muốn xem</label>
                      <input id="preview-app-phong-tro--id--page-tsx-1"
                        type="date"
                        value={appointmentDate}
                        onChange={(e) => setAppointmentDate(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm text-ink focus:border-brand focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 block mb-1 font-medium" htmlFor="preview-app-phong-tro--id--page-tsx-2">Khung giờ</label>
                      <select id="preview-app-phong-tro--id--page-tsx-2"
                        value={appointmentTime}
                        onChange={(e) => setAppointmentTime(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm text-ink focus:border-brand focus:outline-none"
                      >
                        <option value="09:00 (Sáng)">09:00 (Sáng)</option>
                        <option value="15:30 (Chiều)">15:30 (Chiều)</option>
                        <option value="18:00 (Tối)">18:00 (Tối)</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-600 block mb-1 font-medium" htmlFor="preview-app-phong-tro--id--page-tsx-3">Ghi chú cho chủ nhà</label>
                      <input id="preview-app-phong-tro--id--page-tsx-3"
                        type="text"
                        value={appointmentNote}
                        onChange={(e) => setAppointmentNote(e.target.value)}
                        placeholder="Ví dụ: em đến sau giờ làm lúc 5h..."
                        className="w-full bg-white border border-gray-200 rounded-lg p-2 text-sm text-ink focus:border-brand focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled
                      className="w-full py-2.5 bg-brand hover:bg-brand-hover text-white rounded-lg font-medium text-sm transition-colors"
                    >
                      Đặt lịch chưa khả dụng
                    </button>
                  </form>
              </div>

              {/* Ghi chú an toàn */}
              <div className="text-xs text-gray-600 text-center">
                Lưu ý: Không chuyển tiền cọc khi chưa xem phòng thực tế.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
