import { LoaderCircle } from "lucide-react";

export default function ThuePhongTroLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-bg min-h-[calc(100svh-76px)] flex items-center justify-center px-4 py-16"
    >
      <div className="bg-white border border-gray-200 rounded-md px-8 py-10 shadow-sm flex flex-col items-center text-center max-w-md w-full space-y-3">
        <LoaderCircle className="size-9 text-brand animate-spin" aria-hidden="true" />
        <p className="font-sans text-base font-bold text-ink">Đang tải danh sách phòng trọ &amp; bản đồ…</p>
        <p className="font-sans text-xs font-medium text-ink/75">
          Vui lòng đợi trong giây lát để hệ thống đồng bộ dữ liệu phòng trống.
        </p>
      </div>
    </div>
  );
}

