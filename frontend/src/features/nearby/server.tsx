import {publicReadHeaders} from "@/lib/api/public-read-headers.server";
import {NearbySection} from "./section";
import type {NearbySnapshot} from "./types";
export async function NearbyServer({slug}:{slug:string}){
 if(process.env.NEARBY_ENABLED!=="true")return null;
 let initial:NearbySnapshot|undefined;
 try{
  const base=process.env.BACKEND_API_URL||"http://localhost:5000/api/v1";
  const path=`properties/${encodeURIComponent(slug)}/nearby`;
  const response=await fetch(`${base.replace(/\/$/,"")}/${path}`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(200),headers:{Accept:"application/json",...await publicReadHeaders(path)}});
  if(response.ok){const envelope=await response.json();if(envelope.success)initial=envelope.data;}
 }catch{/* Nearby failure must not fail listing detail/metadata. Client read can retry. */}
 return <NearbySection key={slug} slug={slug} initial={initial}/>;
}
