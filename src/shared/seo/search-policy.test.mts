import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { isPublicSearchEnvironment, publicImagePaths, publicPagePaths, searchHeaders } from "./search-policy.ts";
import { publicPageSearchMetadata } from "./metadata.ts";
import robots from "../../app/robots.ts";
import sitemap from "../../app/sitemap.ts";

const require = createRequire(import.meta.url);
const { getPathMatch } = require("next/dist/shared/lib/router/utils/path-match");
const { matchHas } = require("next/dist/shared/lib/router/utils/prepare-destination");
const production = { VERCEL_ENV: "production", NODE_ENV: "production" };
const canonicalHost = "www.lnkgroupsydney.com.au";

function header(path: string, host = canonicalHost, env: Record<string, string | undefined> = production) {
  const url = new URL(path, `https://${host}`);
  let value: string | undefined;
  for (const rule of searchHeaders(env)) {
    if (!getPathMatch(rule.source)(url.pathname)) continue;
    if ("has" in rule && !matchHas({ headers: { host }, cookies: {} }, Object.fromEntries(url.searchParams), rule.has)) continue;
    value = rule.headers.find((entry) => entry.key === "X-Robots-Tag")?.value;
  }
  return value;
}

test("only a non-conflicting production deployment opens search, never a production Node build alone", () => {
  assert.equal(isPublicSearchEnvironment(production), true);
  assert.equal(isPublicSearchEnvironment({ ...production, VERCEL_TARGET_ENV: "production" }), true);
  for (const env of [
    {}, { NODE_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" },
    { VERCEL_ENV: "Production" }, { VERCEL_ENV: "staging" },
    { ...production, VERCEL_TARGET_ENV: "preview" }, { ...production, VERCEL_TARGET_ENV: "custom" },
    { ...production, NODE_ENV: "development" },
  ]) {
    assert.equal(isPublicSearchEnvironment(env), false, JSON.stringify(env));
    assert.equal(header("/", canonicalHost, env), "noindex, nofollow");
    assert.equal(header("/images/story/kitchen-finished.webp", canonicalHost, env), "noindex, nofollow");
  }
});

test("actual Next route/host matching opens exactly the public documents and registered images", () => {
  for (const path of [...publicPagePaths, ...publicImagePaths]) {
    assert.equal(header(path), "index, follow", path);
  }
  assert.equal(header("/?utm_source=chatgpt.com"), "index, follow");
  assert.equal(header("/services/cabinet-painting?utm_source=google"), "index, follow");
  for (const host of ["localhost", "127.0.0.1", "lnkgroupsydney.com.au", "preview.vercel.app", "wwwXlnkgroupsydneyXcomXau", `${canonicalHost}.evil.invalid`]) {
    assert.equal(header("/", host), "noindex, nofollow", host);
    assert.equal(header(publicImagePaths[0], host), "noindex, nofollow", host);
  }
});

test("admin, customer documents, unregistered assets and future pages retain the default HTTP exclusion", () => {
  for (const path of [
    "/admin", "/admin/customers", "/quote/start?service=cabinet-painting", "/quote/start?mode=demo",
    "/api/quote/requests", "/api/quote/requests/photos/private-id/content",
    "/api/quote/photos/private-id/content", "/api/quote/requests/booking/documents/receipt",
    "/api/admin/quote-requests/private-id/photos/private-photo", "/services/not-approved", "/not-found",
    "/images/not-registered.webp", "/images/story/quote%20photo/customer.jpg", "/images/story/kitchen-finished.webp/private",
  ]) assert.equal(header(path), "noindex, nofollow", path);
});

test("image optimizer exceptions match only an exact registered source after normal query decoding", () => {
  for (const path of publicImagePaths) {
    assert.equal(header(`/_next/image?url=${encodeURIComponent(path)}&w=640&q=75`), "index, follow", path);
  }
  for (const path of [
    "/api/quote/requests/photos/private/content", "/images/customer.jpg", "/images/home/cabinet-paintingXwebp",
    "https://www.lnkgroupsydney.com.au/images/home/cabinet-painting.webp",
    "/images/home/cabinet-painting.webp?token=private", "/images/home/cabinet-painting.webp/extra",
  ]) assert.equal(header(`/_next/image?url=${encodeURIComponent(path)}&w=640&q=75`), "noindex, nofollow", path);
  assert.equal(header("/_next/image?w=640&q=75"), "noindex, nofollow");
});

test("metadata and discovery output agree in production, preview and missing environments", () => {
  const original = { VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_TARGET_ENV: process.env.VERCEL_TARGET_ENV, NODE_ENV: process.env.NODE_ENV };
  try {
    for (const environment of ["production", "preview", "development", undefined]) {
      if (environment === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = environment;
      delete process.env.VERCEL_TARGET_ENV;
      process.env.NODE_ENV = "production";
      const open = environment === "production";
      const entries = sitemap();
      assert.deepEqual(entries.map((entry) => entry.url), open ? [
        "https://www.lnkgroupsydney.com.au/", "https://www.lnkgroupsydney.com.au/services/cabinet-painting",
      ] : []);
      const policy = robots();
      assert.deepEqual(policy.rules, open
        ? { userAgent: "*", allow: "/", disallow: ["/admin", "/quote", "/api"] }
        : { userAgent: "*", disallow: "/" });
      assert.equal(policy.sitemap, open ? "https://www.lnkgroupsydney.com.au/sitemap.xml" : undefined);
      for (const path of publicPagePaths) {
        const metadata = publicPageSearchMetadata(path);
        assert.deepEqual(metadata.robots, { index: open, follow: open });
        assert.equal(metadata.alternates?.canonical, open ? `https://www.lnkgroupsydney.com.au${path}` : undefined);
      }
    }
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
