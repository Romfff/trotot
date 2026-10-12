import { PRESET_LOCATIONS } from "@/lib/listing-locations";
import type { SearchListingsParams, SearchListingsResponse } from "@/types/listing";

export interface ListingSearchSnapshot {
  id: string;
  params: SearchListingsParams;
  result: SearchListingsResponse;
  updatedAt: number;
}

export function listingSearchQuery(query: Pick<URLSearchParams, "get">): SearchListingsParams {
  const location = PRESET_LOCATIONS.find(item => item.id === query.get("location")) || PRESET_LOCATIONS[0];
  const page = Number(query.get("page") || "1");
  const requestedSort = query.get("sortBy") || "newest";
  const sortBy = ["newest", "price_asc", "price_desc", "distance_asc"].includes(requestedSort)
    && (requestedSort !== "distance_asc" || location.lat !== undefined) ? requestedSort : "newest";
  const params: SearchListingsParams = { page: Number.isInteger(page) && page >= 1 ? page : 1,
    limit: 20, sortBy: sortBy as SearchListingsParams["sortBy"] };
  for (const key of ["minPrice", "maxPrice", "minArea"] as const) {
    const raw = query.get(key);
    const value = Number(raw);
    if (raw && Number.isFinite(value) && (key === "minArea" ? value > 0 : value >= 0)) params[key] = value;
  }
  const amenities = query.get("amenities")?.trim();
  if (amenities) params.amenities = amenities;
  if (location.lat !== undefined && location.lng !== undefined) {
    params.lat = location.lat; params.lng = location.lng;
    const radius = Number(query.get("radius") || "5000");
    if (Number.isFinite(radius) && radius > 0) params.radius = Math.round(radius);
  }
  return params;
}
