"use client";
import {useEffect,useRef,useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useAuthStore} from "@/stores/auth-store";
import {managementRequest,apiError} from "@/lib/api/client";
import {Button} from "@/components/ui/button";
import type {NearbyItem} from "./types";
import {distanceLabel} from "./types";
type Row={item:NearbyItem;groupCode:string;hidden:boolean;reason:string|null;version:number};
export function NearbyAdmin({propertyId}:{propertyId:string}){
 const auth=useAuthStore();const allowed=auth.status==="authenticated"&&auth.user?.role==="ADMIN"&&auth.user.status==="ACTIVE";
 const query=useQuery({queryKey:["admin-nearby",auth.sessionId,propertyId],queryFn:({signal})=>managementRequest<{data:Row[]}>(`/admin/properties/${propertyId}/nearby`,{signal}),enabled:allowed,retry:false});
 const [target,setTarget]=useState<Row|null>(null);const [reason,setReason]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const request=useRef<{body:{hidden:boolean;reason:string;expectedVersion:number};key:string;id:string}|null>(null);
 const session=useRef(auth.sessionId);session.current=auth.sessionId;
 useEffect(()=>{setTarget(null);setReason("");setError("");setBusy(false);request.current=null;},[propertyId,auth.sessionId]);
 async function save(){
  if(!allowed||!target||!reason.trim()||busy)return;const currentSession=auth.sessionId;
  const body={hidden:!target.hidden,reason:reason.trim(),expectedVersion:target.version};
  if(!request.current||request.current.id!==target.item.id||JSON.stringify(request.current.body)!==JSON.stringify(body))request.current={id:target.item.id,body,key:crypto.randomUUID()};
  setBusy(true);setError("");
  try{await managementRequest(`/admin/properties/${propertyId}/nearby/${target.item.id}/visibility`,{method:"PATCH",data:body,headers:{"Idempotency-Key":request.current.key}});
   if(session.current!==currentSession)return;setTarget(null);setReason("");request.current=null;await query.refetch();
  }catch(error){if(session.current!==currentSession)return;setError(apiError(error).message);if(apiError(error).status===409){request.current=null;setTarget(null);await query.refetch();}}
  finally{if(session.current===currentSession)setBusy(false);}
 }
 if(!allowed)return <p>Bạn cần đăng nhập bằng tài khoản Admin đang hoạt động.</p>;
 return <section className="space-y-4 min-w-0">
  <p className="text-sm text-muted">Ẩn mục sai cho riêng tin này. Không sửa dữ liệu OSM gốc. Mỗi thay đổi lưu lý do và lịch sử.</p>
  {query.isPending&&<p role="status">Đang tải địa điểm…</p>}
  {query.isError&&<p role="alert" className="text-error text-sm">{apiError(query.error).message}</p>}
  {error&&<p role="alert" className="text-error text-sm">{error}</p>}
  <Button variant="secondary" aria-disabled={query.isFetching||busy} onClick={()=>{if(!busy&&!query.isFetching)void query.refetch();}}>Tải lại địa điểm</Button>
  {query.data?.data.length===0&&<p className="py-6 text-muted text-sm">Tin chưa có snapshot địa điểm.</p>}
  <ul className="divide-y divide-gray-200">{query.data?.data.map(row=><li key={`${row.item.id}-${row.groupCode}`} className="py-4 flex flex-col sm:flex-row gap-3 sm:justify-between">
   <div className="min-w-0"><p className="text-sm font-medium break-words">{row.item.name}</p><p className="mt-1 text-xs text-muted">{row.groupCode} · {distanceLabel(row.item.distanceMeters)} · {row.hidden?"Đã ẩn":"Đang hiển thị"}</p>{row.reason&&<p className="text-sm mt-2 break-words">Lý do gần nhất: {row.reason}</p>}</div>
   <Button variant="secondary" className="sm:self-start" disabled={busy||query.isFetching} onClick={()=>{setTarget(row);setReason("");setError("");request.current=null;}}>{row.hidden?"Hiện lại":"Ẩn mục sai"}</Button>
  </li>)}</ul>
  {target&&<form className="space-y-3 border border-gray-200 rounded-xl p-4" onSubmit={event=>{event.preventDefault();void save();}}>
   <p className="font-medium break-words">{target.hidden?"Hiện lại":"Ẩn"}: {target.item.name}</p>
   <label className="block text-sm">Lý do <span className="text-error">*</span><textarea aria-label="Lý do ẩn hoặc hiện địa điểm" required maxLength={500} rows={3} className="mt-2 w-full bg-white border border-gray-200 rounded-xl p-3 text-base md:text-sm" value={reason} onChange={event=>setReason(event.target.value)}/></label>
   <div className="flex gap-3"><Button type="button" variant="secondary" disabled={busy} onClick={()=>setTarget(null)}>Hủy</Button><Button type="submit" disabled={!reason.trim()} aria-disabled={busy} aria-busy={busy}>Lưu thay đổi</Button></div>
  </form>}
 </section>;
}
