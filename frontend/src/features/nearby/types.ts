export type NearbyPoint={latitude:number;longitude:number};
export type NearbyItem={id:string;name:string;category:string;source:"OSM";point:NearbyPoint;distanceMeters:number;representativeMethod:string};
export type NearbyGroup={code:string;label:string;radiusMeters:number;items:NearbyItem[];total:number;hasMore:boolean;truncated:boolean};
export type NearbySnapshot={propertyId:string;rentalMode:string;status:"READY"|"EMPTY"|"PENDING"|"UNAVAILABLE";center:NearbyPoint;
 distanceMethod:"GEODESIC";stale:boolean;updatedAt:string|null;datasetVersion:string|null;snapshotVersion:string|null;
 attribution:{label:string;url:string};groups:NearbyGroup[]};
export class NearbyReadError extends Error {constructor(public status:number,message:string){super(message);}}
export async function readNearby(slug:string,signal:AbortSignal,query?:Record<string,string|number>):Promise<NearbySnapshot>{
 const params=new URLSearchParams(Object.entries(query||{}).map(([key,value])=>[key,String(value)]));
 const response=await fetch(`/api/listings/properties/${encodeURIComponent(slug)}/nearby?${params}`,{signal,cache:"no-store",headers:{Accept:"application/json"}});
 const envelope=await response.json();if(!response.ok||!envelope.success)throw new NearbyReadError(response.status,envelope.message||"Không tải được dữ liệu khu vực.");
 return envelope.data;
}
export function distanceLabel(meters:number){
 if(meters>0&&meters<10)return "Dưới 10 m";
 return meters<1000?`${Math.round(meters/10)*10} m`:`${new Intl.NumberFormat("vi-VN",{maximumFractionDigits:1}).format(meters/1000)} km`;
}
export function appendNearbyPage(current:NearbyGroup,next:NearbyGroup):NearbyGroup{
 return {...next,items:[...current.items,...next.items.filter(item=>!current.items.some(old=>old.id===item.id))]};
}
