import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { galleryImages, ListingGallery } from "../src/components/listing/listing-gallery";
const photos = [
  { url: "https://media.invalid/second.jpg", position: 2, sortOrder: 2 },
  { url: "javascript:alert(1)", position: 0, sortOrder: 0 },
  { url: "https://media.invalid/first.jpg", position: 1, sortOrder: 1 },
];
describe("published listing gallery", () => {
  it("sorts valid media without mutating source data", () => {
    const before = JSON.stringify(photos);
    expect(galleryImages(photos).map(image => image.position)).toEqual([1, 2]);
    expect(JSON.stringify(photos)).toBe(before);
  });
  it.each([{ images: [] }, { images: [photos[1]] }])("shows an explicit empty state including rejected URLs", ({ images }) => {
    const html = renderToStaticMarkup(<ListingGallery title="Room" images={images} />);
    expect(html).toContain("Tin này chưa có hình ảnh.");
    expect(html).not.toContain("Ảnh sau");
  });
  it("does not add carousel controls for one photo", () => {
    const html = renderToStaticMarkup(<ListingGallery title="Room" images={[photos[0]]} />);
    expect(html).toContain("Room — ảnh 1");
    expect(html).not.toContain("Ảnh sau");
  });
  it("renders keyboard instructions and independently labeled thumbnails", () => {
    const html = renderToStaticMarkup(<ListingGallery title="Room" images={photos} />);
    expect(html).toContain('aria-label="Ảnh trước" aria-disabled="true"');
    expect(html).toContain("Dùng phím trái, phải");
    expect(html).toContain('aria-label="Xem ảnh 1" aria-pressed="true"');
    expect(html).toContain('aria-label="Xem ảnh 2" aria-pressed="false"');
    expect(html).not.toContain("javascript:");
  });
});
