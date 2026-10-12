import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminListingPhotos } from "../src/features/admin/listing-photos";

describe("Admin version-specific photo preview", () => {
  it("renders the pending photo order, without mutating the content", () => {
    const imageUrls = ["https://media.invalid/pending-b.jpg", "https://media.invalid/pending-a.jpg"];
    const before = JSON.stringify(imageUrls);
    const html = renderToStaticMarkup(<AdminListingPhotos title="Bản sửa chờ duyệt" imageUrls={imageUrls} />);
    expect(html).toContain("pending-b.jpg");
    expect(html.indexOf("pending-b.jpg")).toBeLessThan(html.indexOf("pending-a.jpg"));
    expect(html).toContain("Bản sửa chờ duyệt — ảnh 1");
    expect(html).toContain('aria-label="Xem ảnh 2"');
    expect(JSON.stringify(imageUrls)).toBe(before);
  });
  it("does not confuse the approved version with the pending version", () => {
    const html = renderToStaticMarkup(<><AdminListingPhotos title="Bản đã duyệt" imageUrls={["https://media.invalid/approved.jpg"]} />
      <AdminListingPhotos title="Bản sửa chờ duyệt" imageUrls={["https://media.invalid/pending.jpg"]} /></>);
    expect(html).toContain("Bản đã duyệt — ảnh 1");
    expect(html).toContain("Bản sửa chờ duyệt — ảnh 1");
    expect(html).toContain("approved.jpg"); expect(html).toContain("pending.jpg");
  });
  it.each([null, undefined, "not-an-array", [null, 7, "javascript:alert(1)", "data:text/html,evil"]])("fails safely with invalid media %j", imageUrls => {
    const html = renderToStaticMarkup(<AdminListingPhotos title="Tin" imageUrls={imageUrls} />);
    expect(html).toContain("Tin này chưa có hình ảnh.");
    expect(html).not.toContain("javascript:"); expect(html).not.toContain("data:text/html");
  });
  it("escapes the display title", () => {
    const html = renderToStaticMarkup(<AdminListingPhotos title="<script>window.x=1</script>" imageUrls={["https://media.invalid/photo.jpg"]} />);
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
  });
});
