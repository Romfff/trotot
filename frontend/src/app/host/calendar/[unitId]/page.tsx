import { HostCalendarScreen } from "@/features/host-finance/calendar-screen";
export const metadata = { robots: { index: false, follow: false }, title: "Lịch phòng | Trotot" };
export default async function Page({ params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params;
  return <HostCalendarScreen unitId={unitId} />;
}
