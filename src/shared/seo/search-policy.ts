import { siteAssets } from "../config/assets.ts";
import { siteConfig } from "../config/site.ts";

export const publicPagePaths = ["/", "/services/cabinet-painting"] as const;
export const publicImagePaths = Object.values(siteAssets).map((asset) => asset.src);
export const privateRobots = { index: false, follow: false } as const;

type SearchEnvironment = Readonly<Record<string, string | undefined>>;

// A production Node build also runs for Preview. Only the declared deployment
// environment can open indexing; conflicting or missing values stay closed.
export function isPublicSearchEnvironment(env: SearchEnvironment = process.env) {
  return env.VERCEL_ENV === "production"
    && (!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === "production")
    && env.NODE_ENV !== "development";
}

export function publicPageUrl(path: typeof publicPagePaths[number]) {
  return new URL(path, siteConfig.url).href;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function searchHeaders(env: SearchEnvironment = process.env) {
  const defaultRule = {
    source: "/:path*",
    headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
  };
  if (!isPublicSearchEnvironment(env)) return [defaultRule];

  const host = { type: "host" as const, value: escapeRegex(new URL(siteConfig.url).hostname) };
  const publicHeaders = [{ key: "X-Robots-Tag", value: "index, follow" }];
  return [
    defaultRule,
    ...[...publicPagePaths, ...publicImagePaths].map((source) => ({
      source,
      has: [host],
      headers: publicHeaders,
    })),
    {
      source: "/_next/image",
      has: [host, {
        type: "query" as const,
        key: "url",
        value: `(?:${publicImagePaths.map(escapeRegex).join("|")})`,
      }],
      headers: publicHeaders,
    },
  ];
}
