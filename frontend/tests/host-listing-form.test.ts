import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/api/client", () => ({ managementRequest: vi.fn() }));
import { listingFormPayload, listingFormValues, type OwnListing } from "../src/lib/api/host-listings";
const form = () => {
  const data = new FormData();
  Object.entries({ title: " Phòng thử ", propertyType: "PHONG_TRO", description: "Mô tả", provinceCode: "01", wardCode: "00001", latitude: "10.7725", longitude: "106.7", monthlyPrice: "3500000", depositAmount: "0", areaSqm: "25.5", electricityCost: "3500", waterCost: "20000", waterUnit: "M3", internetCost: "0", garbageCost: "0", parkingFee: "0", contactPhone: "0990000000" }).forEach(([key, value]) => data.set(key, value));
  return data;
};
describe("Host form preserves real listing contract", () => {
  it("preserves string address codes and ordered media; never sends client ownership/state", () => {
    const data = form(); data.append("amenityIds", "wifi"); data.append("amenityIds", "air_cond"); data.set("allowPets", "on"); data.set("hostId", "forged"); data.set("status", "PUBLISHED");
    const payload = listingFormPayload(data, ["https://example.test/second", "https://example.test/first"]);
    expect(payload).toMatchObject({ title: "Phòng thử", provinceCode: "01", wardCode: "00001", latitude: 10.7725, monthlyPrice: 3500000, depositAmount: 0, areaSqm: 25.5, videoUrl: null, allowPets: true, amenityIds: ["wifi", "air_cond"], imageUrls: ["https://example.test/second", "https://example.test/first"] });
    expect(payload).not.toHaveProperty("hostId"); expect(payload).not.toHaveProperty("status"); expect(payload).not.toHaveProperty("districtCode"); expect(payload).not.toHaveProperty("contactZalo");
  });
  it.each(["", " ", "NaN", "Infinity", "1e5", "1,000"])("does not silently convert invalid money %j to zero", value => {
    const data = form(); data.set("garbageCost", value); expect(() => listingFormPayload(data)).toThrow("Kiểm tra lại");
  });
  it("starts from revision and never drops reviewed media during full replacement", () => {
    const record = { title: "Bản đã duyệt", latitude: "10.5", images: [{ url: "https://example.test/b", position: 1 }, { url: "https://example.test/a", position: 0 }], amenities: [{ amenityId: "wifi" }], longTermDetail: { monthlyPrice: "3500000.00", allowPets: false }, revision: null } as unknown as OwnListing;
    expect(listingFormValues(record)).toMatchObject({ title: "Bản đã duyệt", monthlyPrice: "3500000.00", allowPets: false, imageUrls: ["https://example.test/a", "https://example.test/b"] });
    record.revision = { status: "PENDING_REVIEW", content: { title: "Bản sửa", imageUrls: ["https://example.test/pending"] } as never };
    expect(listingFormValues(record)).toMatchObject({ title: "Bản sửa", imageUrls: ["https://example.test/pending"] });
  });
  it("validates and rounds hidden coordinates without altering the listing DTO",()=>{
    const data=form();data.set("latitude","10.77251265");data.set("longitude","106.65781234");
    expect(listingFormPayload(data)).toMatchObject({latitude:10.772513,longitude:106.657812});
    data.set("latitude","11.5564");data.set("longitude","104.9282");expect(()=>listingFormPayload(data)).toThrow("Việt Nam");
    data.set("latitude","");expect(()=>listingFormPayload(data)).toThrow("Kiểm tra lại");
  });
});
