"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Camera } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import RoomCard, { formatVND } from "@/components/RoomCard";
import { Button } from "@/components/ui/button";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { listingsApi } from "@/lib/api/listings";
import { homestaysApi, type HomestayResult } from "@/lib/api/homestays";
import { httpMediaUrl, listingDisplayTitle } from "@/lib/listing-links";
import { useState, type ReactNode } from "react";

export function HomeHomestayCard({ room }: { room: HomestayResult }) {
  const image = httpMediaUrl(room.media?.[0]?.url);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <Link
      href={`/homestay/${encodeURIComponent(room.slug)}`}
      className="group pcard-lift h-full flex flex-col"
    >
      <div className="aspect-[4/3] bg-brand-tint border-b border-gray-200 relative overflow-hidden shrink-0">
        {image && image !== failedImage ? (
          <Image
            src={image}
            alt={listingDisplayTitle(room.title)}
            unoptimized
            width={800}
            height={600}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 280px"
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setFailedImage(image)}
            className={`w-full h-full object-cover transition-[transform,opacity] duration-700 ease-out group-hover:scale-[1.04] ${
              imageLoaded ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : (
          <div className="h-full w-full flex flex-col gap-2 items-center justify-center text-[13px] text-muted bg-brand-tint">
            <Camera size={32} className="text-muted/50" aria-hidden="true" />
            <span>{image ? "Không tải được ảnh" : "Chưa có hình ảnh"}</span>
          </div>
        )}
        <div className="absolute top-3 right-3 flex gap-1.5 pointer-events-none">
          <span className="bg-white/95 backdrop-blur-xs text-ink border border-gray-200 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] px-2.5 py-1">
            {room.instantBook ? "Đặt tức thì" : "Chủ nhà duyệt"}
          </span>
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col">
        <p className="font-sans text-[15px] font-bold tabular-nums tracking-[-0.01em] text-brand mb-1.5">
          {formatVND(room.basePricePerNight)}
          <span className="ml-1 text-[12px] font-normal text-muted">/ đêm</span>
        </p>

        <h3 className="font-serif text-[22px] font-medium text-ink line-clamp-2 break-words leading-[1.18] tracking-[-0.015em] group-hover:text-brand transition-colors min-h-[52px]">
          {listingDisplayTitle(room.title)}
        </h3>

        <div className="pt-2 pb-1 flex items-center gap-1.5 flex-wrap font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
          <span>Tối đa {room.maxAdults} người lớn</span>
        </div>

        <p className="flex items-start gap-1.5 text-[13px] text-gray-600 pt-3 mt-3 border-t border-gray-200">
          <MapPin size={14} className="shrink-0 mt-1 text-muted" aria-hidden="true" />
          <span className="line-clamp-1 break-words">{room.unitName} · {room.address}</span>
        </p>

        <div className="mt-auto pt-4 flex items-center justify-between font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-brand">
          <span>Xem chi tiết</span>
          <span className="btn__arrow" aria-hidden="true">→</span>
        </div>
      </div>
    </Link>
  );
}

function HomeSection({
  eyebrow,
  title,
  subtitle,
  href,
  loading,
  error,
  retry,
  empty,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  href: string;
  loading: boolean;
  error: unknown;
  retry: () => void;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <section className="py-10 md:py-14 border-b border-gray-200 last:border-b-0">
      <ScrollReveal className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="display d2">{title}</h2>
          {subtitle && <p className="text-[15.5px] text-gray-600 mt-3 max-w-2xl">{subtitle}</p>}
        </div>
        <Link
          href={href}
          className="tng-btn button-secondary self-start md:self-auto"
        >
          <span>Xem tất cả</span>
          <span className="btn__arrow" aria-hidden="true">→</span>
        </Link>
      </ScrollReveal>
      {error ? (
        <div role="alert" className="py-8 px-6 border border-gray-200 bg-white space-y-3">
          <p className="text-sm text-error">Chưa tải được danh sách. {error instanceof Error ? error.message : "Vui lòng thử lại."}</p>
          <Button type="button" variant="secondary" onClick={retry}>Thử lại</Button>
        </div>
      ) : loading ? (
        <div aria-busy="true" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <span role="status" className="sr-only">Đang tải {title.toLowerCase()}</span>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="border border-gray-200 bg-white animate-pulse motion-reduce:animate-none">
              <div className="aspect-[4/3] bg-brand-tint" />
              <div className="p-5 space-y-3">
                <div className="h-3.5 w-1/2 bg-brand-tint" />
                <div className="h-6 w-5/6 bg-brand-tint" />
                <div className="h-4 w-full bg-brand-tint" />
              </div>
            </div>
          ))}
        </div>
      ) : empty ? (
        <p className="py-8 text-sm text-gray-600">Chưa có tin đang hiển thị ở mục này.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">{children}</div>
      )}
    </section>
  );
}

export default function HomeListings() {
  const rooms = useQuery({
    queryKey: ["home-long-term"],
    meta: { public: true },
    queryFn: () => listingsApi.search({ limit: 4, sortBy: "newest" }),
    staleTime: 60_000,
    retry: false,
  });
  const stays = useQuery({
    queryKey: ["home-homestays"],
    meta: { public: true },
    queryFn: ({ signal }) => homestaysApi.search({ page: 1, limit: 4 }, signal),
    staleTime: 60_000,
    retry: false,
  });
  return (
    <>
      <HomeSection
        eyebrow="Long-Term Living · Thuê dài hạn"
        title="Trọ dài hạn mới nhất"
        subtitle="Giá thuê theo tháng, chi phí điện nước minh bạch và thông tin phòng xác thực từ chủ nhà."
        href="/thue-phong-tro"
        loading={rooms.isPending}
        error={rooms.error}
        retry={() => void rooms.refetch()}
        empty={!rooms.data?.data.length}
      >
        {rooms.data?.data.map((room, idx) => (
          <ScrollReveal key={room.id} delayMs={idx * 75} className="h-full">
            <RoomCard room={room} />
          </ScrollReveal>
        ))}
      </HomeSection>
      <HomeSection
        eyebrow="Short-Term Stay · Đặt theo đêm"
        title="Homestay trải nghiệm theo đêm"
        subtitle="Không gian nghỉ dưỡng chọn lọc, báo giá trực tuyến theo từng đêm và giữ chỗ tức thì."
        href="/homestay"
        loading={stays.isPending}
        error={stays.error}
        retry={() => void stays.refetch()}
        empty={!stays.data?.data.length}
      >
        {stays.data?.data.map((room, idx) => (
          <ScrollReveal key={room.id} delayMs={idx * 75} className="h-full">
            <HomeHomestayCard room={room} />
          </ScrollReveal>
        ))}
      </HomeSection>
    </>
  );
}
