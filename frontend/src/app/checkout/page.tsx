import { Suspense } from "react";
import { Checkout } from "@/features/homestays/screens";
export const metadata={robots:{index:false,follow:false}};
export default function Page(){return <Suspense fallback={<p className="s3-state">Đang tải thông tin đặt phòng…</p>}><Checkout/></Suspense>;}
