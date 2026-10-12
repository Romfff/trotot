import {describe,expect,it} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {calendarPriceLabel,homestayCoverUrl,stayDateLabel} from "../src/lib/homestay-display";
import {AvailabilityCalendar,PriceRows} from "../src/features/homestays/screens";

describe("Homestay display labels",()=>{
 it("selects one valid cover by sortOrder without mutating media",()=>{
  const media=[{url:"https://example.com/last.png",sortOrder:3},{url:"javascript:alert(1)",sortOrder:0},{url:"https://example.com/cover.png",sortOrder:1}];
  expect(homestayCoverUrl(media)).toBe("https://example.com/cover.png");expect(media.map(image=>image.sortOrder)).toEqual([3,0,1]);
  expect(homestayCoverUrl()).toBeNull();expect(homestayCoverUrl([{url:"data:image/png;base64,AAAA",sortOrder:0}])).toBeNull();
 });
 it.each([[0,"0đ"],[500,"500đ"],[300000,"300k"],[1250000,"1,3tr"],[1200000,"1,2tr"],[2100000000,"2,1tỷ"]])("labels %s for compact calendar only",(value,label)=>expect(calendarPriceLabel(Number(value))).toBe(label));
 it("formats ISO date text without timezone shifts or changing the value",()=>{
  expect(stayDateLabel("2028-02-29")).toBe("29/02/2028");expect(stayDateLabel("2027-12-21")).toBe("21/12/2027");expect(stayDateLabel("")).toBe("");
 });
 it("keeps full price available to keyboard/screen reader and leaves default calendar unchanged",()=>{
  const calendar={unitId:"fixture",month:"2027-12",days:[{date:"2027-12-21",isAvailable:true,price:1200000},{date:"2027-12-22",isAvailable:false,price:300000}]};
  const compact=renderToStaticMarkup(<AvailabilityCalendar calendar={calendar} compactPrices onPick={()=>{}} />);
  expect(compact).toContain("1,2tr");expect(compact).toContain('aria-label="Nhận phòng 2027-12-21: còn phòng, 1.200.000 đồng"');expect(compact).toContain('aria-label="Nhận phòng 2027-12-22: hết phòng"');
  const standard=renderToStaticMarkup(<AvailabilityCalendar calendar={calendar} onPick={()=>{}} />);
  expect(standard).toContain("1.200.000 đ");expect(standard).not.toContain("1,2tr");
  const price=renderToStaticMarkup(<PriceRows price={{baseAmount:1200000,cleaningFee:0,serviceFee:0,taxAmount:0,totalAmount:1200000,nightlyPrices:[{date:"2027-12-21",price:1200000}]}} />);
  expect(price).toContain("1.200.000 đ");expect(price).not.toContain("1,2tr");
 });
});
