import { LoaderCircle } from "lucide-react";

export default function ListingDetailLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="max-w-[1120px] mx-auto px-4 md:px-7 py-16 flex flex-col items-center justify-center min-h-[60svh]"
    >
      <div className="bg-white border border-gray-200 rounded-md px-8 py-10 shadow-sm flex flex-col items-center text-center max-w-md w-full space-y-3">
        <LoaderCircle className="size-9 text-brand animate-spin" aria-hidden="true" />
        <p className="font-sans text-base font-bold text-ink">Đang tải thông tin &amp; hình ảnh phòng…</p>
        <p className="font-sans text-xs font-medium text-ink/75">
          Hệ thống đang chuẩn bị dữ liệu chi tiết, bảng chi phí và hình ảnh chất lượng cao.
        </p>
      </div>
    </div>
  );
}

