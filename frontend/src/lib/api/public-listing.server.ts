import { cache } from "react";
import type { SearchListingsParams } from "@/types/listing";
import { publicReadHeaders } from "@/lib/api/public-read-headers.server";
import { notFound } from "next/navigation";
import { listingsApi, ListingApiError } from "@/lib/api/listings";

// Request-scoped RSC memoization; no persistent public-data cache across requests.
export const getPublicListing = cache(async (slug: string) => listingsApi.getBySlug(slug, await publicReadHeaders(`properties/${encodeURIComponent(slug)}`)).catch((error: unknown) => {
  if (error instanceof ListingApiError && error.status === 404) notFound();
  throw error;
}));


export async function getPublicSearch(params: SearchListingsParams) {
  return listingsApi.search(params, await publicReadHeaders("properties/long-term/search"));
}
