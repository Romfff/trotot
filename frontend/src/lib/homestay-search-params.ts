import type { Stay } from "@/lib/api/homestays";

// The home form and homestay search use the same existing API field names.
export function homestaySearchParams(params: Pick<URLSearchParams, "get">) {
  const q=(params.get("q") ?? params.get("dest") ?? "").trim();
  const integer=(key:string,fallback:number) => {
    const raw=params.get(key);return raw!==null && /^\d+$/.test(raw) ? Number(raw) : fallback;
  };
  const stay:Stay={unitId:"",checkIn:params.get("checkIn")??"",checkOut:params.get("checkOut")??"",adults:integer("adults",integer("guests",1)),children:integer("children",0)};
  const hasDates=Boolean(stay.checkIn||stay.checkOut);
  return {q,stay,filters:{page:1,limit:10,...(q?{q}:{}),...(hasDates?{checkIn:stay.checkIn,checkOut:stay.checkOut,adults:stay.adults,children:stay.children}:{})} as Record<string,string|number>};
}
