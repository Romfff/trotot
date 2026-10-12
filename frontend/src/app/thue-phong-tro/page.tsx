import { randomUUID } from "node:crypto";
import ListingSearch from "@/components/listing/ListingSearch";
import { getPublicSearch } from "@/lib/api/public-listing.server";
import { listingSearchQuery } from "@/lib/listing-search-query";

export const dynamic = "force-dynamic";

export default async function ThuePhongTroPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (value !== undefined) query.set(key, Array.isArray(value) ? value[0] : value);
  }
  const params = listingSearchQuery(query);
  const result = await getPublicSearch(params);
  return <ListingSearch initialSnapshot={{ id: randomUUID(), params, result, updatedAt: Date.now() }} />;
}
