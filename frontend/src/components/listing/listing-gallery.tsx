"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { httpMediaUrl } from "@/lib/listing-links";
import type { PublicListingItem } from "@/types/listing";

export function galleryImages(images: PublicListingItem["images"]) {
  return [...images].sort((a, b) => a.sortOrder - b.sortOrder).flatMap(image => {
    const url = httpMediaUrl(image.url);
    return url ? [{ ...image, url }] : [];
  });
}

function GalleryPicture({ url, alt, thumbnail = false }: { url: string; alt: string; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (failed) return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-3 text-gray-600">
      <ImageOff size={thumbnail ? 20 : 32} aria-hidden="true" />
      {!thumbnail && <><p className="text-sm">Không tải được ảnh này.</p><Button type="button" variant="secondary" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Thử tải lại ảnh</Button></>}
    </div>
  );
  return <Image key={attempt} src={url} alt={alt} unoptimized width={800} height={600}
    sizes={thumbnail ? "80px" : "(max-width: 1023px) 100vw, 720px"}
    loading={thumbnail ? "lazy" : "eager"} onError={() => setFailed(true)}
    className={`h-full w-full ${thumbnail ? "object-cover" : "object-contain"}`} />;
}

export function ListingGallery({ title, images, appearance = "default" }: { title: string; images: PublicListingItem["images"]; appearance?: "default" | "stitch" }) {
  const isStitch = appearance === "stitch";
  const photos = galleryImages(images);
  const [selected, setSelected] = useState(0);
  const active = Math.min(selected, Math.max(0, photos.length - 1));
  const track = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const scroller = track.current, item = scroller?.children[active] as HTMLElement | undefined;
    // Scroll only the thumbnail track, never the page containing the gallery.
    if (scroller && item) scroller.scrollLeft = Math.max(0, item.offsetLeft - scroller.offsetLeft - (scroller.clientWidth - item.clientWidth) / 2);
  }, [active]);
  const move = (delta: number) => setSelected(Math.max(0, Math.min(photos.length - 1, active + delta)));
  if (!photos.length) return <section aria-label="Hình ảnh phòng" className={isStitch ? "rounded-xl border border-gray-200 bg-white p-6 min-h-64 md:min-h-[380px] flex flex-col items-center justify-center gap-3 text-center text-muted" : "rounded-xl border border-gray-200 bg-white p-6 text-center text-gray-600"}>{isStitch && <ImageOff size={32} aria-hidden="true" />}<p className="text-sm">Tin này chưa có hình ảnh.</p></section>;
  return (
    <section aria-label="Hình ảnh phòng" aria-roledescription="Bộ ảnh" className="min-w-0 space-y-3">
      <div className={isStitch ? `rounded-xl border border-gray-200 bg-white overflow-hidden grid gap-3 ${photos.length > 1 ? "md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]" : "grid-cols-1"}` : "contents"}>
      <div tabIndex={0} role="group" aria-label="Ảnh phòng. Dùng phím trái, phải để đổi ảnh; Home về ảnh đầu, End tới ảnh cuối."
        className={isStitch ? "aspect-[4/3] md:aspect-auto md:h-[380px] overflow-hidden bg-bg [touch-action:pan-y_pinch-zoom] focus-visible:-outline-offset-4" : "aspect-[4/3] overflow-hidden rounded-xl border border-gray-200 bg-white [touch-action:pan-y_pinch-zoom]"}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowRight" ? 1 : -1); }
          if (event.key === "Home" || event.key === "End") { event.preventDefault(); setSelected(event.key === "Home" ? 0 : photos.length - 1); }
        }}
        onTouchStart={event => { touch.current = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null; }}
        onTouchCancel={() => { touch.current = null; }}
        onTouchEnd={event => {
          const start = touch.current; touch.current = null;
          if (!start || !event.changedTouches[0]) return;
          const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
          if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
        }}>
        <GalleryPicture key={photos[active].url} url={photos[active].url} alt={`${title} — ảnh ${active + 1}`} />
      </div>
      {isStitch && photos.length > 1 && <div className="hidden md:grid grid-cols-2 auto-rows-fr gap-3 h-[380px]">
        {photos.slice(1, 5).map((photo, index) => <button key={`${photo.position}:${photo.url}`} type="button" aria-label={`Chọn ảnh ${index + 2} trong bộ ảnh`} aria-pressed={active === index + 1}
          onClick={() => setSelected(index + 1)} className="min-h-0 overflow-hidden bg-bg relative focus-visible:-outline-offset-4 aria-pressed:ring-2 aria-pressed:ring-inset aria-pressed:ring-brand-hover">
          <GalleryPicture key={photo.url} url={photo.url} alt="" thumbnail />
        </button>)}
      </div>}
      </div>
      {photos.length > 1 && <>
        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="secondary" size="icon" aria-label="Ảnh trước" aria-disabled={active === 0} onClick={() => move(-1)} className="aria-disabled:opacity-50"><ChevronLeft size={20} aria-hidden="true" /></Button>
          <p role="status" aria-live="polite" className="text-sm tabular-nums text-gray-600">Ảnh {active + 1} / {photos.length}</p>
          <Button type="button" variant="secondary" size="icon" aria-label="Ảnh sau" aria-disabled={active === photos.length - 1} onClick={() => move(1)} className="aria-disabled:opacity-50"><ChevronRight size={20} aria-hidden="true" /></Button>
        </div>
        <div ref={track} className="flex gap-2 overflow-x-auto pb-2 pt-1" aria-label="Chọn ảnh phòng">
          {photos.map((photo, index) => <button key={`${photo.position}:${photo.url}`} type="button" aria-label={`Xem ảnh ${index + 1}`} aria-pressed={index === active}
            onClick={() => setSelected(index)} className="h-16 w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg border-2 border-gray-200 bg-white aria-pressed:border-brand-hover">
            <GalleryPicture key={photo.url} url={photo.url} alt="" thumbnail />
          </button>)}
        </div>
      </>}
    </section>
  );
}
