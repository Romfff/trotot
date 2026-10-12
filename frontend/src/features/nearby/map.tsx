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
   if(disposed||!container.current||(container.current as {_leaflet_id?:number})._leaflet_id)return;
   map=L.map(container.current,{scrollWheelZoom:true,keyboard:true,zoomControl:true,maxZoom:20}).setView([center.latitude,center.longitude],18);instance.current=map;
   let loadedAny=false;let fallbackUsed=false;const failedTiles=new Set<HTMLElement>();
   const tiles=L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=vi",{subdomains:["0","1","2","3"],maxZoom:20,attribution:"&copy; Google Satellite &amp; Map Data"}).addTo(map);
   tiles.on("tileload",()=>{if(!disposed){loadedAny=true;failedTiles.clear();setFailed(false);}});
   tiles.on("tileerror",(e:import("leaflet").TileErrorEvent)=>{
    if(disposed)return;
    failedTiles.add(e.tile);
    if(!loadedAny&&failedTiles.size>=4&&!fallbackUsed){fallbackUsed=true;failedTiles.clear();tiles.setUrl("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}");return;}
    if(!loadedAny&&failedTiles.size>=8)setFailed(true);
   });
   const label=document.createElement("span");label.textContent="Vị trí ngôi nhà";
   L.circleMarker([center.latitude,center.longitude],{radius:10,color:"#ffffff",weight:2.5,fillColor:"#0284c7",fillOpacity:1}).bindTooltip(label,{permanent:true}).addTo(map);
   for(const item of items){const text=document.createElement("span");text.textContent=item.name;
    const marker=L.circleMarker([item.point.latitude,item.point.longitude],{radius:6,color:"#0a1b2a",fillColor:"#ffffff",fillOpacity:1}).bindTooltip(text).addTo(map!);
    marker.on("click",()=>select.current(item.id));pins.set(item.id,marker);
   }
   if(items.length)map.fitBounds(L.latLngBounds([[center.latitude,center.longitude],...items.map(item=>[item.point.latitude,item.point.longitude] as [number,number])]),{padding:[28,28],maxZoom:17,animate:false});
  }).catch(()=>{if(!disposed)setFailed(true);});
  return()=>{disposed=true;map?.remove();instance.current=null;pins.clear();};
 },[center.latitude,center.longitude,items,visible,retry]);
 useEffect(()=>{const marker=selected?markers.current.get(selected):undefined;if(!marker||!instance.current)return;
  marker.openTooltip();instance.current.panTo(marker.getLatLng(),{animate:!window.matchMedia("(prefers-reduced-motion: reduce)").matches});
 },[selected]);
 return <div className={styles.map}><div ref={container} className={styles.mapCanvas} role="region" aria-label="Bản đồ vệ tinh vị trí ngôi nhà và địa điểm xung quanh."/>
  {failed&&<div className={styles.mapWarning} role="status"><p>Chưa tải được bản đồ. Danh sách vẫn dùng được.</p><Button variant="secondary" onClick={()=>{setFailed(false);setRetry(n=>n+1);}}>Thử lại bản đồ</Button></div>}
 </div>;
}
