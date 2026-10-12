"use client";
import {useEffect,useId,useRef,useState} from "react";
import dynamic from "next/dynamic";
import {Button} from "@/components/ui/button";
import {RotateCw} from "lucide-react";
import {appendNearbyPage,distanceLabel,NearbyReadError,readNearby,type NearbySnapshot} from "./types";
import styles from "./nearby.module.css";
const Map=dynamic(()=>import("./map"),{ssr:false,loading:()=> <div className={styles.map} aria-busy="true"><span className="sr-only">Đang tải bản đồ</span></div>});
export function NearbySection({slug,initial}:{slug:string;initial?:NearbySnapshot}){
 const id=useId();const [data,setData]=useState(initial);const [active,setActive]=useState(initial?.groups[0]?.code||"");
 const [selected,setSelected]=useState<string|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const [refresh,setRefresh]=useState(0);const pending=useRef<AbortController|null>(null);const pages=useRef<Record<string,number>>({});
 useEffect(()=>{
  const controller=new AbortController();pending.current?.abort();pending.current=controller;
  if(initial&&refresh===0)return()=>controller.abort();
  setBusy(true);setError("");
  void readNearby(slug,controller.signal).then(result=>{if(controller.signal.aborted)return;setData(result);setActive(result.groups[0]?.code||"");pages.current={};setSelected(null);})
   .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:"Không tải được dữ liệu khu vực.");})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[slug,initial,refresh]);
 const group=data?.groups.find(group=>group.code===active);
 async function more(){
  if(!data?.snapshotVersion||!group||busy)return;
  pending.current?.abort();const controller=new AbortController();pending.current=controller;setBusy(true);setError("");
  const page=(pages.current[group.code]||1)+1;
  try{const next=await readNearby(slug,controller.signal,{group:group.code,page,limit:5,snapshotVersion:data.snapshotVersion});
   if(controller.signal.aborted)return;const addition=next.groups[0];if(!addition)return;
   setData(old=>old&&({...old,groups:old.groups.map(item=>item.code===group.code?appendNearbyPage(item,addition):item)}));pages.current[group.code]=page;
  }catch(error){if(controller.signal.aborted)return;
   if(error instanceof NearbyReadError&&error.status===409){setRefresh(n=>n+1);setError("Dữ liệu đã thay đổi, đang tải lại.");}
   else setError(error instanceof Error?error.message:"Chưa tải được địa điểm tiếp theo.");
  }finally{if(!controller.signal.aborted)setBusy(false);}
 }
 const retry=()=>setRefresh(n=>n+1);
 return <section className={styles.section} aria-labelledby={`${id}-heading`} aria-busy={busy}>
  <h2 id={`${id}-heading`} className={styles.heading}>Khu vực xung quanh</h2>
  <p className={styles.caption}>Khoảng cách đường thẳng từ ghim của chủ nhà, không phải quãng đường hoặc thời gian đi bộ.</p>
  {error&&<div role="alert" className="space-y-3 py-3"><p className="text-sm text-error">{error}</p><Button variant="secondary" onClick={retry}><RotateCw size={16} aria-hidden/>Thử lại</Button></div>}
  {!data&&busy&&<p className={styles.empty} role="status">Đang tải khu vực…</p>}
  {data&&["UNAVAILABLE","PENDING"].includes(data.status)&&<div className="space-y-3"><Map center={data.center} items={[]} selected={selected} onSelect={setSelected}/><p className={styles.empty}>{data.status==="PENDING"?"Dữ liệu địa điểm xung quanh đang được cập nhật. Bạn vẫn có thể xem vị trí vệ tinh của ngôi nhà trên bản đồ.":"Chưa có danh sách địa điểm xung quanh, hiển thị vị trí vệ tinh của ngôi nhà."}</p></div>}
  {data&&data.groups.length>0&&<>
   <div className={styles.tabs} role="tablist" aria-label="Nhóm địa điểm">
    {data.groups.map((item,index)=><button type="button" role="tab" key={item.code} id={`${id}-${item.code}`} aria-controls={`${id}-panel`} aria-selected={active===item.code} tabIndex={active===item.code?0:-1}
     onClick={()=>{setActive(item.code);setSelected(null);}} onKeyDown={event=>{
      const target=event.key==="Home"?0:event.key==="End"?data.groups.length-1:event.key==="ArrowRight"?(index+1)%data.groups.length:event.key==="ArrowLeft"?(index+data.groups.length-1)%data.groups.length:-1;
      if(target<0)return;event.preventDefault();setActive(data.groups[target].code);setSelected(null);
      const button=event.currentTarget.parentElement?.children[target] as HTMLElement|undefined;button?.focus({preventScroll:true});if(button)button.parentElement!.scrollLeft=button.offsetLeft;
     }}>{item.label}</button>)}
   </div>
   {group&&<div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active}`} className={styles.body}>
    <Map center={data.center} items={group.items} selected={selected} onSelect={setSelected}/>
    <div className={styles.list}>
     {!group.items.length?<p className={styles.empty}>Chưa tìm thấy địa điểm thuộc nhóm này trong bán kính {distanceLabel(group.radiusMeters)}.</p>:
      <ul>{group.items.map(item=><li key={item.id}><button type="button" className={styles.row} aria-pressed={selected===item.id} onClick={()=>setSelected(item.id)}>
       <span className={styles.name}>{item.name}</span><span className={styles.distance}>{distanceLabel(item.distanceMeters)}</span>
      </button></li>)}</ul>}
     {group.hasMore&&<Button variant="secondary" className="mt-3 min-h-11" aria-expanded={group.items.length>5} aria-disabled={busy} onClick={()=>void more()}>Xem thêm địa điểm</Button>}
     {group.truncated&&<p className={styles.footer}>Hiển thị tối đa 20 địa điểm gần nhất trong nhóm.</p>}
    </div>
   </div>}
  </>}
  <p className={styles.footer}>© Google Satellite &amp; Map Data · Dữ liệu địa điểm xung quanh tham khảo từ OpenStreetMap.
   {data?.updatedAt&&<> {data.stale?"Dữ liệu cũ — cập nhật gần nhất":"Cập nhật"}: {new Intl.DateTimeFormat("vi-VN",{timeZone:"Asia/Ho_Chi_Minh",dateStyle:"medium"}).format(new Date(data.updatedAt))}.</>}
  </p>
 </section>;
}
