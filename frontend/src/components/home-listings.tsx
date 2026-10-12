"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin, Camera } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import RoomCard, { formatVND } from "@/components/RoomCard";
import { Button } from "@/components/ui/button";
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
      className="bg-white border border-gray-200 rounded-xl p-3 h-full flex flex-col hover:border-brand transition-colors duration-150 shadow-sm group"
    >
      <div className="aspect-[4/3] bg-bg border border-gray-200 rounded-lg relative overflow-hidden mb-3 shrink-0">
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
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="h-full w-full flex flex-col gap-2 items-center justify-center text-[13px] text-muted bg-bg">
            <Camera size={32} className="text-muted/50" aria-hidden="true" />
            <span>{image ? "Không tải được ảnh" : "Chưa có hình ảnh"}</span>
          </div>
        )}
      </div>
      <div className="space-y-1.5 flex-1 flex flex-col">
        <p className="text-[17px] font-bold text-ink tracking-tight">
          {formatVND(room.basePricePerNight)}
          <span className="ml-1 text-[13px] font-normal text-gray-600">/ đêm</span>
        </p>
        <h3 className="text-[14px] font-semibold text-ink line-clamp-2 break-words text-pretty leading-snug group-hover:text-brand transition-colors min-h-[40px]">
          {listingDisplayTitle(room.title)}
        </h3>
        <div className="pt-1 pb-2 flex items-center gap-1.5 flex-wrap">
          <span className="inline-block bg-bg text-gray-600 text-[12px] px-2 py-0.5 rounded border border-gray-200">
            {room.instantBook ? "Đặt tức thì" : "Chủ nhà duyệt"}
          </span>
          <span className="text-[12px] text-gray-600">· Tối đa {room.maxAdults} người lớn</span>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-[12px] text-muted pt-2 mt-auto border-t border-gray-200">
        <MapPin size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span className="line-clamp-1 break-words">{room.unitName} · {room.address}</span>
      </p>
    </Link>
  );
}

function HomeSection({
  title,
  subtitle,
  href,
  loading,
  error,
  retry,
  empty,
  children,
}: {
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
    <section className="mb-10 md:mb-12 last:mb-0">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-4">
        <div>
          <h2 className="text-[20px] leading-7 font-bold text-ink tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-gray-600 mt-1">{subtitle}</p>}
        </div>
        <Link
          href={href}
          className="inline-flex min-h-11 self-start sm:self-auto items-center text-brand hover:text-brand-hover font-semibold text-sm shrink-0 group transition-colors gap-1"
        >
          <span>Xem tất cả</span>
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
      {error ? (
        <div role="alert" className="py-6 space-y-3">
          <p className="text-sm text-error">Chưa tải được danh sách. {error instanceof Error ? error.message : "Vui lòng thử lại."}</p>
          <Button type="button" variant="secondary" onClick={retry}>Thử lại</Button>
        </div>
      ) : loading ? (
        <div aria-busy="true" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <span role="status" className="sr-only">Đang tải {title.toLowerCase()}</span>
          {[0, 1, 2, 3].map((n) => (
            <div key={n} className="rounded-xl border border-gray-200 bg-white p-3 animate-pulse motion-reduce:animate-none">
              <div className="aspect-[4/3] rounded-lg bg-brand-tint" />
              <div className="pt-3 space-y-3">
                <div className="h-4 w-3/4 bg-bg rounded" />
                <div className="h-4 w-full bg-bg rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : empty ? (
        <p className="py-6 text-sm text-gray-600">Chưa có tin đang hiển thị ở mục này.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">{children}</div>
      )}
    </section>
  );
}

export default function HomeListings() {
  const rooms = useQuery({
    queryKey: ["home-long-term"],
    meta: { public: true },
    queryFn: () => listingsApi.search({ limit: 4, sortBy: "newest" }),
    retry: false,
  });
  const stays = useQuery({
    queryKey: ["home-homestays"],
    meta: { public: true },
    queryFn: ({ signal }) => homestaysApi.search({ page: 1, limit: 4 }, signal),
    retry: false,
  });
  return (
    <>
      <HomeSection
        title="Trọ dài hạn mới nhất"
        subtitle="Giá thuê theo tháng, chi phí dịch vụ và thông tin phòng từ tin đăng."
        href="/thue-phong-tro"
        loading={rooms.isPending}
        error={rooms.error}
        retry={() => void rooms.refetch()}
        empty={!rooms.data?.data.length}
      >
        {rooms.data?.data.map((room) => (
          <RoomCard key={room.id} room={room} />
        ))}
      </HomeSection>
      <HomeSection
        title="Homestay trải nghiệm theo đêm"
        subtitle="Giá theo đêm, sức chứa và hình thức đặt phòng của từng chỗ ở."
        href="/homestay"
        loading={stays.isPending}
        error={stays.error}
        retry={() => void stays.refetch()}
        empty={!stays.data?.data.length}
      >
        {stays.data?.data.map((room) => (
          <HomeHomestayCard key={room.id} room={room} />
        ))}
      </HomeSection>
    </>
  );
}

