"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Home as HomeIcon, Hotel, ChevronDown } from "lucide-react";
import HomeListings from "@/components/home-listings";
import { PRESET_LOCATIONS, longTermSearchHref } from "@/lib/listing-locations";

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"tro" | "hs">("tro");

  // Tab 1 state
  const [poi, setPoi] = useState("bk");
  const [maxPrice, setMaxPrice] = useState("4000000");
  const [radius, setRadius] = useState("3");

  // Tab 2 state
  const vietnamDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year:"numeric", month:"2-digit", day:"2-digit" }).format(date);
  const todayStr = vietnamDay(new Date());
  const defaultIn = new Date();
  defaultIn.setDate(defaultIn.getDate() + 3);
  const defaultOut = new Date();
  defaultOut.setDate(defaultOut.getDate() + 6);

  const [destination, setDestination] = useState("");
  const [checkIn, setCheckIn] = useState(vietnamDay(defaultIn));
  const [checkOut, setCheckOut] = useState(vietnamDay(defaultOut));
  const [adults, setAdults] = useState("2");
  const [hsError, setHsError] = useState("");

  const handleSearchTro = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(longTermSearchHref(poi, maxPrice, radius));
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
      `/homestay?${new URLSearchParams({ ...(destination.trim() ? { q:destination.trim() } : {}), checkIn, checkOut, adults:String(guests), children:"0" })}`
    );
  };

  return (
    <div className="max-w-[1120px] mx-auto px-4 md:px-6 py-6 md:py-8">
      {/* Hero Header: Nền sáng, tiêu đề cân đối cho cả desktop và mobile */}
      <section className="mb-6 md:mb-8 max-w-2xl">
        <h1 className="text-[24px] leading-[30px] md:text-[36px] md:leading-[45px] font-bold text-ink tracking-tight text-balance">
          Tìm chỗ ở minh bạch, tiện lợi
        </h1>
        <p className="text-sm md:text-base text-gray-600 mt-2 max-w-2xl text-pretty">
          Tìm phòng trọ dài hạn và homestay theo đêm. Xem giá thuê, chi phí dịch vụ và thông tin phòng trước khi liên hệ hoặc đặt phòng.
        </p>
      </section>

      {/* Thanh tìm kiếm nhanh */}
      <section className="bg-white border border-gray-200 rounded-xl p-4 sm:p-5 md:p-6 shadow-sm mb-10 md:mb-12">
        <div className="flex gap-3 sm:gap-4 border-b border-gray-200 mb-4 overflow-x-auto" role="group" aria-label="Loại chỗ ở">
          <button
            type="button"
            aria-pressed={activeTab === "tro"}
            onClick={() => setActiveTab("tro")}
            className={`min-h-11 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "tro"
                ? "text-brand border-brand"
                : "text-gray-600 border-transparent hover:text-ink"
            }`}
          >
            <HomeIcon size={18} aria-hidden="true" />
            <span>Thuê trọ dài hạn</span>
          </button>
          <button
            type="button"
            aria-pressed={activeTab === "hs"}
            onClick={() => setActiveTab("hs")}
            className={`min-h-11 pb-3 px-1 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === "hs"
                ? "text-brand border-brand"
                : "text-gray-600 border-transparent hover:text-ink"
            }`}
          >
            <Hotel size={18} aria-hidden="true" />
            <span>Homestay</span>
          </button>
        </div>

        {activeTab === "tro" && (
          <form onSubmit={handleSearchTro} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 items-end">
            <div className="min-w-0">
              <label className="block text-xs text-ink mb-1.5 font-semibold truncate" htmlFor="home-search-location">
                Gần trường, bệnh viện, khu công nghiệp
              </label>
              <div className="relative">
                <select
                  id="home-search-location"
                  value={poi}
                  onChange={(e) => setPoi(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 bg-white border border-gray-200 rounded-lg text-base md:text-sm text-ink focus:border-brand focus:outline-none appearance-none cursor-pointer truncate"
                >
                  {PRESET_LOCATIONS.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
                <ChevronDown size={16} className="absolute right-3 top-3.5 text-muted pointer-events-none" />
              </div>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-ink mb-1.5 font-semibold truncate" htmlFor="home-search-price">
                Mức giá tối đa
              </label>
              <div className="relative">
                <select
                  id="home-search-price"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 bg-white border border-gray-200 rounded-lg text-base md:text-sm text-ink focus:border-brand focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="2500000">Dưới 2,5 triệu</option>
                  <option value="4000000">Dưới 4 triệu</option>
                  <option value="6000000">Dưới 6 triệu</option>
                  <option value="10000000">Dưới 10 triệu</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-3.5 text-muted pointer-events-none" />
              </div>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-ink mb-1.5 font-semibold truncate" htmlFor="home-search-radius">
                Bán kính tìm kiếm
              </label>
              <div className="relative">
                <select
                  id="home-search-radius"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 bg-white border border-gray-200 rounded-lg text-base md:text-sm text-ink focus:border-brand focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="1">Dưới 1 km</option>
                  <option value="3">Dưới 3 km</option>
                  <option value="5">Dưới 5 km</option>
                  <option value="10">Dưới 10 km</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-3.5 text-muted pointer-events-none" />
              </div>
            </div>
            <div className="min-w-0">
              <button
                type="submit"
                className="w-full h-11 bg-brand-hover hover:bg-ink text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 active:scale-[0.99] cursor-pointer"
              >
                <Search size={16} aria-hidden="true" />
                <span>Tìm phòng</span>
              </button>
            </div>
          </form>
        )}

        {activeTab === "hs" && (
          <form onSubmit={handleSearchHs} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_minmax(0,.8fr)_minmax(0,1fr)] gap-3.5 items-end">
            <div className="min-w-0">
              <label className="block text-xs text-ink mb-1.5 font-semibold truncate" htmlFor="home-hs-destination">
                Điểm đến
              </label>
              <input
                id="home-hs-destination"
                type="text"
                placeholder="Nhập tên homestay hoặc địa chỉ"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="w-full h-11 px-3 bg-white border border-gray-200 rounded-lg text-base md:text-sm text-ink placeholder:text-muted/60 focus:border-brand focus:outline-none transition-colors"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
              <div className="min-w-0">
                <label className="block text-xs text-ink mb-1.5 font-semibold truncate" htmlFor="home-hs-checkin">
                  Nhận phòng
                </label>
                <input
                  id="home-hs-checkin"
                  type="date"
                  min={todayStr}
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="w-full h-11 px-3 bg-white border border-gray-200 rounded-lg text-base md:text-sm text-ink focus:border-brand focus:outline-none transition-colors"
                />
              </div>
              <div className="min-w-0">
                <label className="block text-xs text-ink mb-1.5 font-semibold truncate" htmlFor="home-hs-checkout">
                  Trả phòng
                </label>
                <input
                  id="home-hs-checkout"
                  type="date"
                  min={checkIn || todayStr}
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="w-full h-11 px-3 bg-white border border-gray-200 rounded-lg text-base md:text-sm text-ink focus:border-brand focus:outline-none transition-colors"
                />
              </div>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-ink mb-1.5 font-semibold truncate" htmlFor="home-hs-adults">
                Số người lớn
              </label>
              <div className="relative">
                <select
                  id="home-hs-adults"
                  value={adults}
                  onChange={(e) => setAdults(e.target.value)}
                  className="w-full h-11 pl-3 pr-9 bg-white border border-gray-200 rounded-lg text-base md:text-sm text-ink focus:border-brand focus:outline-none appearance-none cursor-pointer"
                >
                  <option value="1">1 người</option>
                  <option value="2">2 người</option>
                  <option value="3">3 người</option>
                  <option value="4">4 người</option>
                </select>
                <ChevronDown size={16} className="absolute right-3 top-3.5 text-muted pointer-events-none" />
              </div>
            </div>
            <div className="min-w-0">
              <button
                type="submit"
                className="w-full h-11 bg-brand-hover hover:bg-ink text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2 active:scale-[0.99] cursor-pointer"
              >
                <Search size={16} aria-hidden="true" />
                <span>Tìm homestay</span>
              </button>
            </div>
            {hsError && (
              <div className="col-span-full text-xs text-error font-medium" role="alert">
                {hsError}
              </div>
            )}
          </form>
        )}
      </section>

      <HomeListings />
    </div>
  );
}

