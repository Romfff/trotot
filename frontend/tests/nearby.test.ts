import {describe,it,expect,vi} from "vitest";
import {appendNearbyPage,distanceLabel,readNearby,NearbyReadError,type NearbyGroup} from "../src/features/nearby/types";
describe("Nearby presentation",()=>{
 it("formats distances to approved precision without implying walking time",()=>{
  expect(distanceLabel(0)).toBe("0 m");expect(distanceLabel(0.1)).toBe("Dưới 10 m");expect(distanceLabel(9.99)).toBe("Dưới 10 m");
  expect(distanceLabel(10)).toBe("10 m");expect(distanceLabel(144)).toBe("140 m");expect(distanceLabel(145)).toBe("150 m");
  expect(distanceLabel(999)).toBe("1000 m");expect(distanceLabel(1000)).toBe("1 km");expect(distanceLabel(1500)).toBe("1,5 km");
 });
 it("append does not duplicate existing IDs",()=>{
  const group={code:"MARKETS",label:"Chợ",radiusMeters:2000,items:[{id:"a"}],total:3,hasMore:true,truncated:false} as NearbyGroup;
  expect(appendNearbyPage(group,{...group,hasMore:false,items:[{id:"a"},{id:"b"}] as NearbyGroup["items"]}).items.map(i=>i.id)).toEqual(["a","b"]);
 });
 it("forwards cancellation and snapshot version, preserves conflict semantics",async()=>{
  const fetcher=vi.fn().mockResolvedValue({ok:false,status:409,json:async()=>({success:false,message:"Snapshot changed"})});vi.stubGlobal("fetch",fetcher);
  try{const controller=new AbortController();await expect(readNearby("safe-slug",controller.signal,{snapshotVersion:"version",page:2})).rejects.toBeInstanceOf(NearbyReadError);
   expect(fetcher.mock.calls[0][0]).toContain("snapshotVersion=version");expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
  }finally{vi.unstubAllGlobals();}
 });
});
