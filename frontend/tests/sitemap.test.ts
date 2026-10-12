import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as index } from "@/app/sitemap.xml/route";
import { GET as page } from "@/app/sitemaps/[page]/route";
import robots from "@/app/robots";
import { listingsApi } from "@/lib/api/listings";
import { sitemapXml } from "@/lib/sitemap-xml";
import rawFixture from "./fixtures/public-listing.json";
import type { PublicListingItem, SearchListingsResponse } from "@/types/listing";

const fixture: PublicListingItem = { ...rawFixture, propertyType: "PHONG_TRO", waterUnit: "PERSON" };

vi.mock("@/lib/api/listings", () => ({ listingsApi: { search: vi.fn() } }));
const search = vi.mocked(listingsApi.search);
const result = (pages = 2): SearchListingsResponse => ({ success: true, message: "Public API fixture", data: [fixture],
  meta: { page: 1, limit: 100, total: 101, totalPages: pages } });
const child = (value: string) => page(new Request("https://ignored.invalid"), { params: Promise.resolve({ page: value }) });

beforeEach(() => { vi.stubEnv("FRONTEND_ORIGIN", "https://trotot.example");search.mockReset();search.mockResolvedValue(result()); });
afterEach(() => { vi.unstubAllEnvs(); });

it("publishes a fresh index with static and all public pages without an API sweep", async () => {
  const response = await index();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
  const xml = await response.text();expect(xml).toContain("<sitemapindex");
  for (const id of [0,1,2]) expect(xml).toContain(`https://trotot.example/sitemaps/${id}.xml`);
  expect(search).toHaveBeenCalledExactlyOnceWith({ page: 1, limit: 100, sortBy: "newest" }, {});
  search.mockResolvedValue(result(0));expect(await (await index()).text()).not.toContain("sitemaps/1.xml");
});
it("keeps static URLs free of demo/auth/private/legacy routes and never reads API for them", async () => {
  expect(await (await child("0.xml")).text()).toContain("<loc>https://trotot.example/</loc>");
  expect(await (await child("0.xml")).text()).not.toMatch(/homestay|account|admin|login|phong-tro\//);
  expect(search).not.toHaveBeenCalled();
});
it("uses one current public page, canonical escaped slugs and no fabricated lastmod", async () => {
  search.mockResolvedValue({ ...result(), data: [{ ...fixture, slug: "room/&?#<>" }, { ...fixture, slug: "room/&?#<>" }] });
  const xml = await (await child("2.xml")).text();
  expect(search).toHaveBeenCalledExactlyOnceWith({ page: 2, limit: 100, sortBy: "newest" }, {});
  expect(xml).toContain("https://trotot.example/thue-phong-tro/room%2F%26%3F%23%3C%3E");
  expect((xml.match(/<loc>/g) || []).length).toBe(1);expect(xml).not.toContain("lastmod");
});
it("rejects noncanonical, invalid and out-of-range page identifiers", async () => {
  for (const value of ["-1.xml", "01.xml", "1", "1.xml?x=y", "50000.xml", "999999999999999999.xml"]) expect((await child(value)).status).toBe(404);
  expect(search).not.toHaveBeenCalled();expect((await child("3.xml")).status).toBe(404);
});
it("fails closed without a configured origin or during outage/malformed/oversize catalog", async () => {
  for (const origin of ["", "javascript:alert(1)", "https://u:p@example.com", "https://example.com/path"]) {
    vi.stubEnv("FRONTEND_ORIGIN", origin);expect((await index()).status).toBe(503);expect((await child("1.xml")).status).toBe(503);
    expect(robots()).not.toHaveProperty("sitemap");
  }
  expect(search).not.toHaveBeenCalled();vi.stubEnv("FRONTEND_ORIGIN", "https://trotot.example");
  search.mockRejectedValue(new Error("Internal fixture failure"));
  for (const response of [await index(), await child("1.xml")]) {
    expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.text()).not.toContain("Internal");
  }
  for (const pages of [-1, 1.5, NaN, Infinity, 50000]) { search.mockResolvedValue(result(pages));expect((await index()).status).toBe(503);expect((await child("1.xml")).status).toBe(503); }
  search.mockResolvedValue({ ...result(), success: false });expect((await child("1.xml")).status).toBe(503);
});
it("escapes XML text independently of URL encoding", async () => {
  expect(await sitemapXml("urlset", ['https://example.com/a?x=1&y="<>\'']).text()).toContain("&amp;y=&quot;&lt;&gt;&apos;");
});
it("points robots at the configured sitemap and excludes current private/demo paths", () => {
  expect(robots()).toMatchObject({ sitemap: "https://trotot.example/sitemap.xml", rules: { userAgent: "*", allow: "/" } });
  expect(robots().rules).toMatchObject({ disallow: expect.arrayContaining(["/account", "/admin", "/api/", "/homestay", "/phong-tro/", "/login", "/my-appointments", "/notifications"]) });
});
