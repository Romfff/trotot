"use client";
import React, { useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { HOMESTAYS, HomestayItem } from "@/lib/data";
import HomestayCard from "@/components/HomestayCard";
import HomestayBookingModal from "@/components/HomestayBookingModal";
import { matchesLocation } from "@/lib/location-search";

function HomestayContent() {
  const searchParams = useSearchParams();

  const todayStr = new Date().toISOString().split("T")[0];
  const defaultIn = new Date();
  defaultIn.setDate(defaultIn.getDate() + 3);
  const defaultOut = new Date();
  defaultOut.setDate(defaultOut.getDate() + 6);

  const [destination, setDestination] = useState(searchParams.get("dest") || "TP. Hồ Chí Minh");
  const [checkIn, setCheckIn] = useState(searchParams.get("checkIn") || defaultIn.toISOString().split("T")[0]);
  const [checkOut, setCheckOut] = useState(searchParams.get("checkOut") || defaultOut.toISOString().split("T")[0]);
  const [adults, setAdults] = useState(String(Math.min(4, Math.max(1, Number(searchParams.get("guests")) || 2))));
  const [children, setChildren] = useState("0");
  const [hsError, setHsError] = useState("");

  const [modeFilter, setModeFilter] = useState<{ instant: boolean; request: boolean }>({
    instant: false,
    request: false,
  });
  const [sortBy, setSortBy] = useState("rec");

  const [selectedHomestay, setSelectedHomestay] = useState<HomestayItem | null>(null);

  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const d1 = new Date(checkIn);
    const d2 = new Date(checkOut);
    return Math.max(0, Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
  }, [checkIn, checkOut]);

  const totalGuests = Number(adults) + Number(children);

  const filteredHomestays = useMemo(() => {
    const list = HOMESTAYS.filter((h) => {
      if (!matchesLocation(destination, h.city, h.location)) return false;
      if (h.capacity < totalGuests) return false;
      if (modeFilter.instant || modeFilter.request) return modeFilter[h.mode];
      return true;
    });

    if (sortBy === "low") {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === "score") {
      list.sort((a, b) => b.score - a.score);
    }

    return list;
  }, [destination, totalGuests, modeFilter, sortBy]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!checkIn || !checkOut) {
      setHsError("Vui lòng chọn ngày nhận và trả phòng");
      return;
    }
    if (new Date(checkIn) < new Date(todayStr)) {
      setHsError("Ngày nhận phòng không được ở quá khứ");
      return;
    }
    if (new Date(checkOut) <= new Date(checkIn)) {
      setHsError("Ngày trả phòng phải sau ngày nhận phòng");
      return;
    }
    setHsError("");
  };

  const toggleMode = (key: "instant" | "request") => {
    setModeFilter((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="max-w-[1120px] mx-auto px-4 md:px-6 py-8">
      {/* Breadcrumb và Header giống trang trọ, bỏ banner xanh dương */}
      <nav className="text-xs text-gray-600 mb-2 flex items-center gap-1.5">
        <Link href="/" className="hover:text-ink">Trang chủ</Link>
        <span>/</span>
        <span className="text-ink">Homestay</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">
          Homestay theo đêm
        </h1>
        <p className="text-sm text-gray-600 mt-1">
          Chỗ nghỉ có lịch phòng riêng, giá niêm yết rõ theo đêm.
        </p>
      </div>

      {/* Khung tìm kiếm phẳng, đồng bộ style trang chủ */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 md:p-6 shadow-sm mb-8">
        <form onSubmit={handleSearch} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-homestay-page-tsx-1">Điểm đến</label>
            <input id="preview-app-homestay-page-tsx-1"
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-homestay-page-tsx-2">Nhận phòng</label>
            <input id="preview-app-homestay-page-tsx-2"
              type="date"
              min={todayStr}
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-homestay-page-tsx-3">Trả phòng</label>
            <input id="preview-app-homestay-page-tsx-3"
              type="date"
              min={checkIn || todayStr}
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-homestay-page-tsx-4">Người lớn</label>
            <select id="preview-app-homestay-page-tsx-4"
              value={adults}
              onChange={(e) => setAdults(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4+</option>
            </select>
          </div>
          <div>
            <button
              type="submit"
              className="w-full py-2 bg-brand hover:bg-brand-hover text-white font-medium text-sm rounded-lg transition-colors"
            >
              Tìm homestay
            </button>
          </div>
          {hsError && (
            <div className="col-span-full text-xs text-error font-medium">
              {hsError}
            </div>
          )}
        </form>
      </div>

      {/* Thanh lọc và sắp xếp */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <span className="text-sm text-gray-600">
          {filteredHomestays.length} chỗ nghỉ {nights > 0 ? `· ${nights} đêm` : ""}
        </span>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => toggleMode("instant")}
              aria-pressed={modeFilter.instant}
              className={`border rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                modeFilter.instant
                  ? "bg-brand-tint border-brand text-brand"
                  : "bg-white border-gray-200 text-ink hover:bg-bg"
              }`}
            >
              Đặt tức thì
            </button>
            <button
              type="button"
              onClick={() => toggleMode("request")}
              aria-pressed={modeFilter.request}
              className={`border rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                modeFilter.request
                  ? "bg-brand-tint border-brand text-brand"
                  : "bg-white border-gray-200 text-ink hover:bg-bg"
              }`}
            >
              Chủ nhà duyệt
            </button>
          </div>

          <select
            aria-label="Sắp xếp homestay"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-ink font-medium focus:border-brand focus:outline-none"
          >
            <option value="rec">Đề xuất</option>
            <option value="low">Giá thấp nhất</option>
            <option value="score">Điểm cao nhất</option>
          </select>
        </div>
      </div>

      {/* Grid Homestays */}
      {filteredHomestays.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredHomestays.map((hs) => (
            <HomestayCard
              key={hs.id}
              homestay={hs}
              onSelect={(h) => setSelectedHomestay(h)}
            />
          ))}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-600">
          <p className="text-sm font-medium mb-3">Không có chỗ nghỉ phù hợp với số khách hoặc bộ lọc.</p>
          <button
            type="button"
            onClick={() => {
              setDestination("");
              setAdults("2");
              setChildren("0");
              setModeFilter({ instant: false, request: false });
              setSortBy("rec");
              setHsError("");
            }}
            className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium transition-colors"
          >
            Xóa bộ lọc
          </button>
        </div>
      )}

      {/* Booking Modal */}
      <HomestayBookingModal
        homestay={selectedHomestay}
        onClose={() => setSelectedHomestay(null)}
        initialCheckIn={checkIn}
        initialCheckOut={checkOut}
        initialGuests={totalGuests}
      />
    </div>
  );
}

export default function HomestayPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600 text-sm">Đang tải danh sách Homestay...</div>}>
      <HomestayContent />
    </Suspense>
  );
}
