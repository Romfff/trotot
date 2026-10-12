import { getPublicListing } from "@/lib/api/public-listing.server";

// Validate visibility before the segment loading boundary can commit HTTP200.
export default async function ListingLayout({ children, params }: {
  children: React.ReactNode; params: Promise<{ slug: string }>;
}) {
  await getPublicListing((await params).slug);
  return children;
}
