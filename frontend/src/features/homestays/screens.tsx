"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import "./stitch-guest.css";
import {
  AlertCircle,
  ArrowRight,
  Calendar as CalendarIcon,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Home,
  Info,
  MapPin,
  Phone,
  RotateCw,
  Search,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollReveal, useProgressiveScroll } from "@/components/ui/scroll-reveal";
import { useAuthStore } from "@/stores/auth-store";
import { ApiError } from "@/lib/auth-types";
import { homestaysApi, type Booking, type Calendar, type Price, type Quote, type Stay } from "@/lib/api/homestays";
import { homestaySearchParams } from "@/lib/homestay-search-params";
import { calendarPriceLabel, homestayCoverUrl, stayDateLabel } from "@/lib/homestay-display";
import { ListingGallery } from "@/components/listing/listing-gallery";
import { listingDisplayTitle, listingDisplayDescription } from "@/lib/listing-links";
import { HostNoShowReport } from "@/features/no-show/host-report";
import { BookingReview, PropertyReviews } from "@/features/reviews/reviews";
import {NearbySection} from "@/features/nearby/section";
import { ChatLauncher } from "@/features/chat/chat";

const currency = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const deadline = (date: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
const message = (error: unknown) => error instanceof ApiError && error.errorCode === "PAYMENT_NOT_CONFIGURED"
  ? "Hiện chưa thể tạo đơn đặt phòng. Vui lòng thử lại sau."
  : (error instanceof Error ? error.message : "Có lỗi xảy ra. Vui lòng thử lại.");

export const bookingLabels: Record<string, string> = {
  PENDING_PAYMENT: "Chờ thanh toán",
  PENDING_HOST_APPROVAL: "Chờ chủ nhà duyệt",
  CONFIRMED: "Đã xác nhận",
  CHECKED_IN: "Đã nhận phòng",
  COMPLETED: "Đã hoàn tất",
  CANCELLED_TIMEOUT: "Hết hạn thanh toán",
  CANCELLED_HOST_TIMEOUT: "Hết hạn chủ nhà duyệt",
  REJECTED_BY_HOST: "Chủ nhà từ chối",
  CANCELLED_BY_GUEST: "Bạn đã hủy",
};

export function PageFrame({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  const pathname = usePathname();
  const isSearch = pathname === "/homestay" || pathname.startsWith("/homestay/");
  const isBookings = pathname === "/bookings";
  const isHostBookings = pathname === "/host/bookings";

  return (
    <div className={`s3-page stitch-guest-page ${className}`}>
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-4 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-ink tracking-tight text-balance">{listingDisplayTitle(title)}</h1>
          <p className="text-sm text-gray-600 mt-1 text-pretty">Nền tảng đặt homestay theo đêm minh bạch và nhanh chóng</p>
        </div>
        <nav className="s3-links s3-tab-bar" aria-label="Đặt phòng" onFocusCapture={(event) => event.target.scrollIntoView({ block: "nearest", inline: "nearest" })}>
          <Link
            className={`s3-tab-link text-link ${isSearch && !isBookings && !isHostBookings ? "active" : ""}`}
            href="/homestay"
            aria-current={isSearch && !isBookings && !isHostBookings ? "page" : undefined}
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span>Tìm homestay</span>
          </Link>
          <Link className={`s3-tab-link text-link ${isBookings ? "active" : ""}`} href="/bookings" aria-current={isBookings ? "page" : undefined}>
            <CalendarIcon className="size-4 shrink-0" aria-hidden="true" />
            <span>Đơn của tôi</span>
          </Link>
          <Link className={`s3-tab-link text-link ${isHostBookings ? "active" : ""}`} href="/host/bookings" aria-current={isHostBookings ? "page" : undefined}>
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            <span>Đơn dành cho Host</span>
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}

export function ReadState({ loading, error, retry }: { loading: boolean; error: unknown; retry: () => void }) {
  if (error) {
    return (
      <div role="alert" className="s3-state">
        <div className="flex flex-col items-center gap-2 max-w-md mx-auto text-center">
          <AlertCircle className="w-8 h-8 text-error" aria-hidden="true" />
          <p className="field-error text-sm font-medium">{message(error)}</p>
          <Button variant="secondary" onClick={retry} className="mt-2">
            <RotateCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
            Thử lại
          </Button>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div aria-busy="true" className="s3-loading">
        <span className="sr-only" role="status">
          Đang tải dữ liệu
        </span>
        {[0, 1, 2].map((n) => (
          <div
            key={n}
            className="h-28 rounded-xl bg-white border border-gray-200 p-4 animate-pulse motion-reduce:animate-none flex items-center justify-between"
          >
            <div className="space-y-3 w-2/3">
              <div className="h-4 bg-brand-tint rounded w-3/4" />
              <div className="h-3 bg-bg rounded w-1/2" />
              <div className="h-3 bg-bg rounded w-1/3" />
            </div>
            <div className="h-9 w-24 bg-brand-tint rounded-lg" />
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function PriceRows({ price }: { price: Price }) {
  return (
    <dl className="s3-price">
      {(
        [
          ["Tiền phòng", price.baseAmount],
          ["Phí vệ sinh", price.cleaningFee],
          ["Phí dịch vụ", price.serviceFee],
          ["Thuế", price.taxAmount],
          ["Tổng cộng", price.totalAmount],
        ] as [string, number][]
      )
        .filter(([label, value]) => value !== 0 || label === "Tổng cộng" || label === "Tiền phòng")
        .map(([label, value]) => (
          <div key={label} className={label === "Tổng cộng" ? "s3-price-total" : ""}>
            <dt>{label}</dt>
            <dd>{currency.format(value)} đ</dd>
          </div>
        ))}
    </dl>
  );
}

function StayInputs({
  stay,
  setStay,
  required = true,
}: {
  stay: Stay;
  setStay: Dispatch<SetStateAction<Stay>>;
  required?: boolean;
}) {
  return (
    <div className="s3-fields">
      <Input
        id="check-in"
        label="Nhận phòng"
        type="date"
        required={required}
        value={stay.checkIn}
        onChange={(e) => {
          const checkIn = e.currentTarget.value;
          setStay((current) => ({ ...current, checkIn }));
        }}
      />
      <Input
        id="check-out"
        label="Trả phòng"
        type="date"
        required={required}
        value={stay.checkOut}
        onChange={(e) => {
          const checkOut = e.currentTarget.value;
          setStay((current) => ({ ...current, checkOut }));
        }}
      />
      <Input
        id="adults"
        label="Người lớn"
        type="number"
        required
        min={1}
        step={1}
        value={stay.adults}
        onChange={(e) => {
          const adults = Math.max(1, Number(e.currentTarget.value) || 1);
          setStay((current) => ({ ...current, adults }));
        }}
      />
      <Input
        id="children"
        label="Trẻ em"
        type="number"
        required
        min={0}
        step={1}
        value={stay.children}
        onChange={(e) => {
          const children = Math.max(0, Number(e.currentTarget.value) || 0);
          setStay((current) => ({ ...current, children }));
        }}
      />
    </div>
  );
}

const emptyStay: Stay = { unitId: "", checkIn: "", checkOut: "", adults: 1, children: 0 };

function HomestayCover({ url, title }: { url: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="homestay-result-cover">
      {url && !failed ? (
        <Image
          src={url}
          alt={listingDisplayTitle(title)}
          unoptimized
          width={640}
          height={480}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      ) : (
        <div className="homestay-result-placeholder">
          <Camera className="size-6" aria-hidden="true" /><span>Chưa có ảnh</span>
        </div>
      )}
    </div>
  );
}

export function HomestaySearch() {
  const params=useSearchParams();
  const urlQuery=params.toString();
  const [q, setQ] = useState(()=>homestaySearchParams(params).q);
  const [stay, setStay] = useState(()=>homestaySearchParams(params).stay);
  const [filters, setFilters] = useState<Record<string, string | number>>(()=>homestaySearchParams(params).filters);
  const [formError, setFormError] = useState("");
  useEffect(()=>{
    const initial=homestaySearchParams(new URLSearchParams(urlQuery));
    setQ(initial.q);setStay(initial.stay);setFilters(initial.filters);setFormError("");
  },[urlQuery]);

  const results = useQuery({
    queryKey: ["homestay-search", filters],
    meta: { public: true },
    queryFn: ({ signal }) => homestaysApi.search(filters, signal),
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    retry: false,
  });

  const units = results.data?.data ?? [];
  const { visibleItems: visibleUnits, hasMoreToReveal, sentinelRef } = useProgressiveScroll(units, 5);

  function search(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    if (Boolean(stay.checkIn) !== Boolean(stay.checkOut)) {
      setFormError("Chọn đủ ngày nhận và trả phòng, hoặc để trống cả hai để tìm tất cả phòng.");
      return;
    }
    if (stay.checkIn && stay.checkOut && stay.checkOut <= stay.checkIn) {
      setFormError("Ngày trả phòng phải sau ngày nhận phòng.");
      return;
    }
    setFilters({
      page: 1,
      limit: 10,
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(stay.checkIn
        ? { checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults, children: stay.children }
        : {}),
    });
  }

  const hasActiveFilters = Boolean(q.trim() || stay.checkIn || stay.checkOut || stay.adults > 1 || stay.children > 0);

  function resetFilters() {
    setQ("");
    setStay(emptyStay);
    setFormError("");
    setFilters({ page: 1, limit: 10 });
  }

  return (
    <PageFrame title="Tìm homestay" className="stitch-homestay-search">
      <section className="s3-card">
        <form className="space-y-5" onSubmit={search}>
          <div>
            <Input
              id="destination"
              label="Tên homestay hoặc địa chỉ"
              placeholder="Ví dụ: Đà Lạt, Vũng Tàu, homestay ven hồ..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <StayInputs stay={stay} setStay={setStay} required={false} />
          <p className="password-rules flex items-center gap-1.5 text-xs text-gray-600">
            <Info className="w-3.5 h-3.5 text-brand flex-shrink-0" aria-hidden="true" />
            <span>Ngày và sức chứa được kiểm tra trên máy chủ, theo giờ Việt Nam. Có thể để trống cả hai ngày để xem danh sách.</span>
          </p>
          {formError && (
            <div role="alert" className="form-error">
              {formError}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit">
              <Search className="w-4 h-4 mr-1.5" aria-hidden="true" />
              Tìm phòng
            </Button>
            {hasActiveFilters && (
              <Button type="button" variant="secondary" onClick={resetFilters}>
                Xóa lọc
              </Button>
            )}
          </div>
        </form>
      </section>

      <ReadState loading={results.isPending} error={results.error} retry={() => void results.refetch()} />

      {results.data && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">
              {results.data.meta.total} phòng phù hợp
            </h2>
            <span className="text-xs text-gray-600">
              Trang {results.data.meta.page} / {results.data.meta.totalPages || 1}
            </span>
          </div>

          <ul className="s3-list">
            {visibleUnits.map((unit, idx) => (
              <li key={unit.id} className="homestay-result-card hover:border-brand transition-colors">
                <HomestayCover key={homestayCoverUrl(unit.media) || "empty"} url={homestayCoverUrl(unit.media)} title={unit.title} />
                <ScrollReveal delayMs={(idx % 5) * 60} className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {unit.instantBook ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <Zap className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                        Đặt tức thì
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                        <Clock className="w-3 h-3 text-amber-600" aria-hidden="true" />
                        Chủ nhà duyệt
                      </span>
                    )}
                    <span className="text-xs text-gray-600">
                      Chính sách: {({ FLEXIBLE: "Linh hoạt", MODERATE: "Vừa phải", STRICT: "Nghiêm ngặt" } as Record<string, string>)[unit.cancellationPolicy] || unit.cancellationPolicy}
                    </span>
                  </div>

                  <h3 className="font-bold text-base text-ink break-words">
                    {listingDisplayTitle(unit.title)} · {unit.unitName}
                  </h3>

                  <p className="text-gray-600 text-sm flex items-center gap-1.5 break-words">
                    <MapPin className="w-4 h-4 text-brand flex-shrink-0" aria-hidden="true" />
                    <span>{unit.address}</span>
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-4 h-4 text-gray-600" aria-hidden="true" />
                      Tối đa {unit.maxAdults} người lớn{unit.maxChildren > 0 ? `, ${unit.maxChildren} trẻ em` : ""}
                    </span>
                    {unit.bedrooms > 0 && <span>· {unit.bedrooms} PN</span>}
                    {unit.bathrooms > 0 && <span>· {unit.bathrooms} PT</span>}
                  </div>
                </ScrollReveal>

                <div className="homestay-result-actions">
                  <p className="homestay-result-price">
                    Từ <span className="homestay-result-amount">{currency.format(unit.basePricePerNight)} đ</span> <span className="text-xs font-normal text-gray-600">/ đêm</span>
                  </p>
                  <Link className="button button-sm inline-flex items-center gap-1" href={`/homestay/${unit.slug}`}>
                    <span>Xem phòng</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </li>
            ))}
          </ul>

          {hasMoreToReveal && (
            <div ref={sentinelRef} className="py-5 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-muted">
              Đang tải thêm homestay khi cuộn…
            </div>
          )}

          {!results.data.data.length && (
            <div className="s3-state py-12">
              <div className="space-y-3 max-w-sm mx-auto text-center">
                <Home className="w-10 h-10 text-gray-600 mx-auto" aria-hidden="true" />
                <p className="font-semibold text-ink text-base">Không có phòng phù hợp.</p>
                <p className="text-sm text-gray-600">Hãy thử đổi tiêu chí ngày nhận/trả hoặc mở rộng địa điểm tìm kiếm.</p>
                <Button variant="secondary" onClick={resetFilters}>
                  Xóa lọc và xem tất cả
                </Button>
              </div>
            </div>
          )}

          {results.data.meta.totalPages > 1 && (
            <div className="homestay-search-pagination s3-actions justify-center pt-4">
              <Button
                variant="secondary"
                disabled={Number(filters.page) <= 1}
                onClick={() => setFilters({ ...filters, page: Number(filters.page) - 1 })}
              >
                <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" />
                Trang trước
              </Button>
              <span className="text-sm font-medium text-gray-600 px-3">
                Trang {results.data.meta.page} / {results.data.meta.totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={results.data.meta.page >= results.data.meta.totalPages}
                onClick={() => setFilters({ ...filters, page: Number(filters.page) + 1 })}
              >
                Trang sau
                <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
              </Button>
            </div>
          )}
        </section>
      )}
    </PageFrame>
  );
}

export function HomestayDetail({ slug,nearbyEnabled=false }: { slug: string;nearbyEnabled?:boolean }) {
  const detail = useQuery({
    queryKey: ["homestay-detail", slug],
    meta: { public: true },
    queryFn: ({ signal }) => homestaysApi.detail(slug, signal),
    retry: false,
  });

  const [stay, setStay] = useState(emptyStay);
  const [applied, setApplied] = useState<Stay | null>(null);
  const unitId = stay.unitId || detail.data?.units[0]?.id || "";

  const [month, setMonth] = useState(() =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit" }).format(
      new Date()
    )
  );

  const calendar = useQuery({
    queryKey: ["homestay-calendar", unitId, month, stay.adults, stay.children],
    meta: { public: true },
    queryFn: ({ signal }) => homestaysApi.calendar(unitId, month, stay.adults, stay.children, signal),
    enabled: Boolean(unitId) && /^\d{4}-\d{2}$/.test(month),
    retry: false,
  });

  const quote = useQuery({
    queryKey: ["homestay-quote", applied],
    meta: { public: true },
    queryFn: ({ signal }) => homestaysApi.quote(applied!, signal),
    enabled: Boolean(applied),
    retry: false,
    staleTime: 0,
  });

  const params = applied ? new URLSearchParams(Object.entries(applied).map(([key, value]) => [key, String(value)])) : null;

  const currentUnit = detail.data?.units.find((u) => u.id === unitId) || detail.data?.units[0];

  return (
    <PageFrame title={detail.data?.title || "Chi tiết homestay"} className="stitch-homestay-detail">
      <nav className="text-xs text-gray-600 flex items-center gap-1.5" aria-label="Đường dẫn trang">
        <Link href="/" className="inline-flex min-h-11 items-center hover:text-ink sm:min-h-0">Trang chủ</Link>
        <span>›</span>
        <Link href="/homestay" className="inline-flex min-h-11 items-center hover:text-ink sm:min-h-0">Homestay</Link>
        {detail.data && (
          <>
            <span>›</span>
            <span className="text-ink font-medium truncate max-w-xs">{listingDisplayTitle(detail.data.title)}</span>
          </>
        )}
      </nav>

      <ReadState loading={detail.isPending} error={detail.error} retry={() => void detail.refetch()} />

      {detail.data && (
        <div className="space-y-6">
          <ListingGallery title={listingDisplayTitle(detail.data.title)} images={(detail.data.media || []).map(image=>({...image,position:image.sortOrder}))} appearance="stitch"/>
          <div className="stitch-booking-layout grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
            <section className="homestay-detail-info s3-card space-y-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded bg-brand-tint text-brand">
                    Homestay theo đêm
                  </span>
                  {currentUnit?.instantBook ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <Zap className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                      Đặt tức thì
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                      <Clock className="w-3 h-3 text-amber-600" aria-hidden="true" />
                      Chủ nhà duyệt
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-sm flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-brand flex-shrink-0" aria-hidden="true" />
                  <span>
                    {detail.data.address.addressDetail}, {detail.data.address.wardName}
                  </span>
                </p>
              </div>
  
              {listingDisplayDescription(detail.data.description) && <div className="border-t border-gray-200 pt-4">
                <h2 className="text-base font-semibold text-ink mb-2">Giới thiệu chỗ ở</h2>
                <p className="whitespace-pre-wrap break-words text-sm text-ink leading-relaxed">
                  {listingDisplayDescription(detail.data.description)}
                </p>
              </div>}
  
              {detail.data.amenities.length > 0 && (
                <div className="border-t border-gray-200 pt-4">
                  <h2 className="text-base font-semibold text-ink mb-3">Tiện nghi có sẵn</h2>
                  <div className="flex flex-wrap gap-2">
                    {detail.data.amenities.map((a) => (
                      <span
                        key={a.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-bg text-ink border border-gray-200"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-brand" aria-hidden="true" />
                        {a.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
  
              <div className="border-t border-gray-200 pt-4 space-y-3">
                <h2 className="text-base font-semibold text-ink">Chọn loại phòng</h2>
                <div className="s3-unit-buttons">
                  {detail.data.units.map((unit) => (
                    <Button
                      key={unit.id}
                      variant={unitId === unit.id ? "primary" : "secondary"}
                      aria-pressed={unitId === unit.id}
                      onClick={() => {
                        setStay({ ...stay, unitId: unit.id });
                        setApplied(null);
                      }}
                    >
                      {unit.unitName}
                    </Button>
                  ))}
                </div>
              </div>
  
              {currentUnit && (
                <div className="bg-bg rounded-lg p-4 border border-gray-200 space-y-2">
                  <div className="flex flex-wrap items-center gap-4 text-sm font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-brand" aria-hidden="true" />
                      Nhận phòng: <strong>{currentUnit.checkInTime.slice(0, 5)}</strong> · Trả phòng:{" "}
                      <strong>{currentUnit.checkOutTime.slice(0, 5)}</strong> (giờ VN)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-brand" aria-hidden="true" />
                      Tối đa <strong>{currentUnit.maxAdults} người lớn</strong>, <strong>{currentUnit.maxChildren} trẻ em</strong>
                    </span>
                  </div>
                  <p className="password-rules">
                    Chính sách hủy:{" "}
                    <strong>
                      {({ FLEXIBLE: "Linh hoạt", MODERATE: "Vừa phải", STRICT: "Nghiêm ngặt" } as Record<string, string>)[
                        currentUnit.cancellationPolicy
                      ] || currentUnit.cancellationPolicy}
                    </strong>
                    . Hủy đơn đã thanh toán/hoàn tiền chưa được kết nối.
                  </p>
                </div>
              )}
            </section>

            <div className="homestay-booking-sidebar s3-card space-y-6 lg:col-span-1 lg:sticky lg:top-24">
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  setApplied({ ...stay, unitId });
                }}
              >
                <h2 className="text-base font-semibold text-ink">Chọn ngày và số khách</h2>
                <StayInputs
                  stay={stay}
                  setStay={(value) => {
                    setStay(value);
                    setApplied(null);
                  }}
                />
                <Button type="submit">Xem báo giá</Button>
              </form>
              {!applied && <p className="text-sm text-gray-600">Chọn ngày và số khách để xem báo giá. Xem báo giá chưa giữ phòng.</p>}
              {applied && (
                <section className="space-y-4 border-t border-gray-200 pt-5">
                  <h2 className="text-base font-bold text-ink border-b border-gray-200 pb-2">
                    Báo giá lưu trú
                  </h2>
                  <ReadState loading={quote.isPending} error={quote.error} retry={() => void quote.refetch()} />
                  {quote.data && (
                    <div className="space-y-4">
                      <div className="text-sm text-gray-600">
                        {stayDateLabel(stay.checkIn)} → {stayDateLabel(stay.checkOut)} ({quote.data.totalNights} đêm)
                      </div>
                      <h3 className="text-base font-semibold">{quote.data.totalNights} đêm</h3>
                      <PriceRows price={quote.data.priceBreakdown} />
                      {quote.data.isAvailable ? (
                        <Link className="button full-width" href={`/checkout?${params}`}>
                          Tiếp tục đặt phòng
                        </Link>
                      ) : (
                        <p className="notice">Phòng không còn trống cho khoảng ngày này.</p>
                      )}
                    </div>
                  )}
                </section>
              )}
            </div>

            <section className="homestay-detail-calendar s3-card space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 className="text-base font-semibold text-ink">Lịch còn phòng</h2>
                <div className="w-44">
                  <Input
                    id="calendar-month"
                    label="Tháng"
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </div>
              </div>

              <p className="password-rules">
                Lịch theo từng đêm; ngày trả phòng không tính là đêm lưu trú. Hết phòng không đồng nghĩa không thể chọn làm ngày trả.
              </p>

              <ReadState loading={calendar.isPending} error={calendar.error} retry={() => void calendar.refetch()} />

              {calendar.data && (
                <div className="space-y-3 pt-2">
                  <p className="password-rules font-medium text-ink">
                    {stay.checkIn && !stay.checkOut
                      ? "Chọn ngày trả phòng (đêm cuối đã ở là ngày trước đó)."
                      : "Chọn ngày nhận phòng trên lịch hoặc dùng ô ngày bên trên."}
                  </p>
                  <AvailabilityCalendar
                    compactPrices
                    calendar={calendar.data}
                    checkout={Boolean(stay.checkIn && !stay.checkOut)}
                    selectedCheckIn={stay.checkIn}
                    selectedCheckOut={stay.checkOut}
                    onPick={(date) => {
                      if (!stay.checkIn || (stay.checkIn && stay.checkOut)) {
                        setStay({ ...stay, checkIn: date, checkOut: "" });
                        setApplied(null);
                      } else {
                        if (date > stay.checkIn) {
                          setStay({ ...stay, checkOut: date });
                          setApplied(null);
                        } else {
                          setStay({ ...stay, checkIn: date, checkOut: "" });
                          setApplied(null);
                        }
                      }
                    }}
                  />
                </div>
              )}
            </section>
          </div>
          <PropertyReviews key={slug} slug={slug} />
          <ChatLauncher propertyId={detail.data.id} />
          {nearbyEnabled&&<NearbySection key={slug} slug={slug}/>}
        </div>
      )}
    </PageFrame>
  );
}

export function AvailabilityCalendar({
  calendar,
  onPick,
  checkout = false,
  selectedCheckIn,
  selectedCheckOut,
  compactPrices = false,
}: {
  calendar: Calendar;
  onPick?: (date: string) => void;
  checkout?: boolean;
  selectedCheckIn?: string;
  selectedCheckOut?: string;
  compactPrices?: boolean;
}) {
  const start = new Date(`${calendar.month}-01T00:00:00Z`).getUTCDay();
  const offset = (start + 6) % 7;
  return (
    <div className={compactPrices ? "homestay-compact-calendar" : undefined}>
      <div className="s3-calendar s3-weekdays" aria-hidden="true">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <ul className="s3-calendar" aria-label={`Lịch tháng ${calendar.month}`}>
        {Array.from({ length: offset }, (_, n) => (
          <li key={`empty-${n}`} className="s3-calendar-empty" aria-hidden="true" />
        ))}
        {calendar.days.map((day) => {
          const isSelectedStart = day.date === selectedCheckIn;
          const isSelectedEnd = day.date === selectedCheckOut;
          const isInRange = Boolean(
            selectedCheckIn && selectedCheckOut && day.date > selectedCheckIn && day.date < selectedCheckOut
          );
          const isSelected = isSelectedStart || isSelectedEnd || isInRange;
          // A sold-out night may be checkout, but never a replacement check-in.
          const isCheckoutDate = Boolean(checkout && selectedCheckIn && day.date > selectedCheckIn);

          return (
            <li
              key={day.date}
              className={`${day.isAvailable ? "" : "s3-day-unavailable"} ${
                isSelectedStart ? "s3-day-start" : ""
              } ${isSelectedEnd ? "s3-day-end" : ""} ${isInRange ? "s3-day-range" : ""}`}
              aria-label={`${day.date}: ${
                day.isAvailable ? `còn phòng, ${currency.format(day.price)} đồng` : "hết phòng"
              }`}
            >
              <button
                type="button"
                className={`s3-day ${isSelected ? "s3-day-active" : ""}`}
                disabled={!onPick || (!isCheckoutDate && !day.isAvailable)}
                onClick={() => onPick?.(day.date)}
                aria-label={`${isCheckoutDate ? "Trả" : "Nhận"} phòng ${day.date}${compactPrices ? `: ${day.isAvailable ? `còn phòng, ${currency.format(day.price)} đồng` : "hết phòng"}` : ""}`}
              >
                <span className="font-medium">{Number(day.date.slice(-2))}</span>
                <small>{day.isAvailable ? compactPrices ? calendarPriceLabel(day.price) : `${currency.format(day.price)} đ` : "Hết"}</small>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function readStay(params: URLSearchParams): Stay {
  return {
    unitId: params.get("unitId") || "",
    checkIn: params.get("checkIn") || "",
    checkOut: params.get("checkOut") || "",
    adults: Number(params.get("adults") ?? 1),
    children: Number(params.get("children") ?? 0),
  };
}

export function Checkout() {
  const params = useSearchParams();
  const sessionId = useAuthStore((s) => s.sessionId);
  return <CheckoutForm key={`${sessionId}:${params.toString()}`} />;
}

function CheckoutForm() {
  const params = useSearchParams();
  const stay = readStay(new URLSearchParams(params.toString()));
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const sessionId = useAuthStore((s) => s.sessionId);
  const queryClient = useQueryClient();
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;

  const quote = useQuery({
    queryKey: ["homestay-quote", stay],
    meta: { public: true },
    queryFn: ({ signal }) => homestaysApi.quote(stay, signal),
    retry: false,
  });

  const [newQuote, setNewQuote] = useState<Quote | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<Booking | null>(null);
  const submitting = useRef(false);
  const attempt = useRef<{ body: string; key: string } | null>(null);
  const activeQuote = newQuote || quote.data;

  async function hold(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !activeQuote || !user) return;
    const sentSession = sessionRef.current;
    const form = new FormData(event.currentTarget);
    const guestName = String(form.get("guestName") || "").trim();
    const guestPhone = String(form.get("guestPhone") || "").trim();
    const guestEmailRaw = form.get("guestEmail");
    const guestEmail = guestEmailRaw ? String(guestEmailRaw).trim() : undefined;

    if (!guestName) {
      setError("Vui lòng nhập họ tên người nhận phòng.");
      return;
    }
    if (!guestPhone) {
      setError("Vui lòng nhập số điện thoại liên hệ.");
      return;
    }

    const body = {
      unitId: stay.unitId,
      checkInDate: stay.checkIn,
      checkOutDate: stay.checkOut,
      numAdults: stay.adults,
      numChildren: stay.children,
      guestName,
      guestPhone,
      ...(guestEmail ? { guestEmail } : {}),
      quoteToken: activeQuote.quoteToken,
    };
    const serialized = JSON.stringify(body);
    if (attempt.current?.body !== serialized) attempt.current = { body: serialized, key: crypto.randomUUID() };
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await homestaysApi.hold(body, attempt.current.key);
      if (sentSession !== sessionRef.current) return;
      setBooking(result);
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["homestay-calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["homestay-search"] });
    } catch (err) {
      if (sentSession !== sessionRef.current) return;
      if (err instanceof ApiError && err.errorCode === "PRICE_CHANGED" && isQuote(err.data)) {
        setNewQuote(err.data);
        attempt.current = null;
      }
      setError(message(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <PageFrame title="Xác nhận đặt phòng">
      {status === "initializing" ? (
        <p className="s3-state">Đang kiểm tra phiên đăng nhập…</p>
      ) : status !== "authenticated" ? (
        <div className="s3-state space-y-3">
          <p className="font-medium text-ink">
            {status === "unavailable"
              ? "Chưa kiểm tra được phiên. Hãy tải lại hoặc đăng nhập."
              : "Cần đăng nhập để giữ phòng."}
          </p>
          <Link className="button" href="/login">
            Đăng nhập ngay
          </Link>
        </div>
      ) : booking ? (
        <section className="s3-card space-y-5 max-w-xl mx-auto">
          <div className="flex items-center gap-2 text-brand">
            <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
            <h2 className="text-lg font-bold text-ink">Đơn {booking.bookingCode} đã được tạo thành công!</h2>
          </div>
          <BookingSummary booking={booking} />
          <Link className="button" href={`/bookings/${booking.bookingId}/payment`}>Kiểm tra thanh toán</Link>
          <div className="pt-2 flex flex-wrap gap-3">
            <Link className="button" href="/bookings">
              Xem đơn của tôi
            </Link>
            <Link className="button button-secondary" href="/homestay">
              Tìm phòng khác
            </Link>
          </div>
        </section>
      ) : (
        <div className="stitch-checkout-layout grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
          <div className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24">
            <section className="s3-card space-y-4">
              <h2 className="text-base font-bold text-ink border-b border-gray-200 pb-2">
                Tóm tắt lưu trú
              </h2>
              <ReadState loading={quote.isPending} error={quote.error} retry={() => void quote.refetch()} />
              {activeQuote && (
                <div className="space-y-4">
                  <div className="space-y-1 text-sm text-ink">
                    <p className="font-semibold">
                      {stay.checkIn} → {stay.checkOut}
                    </p>
                    <p className="text-gray-600">
                      {activeQuote.totalNights} đêm · {stay.adults} người lớn
                      {stay.children > 0 ? `, ${stay.children} trẻ em` : ""}
                    </p>
                  </div>
                  <PriceRows price={activeQuote.priceBreakdown} />
                </div>
              )}
            </section>
          </div>
          <div className="lg:col-start-1 lg:row-start-1 space-y-6">
            <section className="s3-card space-y-5">
              <h2 className="text-base font-bold text-ink border-b border-gray-200 pb-2">
                Thông tin người nhận phòng
              </h2>

              {error && (
                <div className="space-y-3">
                  <div className="form-error" role="alert">
                    {error}
                  </div>
                  {newQuote && (
                    <div className="notice">
                      Giá phòng vừa được cập nhật trên hệ thống. Vui lòng kiểm tra giá mới trong phần “Tóm tắt lưu trú” trước khi xác nhận giữ phòng.
                    </div>
                  )}
                  <p className="password-rules">
                    Nếu mất kết nối sau khi gửi, hãy kiểm tra Đơn của tôi trước khi tạo yêu cầu mới.
                  </p>
                  <Button
                    variant="secondary"
                    disabled={busy || quote.isFetching}
                    onClick={() => {
                      setNewQuote(null);
                      attempt.current = null;
                      setError("");
                      void quote.refetch();
                    }}
                  >
                    Lấy báo giá mới
                  </Button>
                </div>
              )}

              <form key={user?.id} className="space-y-4" onSubmit={hold}>
                <Input
                  id="guest-name"
                  name="guestName"
                  label="Họ tên người nhận phòng"
                  required
                  defaultValue={user?.fullName}
                />
                <Input
                  id="guest-phone"
                  name="guestPhone"
                  label="Số điện thoại liên hệ"
                  type="tel"
                  required
                  defaultValue={user?.phone}
                />
                <Input
                  id="guest-email"
                  name="guestEmail"
                  label="Email (không bắt buộc)"
                  type="email"
                  defaultValue={user?.email || ""}
                />

                <div className="pt-3">
                  <Button
                    type="submit"
                    className="full-width"
                    aria-busy={busy}
                    aria-disabled={busy}
                    disabled={
                      busy ||
                      quote.isFetching ||
                      !activeQuote ||
                      !activeQuote.isAvailable ||
                      activeQuote.priceBreakdown.totalAmount === 0
                    }
                    onClick={(e) => {
                      if (busy) e.preventDefault();
                    }}
                  >
                    {busy ? "Đang giữ phòng…" : newQuote ? "Xác nhận giá mới và giữ phòng" : "Giữ phòng"}
                  </Button>
                </div>

                {activeQuote && !activeQuote.isAvailable && (
                  <p className="field-error">Phòng không còn trống.</p>
                )}
                {activeQuote && activeQuote.priceBreakdown.totalAmount === 0 && (
                  <p className="field-error">Chưa hỗ trợ tạo đơn 0 đ.</p>
                )}
              </form>
            </section>
          </div>

        </div>
      )}
    </PageFrame>
  );
}

export function isQuote(value: unknown): value is Quote {
  if (!value || typeof value !== "object") return false;
  const q = value as Partial<Quote>;
  const p = q.priceBreakdown;
  return (
    typeof q.quoteToken === "string" &&
    q.quoteToken.length > 0 &&
    typeof q.quoteExpiresAt === "string" &&
    Number.isFinite(Date.parse(q.quoteExpiresAt)) &&
    typeof q.isAvailable === "boolean" &&
    Number.isSafeInteger(q.totalNights) &&
    q.totalNights! > 0 &&
    Boolean(p) &&
    ["baseAmount", "cleaningFee", "serviceFee", "taxAmount", "totalAmount"].every((key) => {
      const n = p?.[key as keyof Price];
      return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
    }) &&
    p!.totalAmount === p!.baseAmount + p!.cleaningFee + p!.serviceFee + p!.taxAmount &&
    Array.isArray(p!.nightlyPrices) &&
    p!.nightlyPrices.length === q.totalNights
  );
}

export function remainingBookingSeconds(expiresAt: string, serverTime: string, elapsedMs: number) {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.parse(serverTime) - elapsedMs) / 1000));
}

function BookingCountdown({ booking }: { booking: Booking }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const tick = () => setElapsed(Date.now() - start);
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [booking.expiresAt, booking.serverTime]);
  const seconds = remainingBookingSeconds(booking.expiresAt, booking.serverTime, elapsed);
  return (
    <p className="password-rules tabular-nums flex items-center gap-1.5 font-medium text-ink" role="timer">
      <Clock className="w-3.5 h-3.5 text-brand flex-shrink-0" aria-hidden="true" />
      <span>
        {seconds > 0
          ? `Còn ${Math.floor(seconds / 60)
              .toString()
              .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`
          : "Đã đến hạn. Trạng thái cuối cùng do máy chủ xác nhận."}
      </span>
    </p>
  );
}

function BookingSummary({ booking }: { booking: Booking }) {
  const isPending = booking.bookingStatus.startsWith("PENDING_");
  const badgeClass =
    booking.bookingStatus.startsWith("PENDING_")
      ? "status-pill status-pill-pending"
      : booking.bookingStatus === "CONFIRMED"
      ? "status-pill status-pill-confirmed"
      : booking.bookingStatus === "CHECKED_IN"
      ? "status-pill status-pill-checked-in"
      : booking.bookingStatus === "COMPLETED"
      ? "status-pill status-pill-completed"
      : booking.bookingStatus.startsWith("CANCELLED_") || booking.bookingStatus === "REJECTED_BY_HOST"
      ? "status-pill status-pill-cancelled"
      : "status-pill";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
        <span className={badgeClass}>{bookingLabels[booking.bookingStatus] || booking.bookingStatus}</span>
        <span className="sr-only">Phiên bản #{booking.version}</span>
      </div>
      <div className="text-sm space-y-1.5 text-ink">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-brand flex-shrink-0" aria-hidden="true" />
          <span className="font-semibold">{booking.checkInDate}</span>
          <span className="text-gray-600">→</span>
          <span className="font-semibold">{booking.checkOutDate}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-600">
          <Users className="w-4 h-4 text-gray-600 flex-shrink-0" aria-hidden="true" />
          <span>
            {booking.numAdults} người lớn{booking.numChildren > 0 ? `, ${booking.numChildren} trẻ em` : ""}
          </span>
        </div>
      </div>
      <div className="bg-bg rounded-lg p-3 border border-gray-200">
        <PriceRows price={booking} />
      </div>
      {isPending && (
        <div className="notice space-y-2">
          <div className="font-medium">
            {booking.bookingStatus === "PENDING_HOST_APPROVAL"
              ? "Chủ nhà cần phản hồi"
              : "Thời hạn giữ phòng"}{" "}
            trước {deadline(booking.expiresAt)} (giờ Việt Nam).
          </div>
          <BookingCountdown key={booking.serverTime} booking={booking} />
        </div>
      )}
      {booking.paymentStatus === "NOT_CONFIGURED" && (
        <p className="password-rules flex items-center gap-1.5 text-xs text-gray-600">
          <Info className="w-3.5 h-3.5 text-gray-600 flex-shrink-0" aria-hidden="true" />
          <span>Chưa thanh toán.</span>
        </p>
      )}
    </div>
  );
}

export function BookingList({ host = false }: { host?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const sessionId = useAuthStore((s) => s.sessionId);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const attempts = useRef(new Map<string, string>());
  const locked = useRef(false);
  const reportLock = useRef<string | null>(null);
  const [reportLocked, setReportLocked] = useState(false);
  const setReportLock = useCallback((id: string, lock: boolean) => {
    if (lock) {
      if (locked.current || (reportLock.current && reportLock.current !== id)) return false;
      reportLock.current = id;
    } else if (reportLock.current === id) reportLock.current = null;
    setReportLocked(Boolean(reportLock.current));
    return true;
  }, []);
  const sessionRef = useRef(sessionId);
  sessionRef.current = sessionId;
  const queryClient = useQueryClient();

  const allowed =
    status === "authenticated" && Boolean(user) && (!host || user?.role === "HOST") && (host || user?.role !== "ADMIN");

  const list = useQuery({
    queryKey: ["bookings", sessionId, host, page],
    queryFn: ({ signal }) => homestaysApi.bookings(host, page, signal),
    enabled: allowed,
    retry: false,
    refetchInterval: 15000,
  });

  useEffect(() => {
    setError("");
    setPage(1);
    attempts.current.clear();
  }, [sessionId]);

  async function action(booking: Booking, action: string) {
    if (locked.current || reportLock.current) return;
    const sentSession = sessionId;
    const scope = `${booking.bookingId}:${action}:${booking.version}`;
    if (!attempts.current.has(scope)) attempts.current.set(scope, crypto.randomUUID());
    locked.current = true;
    setBusy(booking.bookingId);
    setError("");
    try {
      await homestaysApi.action(host, booking.bookingId, action, booking.version, attempts.current.get(scope)!);
      if (sessionRef.current !== sentSession) return;
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["homestay-calendar"] });
      void queryClient.invalidateQueries({ queryKey: ["homestay-search"] });
    } catch (err) {
      if (sessionRef.current === sentSession) {
        setError(message(err));
        void list.refetch();
      }
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }

  const pageTitle = host ? "Đơn đặt phòng dành cho Host" : "Đơn đặt phòng của tôi";

  return (
    <PageFrame title={pageTitle}>
      {!allowed ? (
        <div className="s3-state">
          <p>
            {status === "initializing"
              ? "Đang kiểm tra phiên…"
              : status === "unavailable"
              ? "Chưa kiểm tra được phiên. Hãy tải lại."
              : "Cần đăng nhập bằng tài khoản có quyền phù hợp."}
          </p>
          <Link className="button" href="/login">
            Đăng nhập
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <ReadState loading={list.isPending} error={list.error} retry={() => void list.refetch()} />
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}

          {list.data && (
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">
                  {list.data.meta.total} đơn đặt phòng
                </span>
                <span className="text-xs text-gray-600">
                  Trang {list.data.meta.page} / {list.data.meta.totalPages || 1}
                </span>
              </div>

              <ul className="s3-list">
                {list.data.data.map((booking) => {
                  const availableActions = host
                    ? booking.bookingStatus === "PENDING_HOST_APPROVAL"
                      ? ["accept", "reject"]
                      : booking.bookingStatus === "CONFIRMED" && booking.paymentStatus === "PAID"
                      ? ["check-in"]
                      : booking.bookingStatus === "CHECKED_IN" && booking.paymentStatus === "PAID"
                      ? ["complete"]
                      : []
                    : booking.bookingStatus.startsWith("PENDING_")
                    ? ["cancel"]
                    : [];

                  return (
                    <li key={booking.bookingId} className="!block space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-gray-200 pb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 font-mono">Mã đơn:</span>
                          <h2 className="font-bold text-base text-ink break-words">{booking.bookingCode}</h2>
                        </div>
                        {host && (
                          <div className="text-sm flex items-center gap-2 text-ink">
                            <span className="font-medium">{booking.guestName}</span>
                            <span>·</span>
                            <a
                              className="text-link inline-flex items-center gap-1 font-semibold"
                              href={`tel:${booking.guestPhone}`}
                            >
                              <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                              {booking.guestPhone}
                            </a>
                          </div>
                        )}
                      </div>

                      <BookingSummary booking={booking} />
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
                        {!host ? <Link className="text-link underline" href={`/bookings/${booking.bookingId}/payment`}>Thanh toán / kiểm tra giao dịch</Link> : null}
                        <Link className="text-link underline" href={host?"/host/finance/complaints":`/bookings/${booking.bookingId}/complaints`}>
                          {host?"Xem khiếu nại của khách":"Khiếu nại về đơn này"}
                        </Link>
                      </div>

                      {availableActions.length > 0 && (
                        <div className="s3-actions pt-2 border-t border-gray-100">
                          {availableActions.map((name) => {
                            const isDestructive = name === "reject" || name === "cancel";
                            const isPrimary = name === "accept" || name === "check-in" || name === "complete";
                            return (
                              <Button
                                key={name}
                                variant={isPrimary ? "primary" : "secondary"}
                                className={isDestructive ? "text-error border-error/30 hover:bg-red-50" : ""}
                                aria-busy={busy === booking.bookingId}
                                aria-disabled={Boolean(busy) || reportLocked}
                                onClick={() => {
                                  if (!busy && !reportLocked) void action(booking, name);
                                }}
                              >
                                {busy === booking.bookingId
                                  ? "Đang xử lý…"
                                  : (
                                      {
                                        accept: "Chấp nhận",
                                        reject: "Từ chối",
                                        cancel: "Hủy đơn chưa thanh toán",
                                        "check-in": "Xác nhận nhận phòng",
                                        complete: "Hoàn tất lưu trú",
                                      } as Record<string, string>
                                    )[name]}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                      {host && sessionId ? <HostNoShowReport key={`${sessionId}:${booking.bookingId}`} booking={booking} sessionId={sessionId}
                        disabled={Boolean(busy) || (reportLocked && reportLock.current !== `${sessionId}:${booking.bookingId}`)} setLock={setReportLock} /> : null}
                      {!host && booking.bookingStatus === "COMPLETED" && sessionId ? <BookingReview key={`${sessionId}:${booking.bookingId}`} bookingId={booking.bookingId} sessionId={sessionId} /> : null}
                    </li>
                  );
                })}
              </ul>

              {!list.data.data.length && (
                <div className="s3-state py-12">
                  <div className="space-y-3 max-w-sm mx-auto text-center">
                    <CalendarIcon className="w-10 h-10 text-gray-600 mx-auto" aria-hidden="true" />
                    <p className="font-semibold text-ink text-base">
                      {host ? "Chưa có đơn đặt phòng nào dành cho Host." : "Chưa có đơn đặt phòng nào."}
                    </p>
                    {!host && (
                      <Link className="button" href="/homestay">
                        Khám phá homestay ngay
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {list.data.meta.totalPages > 1 && (
                <div className="s3-actions justify-center pt-4">
                  <Button variant="secondary" disabled={page <= 1 || Boolean(busy) || reportLocked} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" />
                    Trang trước
                  </Button>
                  <span className="text-sm font-medium text-gray-600 px-3">
                    Trang {list.data.meta.page} / {list.data.meta.totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={page >= list.data.meta.totalPages || Boolean(busy) || reportLocked}
                    onClick={() => setPage(page + 1)}
                  >
                    Trang sau
                    <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </PageFrame>
  );
}
