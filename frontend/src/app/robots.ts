import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site-origin";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin(process.env.FRONTEND_ORIGIN);
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/account", "/admin", "/api/", "/login", "/register",
      "/verify-otp", "/forgot-password", "/reset-password", "/homestay", "/phong-tro/", "/checkout", "/bookings", "/host", "/my-appointments", "/notifications"] },
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
