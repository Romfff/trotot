"use client";

import Image from "next/image";
import { useState } from "react";
import Link from "next/link";
import { Camera, MapPin, Ruler } from "lucide-react";
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

  const firstImageUrl = httpMediaUrl(
    isReal
      ? room.images && room.images.length > 0
        ? room.images[0].url
        : null
      : room.images && room.images.length > 0
      ? room.images[0]
      : null
  );

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
      className={`group pcard-lift h-full flex flex-col ${
        highlighted ? "border-brand ring-1 ring-brand" : ""
      }`}
    >
      {/* 4:3 Editorial Aspect Ratio Image */}
      <div className="aspect-[4/3] w-full bg-brand-tint relative overflow-hidden shrink-0 border-b border-gray-200">
        {firstImageUrl && firstImageUrl !== failedImage ? (
          <Image
            unoptimized
            width={800}
            height={600}
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 360px"
            src={firstImageUrl}
            alt={listingDisplayTitle(room.title)}
            className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            loading="lazy"
            onError={() => setFailedImage(firstImageUrl)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-ink/70 text-[13px] font-medium">
            <Camera className="w-8 h-8 text-ink/50" aria-hidden="true" />
            <span>{firstImageUrl ? "Không tải được ảnh" : "Chưa có hình ảnh"}</span>
          </div>
        )}
        {!isAvailable && (
          <div className="absolute inset-0 bg-ink/45 flex items-center justify-center">
            <span className="bg-white text-ink mono-label px-3 py-1.5 border border-gray-200">Đã cho thuê</span>
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 pointer-events-none">
          <span className="bg-white/95 backdrop-blur-xs text-ink px-2.5 py-1 border border-gray-200 font-sans text-[11px] font-bold uppercase tracking-[0.06em]">
            {area} m²
          </span>
          {distanceText && (
            <span className="bg-[#0a1b2a]/95 text-[#f1f5f9] px-2.5 py-1 font-sans text-[11px] font-semibold uppercase tracking-[0.06em]">
              {distanceText}
            </span>
          )}
        </div>
        {room.images && room.images.length > 1 && (
          <div className="absolute bottom-2.5 right-2.5 bg-[#0a1b2a]/85 text-[#f1f5f9] font-sans text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 flex items-center gap-1 backdrop-blur-xs pointer-events-none">
            <Camera className="w-3 h-3" aria-hidden="true" />
            <span>{room.images.length} ảnh</span>
          </div>
        )}
      </div>

      {/* 3-Tier Luxury Hospitality Card Body:
          Tier 1: Prominent Price (Plus Jakarta Sans ExtraBold)
          Tier 2: Crisp Room Title (Plus Jakarta Sans Bold - easy to scan in Vietnamese)
          Tier 3: Address & Specs (Inter / Plus Jakarta Sans Medium) */}
      <div className="flex-1 flex flex-col p-5 font-sans">
        <div className="flex flex-wrap items-baseline justify-between gap-1 mb-2">
          <div className="font-sans text-[18px] font-extrabold tabular-nums tracking-[-0.015em] text-brand">
            {formatVND(price)} <span className="text-[12.5px] text-ink/75 font-semibold">/ tháng</span>
          </div>
        </div>

        <h3
          className={`font-sans text-[17.5px] font-bold text-ink line-clamp-2 break-words leading-[1.35] tracking-[-0.015em] group-hover:text-brand transition-colors ${
            appearance === "home" ? "min-h-[48px]" : ""
          }`}
        >
          {listingDisplayTitle(room.title)}
        </h3>

        <div
          className={`flex items-start gap-1.5 font-sans text-[13.5px] font-medium text-ink/85 ${
            appearance === "home" ? "mt-3 pt-3 border-t border-gray-200" : "mt-2.5"
          }`}
        >
          {appearance === "search" ? (
            <MapPin size={15} className="shrink-0 mt-0.5 text-brand" aria-hidden="true" />
          ) : (
            <Ruler size={15} className="shrink-0 mt-0.5 text-brand" aria-hidden="true" />
          )}
          <span className="line-clamp-1 break-words">
            {appearance === "home" && <strong className="font-bold text-ink">{area} m² · </strong>}
            {locationLabel}
          </span>
        </div>

        {appearance === "search" && isReal && room.amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {room.amenities.map((amenity) => (
              <span
                key={amenity.id}
                className="font-sans text-[11px] font-semibold text-ink bg-brand-tint border border-gray-200 px-2.5 py-0.5 rounded-xs break-words"
              >
                {amenity.name}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto pt-4 flex items-center justify-between font-sans text-[11.5px] font-bold uppercase tracking-[0.06em] text-brand">
          <span>Xem chi tiết</span>
          <span className="btn__arrow" aria-hidden="true">→</span>
        </div>
      </div>
    </Link>
  );
}
