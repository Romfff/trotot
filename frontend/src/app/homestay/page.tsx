import { HomestaySearch } from "@/features/homestays/screens";
import { Suspense } from "react";
export default function HomestayPage() { return <Suspense fallback={<p role="status" className="p-6 text-sm">Đang tải tìm kiếm homestay…</p>}><HomestaySearch/></Suspense>; }
