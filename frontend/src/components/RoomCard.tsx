"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { Camera, MapPin, Ruler, ArrowRight } from "lucide-react";
import type { PublicListingItem } from "@/types/listing";
import type { RoomItem } from "@/lib/data";
import { httpMediaUrl, listingDetailHref, listingDisplayTitle } from "@/lib/listing-links";

export function formatVND(val: number): string {
  return new Intl.NumberFormat("vi-VN").format(val) + " đ";
}

interface RoomCardProps {
  room: PublicListingItem | RoomItem;
  highlighted?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  appearance?: "home" | "search";
}

function isPublicListing(room: PublicListingItem | RoomItem): room is PublicListingItem {
  return "monthlyPrice" in room;
}

export default function RoomCard({
  room,
  highlighted = false,
  onMouseEnter,
  onMouseLeave,
  appearance = "home",
}: RoomCardProps) {
  const isReal = isPublicListing(room);

  const price = isReal ? room.monthlyPrice : room.price;
  const area = isReal ? room.areaSqm : room.area;
  const isAvailable = isReal ? room.isAvailable : true;
  const [failedImage, setFailedImage] = useState<string | null>(null);

  // Format location label: "Phường X" or "Phường X, Quận Y"
  const locationLabel = isReal
    ? [room.ward?.name, room.ward?.province?.name].filter(Boolean).join(", ") || room.addressDetail
    : [room.ward, room.district].filter(Boolean).join(", ") || room.address;

  const distanceText = isReal
    ? room.distanceMeters !== null && room.distanceMeters !== undefined
      ? room.distanceMeters >= 1000
        ? `Cách ${(room.distanceMeters / 1000).toFixed(1)} km`
        : `Cách ${Math.round(room.distanceMeters)} m`
      : null
    : room.km
    ? `Cách ${room.km} km`
    : null;

  const firstImageUrl = httpMediaUrl(isReal
    ? room.images && room.images.length > 0
      ? room.images[0].url
      : null
    : room.images && room.images.length > 0
    ? room.images[0]
    : null);

  const href = isReal
    ? room.slug
      ? listingDetailHref(room.slug)
      : listingDetailHref(room.id)
    : `/phong-tro/${room.id}`;

  return (
    <Link
      href={href}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`group bg-white border rounded-xl p-3 h-full flex flex-col transition-colors duration-150 shadow-sm ${
        highlighted ? "border-brand ring-1 ring-brand" : "border-gray-200 hover:border-brand"
      }`}
    >
      {/* 4:3 Aspect Ratio Image */}
      <div className="aspect-[4/3] w-full bg-bg rounded-lg border border-gray-200 relative overflow-hidden mb-3 shrink-0">
        {firstImageUrl && firstImageUrl !== failedImage ? (
          <Image
            unoptimized
            width={800}
            height={600}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 360px"
            src={firstImageUrl}
            alt={listingDisplayTitle(room.title)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
            onError={() => setFailedImage(firstImageUrl)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-muted text-[13px]">
            <Camera className="w-8 h-8 text-muted/50" aria-hidden="true" />
            <span>{firstImageUrl ? "Không tải được ảnh" : "Chưa có hình ảnh"}</span>
          </div>
        )}
        {!isAvailable && (
          <div className="absolute inset-0 bg-ink/30 flex items-center justify-center">
            <span className="bg-white text-ink text-[12px] font-medium px-3 py-1 rounded-full border border-gray-200">Đã cho thuê</span>
          </div>
        )}
        {room.images && room.images.length > 1 && (
          <div className="absolute bottom-2 right-2 bg-foreground/75 text-white text-[12px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1 backdrop-blur-xs pointer-events-none">
            <Camera className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{room.images.length} ảnh</span>
          </div>
        )}
      </div>

      {/* Card Content */}
      <div className="flex-1 flex flex-col">
        {distanceText && (
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            {distanceText && (
              <span className="inline-block bg-bg text-muted text-[12px] px-2 py-0.5 rounded border border-gray-200">
                {distanceText}
              </span>
            )}
          </div>
        )}

        {/* Price: 17px / 700 */}
        <div className="flex flex-wrap items-baseline justify-between gap-1">
        <div className={`text-[17px] font-bold tracking-tight ${appearance === "search" ? "text-brand" : "text-ink"}`}>
          {formatVND(price)}
          <span className="text-[13px] font-normal text-muted ml-1">/ tháng</span>
        </div>
        {appearance === "search" && <span className="text-[12px] font-medium bg-brand-tint text-ink px-1.5 py-0.5 rounded">{area} m²</span>}
        </div>

        {/* Title: max 2 lines with group hover */}
        <h3 className={`text-[14px] font-semibold text-ink line-clamp-2 break-words mt-1 leading-snug group-hover:text-brand transition-colors ${appearance === "home" ? "min-h-[40px]" : ""}`}>
          {listingDisplayTitle(room.title)}
        </h3>

        {/* Subtitle: "28 m² · Phường X", min 13px, high contrast */}
        <div className={`flex items-start gap-1.5 text-[12px] text-muted ${appearance === "home" ? "mt-auto pt-2 border-t border-gray-200" : "mt-2"}`}>
          {appearance === "search" ? <MapPin size={15} className="shrink-0 mt-0.5" aria-hidden="true" /> : <Ruler size={15} className="shrink-0 mt-0.5" aria-hidden="true" />}
          <span className="line-clamp-1 break-words">{appearance === "home" && <>{area} m² · </>}{locationLabel}</span>
        </div>
        {appearance === "search" && isReal && room.amenities.length > 0 && <div className="flex flex-wrap gap-1 mt-3">
          {room.amenities.map(amenity => <span key={amenity.id} className="text-[11px] text-muted bg-bg border border-gray-200 rounded px-2 py-0.5 break-words">{amenity.name}</span>)}
        </div>}
        {appearance === "search" && <div className="mt-3 pt-2 border-t border-gray-200 flex justify-end text-[12px] font-medium text-brand gap-1 items-center">
          Xem chi tiết <ArrowRight size={14} aria-hidden="true" />
        </div>}
      </div>
    </Link>
  );
}
