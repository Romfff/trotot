import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,expect,it,vi} from "vitest";
import {AdminNoShowScreen,NoShowSnapshot} from "@/features/no-show/admin-review";
import type {NoShowDetail} from "@/lib/api/no-show";
const auth=vi.hoisted(()=>({state:{} as Record<string,unknown>}));
vi.mock("@/stores/auth-store",()=>({useAuthStore:()=>auth.state}));
const row:NoShowDetail={id:"00000000-0000-4000-8000-000000000001",bookingId:"00000000-0000-4000-8000-000000000002",bookingVersion:2,reason:"<script>fixture</script>",reportedAt:"2026-10-06T17:00:00.000Z",resolution:null};
beforeEach(()=>{auth.state={status:"initializing",user:null,sessionId:null};});
it("escapes report text and displays Vietnam local time without inventing payment actions",()=>{
  const html=renderToStaticMarkup(<NoShowSnapshot row={row}/>);
  expect(html).toContain("&lt;script&gt;fixture&lt;/script&gt;");expect(html).not.toContain("<script>");expect(html).toContain("07/10/2026");expect(html).toContain("00:00");
  expect(html).toContain("Chờ xác minh");expect(html).toContain(row.bookingId);expect(html).not.toContain("<form");expect(html).not.toContain("<button");
});
it("shows only the actual resolved proof, escaped, without an automatic completion claim",()=>{
  const html=renderToStaticMarkup(<NoShowSnapshot row={{...row,resolution:{actorId:"00000000-0000-4000-8000-000000000003",reason:"<b>reason</b>",evidenceNote:"<img src=x onerror=alert(1)>",resolvedAt:row.reportedAt}}}/>);
  expect(html).toContain("Đã xác minh");expect(html).toContain("&lt;img");expect(html).not.toContain("<img");expect(html).toContain("Chứng cứ nội bộ");expect(html).not.toContain("Đã hoàn thành");
});
it.each([
  [{status:"initializing"},"Đang kiểm tra phiên"],[{status:"unavailable"},"Chưa kiểm tra được phiên"],[{status:"anonymous"},"Đăng nhập"],
  ...["HOST","TENANT"].map(role=>[{status:"authenticated",sessionId:"fixture",user:{role,status:"ACTIVE"}},"chỉ dành cho Admin"] as const),
  [{status:"authenticated",sessionId:"fixture",user:{role:"ADMIN",status:"SUSPENDED"}},"chỉ dành cho Admin"],
  [{status:"authenticated",sessionId:null,user:{role:"ADMIN",status:"ACTIVE"}},"chỉ dành cho Admin"],
] as const)("does not mount private queries for %j",(state,message)=>{
  auth.state={...auth.state,...state};const html=renderToStaticMarkup(<AdminNoShowScreen/>);expect(html).toContain(message);expect(html).not.toContain("no-show-list-title");
});
