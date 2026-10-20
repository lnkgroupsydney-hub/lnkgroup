import type { Metadata } from "next";
import { isPublicSearchEnvironment, privateRobots, publicPagePaths, publicPageUrl } from "./search-policy.ts";

export function publicPageSearchMetadata(path: typeof publicPagePaths[number]): Metadata {
  if (!isPublicSearchEnvironment()) return { robots: privateRobots };
  const url = publicPageUrl(path);
  return {
    robots: { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: { url },
  };
}
