import type { MetadataRoute } from "next";
import { siteConfig } from "../shared/config/site.ts";
import { isPublicSearchEnvironment } from "../shared/seo/search-policy.ts";

export default function robots(): MetadataRoute.Robots {
  if (!isPublicSearchEnvironment()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  // Search crawlers (including OAI-SearchBot) share the same private-route
  // restrictions. Authentication, ownership and no-store remain the protection.
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/quote", "/api"] },
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
