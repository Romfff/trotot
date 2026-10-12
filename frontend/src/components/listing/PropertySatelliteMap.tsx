"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin } from "lucide-react";
import type { PublicListingItem } from "@/types/listing";

const ListingMap = dynamic(() => import("@/components/listing/ListingMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[380px] bg-[#0a1b2a] border border-gray-200 rounded-[4px] flex items-center justify-center text-[#eef2f6] font-mono text-[12px] uppercase tracking-wider">
      Đang tải bản đồ vệ tinh…
    </div>
  ),
});

export function PropertySatelliteMap({
  room,
  address,
}: {
  room: PublicListingItem;
  address: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (
    typeof room.latitude !== "number" ||
    isNaN(room.latitude) ||
    typeof room.longitude !== "number" ||
    isNaN(room.longitude)
  ) {
    return null;
  }

  return (
    <section
      ref={containerRef}
      className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-[20px] leading-7 font-bold text-ink flex items-center gap-2">
            <MapPin size={20} className="text-brand shrink-0" aria-hidden="true" />
            <span>Bản đồ vệ tinh vị trí ngôi nhà</span>
          </h2>
          <p className="text-[13px] text-muted mt-1">{address}</p>
        </div>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-brand bg-brand-tint border border-gray-200 px-2.5 py-1 rounded-[2px] self-start sm:self-auto">
          {room.latitude.toFixed(5)}, {room.longitude.toFixed(5)}
        </span>
      </div>
      <div className="h-[380px] w-full rounded-[4px] overflow-hidden">
        {inView ? (
          <ListingMap rooms={[room]} selectedRoomId={room.id} />
        ) : (
          <div className="w-full h-full bg-[#0a1b2a] flex items-center justify-center text-[#eef2f6] font-mono text-[12px] uppercase tracking-wider">
            Cuộn tới để tải bản đồ vệ tinh…
          </div>
        )}
      </div>
    </section>
  );
}
