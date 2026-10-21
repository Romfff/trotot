"use client";

import Image from "next/image";
import Link from "next/link";
import { MapPin, Camera, LoaderCircle } from "lucide-react";
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
            onError={() => setFailedImage(image)}
            className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full flex flex-col gap-2 items-center justify-center text-[13px] font-medium text-ink/70 bg-brand-tint">
            <Camera size={32} className="text-ink/50" aria-hidden="true" />
            <span>{image ? "Không tải được ảnh" : "Chưa có hình ảnh"}</span>
          </div>
        )}
        <div className="absolute top-3 right-3 flex gap-1.5 pointer-events-none">
          <span className="bg-white/95 backdrop-blur-xs text-ink border border-gray-200 font-sans text-[10.5px] font-bold uppercase tracking-[0.06em] px-2.5 py-1">
            {room.instantBook ? "Đặt tức thì" : "Chủ nhà duyệt"}
          </span>
        </div>
      </div>

      <div className="p-5 flex-1 flex flex-col font-sans">
        <p className="font-sans text-[18px] font-extrabold tabular-nums tracking-[-0.015em] text-brand mb-2">
          {formatVND(room.basePricePerNight)}
          <span className="ml-1 text-[12.5px] font-semibold text-ink/75">/ đêm</span>
        </p>

        <h3 className="font-sans text-[17.5px] font-bold text-ink line-clamp-2 break-words leading-[1.35] tracking-[-0.015em] group-hover:text-brand transition-colors min-h-[48px]">
          {listingDisplayTitle(room.title)}
        </h3>

        <div className="pt-2 pb-1 flex items-center gap-1.5 flex-wrap font-sans text-[11.5px] font-semibold text-ink/80">
          <span className="bg-brand-tint border border-gray-200 px-2 py-0.5 rounded-xs">
            Tối đa {room.maxAdults} người lớn
          </span>
        </div>

        <p className="flex items-start gap-1.5 font-sans text-[13.5px] font-medium text-ink/85 pt-3 mt-3 border-t border-gray-200">
          <MapPin size={15} className="shrink-0 mt-0.5 text-brand" aria-hidden="true" />
          <span className="line-clamp-1 break-words">{room.unitName} · {room.address}</span>
        </p>

        <div className="mt-auto pt-4 flex items-center justify-between font-sans text-[11.5px] font-bold uppercase tracking-[0.06em] text-brand">
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
          {subtitle && <p className="font-sans text-[15px] font-medium text-ink/85 mt-3 max-w-2xl">{subtitle}</p>}
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
          <p className="text-sm font-medium text-error">Chưa tải được danh sách. {error instanceof Error ? error.message : "Vui lòng thử lại."}</p>
          <Button type="button" variant="secondary" onClick={retry}>Thử lại</Button>
        </div>
      ) : loading ? (
        <div aria-busy="true" className="py-12 px-6 border border-gray-200 bg-white flex flex-col items-center justify-center text-center gap-3">
          <LoaderCircle className="size-8 text-brand animate-spin" aria-hidden="true" />
          <p role="status" className="font-sans text-sm font-bold text-ink">
            Đang tải danh sách {title.toLowerCase()}…
          </p>
        </div>
      ) : empty ? (
        <p className="py-8 text-sm font-medium text-ink/80">Chưa có tin đang hiển thị ở mục này.</p>
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
