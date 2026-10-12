import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeHomestayCard } from "../src/components/home-listings";
import { homestaySearchParams } from "../src/lib/homestay-search-params";
import type { HomestayResult } from "../src/lib/api/homestays";

describe("home → actual homestay search", () => {
  it("keeps API names, dates and capacity from the home form", () => {
    const result=homestaySearchParams(new URLSearchParams("q=Studio&checkIn=2026-11-01&checkOut=2026-11-04&adults=2&children=0"));
    expect(result.filters).toEqual({page:1,limit:10,q:"Studio",checkIn:"2026-11-01",checkOut:"2026-11-04",adults:2,children:0});
    expect(result.stay.unitId).toBe("");
  });
  it("supports old bookmarked home URLs without changing the API contract", () => {
    const result=homestaySearchParams(new URLSearchParams("dest=Studio&guests=3&checkIn=2026-11-01&checkOut=2026-11-04"));
    expect(result.filters).toMatchObject({q:"Studio",adults:3});
  });
  it("does not add date or capacity filters when viewing all", () => {
    expect(homestaySearchParams(new URLSearchParams()).filters).toEqual({page:1,limit:10});
  });
  it("does not silently discard an incomplete date range", () => {
    expect(homestaySearchParams(new URLSearchParams("checkIn=2026-11-01")).filters).toMatchObject({checkIn:"2026-11-01",checkOut:"",adults:1,children:0});
  });
  it("prefers current URL names and trims the query", () => {
    const result=homestaySearchParams(new URLSearchParams("q=%20New%20&dest=Old&adults=2&guests=3"));
    expect(result.q).toBe("New");expect(result.stay.adults).toBe(2);
  });
});

const room:HomestayResult={id:"unit",slug:"demo-local-studio",title:"[DEMO] Studio",address:"Địa chỉ mẫu",unitName:"Phòng mẫu",maxAdults:2,maxChildren:2,maxGuests:4,maxNights:90,instantBook:true,bedrooms:1,bathrooms:1,checkInTime:"14:00:00",checkOutTime:"12:00:00",cancellationPolicy:"FLEXIBLE",basePricePerNight:550000,cleaningFee:100000,media:[{url:"https://media.invalid/room.jpg",sortOrder:0}]};
describe("home homestay API card", () => {
  it("links to the actual slug and shows actual price/media, without invented ratings", () => {
    const html=renderToStaticMarkup(<HomeHomestayCard room={room}/>);
    expect(html).toContain('href="/homestay/demo-local-studio"');expect(html).toContain("550.000");
    expect(html).toContain("https://media.invalid/room.jpg");expect(html).toContain("Studio");expect(html).not.toContain("[DEMO]");
    expect(html).not.toContain("đánh giá");expect(html).not.toContain("Chính chủ");
  });
  it("shows a truthful empty photo state, never random fallback photos", () => {
    const html=renderToStaticMarkup(<HomeHomestayCard room={{...room,media:[]}}/>);
    expect(html).toContain("Chưa có hình ảnh");expect(html).not.toContain("unsplash");
  });
  it("rejects unsafe media URLs", () => {
    const html=renderToStaticMarkup(<HomeHomestayCard room={{...room,media:[{url:"javascript:alert(1)",sortOrder:0}]}}/>);
    expect(html).not.toContain("javascript:");expect(html).toContain("Chưa có hình ảnh");
  });
});
