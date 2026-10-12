import Link from "next/link";
import {notFound} from "next/navigation";
import {NearbyAdmin} from "@/features/nearby/admin";
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(id))notFound();
 return <div className="max-w-4xl mx-auto px-4 py-6 space-y-5"><Link href="/admin/properties" className="inline-flex min-h-11 items-center text-brand">Về danh sách tin</Link>
  <h1 className="text-xl font-semibold">Quản lý khu vực xung quanh</h1>
  {process.env.NEARBY_ENABLED==="true"?<NearbyAdmin propertyId={id}/>:<p className="text-sm text-muted">Dữ liệu khu vực chưa được bật. Cần nhập và kiểm chứng nguồn OSM trước.</p>}
 </div>;
}
