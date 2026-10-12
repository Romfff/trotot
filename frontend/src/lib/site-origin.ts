// Reuse the configured server origin; never accept Host/query input as a canonical domain.
export function siteOrigin(configured?: string): string | undefined {
  try {
    const url = new URL(configured || "");
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      && url.pathname === "/" && !url.search && !url.hash) return url.origin;
  } catch { /* Missing/invalid configuration cannot publish canonical URLs. */ }
}
