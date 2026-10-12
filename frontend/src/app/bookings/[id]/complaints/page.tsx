import {ComplaintScreen} from "@/features/host-finance/complaint-screen";
export const metadata={title:"Khiếu nại đơn đặt phòng",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;return <ComplaintScreen bookingId={id}/>;
}
