import { HostListingEditor } from "@/features/host-listings/screens";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <HostListingEditor id={(await params).id} />; }
