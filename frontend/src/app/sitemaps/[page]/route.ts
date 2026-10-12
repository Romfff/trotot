import { getPublicSearch } from "@/lib/api/public-listing.server";
import { listingDetailHref } from "@/lib/listing-links";
import { siteOrigin } from "@/lib/site-origin";
import { MAX_SITEMAP_PAGES, SITEMAP_PAGE_SIZE, sitemapXml, unavailableSitemap } from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ page: string }> }): Promise<Response> {
  const value = (await params).page;
  if (!/^(0|[1-9]\d*)\.xml$/.test(value) || Number.parseInt(value, 10) > MAX_SITEMAP_PAGES) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const page = Number.parseInt(value, 10);
  const origin = siteOrigin(process.env.FRONTEND_ORIGIN);
  if (!origin) return unavailableSitemap();
  if (page === 0) return sitemapXml("urlset", [`${origin}/`, `${origin}/thue-phong-tro`]);
  try {
    const result = await getPublicSearch({ page, limit: SITEMAP_PAGE_SIZE, sortBy: "newest" });
    if (!result.success || !Number.isSafeInteger(result.meta.totalPages) || result.meta.totalPages < 0 || result.meta.totalPages > MAX_SITEMAP_PAGES) return unavailableSitemap();
    if (page > result.meta.totalPages) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    return sitemapXml("urlset", [...new Set(result.data.map(room => new URL(listingDetailHref(room.slug), origin).href))]);
  } catch { return unavailableSitemap(); }
}
