import { expect, it } from "vitest";
import { listingSearchQuery } from "@/lib/listing-search-query";

it("maps URL filters to the existing public search contract identically on server/client", () => {
  expect(listingSearchQuery(new URLSearchParams("location=bk&minPrice=2000000&maxPrice=4000000&minArea=25&radius=3000&sortBy=price_asc&page=2&amenities=wifi,air_cond"))).toEqual({
    page: 2, limit: 20, sortBy: "price_asc", minPrice: 2000000, maxPrice: 4000000, minArea: 25,
    amenities: "wifi,air_cond", lat: 10.7725, lng: 106.6578, radius: 3000,
  });
});
it("retains free price boundaries, trims amenities and rounds a finite radius", () => {
  expect(listingSearchQuery(new URLSearchParams("location=q1&minPrice=0&maxPrice=0&minArea=0&radius=3000.6&amenities=%20wifi%20"))).toMatchObject({
    minPrice: 0, maxPrice: 0, radius: 3001, amenities: "wifi",
  });
});
it("rejects malformed numeric values rather than sending Infinity/NaN or negative filters", () => {
  for (const invalid of ["Infinity", "NaN", "-1", "wrong"]) {
    const params = listingSearchQuery(new URLSearchParams(`minPrice=${invalid}&maxPrice=${invalid}&minArea=${invalid}&page=${invalid}&location=bk&radius=${invalid}`));
    expect(params).not.toHaveProperty("minPrice");expect(params).not.toHaveProperty("maxPrice");expect(params).not.toHaveProperty("minArea");
    expect(params).not.toHaveProperty("radius");expect(params.page).toBe(1);
  }
});
it("unknown destinations/sorts fall back to existing all/newest; distance needs coordinates", () => {
  expect(listingSearchQuery(new URLSearchParams("location=unknown&sortBy=distance_asc&page=1.5"))).toEqual({page:1,limit:20,sortBy:"newest"});
  expect(listingSearchQuery(new URLSearchParams("sortBy=unknown"))).toEqual({page:1,limit:20,sortBy:"newest"});
  expect(listingSearchQuery(new URLSearchParams("location=bk&sortBy=distance_asc"))).toMatchObject({sortBy:"distance_asc",radius:5000});
});
it("duplicate query keys use the first value without mutating URL state", () => {
  const query = new URLSearchParams("maxPrice=3000000&maxPrice=4000000&page=2&page=3");const before=query.toString();
  expect(listingSearchQuery(query)).toMatchObject({maxPrice:3000000,page:2});expect(query.toString()).toBe(before);
});
