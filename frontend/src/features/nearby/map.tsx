"use client";
import {useEffect,useRef,useState} from "react";
import type {NearbyItem,NearbyPoint} from "./types";
import {Button} from "@/components/ui/button";
import styles from "./nearby.module.css";
import "leaflet/dist/leaflet.css";
export default function NearbyMap({center,items,selected,onSelect}:{center:NearbyPoint;items:NearbyItem[];selected:string|null;onSelect:(id:string)=>void}){
 const container=useRef<HTMLDivElement>(null);const instance=useRef<import("leaflet").Map|null>(null);
 const markers=useRef(new Map<string,import("leaflet").CircleMarker>());const select=useRef(onSelect);
 const [visible,setVisible]=useState(false);const [failed,setFailed]=useState(false);const [retry,setRetry]=useState(0);
 useEffect(()=>{select.current=onSelect;},[onSelect]);
 useEffect(()=>{if(!container.current)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:"200px"});observer.observe(container.current);return()=>observer.disconnect();},[]);
 useEffect(()=>{
  if(!visible||!container.current)return;let disposed=false;let map:import("leaflet").Map|undefined;const pins=markers.current;
  void import("leaflet").then(L=>{
   if(disposed||!container.current)return;
   map=L.map(container.current,{scrollWheelZoom:false,keyboard:true,zoomControl:true}).setView([center.latitude,center.longitude],14);instance.current=map;
   const tiles=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
   tiles.on("tileerror",()=>{if(!disposed)setFailed(true);});
   const label=document.createElement("span");label.textContent="Vị trí tin đăng";
   L.circleMarker([center.latitude,center.longitude],{radius:9,color:"var(--primary)",fillOpacity:1}).bindTooltip(label,{permanent:true}).addTo(map);
   for(const item of items){const text=document.createElement("span");text.textContent=item.name;
    const marker=L.circleMarker([item.point.latitude,item.point.longitude],{radius:6,color:"var(--foreground)",fillColor:"var(--surface,#fff)",fillOpacity:1}).bindTooltip(text).addTo(map!);
    marker.on("click",()=>select.current(item.id));pins.set(item.id,marker);
   }
   if(items.length)map.fitBounds(L.latLngBounds([[center.latitude,center.longitude],...items.map(item=>[item.point.latitude,item.point.longitude] as [number,number])]),{padding:[28,28],maxZoom:15,animate:false});
  }).catch(()=>{if(!disposed)setFailed(true);});
  return()=>{disposed=true;map?.remove();instance.current=null;pins.clear();};
 },[center.latitude,center.longitude,items,visible,retry]);
 useEffect(()=>{const marker=selected?markers.current.get(selected):undefined;if(!marker||!instance.current)return;
  marker.openTooltip();instance.current.panTo(marker.getLatLng(),{animate:!window.matchMedia("(prefers-reduced-motion: reduce)").matches});
 },[selected]);
 return <div className={styles.map}><div ref={container} className={styles.mapCanvas} role="region" aria-label="Bản đồ vị trí tin và địa điểm xung quanh. Có thể chọn địa điểm bằng danh sách bên cạnh."/>
  {failed&&<div className={styles.mapWarning} role="status"><p>Chưa tải được bản đồ. Danh sách vẫn dùng được.</p><Button variant="secondary" onClick={()=>{setFailed(false);setRetry(n=>n+1);}}>Thử lại bản đồ</Button></div>}
 </div>;
}
