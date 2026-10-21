import { HomestaySearch } from "@/features/homestays/screens";
import { LoaderCircle } from "lucide-react";
import { Suspense } from "react";

export default function HomestayPage() {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-live="polite"
          className="s3-page stitch-guest-page min-h-[calc(100svh-76px)] flex items-center justify-center"
        >
          <div className="bg-white border border-gray-200 rounded-md px-8 py-10 shadow-sm flex flex-col items-center text-center max-w-md w-full space-y-3">
            <LoaderCircle className="size-9 text-brand animate-spin" aria-hidden="true" />
            <p className="font-sans text-base font-bold text-ink">Đang tải danh sách Homestay…</p>
            <p className="font-sans text-xs font-medium text-ink/75">
              Đang đồng bộ lịch phòng trống và đơn giá theo đêm.
            </p>
          </div>
        </div>
      }
    >
      <HomestaySearch />
    </Suspense>
  );
}

