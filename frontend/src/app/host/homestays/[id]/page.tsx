import { HomestayDetailScreen } from "@/features/host-homestays/screens";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <HomestayDetailScreen id={(await params).id} />; }
