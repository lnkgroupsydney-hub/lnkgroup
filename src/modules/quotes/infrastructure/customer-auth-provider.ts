import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { QuoteRequestError } from '../domain/contracts.ts'
import type { CustomerAuthProvider, VerifiedQuoteCustomer } from '../domain/customer-auth.ts'
import { privateQuoteClient } from './media-store.ts'
function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new QuoteRequestError(503, 'Customer email verification is not configured.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) }) } })
}
const unavailable = () => new QuoteRequestError(503, 'Customer email verification is temporarily unavailable. Your saved quote remains safe.')
async function identity(auth: SupabaseClient, token: string, known?: User | null): Promise<VerifiedQuoteCustomer> {
  const [{ data: account, error: userError }, { data: verified, error: claimsError }] = await Promise.all([auth.auth.getUser(token), auth.auth.getClaims(token)])
  if (userError || claimsError) {
    if ((userError?.status ?? claimsError?.status ?? 0) >= 500) throw unavailable()
    throw new QuoteRequestError(401, 'Your customer session expired. Verify your email again.')
  }
  const user = account.user, claims = verified?.claims, url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!user || (known && known.id !== user.id) || !user.email || !user.email_confirmed_at || user.is_anonymous || !claims
    || claims.sub !== user.id || claims.iss !== `${url?.replace(/\/$/, '')}/auth/v1`
    || !(claims.aud === 'authenticated' || (Array.isArray(claims.aud) && claims.aud.includes('authenticated')))
    || typeof claims.session_id !== 'string' || !/^[a-f0-9-]{36}$/i.test(claims.session_id)
    || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new QuoteRequestError(401, 'Verify your email to reopen saved quotes.')
  const { data: active, error } = await privateQuoteClient().rpc('lk_quote_customer_auth_session_active', { input_session_id: claims.session_id, input_user_id: user.id })
  if (error) throw unavailable()
  if (active !== true) throw new QuoteRequestError(401, 'Your customer session ended. Verify your email again.')
  return { userId: user.id, email: user.email.toLowerCase(), authSessionId: claims.session_id, accessToken: token, expiresAt: Math.min(claims.exp * 1000, Date.now() + 3600000) }
}
export const customerAuthProvider: CustomerAuthProvider = {
  async send(email) {
    const { error } = await client().auth.signInWithOtp({ email, options: { shouldCreateUser: true } })
    if (error?.status === 429) throw new QuoteRequestError(429, 'Please wait before requesting another verification code.')
    if (error) throw unavailable()
  },
  async verify(email, token) {
    const auth = client(), { data, error } = await auth.auth.verifyOtp({ email, token, type: 'email' })
    if (error || !data.session) {
      if (error?.status === 429) throw new QuoteRequestError(429, 'Too many verification attempts. Request a new code after the cooldown.')
      if ((error?.status ?? 0) >= 500) throw unavailable()
      throw new QuoteRequestError(401, 'The verification code is incorrect, expired or already used.')
    }
    return identity(auth, data.session.access_token, data.user)
  },
  async identity(token) { return identity(client(), token) },
}
export const customerAuthStore = {
  async command<T>(command: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await privateQuoteClient().rpc('lk_quote_customer_command', { command, args })
    if (error) {
      const status = ({ LK400: 400, LK401: 401, LK403: 403, LK404: 404, LK409: 409, LK429: 429 } as Record<string, number>)[error.code]
      throw new QuoteRequestError(status ?? 503, status ? error.message : 'Customer email verification storage is temporarily unavailable.')
    }
    return data as T
  },
}
