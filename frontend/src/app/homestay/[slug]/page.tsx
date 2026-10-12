import { HomestayDetail } from "@/features/homestays/screens";
export default async function Page({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;return <HomestayDetail slug={slug} nearbyEnabled={process.env.NEARBY_ENABLED==="true"}/>;
}
