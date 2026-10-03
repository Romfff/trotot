"use client";
import Image from "next/image";
import Link from "next/link";
import { RoomItem, formatVND } from "@/lib/data";

interface RoomCardProps {
  room: RoomItem;
}

export default function RoomCard({ room }: RoomCardProps) {
  const locationLabel = [
    room.ward,
    room.district,
  ]
    .filter(Boolean)
    .join(", ") || room.address;

  return (
    <Link
      href={`/phong-tro/${room.id}`}
      className="bg-white border border-gray-200 rounded-xl overflow-hidden block transition-colors duration-150 hover:border-brand"
    >
      <div className="aspect-[4/3] w-full bg-bg relative overflow-hidden">
        {room.images && room.images.length > 0 ? (
          <Image unoptimized width={800} height={600} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 280px"
            src={room.images[0]}
            alt={room.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">
            Chưa có hình ảnh
          </div>
        )}
      </div>

      <div className="p-4">
        {room.isVerified && (
          <div className="mb-2">
            <span className="inline-block bg-brand-tint text-brand text-xs font-medium px-2 py-0.5 rounded">
              Chính chủ
            </span>
          </div>
        )}

        <div className="text-base font-bold text-ink">
          {formatVND(room.price)}
          <span className="text-xs font-normal text-gray-600 ml-1">/ tháng</span>
        </div>

        <h3 className="text-sm font-medium text-ink line-clamp-2 mt-1">
          {room.title}
        </h3>

        <div className="text-xs text-gray-600 truncate mt-1">
          {room.area} m² · {locationLabel}
        </div>
      </div>
    </Link>
  );
}
