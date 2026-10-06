import type { NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin-auth/:path*", "/api/operations/:path*", "/api/google/:path*", "/api/enquiries"],
};
