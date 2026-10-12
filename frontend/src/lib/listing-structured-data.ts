import type { PublicListingItem } from "@/types/listing";
import { httpMediaUrl, listingDetailHref, listingDisplayTitle, listingDisplayDescription } from "@/lib/listing-links";
import { siteOrigin } from "@/lib/site-origin";

export function listingStructuredData(room: PublicListingItem, configuredOrigin?: string): string | undefined {
  const origin = siteOrigin(configuredOrigin);
  if (!origin) return;
  const url = new URL(listingDetailHref(room.slug), origin).href;
  const type = { PHONG_TRO: "Room", CHUNG_CU_MINI: "Apartment", NHA_NGUYEN_CAN: "House", O_GHEP: "Accommodation" }[room.propertyType];
  const images = [...room.images].sort((a, b) => a.sortOrder - b.sortOrder)
    .map(image => httpMediaUrl(image.url)).filter(Boolean);
  const property = {
    "@type": type, "@id": `${url}#accommodation`, url, name: listingDisplayTitle(room.title), description: listingDisplayDescription(room.description),
    address: { "@type": "PostalAddress", streetAddress: room.addressDetail,
      ...(room.ward ? { addressLocality: room.ward.name, addressRegion: room.ward.province.name } : {}) },
    ...(Number.isFinite(room.areaSqm) && room.areaSqm > 0 ? {
      floorSize: { "@type": "QuantitativeValue", value: room.areaSqm, unitCode: "MTK" },
    } : {}),
    petsAllowed: room.allowPets, ...(images.length ? { image: images } : {}),
  };
  const breadcrumb = {
    "@type": "BreadcrumbList", "@id": `${url}#breadcrumb`, itemListElement: [
      { "@type": "ListItem", position: 1, name: "Trang chủ", item: `${origin}/` },
      { "@type": "ListItem", position: 2, name: "Thuê trọ dài hạn", item: `${origin}/thue-phong-tro` },
      { "@type": "ListItem", position: 3, name: "Chi tiết phòng", item: url },
    ],
  };
  // Host text is literal JSON data, never a closing script tag or executable HTML.
  return JSON.stringify({ "@context": "https://schema.org", "@graph": [property, breadcrumb] }).replace(/</g, "\\u003c");
}
