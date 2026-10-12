import { describe,it,expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AvailabilityCalendar,PriceRows,isQuote,remainingBookingSeconds } from "../src/features/homestays/screens";

const price={baseAmount:100,cleaningFee:5,serviceFee:0,taxAmount:0,totalAmount:105,nightlyPrices:[{date:"2026-10-01",price:100}]};
describe("minimal homestay presentation",()=>{
 it("hides zero optional fees and keeps displayed total equal to visible charges",()=>{
  const html=renderToStaticMarkup(<PriceRows price={price}/>);expect(html).toContain("105");expect(html).not.toContain("Phí dịch vụ");expect(html).not.toContain("Thuế");expect(html).toContain("Phí vệ sinh");
 });
 it("October starts on Thursday, with three leading cells and accessible availability labels",()=>{
  const html=renderToStaticMarkup(<AvailabilityCalendar calendar={{unitId:"fixture",month:"2026-10",days:[{date:"2026-10-01",isAvailable:false,price:100}]}}/>);
  expect(html.match(/s3-calendar-empty/g)).toHaveLength(3);expect(html).toContain("2026-10-01: hết phòng");expect(html).toContain("CN");
 });
 it("keeps sold-out replacement arrivals disabled while allowing a sold-out checkout after arrival",()=>{
  const calendar={unitId:"fixture",month:"2026-10",days:[
   {date:"2026-10-01",isAvailable:false,price:100},
   {date:"2026-10-02",isAvailable:true,price:100},
   {date:"2026-10-03",isAvailable:false,price:100},
   {date:"2026-10-04",isAvailable:false,price:100},
  ]};
  const html=renderToStaticMarkup(<AvailabilityCalendar calendar={calendar} onPick={()=>{}} checkout selectedCheckIn="2026-10-03"/>);
  const button=(date:string)=>html.match(new RegExp(`<button[^>]*aria-label="(?:Nhận|Trả) phòng ${date}"[^>]*>`))![0];
  expect(button("2026-10-01")).toContain('disabled=""');
  expect(button("2026-10-02")).not.toContain('disabled=""');
  expect(button("2026-10-02")).toContain("Nhận phòng");
  expect(button("2026-10-03")).toContain('disabled=""');
  expect(button("2026-10-04")).not.toContain('disabled=""');
  expect(button("2026-10-04")).toContain("Trả phòng");
 });
 it("does not allow sold-out arrivals when starting or restarting a range",()=>{
  const calendar={unitId:"fixture",month:"2026-10",days:[{date:"2026-10-04",isAvailable:false,price:100}]};
  for(const selection of [{},{selectedCheckIn:"2026-10-02",selectedCheckOut:"2026-10-03"}]){
   const html=renderToStaticMarkup(<AvailabilityCalendar calendar={calendar} onPick={()=>{}} {...selection}/>);
   expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Nhận phòng 2026-10-04"/);
  }
 });
 it("accepts a complete repricing quote, rejects malformed money/expiry/total",()=>{
  const quote={quoteToken:"signed-fixture",quoteExpiresAt:"2026-10-22T00:15:00Z",isAvailable:true,totalNights:1,priceBreakdown:price};
  expect(isQuote(quote)).toBe(true);
  for(const bad of [{...quote,quoteExpiresAt:"invalid"},{...quote,totalNights:2},{...quote,priceBreakdown:{totalAmount:105}},{...quote,priceBreakdown:{...price,totalAmount:104}},{...quote,priceBreakdown:{...price,cleaningFee:-1}},{...quote,priceBreakdown:{...price,baseAmount:100.2}}])expect(isQuote(bad)).toBe(false);
 });
 it("countdown uses server time, not the guest's timezone/clock; never goes negative",()=>{
  expect(remainingBookingSeconds('2026-10-22T00:15:00Z','2026-10-22T00:00:00Z',0)).toBe(900);
  expect(remainingBookingSeconds('2026-10-22T00:15:00Z','2026-10-22T00:00:00Z',1000)).toBe(899);
  expect(remainingBookingSeconds('2026-10-22T00:15:00Z','2026-10-22T00:00:00Z',900001)).toBe(0);
 });
});
