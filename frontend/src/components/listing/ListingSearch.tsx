"use client";

import React, { useState, useMemo, useCallback, useRef, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import {
  Map as MapIcon,
  List as ListIcon,
  RotateCcw,
  SlidersHorizontal,
  X,
  SearchX,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { listingsApi, ListingApiError } from "@/lib/api/listings";
import { listingSearchQuery, type ListingSearchSnapshot } from "@/lib/listing-search-query";
import RoomCard from "@/components/RoomCard";
import { PRESET_LOCATIONS } from "@/lib/listing-locations";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollReveal, useProgressiveScroll } from "@/components/ui/scroll-reveal";
import * as DialogPrimitive from "@radix-ui/react-dialog";

// Dynamic import Leaflet map to prevent SSR issues
const ListingMap = dynamic(() => import("@/components/listing/ListingMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[320px] bg-[#f2f4f3] border border-gray-200 rounded-[12px] flex items-center justify-center text-muted text-[13px]">
      Đang tải bản đồ…
    </div>
  ),
});

function CardSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
      <div className="aspect-[4/3] w-full bg-brand-tint" />
      <div className="p-4 space-y-2.5">
        <div className="h-4 bg-brand-tint rounded w-1/3" />
        <div className="h-5 bg-brand-tint rounded w-1/2" />
        <div className="h-4 bg-brand-tint rounded w-full" />
        <div className="h-3.5 bg-brand-tint rounded w-2/3" />
      </div>
    </div>
  );
}

function ThuePhongTroContent({ initialSnapshot }: { initialSnapshot: ListingSearchSnapshot }) {
  const searchParams = useSearchParams();

  // URL is the source of truth, including same-route navigation and Back/Forward.
  const selectedLocation = searchParams.get("location") || "all";
  const minPrice = searchParams.get("minPrice") || "";
  const maxPrice = searchParams.get("maxPrice") || "";
  const minArea = searchParams.get("minArea") || "0";
  const customMaxPrice = maxPrice !== "" && Number.isFinite(Number(maxPrice)) && Number(maxPrice) >= 0
    && !["2500000", "4000000", "6000000", "10000000", "15000000"].includes(maxPrice);
  const customMinArea = Number.isFinite(Number(minArea)) && Number(minArea) >= 0
    && !["0", "18", "25", "30", "40"].includes(minArea);
  const radiusMeters = searchParams.get("radius") || "5000";
  const requestedSort = searchParams.get("sortBy") || "newest";
  const currentLocationObj = PRESET_LOCATIONS.find((loc) => loc.id === selectedLocation) || PRESET_LOCATIONS[0];
  const sortBy = ["newest", "price_asc", "price_desc", "distance_asc"].includes(requestedSort)
    && (requestedSort !== "distance_asc" || currentLocationObj.lat !== undefined) ? requestedSort : "newest";
  const urlAmenities = searchParams.get("amenities") || "";
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  // Popover state for amenities filter on desktop
  const [isAmenitiesOpen, setIsAmenitiesOpen] = useState(false);
  const amenitiesPopoverRef = useRef<HTMLDivElement>(null);

  // Bottom sheet state for mobile filter
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);

  useEffect(() => {
    if (!isMobileFilterOpen) return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setIsMobileFilterOpen(false);
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [isMobileFilterOpen]);

  // Toggle map view under 1024px (tablet & mobile)
  const [showMapUnder1024, setShowMapUnder1024] = useState(false);

  // Selected amenities set
  const selectedAmenities = useMemo(() => {
    return new Set(urlAmenities ? urlAmenities.split(",").filter(Boolean) : []);
  }, [urlAmenities]);

  // Check if any filter is active
  const hasActiveFilters = Boolean(
    selectedLocation !== "all" ||
      minPrice !== "" ||
      maxPrice !== "" ||
      minArea !== "0" ||
      selectedAmenities.size > 0
  );

  // Sync state to URL
  const syncToUrl = useCallback(
    (newParams: Record<string, string | number | undefined>) => {
      // Read the latest URL even before React renders the previous filter change.
      const current = new URLSearchParams(window.location.search);

      Object.entries(newParams).forEach(([key, value]) => {
        if (value === undefined || value === "" || value === 0 || (key === "page" && value === 1)) {
          current.delete(key);
        } else {
          current.set(key, String(value));
        }
      });

      const queryString = current.toString();
      const targetUrl = queryString ? `/thue-phong-tro?${queryString}` : "/thue-phong-tro";
      // These filters are client-only. Next's native history integration updates
      // useSearchParams without an asynchronous RSC navigation losing rapid edits.
      window.history.replaceState(null, "", targetUrl);
    },
    []
  );

  // Close amenities popover on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        amenitiesPopoverRef.current &&
        !amenitiesPopoverRef.current.contains(event.target as Node)
      ) {
        setIsAmenitiesOpen(false);
      }
    }
    if (isAmenitiesOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isAmenitiesOpen]);

  // Fetch amenities catalog
  const { data: amenitiesList = [], isPending: amenitiesPending, isError: amenitiesError,
    isFetching: amenitiesFetching, refetch: refetchAmenities } = useQuery({
    queryKey: ["amenities"],
    queryFn: () => listingsApi.getAmenities(),
    staleTime: 24 * 60 * 60 * 1000,
  });

  const amenitiesStatus = amenitiesPending ? (
    <Alert tone="notice">Đang tải tiện ích…</Alert>
  ) : amenitiesError ? (
    <div className="mb-2">
      <Alert>Chưa thể tải tiện ích. Các bộ lọc đã chọn vẫn được giữ.</Alert>
      <Button type="button" variant="secondary" size="sm" disabled={amenitiesFetching}
        onClick={() => void refetchAmenities()}>
        {amenitiesFetching ? "Đang tải lại tiện ích…" : "Thử tải lại tiện ích"}
      </Button>
    </div>
  ) : amenitiesList.length === 0 ? (
    <Alert tone="notice">Chưa có tiện ích trong danh mục.</Alert>
  ) : null;

  const queryString = searchParams.toString();
  const apiSearchParams = useMemo(() => listingSearchQuery(new URLSearchParams(queryString)), [queryString]);
  const isInitialQuery = JSON.stringify(apiSearchParams) === JSON.stringify(initialSnapshot.params);

  // Fetch listings from real API using TanStack Query
  const {
    data: listingsResult,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    // A new server render supplies authoritative data; do not reuse an older render's cached query.
    // Native history within this render keeps the same ID and still reuses fresh results.
    queryKey: ["longTermListings", initialSnapshot.id, apiSearchParams],
    queryFn: () => listingsApi.search(apiSearchParams),
    initialData: isInitialQuery ? initialSnapshot.result : undefined,
    initialDataUpdatedAt: isInitialQuery ? initialSnapshot.updatedAt : undefined,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });

  const rooms = useMemo(() => listingsResult?.data ?? [], [listingsResult?.data]);
  const { visibleItems: visibleRooms, hasMoreToReveal, sentinelRef } = useProgressiveScroll(rooms, 6);
  const meta = listingsResult?.meta ?? { page: 1, limit: 20, total: 0, totalPages: 0 };

  // Handler: toggle amenity
  const toggleAmenity = (amenityId: string) => {
    const currentAmenities = new URLSearchParams(window.location.search).get("amenities");
    const nextSet = new Set(currentAmenities?.split(",").filter(Boolean) ?? []);
    if (nextSet.has(amenityId)) {
      nextSet.delete(amenityId);
    } else {
      nextSet.add(amenityId);
    }
    const nextAmenitiesStr = Array.from(nextSet).join(",");
    syncToUrl({ amenities: nextAmenitiesStr, page: 1 });
  };

  // Handler: change location
  const handleLocationChange = (locId: string) => {
    if (locId === "all" && new URLSearchParams(window.location.search).get("sortBy") === "distance_asc") {
      syncToUrl({ location: locId, sortBy: "newest", page: 1 });
    } else {
      syncToUrl({ location: locId, page: 1 });
    }
  };

  // Handler: change max price
  const handleMaxPriceChange = (val: string) => {
    syncToUrl({ maxPrice: val, page: 1 });
  };

  // Handler: change min area
  const handleMinAreaChange = (val: string) => {
    syncToUrl({ minArea: val, page: 1 });
  };

  // Handler: change sort
  const handleSortChange = (val: string) => {
    syncToUrl({ sortBy: val, page: 1 });
  };

  // Handler: change page
  const handlePageChange = (newPage: number) => {
    syncToUrl({ page: newPage });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Handler: reset filters
  const handleResetFilters = () => {
    syncToUrl({
      location: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      minArea: undefined,
      radius: undefined,
      sortBy: undefined,
      amenities: undefined,
      page: undefined,
    });
    setIsAmenitiesOpen(false);
    setIsMobileFilterOpen(false);
  };

  const centerCoords = useMemo(() =>
    currentLocationObj.lat !== undefined && currentLocationObj.lng !== undefined
      ? { lat: currentLocationObj.lat, lng: currentLocationObj.lng }
      : null, [currentLocationObj]);

  return (
    <DialogPrimitive.Root open={isMobileFilterOpen} onOpenChange={setIsMobileFilterOpen}>
    <div className="max-w-[1440px] mx-auto px-4 md:px-7 pb-8">
      {/* Breadcrumbs */}
      <nav className="bg-white -mx-4 md:-mx-7 px-4 md:px-7 text-[12px] text-muted flex items-center gap-1.5" aria-label="Đường dẫn trang">
        <Link href="/" className="inline-flex min-h-11 items-center hover:text-ink transition-colors">Trang chủ</Link>
        <span>/</span>
        <span className="text-ink">Thuê trọ dài hạn</span>
      </nav>

      {/* 1. THANH LỌC NGANG PHÍA TRÊN CHO DESKTOP (bỏ cột sidebar bên trái) */}
      <div className="hidden lg:flex flex-wrap items-center gap-3 py-3 px-7 -mx-7 mb-4 border-b border-gray-200 bg-white shadow-sm sticky top-16 z-30">
        {/* Ô chọn "Gần (trường, bệnh viện, KCN)" */}
        <div className="relative w-[300px] min-w-[240px]">
          <label htmlFor="desktop-filter-location" className="sr-only">
            Gần (trường, bệnh viện, KCN)
          </label>
          <select
            id="desktop-filter-location"
            value={selectedLocation}
            onChange={(e) => handleLocationChange(e.target.value)}
            className="w-full h-11 px-3 pr-8 bg-white border border-gray-200 rounded-lg text-[13px] text-ink font-medium focus:border-brand focus:outline-none appearance-none cursor-pointer"
          >
            {PRESET_LOCATIONS.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.id === "all" ? "Gần: Tất cả địa điểm" : `Gần: ${loc.name}`}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-3.5 text-muted pointer-events-none" aria-hidden="true" />
        </div>

        {/* Giá tối đa */}
        <div className="relative min-w-[160px]">
          <label htmlFor="desktop-filter-price" className="sr-only">
            Giá tối đa
          </label>
          <select
            id="desktop-filter-price"
            value={maxPrice}
            onChange={(e) => handleMaxPriceChange(e.target.value)}
            className="w-full h-11 px-3 pr-8 bg-white border border-gray-200 rounded-lg text-[13px] text-ink font-medium focus:border-brand focus:outline-none appearance-none cursor-pointer"
          >
            <option value="">Giá: Bất kỳ</option>
            <option value="2500000">Dưới 2,5 triệu</option>
            <option value="4000000">Dưới 4 triệu</option>
            <option value="6000000">Dưới 6 triệu</option>
            <option value="10000000">Dưới 10 triệu</option>
            <option value="15000000">Dưới 15 triệu</option>
            {customMaxPrice && <option value={maxPrice}>Tối đa {Number(maxPrice).toLocaleString("vi-VN")} đ</option>}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-3.5 text-muted pointer-events-none" aria-hidden="true" />
        </div>

        {/* Diện tích tối thiểu */}
        <div className="relative min-w-[160px]">
          <label htmlFor="desktop-filter-area" className="sr-only">
            Diện tích tối thiểu
          </label>
          <select
            id="desktop-filter-area"
            value={minArea}
            onChange={(e) => handleMinAreaChange(e.target.value)}
            className="w-full h-11 px-3 pr-8 bg-white border border-gray-200 rounded-lg text-[13px] text-ink font-medium focus:border-brand focus:outline-none appearance-none cursor-pointer"
          >
            <option value="0">Diện tích: Bất kỳ</option>
            <option value="18">Từ 18 m²</option>
            <option value="25">Từ 25 m²</option>
            <option value="30">Từ 30 m²</option>
            <option value="40">Từ 40 m²</option>
            {customMinArea && <option value={minArea}>Từ {Number(minArea).toLocaleString("vi-VN")} m²</option>}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-3.5 text-muted pointer-events-none" aria-hidden="true" />
        </div>

        {/* Nút "Tiện ích" mở popover */}
        <div className="relative" ref={amenitiesPopoverRef}>
          <button
            type="button"
            onClick={() => setIsAmenitiesOpen(!isAmenitiesOpen)}
            aria-expanded={isAmenitiesOpen}
            className={`h-11 px-3.5 flex items-center gap-1.5 border rounded-lg text-[13px] font-medium transition-colors ${
              selectedAmenities.size > 0
                ? "border-brand bg-brand-tint text-brand"
                : "border-gray-200 bg-white text-ink hover:bg-bg"
            }`}
          >
            <span>Tiện ích</span>
            {selectedAmenities.size > 0 && (
              <span className="w-5 h-5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center">
                {selectedAmenities.size}
              </span>
            )}
            <ChevronDown size={14} className="text-muted" />
          </button>

          {/* Popover chứa các chip tiện ích */}
          {isAmenitiesOpen && (
            <div className="absolute top-12 right-0 w-[340px] bg-white border border-gray-200 rounded-xl p-4 shadow-lg z-30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-bold text-ink">Tiện ích phòng</span>
                <span className="text-[12px] text-muted">Phải có tất cả</span>
              </div>
              <p className="text-[12px] text-muted mb-3 leading-normal">
                Hệ thống chỉ hiển thị phòng có đủ toàn bộ các tiện ích bạn đánh dấu bên dưới.
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-[220px] overflow-y-auto pr-1">
                {amenitiesStatus}
                {amenitiesList.map((amenity) => {
                  const isChecked = selectedAmenities.has(amenity.id);
                  return (
                    <button
                      key={amenity.id}
                      type="button"
                      onClick={() => toggleAmenity(amenity.id)}
                      aria-pressed={isChecked}
                      className={`min-h-11 border rounded-lg px-2.5 py-1 text-[13px] font-medium transition-colors ${
                        isChecked
                          ? "bg-brand-tint border-brand text-brand"
                          : "bg-white border-gray-200 text-ink hover:bg-bg"
                      }`}
                    >
                      {amenity.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Nút "Đặt lại" duy nhất */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="h-11 px-3 flex items-center gap-1.5 text-[13px] text-muted hover:text-brand transition-colors ml-auto"
            title="Đặt lại toàn bộ bộ lọc"
          >
            <RotateCcw size={14} />
            <span>Đặt lại</span>
          </button>
        )}
      </div>

      {/* THANH ĐIỀU HƯỚNG TRÊN MOBILE & TABLET (<1024px) */}
      <div className="lg:hidden flex items-center justify-between gap-2 my-4">
        {/* Nút mở Bottom Sheet bộ lọc */}
        <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          className={`h-11 px-3.5 border rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-colors ${
            hasActiveFilters
              ? "border-brand bg-brand-tint text-brand"
              : "border-gray-200 bg-white text-ink"
          }`}
        >
          <SlidersHorizontal size={14} />
          <span>Bộ lọc</span>
          {hasActiveFilters && (
            <span className="w-2 h-2 rounded-full bg-brand inline-block" />
          )}
        </button>
        </DialogPrimitive.Trigger>

        {/* Nút toggle Danh sách / Bản đồ trên mobile */}
        <div className="flex border border-gray-200 rounded-lg p-0.5 bg-white">
          <button
            type="button"
            onClick={() => setShowMapUnder1024(false)}
            aria-pressed={!showMapUnder1024}
            className={`min-h-11 flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
              !showMapUnder1024 ? "bg-brand text-white" : "text-muted hover:text-ink"
            }`}
          >
            <ListIcon size={14} /> Danh sách
          </button>
          <button
            type="button"
            onClick={() => setShowMapUnder1024(true)}
            aria-pressed={showMapUnder1024}
            className={`min-h-11 flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
              showMapUnder1024 ? "bg-brand text-white" : "text-muted hover:text-ink"
            }`}
          >
            <MapIcon size={14} /> Bản đồ
          </button>
        </div>
      </div>

      {/* 3. DÒNG PHÍA TRÊN DANH SÁCH: "Tìm thấy N phòng trọ phù hợp" bên trái, sắp xếp bên phải */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-[18px] sm:text-[20px] leading-7 font-bold text-ink tracking-tight">
            {isLoading
              ? "Đang tìm kiếm phòng trọ…"
              : isError
              ? "Lỗi kết nối máy chủ"
              : `Tìm thấy ${meta.total} phòng trọ phù hợp`}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="select-sort-by" className="text-[13px] text-muted whitespace-nowrap">
            Sắp xếp:
          </label>
          <select
            id="select-sort-by"
            aria-label="Sắp xếp phòng trọ"
            value={sortBy}
            onChange={(e) => handleSortChange(e.target.value)}
            className="h-11 bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-[13px] text-ink font-medium focus:border-brand focus:outline-none cursor-pointer hover:border-gray-300 transition-colors"
          >
            <option value="newest">Mới nhất</option>
            <option value="price_asc">Giá thấp đến cao</option>
            <option value="price_desc">Giá cao đến thấp</option>
            {centerCoords && <option value="distance_asc">Gần nhất</option>}
          </select>
        </div>
      </div>

      {/* BỐ CỤC CHÍNH: DANH SÁCH (~60%) VÀ BẢN ĐỒ (~40% STICKY) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 items-start">
        {/* Cột danh sách bên trái */}
        <div className={`${showMapUnder1024 ? "hidden lg:block" : "block"}`}>
          {/* Trạng thái đang tải */}
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          )}

          {/* Trạng thái lỗi */}
          {!isLoading && isError && (
            <div className="py-12 text-center">
              <AlertCircle className="mx-auto text-danger mb-2.5" size={28} />
              <p className="text-[14px] font-medium text-ink mb-1">
                Không thể tải dữ liệu tìm kiếm
              </p>
              <p className="text-[13px] text-muted mb-4 max-w-sm mx-auto">
                {error instanceof ListingApiError
                  ? error.message
                  : "Máy chủ đang bận hoặc có sự cố mạng. Vui lòng thử lại sau ít phút."}
              </p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="min-h-11 px-4 py-2 bg-brand text-white rounded-lg text-[13px] font-medium hover:bg-brand-hover transition-colors"
              >
                Thử lại
              </button>
            </div>
          )}

          {/* 5. EMPTY STATE: bỏ khung lớn, chỉ một icon, một câu, một nút "Xóa bộ lọc" */}
          {!isLoading && !isError && rooms.length === 0 && (
            <div className="py-16 text-center">
              <SearchX className="mx-auto text-muted mb-3" size={32} strokeWidth={1.5} />
              <p className="text-[14px] text-ink mb-4">
                Không có phòng trọ phù hợp với tiêu chí hiện tại.
              </p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="min-h-11 px-4 py-2 bg-brand text-white rounded-lg text-[13px] font-medium hover:bg-brand-hover transition-colors"
              >
                Xóa bộ lọc
              </button>
            </div>
          )}

          {/* Danh sách phòng */}
          {!isLoading && !isError && rooms.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {visibleRooms.map((room, idx) => (
                  <ScrollReveal key={room.id} delayMs={(idx % 6) * 60} className="h-full min-w-0">
                    <RoomCard
                      room={room}
                      appearance="search"
                      highlighted={room.id === selectedRoomId}
                      onMouseEnter={() => setSelectedRoomId(room.id)}
                      onMouseLeave={() => setSelectedRoomId(null)}
                    />
                  </ScrollReveal>
                ))}
              </div>
              {hasMoreToReveal && (
                <div ref={sentinelRef} className="py-6 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
                  Đang tải thêm phòng khi cuộn…
                </div>
              )}

              {/* Phân trang */}
              {meta.totalPages > 1 && (
                <div className="mt-8 flex flex-wrap items-center justify-center gap-1.5" role="navigation" aria-label="Phân trang">
                  <button
                    type="button"
                    onClick={() => handlePageChange(meta.page - 1)}
                    disabled={meta.page <= 1}
                    className="min-h-11 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] font-medium bg-white text-ink hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <ChevronLeft size={14} /> Trước
                  </button>

                  {Array.from({ length: meta.totalPages }).map((_, idx) => {
                    const pNum = idx + 1;
                    const isCurrent = pNum === meta.page;
                    if (
                      pNum === 1 ||
                      pNum === meta.totalPages ||
                      (pNum >= meta.page - 1 && pNum <= meta.page + 1)
                    ) {
                      return (
                        <button
                          key={pNum}
                          type="button"
                          onClick={() => handlePageChange(pNum)}
                          aria-current={isCurrent ? "page" : undefined}
                          className={`w-11 h-11 rounded-lg text-[13px] font-medium transition-colors ${
                            isCurrent
                              ? "bg-brand text-white"
                              : "bg-white border border-gray-200 text-ink hover:bg-bg"
                          }`}
                        >
                          {pNum}
                        </button>
                      );
                    }
                    if (pNum === meta.page - 2 || pNum === meta.page + 2) {
                      return (
                        <span key={pNum} className="text-[13px] text-muted px-1">
                          …
                        </span>
                      );
                    }
                    return null;
                  })}

                  <button
                    type="button"
                    onClick={() => handlePageChange(meta.page + 1)}
                    disabled={meta.page >= meta.totalPages}
                    className="min-h-11 px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] font-medium bg-white text-ink hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    Sau <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Cột bản đồ bên phải: sticky, chiều cao bằng viewport trừ header (64px + padding) */}
        <div
          className={`${
            showMapUnder1024 ? "block" : "hidden"
          } lg:block lg:sticky lg:top-[148px] h-[calc(100dvh-176px)] min-h-[460px] lg:min-h-[620px] w-full shadow-sm rounded-xl`}
        >
          <ListingMap
            rooms={rooms}
            selectedRoomId={selectedRoomId}
            onSelectRoom={setSelectedRoomId}
            centerCoordinates={centerCoords}
            radiusMeters={centerCoords && Number.isFinite(Number(radiusMeters)) && Number(radiusMeters) > 0 ? Math.round(Number(radiusMeters)) : undefined}
          />
        </div>
      </div>

      {/* MOBILE BOTTOM SHEET FOR FILTERS */}
      <DialogPrimitive.Portal>
          {/* Backdrop */}
          <DialogPrimitive.Overlay
            className="fixed inset-0 z-[600] bg-black/40 backdrop-blur-xs transition-opacity"
          />

          {/* Sheet panel */}
          <DialogPrimitive.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-[601] bg-white rounded-t-2xl p-5 shadow-2xl max-h-[85dvh] overflow-y-auto space-y-4"
            onCloseAutoFocus={(event) => {
              if (window.matchMedia("(min-width: 1024px)").matches) {
                event.preventDefault();
                document.getElementById("desktop-filter-location")?.focus();
              }
            }}
          >
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <DialogPrimitive.Title asChild>
              <h2 className="text-[16px] font-bold text-ink">Bộ lọc tìm kiếm</h2>
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
              <button
                type="button"
                className="w-11 h-11 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-bg"
                aria-label="Đóng bộ lọc"
              >
                <X size={18} />
              </button>
              </DialogPrimitive.Close>
            </div>

            {/* Địa điểm gần */}
            <div>
              <label className="block text-[13px] text-muted mb-1 font-medium" htmlFor="mobile-filter-loc">
                Gần (trường, bệnh viện, KCN)
              </label>
              <select
                id="mobile-filter-loc"
                value={selectedLocation}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-[13px] text-ink focus:border-brand focus:outline-none"
              >
                {PRESET_LOCATIONS.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Giá tối đa */}
            <div>
              <label className="block text-[13px] text-muted mb-1 font-medium" htmlFor="mobile-filter-price">
                Giá tối đa
              </label>
              <select
                id="mobile-filter-price"
                value={maxPrice}
                onChange={(e) => handleMaxPriceChange(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-[13px] text-ink focus:border-brand focus:outline-none"
              >
                <option value="">Bất kỳ</option>
                <option value="2500000">Dưới 2,5 triệu</option>
                <option value="4000000">Dưới 4 triệu</option>
                <option value="6000000">Dưới 6 triệu</option>
                <option value="10000000">Dưới 10 triệu</option>
                <option value="15000000">Dưới 15 triệu</option>
                {customMaxPrice && <option value={maxPrice}>Tối đa {Number(maxPrice).toLocaleString("vi-VN")} đ</option>}
              </select>
            </div>

            {/* Diện tích tối thiểu */}
            <div>
              <label className="block text-[13px] text-muted mb-1 font-medium" htmlFor="mobile-filter-area">
                Diện tích tối thiểu
              </label>
              <select
                id="mobile-filter-area"
                value={minArea}
                onChange={(e) => handleMinAreaChange(e.target.value)}
                className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-[13px] text-ink focus:border-brand focus:outline-none"
              >
                <option value="0">Bất kỳ</option>
                <option value="18">Từ 18 m²</option>
                <option value="25">Từ 25 m²</option>
                <option value="30">Từ 30 m²</option>
                <option value="40">Từ 40 m²</option>
                {customMinArea && <option value={minArea}>Từ {Number(minArea).toLocaleString("vi-VN")} m²</option>}
              </select>
            </div>

            {/* Tiện ích yêu cầu */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-[13px] text-muted font-medium">Tiện ích phòng</label>
                  <span className="text-[12px] text-muted">Phải có tất cả</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {amenitiesStatus}
                  {amenitiesList.map((amenity) => {
                    const isChecked = selectedAmenities.has(amenity.id);
                    return (
                      <button
                        key={amenity.id}
                        type="button"
                        onClick={() => toggleAmenity(amenity.id)}
                        aria-pressed={isChecked}
                        className={`min-h-11 border rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                          isChecked
                            ? "bg-brand-tint border-brand text-brand"
                            : "bg-white border-gray-200 text-ink"
                        }`}
                      >
                        {amenity.name}
                      </button>
                    );
                  })}
                </div>
              </div>

            {/* Nút hành động */}
            <div className="pt-3 flex gap-2 border-t border-gray-200">
              <button
                type="button"
                onClick={handleResetFilters}
                className="min-h-11 flex-1 py-2.5 bg-bg text-ink border border-gray-200 rounded-lg text-[13px] font-medium"
              >
                Đặt lại
              </button>
              <button
                type="button"
                onClick={() => setIsMobileFilterOpen(false)}
                className="min-h-11 flex-1 py-2.5 bg-brand text-white rounded-lg text-[13px] font-medium"
              >
                Xem kết quả ({meta.total})
              </button>
            </div>
          </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </div>
    </DialogPrimitive.Root>
  );
}

export default function ListingSearch({ initialSnapshot }: { initialSnapshot: ListingSearchSnapshot }) {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-muted text-[13px]">
          Đang tải danh sách phòng trọ…
        </div>
      }
    >
      <ThuePhongTroContent initialSnapshot={initialSnapshot} />
    </Suspense>
  );
}
