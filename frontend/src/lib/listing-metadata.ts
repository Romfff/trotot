import type { Metadata } from "next";
import { siteOrigin } from "@/lib/site-origin";
import type { PublicListingItem } from "@/types/listing";
import { httpMediaUrl, listingDetailHref, listingDisplayTitle, listingDisplayDescription } from "@/lib/listing-links";

export function listingMetadata(room: PublicListingItem, configuredOrigin?: string): Metadata {
  const title = listingDisplayTitle(room.title).replace(/\s+/g, " ").trim();
  const description = Array.from(listingDisplayDescription(room.description).replace(/\s+/g, " ").trim()).slice(0, 160).join("");
  const origin = siteOrigin(configuredOrigin);
  const url = origin ? new URL(listingDetailHref(room.slug), origin).href : undefined;
  const image = [...room.images].sort((a, b) => a.sortOrder - b.sortOrder)
    .map(item => httpMediaUrl(item.url)).find(Boolean);
  return {
    title, description,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: { type: "website", title: `${title} | TroTot`, description,
      ...(url ? { url } : {}), ...(image ? { images: [{ url: image, alt: title }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title: `${title} | TroTot`, description,
      ...(image ? { images: [image] } : {}) },
  };
}
