import type { NextConfig } from "next";
import { searchHeaders } from "./src/shared/seo/search-policy";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingIncludes: {
    '/api/**/*': ['./src/shared/assets/pdf-fonts/LKDemoSans-Regular.ttf'],
  },
  async headers() {
    return searchHeaders();
  },
};

export default nextConfig;
