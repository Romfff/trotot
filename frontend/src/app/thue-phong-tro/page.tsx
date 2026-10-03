"use client";
import React, { useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ROOMS } from "@/lib/data";
import RoomCard from "@/components/RoomCard";
import { matchesLocation } from "@/lib/location-search";

function ThuePhongTroContent() {
  const searchParams = useSearchParams();
  const initialPoi = searchParams.get("poi") || "";
  const initialPrice = searchParams.get("maxPrice") || "6000000";
  const initialRadius = searchParams.get("radius") || "5";

  const [poi, setPoi] = useState(initialPoi);
  const [maxPrice, setMaxPrice] = useState(initialPrice);
  const [radius, setRadius] = useState(initialRadius);
  const [minArea, setMinArea] = useState("0");
  const [sortBy, setSortBy] = useState("new");

  // Chips filters
  const [amenityFilters, setAmenityFilters] = useState<{ [key: string]: boolean }>({
    ac: false,
    loft: false,
    pets: false,
    v: false,
  });

  const toggleChip = (key: string) => {
    setAmenityFilters((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const filteredRooms = useMemo(() => {
    const pLimit = Number(maxPrice);
    const rLimit = Number(radius);
    const aLimit = Number(minArea);

    const list = ROOMS.filter((r) => {
      if (!matchesLocation(poi, r.address, ...r.nearby.map((place) => place.name))) return false;
      if (r.price > pLimit) return false;
      if (r.km > rLimit) return false;
      if (r.area < aLimit) return false;

      if (amenityFilters.v && !r.isVerified) return false;
      if (amenityFilters.ac && !r.amenities.includes("ac")) return false;
      if (amenityFilters.loft && !r.amenities.includes("loft")) return false;
      if (amenityFilters.pets && !r.amenities.includes("pets")) return false;

      return true;
    });

    if (sortBy === "price_asc") {
      list.sort((a, b) => a.price - b.price);
    } else if (sortBy === "price_desc") {
      list.sort((a, b) => b.price - a.price);
    } else if (sortBy === "distance_asc") {
      list.sort((a, b) => a.km - b.km);
    }

    return list;
  }, [poi, maxPrice, radius, minArea, amenityFilters, sortBy]);

  const handleReset = () => {
    setPoi("");
    setMaxPrice("6000000");
    setRadius("5");
    setMinArea("0");
    setSortBy("new");
    setAmenityFilters({ ac: false, loft: false, pets: false, v: false });
  };

  return (
    <div className="max-w-[1120px] mx-auto px-4 md:px-6 py-8">
      {/* Header gọn gàng, nền sáng, không gradient */}
      <nav className="text-xs text-gray-600 mb-2 flex items-center gap-1.5">
        <Link href="/" className="hover:text-ink">Trang chủ</Link>
        <span>/</span>
        <span className="text-ink">Thuê trọ dài hạn</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-2xl font-bold text-ink">Thuê trọ dài hạn</h1>
        <p className="text-sm text-gray-600 mt-1">
          Giá thuê và chi phí dịch vụ niêm yết rõ ràng.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_minmax(0,1fr)] gap-6 items-start">
        {/* Sidebar Filter */}
        <aside className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-4 md:sticky md:top-20">
          <h2 className="font-bold text-sm text-ink border-b border-gray-200 pb-2">Bộ lọc</h2>

          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-thue-phong-tro-page-tsx-1">Địa chỉ hoặc địa danh</label>
            <input id="preview-app-thue-phong-tro-page-tsx-1"
              type="text"
              value={poi}
              onChange={(e) => setPoi(e.target.value)}
              placeholder="Ví dụ: ĐH Bách Khoa"
              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-thue-phong-tro-page-tsx-2">Giá tối đa</label>
            <select id="preview-app-thue-phong-tro-page-tsx-2"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="2500000">2,5 triệu</option>
              <option value="4000000">4 triệu</option>
              <option value="6000000">6 triệu</option>
              <option value="10000000">10 triệu</option>
              <option value="12000000">12 triệu</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-thue-phong-tro-page-tsx-3">Cách ĐH Bách Khoa tối đa</label>
            <select id="preview-app-thue-phong-tro-page-tsx-3"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="1">1 km</option>
              <option value="3">3 km</option>
              <option value="5">5 km</option>
              <option value="10">10 km</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium" htmlFor="preview-app-thue-phong-tro-page-tsx-4">Diện tích tối thiểu</label>
            <select id="preview-app-thue-phong-tro-page-tsx-4"
              value={minArea}
              onChange={(e) => setMinArea(e.target.value)}
              className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm text-ink focus:border-brand focus:outline-none"
            >
              <option value="0">Bất kỳ</option>
              <option value="20">20 m²</option>
              <option value="25">25 m²</option>
              <option value="30">30 m²</option>
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1 font-medium">Tiện ích ưu tiên</label>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => toggleChip("ac")}
                aria-pressed={amenityFilters.ac}
                className={`border rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  amenityFilters.ac
                    ? "bg-brand-tint border-brand text-brand"
                    : "bg-white border-gray-200 text-ink hover:bg-bg"
                }`}
              >
                Máy lạnh
              </button>
              <button
                type="button"
                onClick={() => toggleChip("loft")}
                aria-pressed={amenityFilters.loft}
                className={`border rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  amenityFilters.loft
                    ? "bg-brand-tint border-brand text-brand"
                    : "bg-white border-gray-200 text-ink hover:bg-bg"
                }`}
              >
                Gác lửng
              </button>
              <button
                type="button"
                onClick={() => toggleChip("pets")}
                aria-pressed={amenityFilters.pets}
                className={`border rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  amenityFilters.pets
                    ? "bg-brand-tint border-brand text-brand"
                    : "bg-white border-gray-200 text-ink hover:bg-bg"
                }`}
              >
                Nuôi thú cưng
              </button>
              <button
                type="button"
                onClick={() => toggleChip("v")}
                aria-pressed={amenityFilters.v}
                className={`border rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  amenityFilters.v
                    ? "bg-brand-tint border-brand text-brand"
                    : "bg-white border-gray-200 text-ink hover:bg-bg"
                }`}
              >
                Chính chủ
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleReset}
            className="w-full py-2 bg-white hover:bg-bg text-gray-600 hover:text-ink border border-gray-200 rounded-lg text-xs font-medium transition-colors"
          >
            Đặt lại bộ lọc
          </button>
        </aside>

        {/* Danh sách phòng */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <span className="text-sm text-gray-600">
              {filteredRooms.length} phòng trọ phù hợp
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600">Sắp xếp:</span>
              <select
                aria-label="Sắp xếp phòng trọ"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-ink font-medium focus:border-brand focus:outline-none"
              >
                <option value="new">Mới nhất</option>
                <option value="price_asc">Giá thấp đến cao</option>
                <option value="price_desc">Giá cao đến thấp</option>
                <option value="distance_asc">Gần nhất</option>
              </select>
            </div>
          </div>

          {filteredRooms.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredRooms.map((room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl p-12 text-center text-gray-600">
              <p className="text-sm font-medium mb-3">Không có phòng phù hợp với bộ lọc hiện tại.</p>
              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium transition-colors"
              >
                Xóa bộ lọc
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ThuePhongTroPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-600 text-sm">Đang tải danh sách phòng...</div>}>
      <ThuePhongTroContent />
    </Suspense>
  );
}
