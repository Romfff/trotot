import type {Metadata} from "next";
import {AdminNoShowScreen} from "@/features/no-show/admin-review";
export const metadata:Metadata={title:"Xác minh khách không đến | Trotot",robots:{index:false,follow:false}};
export default function Page(){return <AdminNoShowScreen/>;}
