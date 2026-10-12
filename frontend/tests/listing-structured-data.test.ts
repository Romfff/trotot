import { expect, it } from "vitest";
import { listingStructuredData } from "@/lib/listing-structured-data";
import fixture from "./fixtures/public-listing.json";
import type { PublicListingItem } from "@/types/listing";

const origin = "https://trotot.example";
const room = fixture as PublicListingItem;

it("maps existing public property types without turning a listing into an executed rent action/business", () => {
  for (const [propertyType, schemaType] of Object.entries({ PHONG_TRO: "Room", CHUNG_CU_MINI: "Apartment", NHA_NGUYEN_CAN: "House", O_GHEP: "Accommodation" })) {
    const data = JSON.parse(listingStructuredData({ ...room, propertyType: propertyType as PublicListingItem["propertyType"] }, origin)!);
    expect(data["@graph"][0]).toMatchObject({ "@type": schemaType, name: room.title, description: room.description,
      floorSize: { value: 25, unitCode: "MTK" }, petsAllowed: false,
      address: { streetAddress: room.addressDetail, addressLocality: room.ward!.name, addressRegion: room.ward!.province.name } });
    expect(data["@graph"][1]).toMatchObject({ "@type": "BreadcrumbList", itemListElement: [
      { position: 1, item: origin + "/" }, { position: 2, item: origin + "/thue-phong-tro" },
      { position: 3, item: origin + "/thue-phong-tro/" + room.slug },
    ] });
    expect(JSON.stringify(data)).not.toMatch(/offers|aggregateRating|review|availability|potentialAction|LodgingBusiness|RentAction|Product/);
  }
});
it("escapes script terminators while preserving literal host text after JSON parsing", () => {
  const payload = '</script><script id="json-xss">window.xss=1</script>\u003c<!-- & 🏠';
  const serialized = listingStructuredData({ ...room, title: payload, description: payload, addressDetail: payload }, origin)!;
  expect(serialized).not.toContain("<");expect(serialized).not.toContain("</script>");
  expect(JSON.parse(serialized)["@graph"][0]).toMatchObject({ name: payload, description: payload, address: { streetAddress: payload } });
});
it("uses ordered safe media and encoded canonical segments", () => {
  const data = JSON.parse(listingStructuredData({ ...room, slug: "phòng/#?", images: [
    { url: "javascript:alert(1)", sortOrder: 0, position: 0 },
    { url: "https://example.invalid/second.webp", sortOrder: 2, position: 2 },
    { url: "https://example.invalid/first.webp", sortOrder: 1, position: 1 },
  ] }, origin)!)["@graph"][0];
  expect(data.url).toBe(origin + "/thue-phong-tro/ph%C3%B2ng%2F%23%3F");
  expect(data.image).toEqual(["https://example.invalid/first.webp", "https://example.invalid/second.webp"]);
});
it("omits unknown administrative names/images/invalid dimensions instead of inventing data", () => {
  const data = JSON.parse(listingStructuredData({ ...room, ward: null, images: [], areaSqm: NaN }, origin)!)["@graph"][0];
  expect(data.address).toEqual({ "@type": "PostalAddress", streetAddress: room.addressDetail });
  expect(data).not.toHaveProperty("image");expect(data).not.toHaveProperty("floorSize");
});
it("omits JSON-LD when canonical origin is missing/invalid", () => {
  for (const value of [undefined, "bad", "javascript:alert(1)", "https://u:p@example.com", "https://example.com/path", "https://example.com/?x=1"]) {
    expect(listingStructuredData(room, value)).toBeUndefined();
  }
});
