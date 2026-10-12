import type {Metadata} from "next";
import {AdminComplaintScreen} from "@/features/admin-finance/complaint-screen";
export const metadata:Metadata={title:"Xử lý khiếu nại | Trotot",robots:{index:false,follow:false}};
export default function Page(){return <AdminComplaintScreen/>;}
