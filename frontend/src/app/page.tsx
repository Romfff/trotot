"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ROOMS, HOMESTAYS, HomestayItem } from "@/lib/data";
import RoomCard from "@/components/RoomCard";
import HomestayCard from "@/components/HomestayCard";
import HomestayBookingModal from "@/components/HomestayBookingModal";

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"tro" | "hs">("tro");

  // Tab 1 state
  const [poi, setPoi] = useState("ĐH Bách Khoa");
  const [maxPrice, setMaxPrice] = useState("4000000");
  const [radius, setRadius] = useState("3");

  // Tab 2 state
  const todayStr = new Date().toISOString().split("T")[0];
  const defaultIn = new Date();
  defaultIn.setDate(defaultIn.getDate() + 3);
  const defaultOut = new Date();
  defaultOut.setDate(defaultOut.getDate() + 6);

  const [destination, setDestination] = useState("TP. Hồ Chí Minh");
  const [checkIn, setCheckIn] = useState(defaultIn.toISOString().split("T")[0]);
  const [checkOut, setCheckOut] = useState(defaultOut.toISOString().split("T")[0]);
  const [adults, setAdults] = useState("2");
  const [hsError, setHsError] = useState("");

  // Modals state
  const [selectedHomestay, setSelectedHomestay] = useState<HomestayItem | null>(null);

  const handleSearchTro = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(`/thue-phong-tro?poi=${encodeURIComponent(poi)}&maxPrice=${maxPrice}&radius=${radius}`);
  };

  const handleSearchHs = (e: React.FormEvent) => {
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
    const guests = Number(adults);
    router.push(
      `/homestay?dest=${encodeURIComponent(destination)}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guests}`
    );
  };

  return (
    <div className="max-w-[1120px] mx-auto px-4 md:px-6 py-12">
      {/* Hero Header: Nền sáng, tiêu đề căn trái 36/700, một dòng phụ */}
      <section className="mb-8">
        <h1 className="text-4xl font-bold text-ink tracking-tight">
          Tìm phòng trọ và homestay
        </h1>
        <p className="text-sm text-gray-600 mt-2">
          Thông tin giá thuê, chi phí dịch vụ và tình trạng phòng hiển thị rõ ràng.
        </p>
      </section>

      {/* Thanh tìm kiếm ngay dưới */}
      <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-12">
        <div className="flex gap-4 border-b border-gray-200 mb-6">
          <button
            type="button"
            aria-pressed={activeTab === "tro"}
            onClick={() => setActiveTab("tro")}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "tro"
                ? "text-brand border-brand"
                : "text-gray-600 border-transparent hover:text-ink"
            }`}
          >
            Thuê trọ dài hạn
          </button>
          <button
            type="button"
            aria-pressed={activeTab === "hs"}
            onClick={() => setActiveTab("hs")}
            className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "hs"
                ? "text-brand border-brand"
                : "text-gray-600 border-transparent hover:text-ink"
            }`}
          >
            Homestay
          </button>
        </div>

        {activeTab === "tro" && (
          <form onSubmit={handleSearchTro} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div className="lg:col-span-2">
              <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-page-tsx-1">
                Gần trường, bệnh viện, khu công nghiệp
              </label>
              <input id="preview-app-page-tsx-1"
                type="text"
                value={poi}
                onChange={(e) => setPoi(e.target.value)}
                placeholder="Ví dụ: ĐH Bách Khoa"
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-page-tsx-2">Giá tối đa</label>
              <select id="preview-app-page-tsx-2"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="2500000">2,5 triệu</option>
                <option value="4000000">4 triệu</option>
                <option value="6000000">6 triệu</option>
                <option value="10000000">10 triệu</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-page-tsx-3">Bán kính</label>
              <select id="preview-app-page-tsx-3"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
              >
                <option value="1">1 km</option>
                <option value="3">3 km</option>
                <option value="5">5 km</option>
                <option value="10">10 km</option>
              </select>
            </div>
            <div>
              <button
                type="submit"
                className="w-full py-2 bg-brand hover:bg-brand-hover text-white font-medium text-sm rounded-lg transition-colors"
              >
                Tìm phòng
              </button>
            </div>
          </form>
        )}

        {activeTab === "hs" && (
          <form onSubmit={handleSearchHs} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
            <div className="sm:col-span-2">
              <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-page-tsx-4">Điểm đến</label>
              <input id="preview-app-page-tsx-4"
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-page-tsx-5">Nhận phòng</label>
              <input id="preview-app-page-tsx-5"
                type="date"
                min={todayStr}
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-page-tsx-6">Trả phòng</label>
              <input id="preview-app-page-tsx-6"
                type="date"
                min={checkIn || todayStr}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-page-tsx-7">Người lớn</label>
              <select id="preview-app-page-tsx-7"
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
        )}
      </section>

      {/* Featured Rooms */}
      <section className="mb-12">
        <div className="flex justify-between items-baseline mb-4">
          <h2 className="text-xl font-bold text-ink">
            Phòng trọ dài hạn nổi bật
          </h2>
          <Link
            href="/thue-phong-tro"
            className="text-brand hover:underline font-medium text-sm"
          >
            Xem tất cả
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ROOMS.slice(0, 4).map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      </section>

      {/* Featured Homestays */}
      <section className="mb-12">
        <div className="flex justify-between items-baseline mb-4">
          <h2 className="text-xl font-bold text-ink">
            Homestay được yêu thích
          </h2>
          <Link
            href="/homestay"
            className="text-brand hover:underline font-medium text-sm"
          >
            Xem tất cả
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {HOMESTAYS.map((hs) => (
            <HomestayCard
              key={hs.id}
              homestay={hs}
              onSelect={(h) => setSelectedHomestay(h)}
            />
          ))}
        </div>
      </section>

      {/* Booking Modals */}
      <HomestayBookingModal homestay={selectedHomestay} onClose={() => setSelectedHomestay(null)} />
    </div>
  );
}
