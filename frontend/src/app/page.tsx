"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Home as HomeIcon, Hotel, ChevronDown } from "lucide-react";
import HomeListings from "@/components/home-listings";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { PRESET_LOCATIONS, longTermSearchHref } from "@/lib/listing-locations";

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"tro" | "hs">("tro");

  // Tab 1 state
  const [poi, setPoi] = useState("bk");
  const [maxPrice, setMaxPrice] = useState("4000000");
  const [radius, setRadius] = useState("3");

  // Tab 2 state
  const vietnamDay = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
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
      `/homestay?${new URLSearchParams({
        ...(destination.trim() ? { q: destination.trim() } : {}),
        checkIn,
        checkOut,
        adults: String(guests),
        children: "0",
      })}`
    );
  };

  return (
    <div>
      {/* TNG Trading Inspired Deep Marine Hero & Search Console */}
      <section className="tng-hero">
        <div className="tng-hero-backdrop" aria-hidden="true" />

        <div className="tng-wrap">
          <div className="max-w-3xl mb-10 md:mb-12">
            <p className="eyebrow rise" style={{ color: "var(--on-brand-bright)" }}>
              Vietnam Living &amp; Hospitality · Lưu trú minh bạch
            </p>
            <h1 className="display d0 wm" style={{ color: "#ffffff" }}>
              <span className="line">
                <span>Tìm chỗ ở minh bạch,</span>
              </span>
              <span className="line">
                <span>
                  không gian <em style={{ color: "var(--on-brand-bright)" }}>tiện lợi</em>.
                </span>
              </span>
            </h1>
            <p
              className="rise mt-6 text-[16px] md:text-[18px] leading-[1.65] max-w-2xl"
              style={{ "--i": 2, color: "rgba(238, 242, 246, 0.84)" } as React.CSSProperties}
            >
              Tìm phòng trọ dài hạn và homestay theo đêm. Xem giá thuê, chi phí dịch vụ và thông tin phòng trước khi liên hệ hoặc đặt phòng.
            </p>
          </div>

          {/* Editorial Search Console */}
          <div
            className="rise bg-white border border-gray-200 p-5 sm:p-6 md:p-8 text-ink shadow-[0_32px_64px_-32px_rgba(10,27,42,0.55)]"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            <div
              className="flex gap-0 border border-gray-200 mb-6 w-fit max-w-full overflow-x-auto bg-brand-tint"
              role="group"
              aria-label="Loại chỗ ở"
            >
              <button
                type="button"
                aria-pressed={activeTab === "tro"}
                onClick={() => setActiveTab("tro")}
                className={`min-h-11 px-5 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] border-r border-gray-200 transition-colors flex items-center gap-2.5 cursor-pointer whitespace-nowrap ${
                  activeTab === "tro"
                    ? "bg-[#0a1b2a] text-[#eef2f6]"
                    : "bg-white text-muted hover:text-ink hover:bg-brand-tint"
                }`}
              >
                <HomeIcon size={15} aria-hidden="true" />
                <span>Thuê trọ dài hạn</span>
              </button>
              <button
                type="button"
                aria-pressed={activeTab === "hs"}
                onClick={() => setActiveTab("hs")}
                className={`min-h-11 px-5 py-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors flex items-center gap-2.5 cursor-pointer whitespace-nowrap ${
                  activeTab === "hs"
                    ? "bg-[#0a1b2a] text-[#eef2f6]"
                    : "bg-white text-muted hover:text-ink hover:bg-brand-tint"
                }`}
              >
                <Hotel size={15} aria-hidden="true" />
                <span>Homestay</span>
              </button>
            </div>

            {activeTab === "tro" && (
              <form
                onSubmit={handleSearchTro}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end"
              >
                <div className="min-w-0">
                  <label
                    className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted mb-2 font-medium truncate"
                    htmlFor="home-search-location"
                  >
                    Gần trường, bệnh viện, khu công nghiệp
                  </label>
                  <div className="relative">
                    <select
                      id="home-search-location"
                      value={poi}
                      onChange={(e) => setPoi(e.target.value)}
                      className="w-full h-12 pl-3.5 pr-9 bg-brand-tint border border-gray-200 text-base md:text-sm text-ink focus:border-brand focus:bg-white focus:outline-none appearance-none cursor-pointer truncate transition-colors"
                    >
                      {PRESET_LOCATIONS.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="absolute right-3.5 top-4 text-muted pointer-events-none"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <label
                    className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted mb-2 font-medium truncate"
                    htmlFor="home-search-price"
                  >
                    Mức giá tối đa
                  </label>
                  <div className="relative">
                    <select
                      id="home-search-price"
                      value={maxPrice}
                      onChange={(e) => setMaxPrice(e.target.value)}
                      className="w-full h-12 pl-3.5 pr-9 bg-brand-tint border border-gray-200 text-base md:text-sm text-ink focus:border-brand focus:bg-white focus:outline-none appearance-none cursor-pointer transition-colors"
                    >
                      <option value="2500000">Dưới 2,5 triệu</option>
                      <option value="4000000">Dưới 4 triệu</option>
                      <option value="6000000">Dưới 6 triệu</option>
                      <option value="10000000">Dưới 10 triệu</option>
                    </select>
                    <ChevronDown
                      size={16}
                      className="absolute right-3.5 top-4 text-muted pointer-events-none"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <label
                    className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted mb-2 font-medium truncate"
                    htmlFor="home-search-radius"
                  >
                    Bán kính tìm kiếm
                  </label>
                  <div className="relative">
                    <select
                      id="home-search-radius"
                      value={radius}
                      onChange={(e) => setRadius(e.target.value)}
                      className="w-full h-12 pl-3.5 pr-9 bg-brand-tint border border-gray-200 text-base md:text-sm text-ink focus:border-brand focus:bg-white focus:outline-none appearance-none cursor-pointer transition-colors"
                    >
                      <option value="1">Dưới 1 km</option>
                      <option value="3">Dưới 3 km</option>
                      <option value="5">Dưới 5 km</option>
                      <option value="10">Dưới 10 km</option>
                    </select>
                    <ChevronDown
                      size={16}
                      className="absolute right-3.5 top-4 text-muted pointer-events-none"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <button type="submit" className="tng-btn w-full h-12">
                    <Search size={15} aria-hidden="true" />
                    <span>Tìm phòng</span>
                    <span className="btn__arrow" aria-hidden="true">→</span>
                  </button>
                </div>
              </form>
            )}

            {activeTab === "hs" && (
              <form
                onSubmit={handleSearchHs}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_minmax(0,.8fr)_minmax(0,1fr)] gap-4 items-end"
              >
                <div className="min-w-0">
                  <label
                    className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted mb-2 font-medium truncate"
                    htmlFor="home-hs-destination"
                  >
                    Điểm đến
                  </label>
                  <input
                    id="home-hs-destination"
                    type="text"
                    placeholder="Nhập tên homestay hoặc địa chỉ"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className="w-full h-12 px-3.5 bg-brand-tint border border-gray-200 text-base md:text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:bg-white focus:outline-none transition-colors"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0">
                  <div className="min-w-0">
                    <label
                      className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted mb-2 font-medium truncate"
                      htmlFor="home-hs-checkin"
                    >
                      Nhận phòng
                    </label>
                    <input
                      id="home-hs-checkin"
                      type="date"
                      min={todayStr}
                      value={checkIn}
                      onChange={(e) => setCheckIn(e.target.value)}
                      className="w-full h-12 px-3.5 bg-brand-tint border border-gray-200 text-base md:text-sm text-ink focus:border-brand focus:bg-white focus:outline-none transition-colors"
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted mb-2 font-medium truncate"
                      htmlFor="home-hs-checkout"
                    >
                      Trả phòng
                    </label>
                    <input
                      id="home-hs-checkout"
                      type="date"
                      min={checkIn || todayStr}
                      value={checkOut}
                      onChange={(e) => setCheckOut(e.target.value)}
                      className="w-full h-12 px-3.5 bg-brand-tint border border-gray-200 text-base md:text-sm text-ink focus:border-brand focus:bg-white focus:outline-none transition-colors"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <label
                    className="block font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted mb-2 font-medium truncate"
                    htmlFor="home-hs-adults"
                  >
                    Số người lớn
                  </label>
                  <div className="relative">
                    <select
                      id="home-hs-adults"
                      value={adults}
                      onChange={(e) => setAdults(e.target.value)}
                      className="w-full h-12 pl-3.5 pr-9 bg-brand-tint border border-gray-200 text-base md:text-sm text-ink focus:border-brand focus:bg-white focus:outline-none appearance-none cursor-pointer transition-colors"
                    >
                      <option value="1">1 người</option>
                      <option value="2">2 người</option>
                      <option value="3">3 người</option>
                      <option value="4">4 người</option>
                    </select>
                    <ChevronDown
                      size={16}
                      className="absolute right-3.5 top-4 text-muted pointer-events-none"
                    />
                  </div>
                </div>
                <div className="min-w-0">
                  <button type="submit" className="tng-btn w-full h-12">
                    <Search size={15} aria-hidden="true" />
                    <span>Tìm homestay</span>
                    <span className="btn__arrow" aria-hidden="true">→</span>
                  </button>
                </div>
                {hsError && (
                  <div className="col-span-full text-xs text-error font-medium" role="alert">
                    {hsError}
                  </div>
                )}
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Main Content Container */}
      <div className="max-w-[1320px] mx-auto px-5 md:px-11 py-6 md:py-10">
        <HomeListings />
      </div>

      {/* TNG Trading Editorial Capabilities Band */}
      <section className="bg-brand-tint border-t border-gray-200 py-14 md:py-20 px-5 md:px-11">
        <div className="max-w-[1320px] mx-auto">
          <ScrollReveal className="max-w-xl mb-10 md:mb-14">
            <p className="eyebrow">Core Architecture · Giá trị cốt lõi</p>
            <h2 className="display d2">
              Tiêu chuẩn mới cho trải nghiệm <em>thuê &amp; ở</em>.
            </h2>
          </ScrollReveal>

          <div className="tng-caps">
            <ScrollReveal delayMs={0}>
              <article className="tng-caps__item h-full">
                <span className="tng-caps__n">01</span>
                <div>
                  <h3>Dự toán chi phí minh bạch</h3>
                  <p>
                    Công cụ tính toán trước tổng chi phí hàng tháng gồm tiền phòng, điện, nước, gửi xe và dịch vụ để bạn chủ động ngân sách trước khi hẹn xem.
                  </p>
                </div>
              </article>
            </ScrollReveal>
            <ScrollReveal delayMs={90}>
              <article className="tng-caps__item h-full">
                <span className="tng-caps__n">02</span>
                <div>
                  <h3>Giữ chỗ chống trùng lịch</h3>
                  <p>
                    Báo giá ký số thời gian thực kết hợp cơ chế khóa lịch 3 lớp đảm bảo không bao giờ xảy ra tình trạng đặt trùng phòng Homestay.
                  </p>
                </div>
              </article>
            </ScrollReveal>
            <ScrollReveal delayMs={180}>
              <article className="tng-caps__item h-full">
                <span className="tng-caps__n">03</span>
                <div>
                  <h3>Định vị không gian PostGIS</h3>
                  <p>
                    Truy vấn bán kính chính xác đến từng mét quanh các trường đại học, bệnh viện và khu công nghệ cao trên bản đồ trực quan.
                  </p>
                </div>
              </article>
            </ScrollReveal>
            <ScrollReveal delayMs={270}>
              <article className="tng-caps__item h-full">
                <span className="tng-caps__n">04</span>
                <div>
                  <h3>Đánh giá &amp; Đối soát xác thực</h3>
                  <p>
                    Chỉ những khách hàng đã hoàn tất kỳ lưu trú thực tế mới có quyền để lại đánh giá, cùng hệ thống sổ cái đối soát minh bạch cho Chủ nhà.
                  </p>
                </div>
              </article>
            </ScrollReveal>
          </div>
        </div>
      </section>
    </div>
  );
}
