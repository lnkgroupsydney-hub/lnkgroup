import type { MetadataRoute } from "next";
import { isPublicSearchEnvironment, publicPagePaths, publicPageUrl } from "../shared/seo/search-policy.ts";

export default function sitemap(): MetadataRoute.Sitemap {
  return isPublicSearchEnvironment()
    ? publicPagePaths.map((path) => ({ url: publicPageUrl(path) }))
    : [];
}
