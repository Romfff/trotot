import { describe, expect, it } from "vitest";
import { listingDisplayTitle, listingDisplayDescription } from "../src/lib/listing-links";

describe("listing display titles", () => {
  it("removes the fixture prefix only for presentation", () => {
    expect(listingDisplayTitle("[DEMO] Studio ban công")).toBe("Studio ban công");
    expect(listingDisplayTitle("  [demo]  Phòng trọ")).toBe("Phòng trọ");
  });
  it("preserves normal titles and markers inside the title", () => {
    for (const title of ["Phòng trọ", "Studio demo", "Studio [DEMO]", ""])
      expect(listingDisplayTitle(title)).toBe(title);
  });
  it("hides the seeded technical description, not genuine host content", () => {
    expect(listingDisplayDescription("LOCAL_DEMO_LISTINGS_V1\nDữ liệu mẫu chỉ để kiểm thử local.")).toBe("");
    expect(listingDisplayDescription("Phòng thoáng, có ban công.")).toBe("Phòng thoáng, có ban công.");
  });
});
