import { HomestayEditorScreen } from "@/features/host-homestays/screens";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <HomestayEditorScreen id={(await params).id} />; }
