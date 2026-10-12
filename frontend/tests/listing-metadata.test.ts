import { expect, it } from "vitest";
import { listingMetadata } from "@/lib/listing-metadata";
import fixture from "./fixtures/public-listing.json";
import type { PublicListingItem } from "@/types/listing";

it("uses reviewed public content, configured canonical origin, and ordered safe media", () => {
  const room = { ...fixture, slug: "phòng/#?", images: [{ url: "javascript:alert(1)", sortOrder: 0, position: 0 },
    { url: "https://example.invalid/second.webp", sortOrder: 2, position: 2 },
    { url: "https://example.invalid/first.webp", sortOrder: 1, position: 1 }] } as PublicListingItem;
  const result = listingMetadata(room, "https://trotot.example");
  expect(result.alternates).toEqual({ canonical: "https://trotot.example/thue-phong-tro/ph%C3%B2ng%2F%23%3F" });
  expect(result.openGraph).toMatchObject({ title: `${room.title} | TroTot`, images: [{ url: "https://example.invalid/first.webp" }] });
  expect(result.twitter).toMatchObject({ card: "summary_large_image" });
  expect(JSON.stringify(result)).not.toContain("javascript:");
});
it("keeps unicode text, normalizes whitespace and limits description without inventing reviews/prices", () => {
  const result = listingMetadata({ ...fixture, title: " <script>literal</script>\n room ", description: "😀".repeat(170), images: [] } as PublicListingItem);
  expect(result.title).toBe("<script>literal</script> room");
  expect(result.description).toBe("😀".repeat(160));
  expect(result.twitter).toMatchObject({ card: "summary" });
  expect(result.alternates).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(/aggregateRating|priceCurrency/);
});
it("does not create canonical URLs from invalid, credentialed or non-origin configuration", () => {
  for (const origin of [undefined, "bad", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/path", "https://example.com/?q=x", "https://example.com/#x"]) {
    expect(listingMetadata(fixture as PublicListingItem, origin).alternates).toBeUndefined();
  }
});
