import { HomestaySearch } from "@/features/homestays/screens";
import { Suspense } from "react";

export default function HomestayPage() {
  return (
    <Suspense
      fallback={
        <div role="status" className="s3-page stitch-guest-page min-h-[calc(100svh-76px)]">
          <div className="h-16 bg-brand-tint rounded animate-pulse" />
          <div className="h-56 bg-white border border-gray-200 animate-pulse" />
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 bg-white border border-gray-200 animate-pulse" />
            ))}
          </div>
          <span className="sr-only">Đang tải tìm kiếm homestay…</span>
        </div>
      }
    >
      <HomestaySearch />
    </Suspense>
  );
}
