"use client";

import { ListingGallery } from "@/components/listing/listing-gallery";

/** Reuse the public gallery for the exact photo order of each version under review. */
export function AdminListingPhotos({ title, imageUrls }: { title: string; imageUrls: unknown }) {
  const images = Array.isArray(imageUrls) ? imageUrls.flatMap((url, index) =>
    typeof url === "string" ? [{ url, position: index, sortOrder: index }] : []) : [];
  return <div className="mb-4"><ListingGallery title={title} images={images} /></div>;
}
