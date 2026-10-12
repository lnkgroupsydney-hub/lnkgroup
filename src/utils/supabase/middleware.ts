import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { staffRequestTransport } from '../../modules/admin-access/request.ts';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const staff = process.env.STAFF_ADMIN_AUTH_ENABLED === 'true';
  let secure = false;
  if (staff) {
    // Do not refresh credentials on an alias or an untrusted proxy authority.
    // The staff API/boundary will return its ordinary address error.
    try { secure = staffRequestTransport(request).secure; }
    catch { response.headers.set('cache-control', 'private, no-store'); return response; }
  }
  const supabase = createServerClient(url, key, {
    ...(staff ? { cookieOptions: { name: 'lk-staff-auth', path: '/', httpOnly: true, sameSite: 'lax' as const, secure } } : {}),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
  await supabase.auth.getClaims();
  if (staff) {
    response.headers.set('cache-control', 'private, no-store');
  }
  return response;
}
