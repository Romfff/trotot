// Sitemap protocol: an index and each child contain at most 50,000 entries.
export const SITEMAP_PAGE_SIZE = 100; // Existing public search API maximum.
export const MAX_SITEMAP_PAGES = 49_999; // One index entry is reserved for static pages.

export function sitemapXml(kind: "sitemapindex" | "urlset", urls: string[]): Response {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[char]!);
  const element = kind === "sitemapindex" ? "sitemap" : "url";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<${kind} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `<${element}><loc>${escape(url)}</loc></${element}>`).join("\n")}
</${kind}>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export function unavailableSitemap(): Response {
  return new Response("Sitemap temporarily unavailable", { status: 503,
    headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
}
