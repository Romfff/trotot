export default function ThuePhongTroLoading() {
  return (
    <div className="bg-bg min-h-[calc(100svh-76px)]">
      <div className="max-w-[1320px] mx-auto px-4 md:px-6 py-4">
        <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 h-16 animate-pulse" />
        <div className="flex items-center justify-between py-2 mb-4">
          <div className="h-7 w-64 bg-brand-tint rounded animate-pulse" />
          <div className="h-10 w-40 bg-brand-tint rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-6 items-start">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white border border-gray-200 overflow-hidden animate-pulse">
                <div className="aspect-[4/3] w-full bg-brand-tint" />
                <div className="p-5 space-y-3">
                  <div className="h-4 bg-brand-tint rounded w-1/3" />
                  <div className="h-6 bg-brand-tint rounded w-4/5" />
                  <div className="h-4 bg-brand-tint rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
          <div className="hidden lg:block h-[calc(100dvh-176px)] min-h-[620px] w-full bg-[#0a1b2a]/90 rounded-[4px] animate-pulse" />
        </div>
      </div>
    </div>
  );
}
