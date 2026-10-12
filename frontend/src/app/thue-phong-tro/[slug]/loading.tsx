export default function ListingDetailLoading() {
  return (
    <div role="status" className="max-w-[1120px] mx-auto px-4 py-6">
      <span className="sr-only">Đang tải thông tin phòng…</span>
      <div aria-hidden="true" className="animate-pulse space-y-4">
        <div className="h-7 w-3/4 bg-gray-200 rounded" />
        <div className="h-4 w-1/2 bg-gray-200 rounded" />
        <div className="aspect-[4/3] max-w-2xl bg-gray-200 rounded-xl" />
      </div>
    </div>
  );
}
