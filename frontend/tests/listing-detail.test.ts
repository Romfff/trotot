import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ListingDetailPage, { generateMetadata } from "../src/app/thue-phong-tro/[slug]/page";
import RoomCard from "@/components/RoomCard";
import { listingsApi, ListingApiError } from "@/lib/api/listings";
import { httpMediaUrl, listingDetailHref } from "@/lib/listing-links";
import fixture from "./fixtures/public-listing.json";
import type { PublicListingItem } from "@/types/listing";

vi.mock("@/lib/api/listings", async (original) => ({
  ...await original<typeof import("@/lib/api/listings")>(),
  listingsApi: { getBySlug: vi.fn() },
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));
const listing = fixture as PublicListingItem;
beforeEach(() => { vi.mocked(listingsApi.getBySlug).mockReset(); });

it("links the real card to the implemented slug route and encodes a path segment", () => {
  const html = renderToStaticMarkup(createElement(RoomCard, { room: { ...listing, slug: "phòng/#?" } }));
  expect(html).toContain(`href="${listingDetailHref("phòng/#?")}"`);
  expect(listingDetailHref("phòng/#?")).toBe("/thue-phong-tro/ph%C3%B2ng%2F%23%3F");
});

it("does not imply ownership verification even when the response contains isVerified", () => {
  const html = renderToStaticMarkup(createElement(RoomCard, { room: { ...listing, isVerified: true } }));
  expect(html).not.toContain("Chính chủ");
  expect(html).toContain("3.500.000");
});

it("card rejects active media schemes without substituting unrelated photos", () => {
  const html = renderToStaticMarkup(createElement(RoomCard, { room: { ...listing,
    images: [{url:"javascript:alert(1)",position:0,sortOrder:0}] } }));
  expect(html).not.toContain("javascript:");
  expect(html).toContain("Chưa có hình ảnh");
});

it("detail preserves person names and renders availability without a verification claim", async () => {
  vi.mocked(listingsApi.getBySlug).mockResolvedValue({ ...listing, isVerified:true,
    host:{fullName:"[DEMO] Tên người kiểm thử",avatarUrl:null} });
  const html=renderToStaticMarkup(await ListingDetailPage({params:Promise.resolve({slug:listing.slug})}));
  expect(html).toContain("[DEMO] Tên người kiểm thử");
  expect(html).toContain("Còn phòng");
  expect(html).not.toContain("Chính chủ");
  expect(html).not.toContain("bg-soft-green");
  expect(html).not.toContain("border-line");
});

it("loads the requested slug and renders real fees/amenities without fixture fallback", async () => {
  vi.mocked(listingsApi.getBySlug).mockResolvedValue({ ...listing, title: '<img src=x onerror="alert(1)">' });
  const page = await ListingDetailPage({ params: Promise.resolve({ slug: listing.slug }) });
  const html = renderToStaticMarkup(page);
  expect(listingsApi.getBySlug).toHaveBeenCalledWith(listing.slug, {});
  expect(html).toContain("30.000 đ / phòng / tháng");
  expect(html).toContain("20.000 đ / người");
  expect(html).toContain("Wi-Fi");
  expect(html).not.toContain("Máy lạnh");
  expect(html).not.toContain('<img src=x onerror="alert(1)">');
  expect(html).toContain("&lt;img");
  expect(html).not.toContain('href="tel:');
});

it("returns not-found for a missing/hidden listing rather than showing a demo", async () => {
  vi.mocked(listingsApi.getBySlug).mockRejectedValue(new ListingApiError(404, "PROPERTY_NOT_FOUND", "not found"));
  await expect(ListingDetailPage({ params: Promise.resolve({ slug: "hidden" }) })).rejects.toThrow("NEXT_NOT_FOUND");
});

it("keeps server/network failure as an error rather than a false not-found", async () => {
  vi.mocked(listingsApi.getBySlug).mockRejectedValue(new ListingApiError(503, "RATE_LIMIT_UNAVAILABLE", "unavailable"));
  await expect(ListingDetailPage({ params: Promise.resolve({ slug: listing.slug }) })).rejects.toMatchObject({ status: 503 });
});

it("does not allow active schemes or malformed URLs in listing media", () => {
  expect(httpMediaUrl("javascript:alert(1)")).toBeNull();
  expect(httpMediaUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  expect(httpMediaUrl("not a URL")).toBeNull();
  expect(httpMediaUrl(null)).toBeNull();
  expect(httpMediaUrl("https://example.invalid/photo.webp")).toBe("https://example.invalid/photo.webp");
});

it("metadata uses the same public API gate: hidden is404 and service failure stays an error", async () => {
  vi.mocked(listingsApi.getBySlug).mockRejectedValue(new ListingApiError(404, "PROPERTY_NOT_FOUND", "not found"));
  await expect(generateMetadata({ params: Promise.resolve({ slug: "hidden" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  vi.mocked(listingsApi.getBySlug).mockRejectedValue(new ListingApiError(503, "RATE_LIMIT_UNAVAILABLE", "unavailable"));
  await expect(generateMetadata({ params: Promise.resolve({ slug: listing.slug }) })).rejects.toMatchObject({ status: 503 });
});
