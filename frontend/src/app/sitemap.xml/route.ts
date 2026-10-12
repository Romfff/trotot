import { getPublicSearch } from "@/lib/api/public-listing.server";
import { siteOrigin } from "@/lib/site-origin";
import { MAX_SITEMAP_PAGES, SITEMAP_PAGE_SIZE, sitemapXml, unavailableSitemap } from "@/lib/sitemap-xml";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const origin = siteOrigin(process.env.FRONTEND_ORIGIN);
  if (!origin) return unavailableSitemap();
  try {
    const result = await getPublicSearch({ page: 1, limit: SITEMAP_PAGE_SIZE, sortBy: "newest" });
    const pages = result.meta.totalPages;
    if (!result.success || !Number.isSafeInteger(pages) || pages < 0 || pages > MAX_SITEMAP_PAGES) return unavailableSitemap();
    return sitemapXml("sitemapindex", Array.from({ length: pages + 1 }, (_, page) => `${origin}/sitemaps/${page}.xml`));
  } catch { return unavailableSitemap(); }
}
