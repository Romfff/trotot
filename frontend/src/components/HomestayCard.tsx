"use client";
import Image from "next/image";
import { HomestayItem, formatVND, formatNumber } from "@/lib/data";
import { Zap, Clock, Star } from "lucide-react";

interface HomestayCardProps {
  homestay: HomestayItem;
  onSelect: (homestay: HomestayItem) => void;
}

export default function HomestayCard({ homestay, onSelect }: HomestayCardProps) {
  const isInstant = homestay.mode === "instant";

  return (
    <article
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`Xem ${homestay.title}`}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(homestay); } }}
      onClick={() => onSelect(homestay)}
      className="bg-white border border-gray-200 rounded-xl overflow-hidden cursor-pointer transition-colors duration-150 hover:border-brand flex flex-col justify-between"
    >
      <div>
        <div className="aspect-[4/3] w-full bg-bg relative overflow-hidden">
          {homestay.images && homestay.images.length > 0 ? (
            <Image unoptimized width={800} height={600} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 280px"
              src={homestay.images[0]}
              alt={homestay.title}
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
          <h3 className="text-sm font-medium text-ink line-clamp-1">
            {homestay.title}
          </h3>

          <div className="text-xs text-gray-600 truncate mt-1">
            {homestay.location}
          </div>

          <div className="text-xs text-ink font-medium mt-2 flex items-center gap-1">
            <Star size={16} strokeWidth={1.5} className="fill-ink text-ink shrink-0" />
            <span>{homestay.score.toString().replace(".", ",")}</span>
            <span className="text-gray-600">· {formatNumber(homestay.reviewCount)} đánh giá</span>
          </div>

          <div className="text-base font-bold text-ink mt-2">
            <span className="text-xs font-normal text-gray-600 mr-1">từ</span>
            {formatVND(homestay.price)}
            <span className="text-xs font-normal text-gray-600 ml-1">/ đêm</span>
          </div>

          <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-600">
            {isInstant ? (
              <>
                <Zap size={16} strokeWidth={1.5} className="text-brand" />
                <span>Đặt tức thì</span>
              </>
            ) : (
              <>
                <Clock size={16} strokeWidth={1.5} className="text-gray-600" />
                <span>Chủ nhà duyệt</span>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
