import { createHash } from 'node:crypto'
import { createClient, type User } from '@supabase/supabase-js'
import { createServerClient, parseCookieHeader, serializeCookieHeader, type CookieOptions } from '@supabase/ssr'
import { authorizeAdmin } from '../application/authorize-admin.ts'
import { AdminAccessError } from '../domain/errors.ts'
import type { AdminMembership, AdminPermission, VerifiedAdminSession } from '../domain/contracts.ts'
import { assertLocalPreviewRequest } from '../domain/local-preview.ts'
import { localPreviewContext } from '../request.ts'
import { emailVerificationEnabled, parseEmailVerification, staffEmailAddress, staffEmailHash, type EmailVerificationState } from './email-verification.ts'

export const STAFF_COOKIE = 'lk-staff-auth'
export const STAFF_COMPANY = 'lk-group'
export const STAFF_SESSION_MS = 8 * 60 * 60 * 1000
export const staffAuthEnabled = () => process.env.STAFF_ADMIN_AUTH_ENABLED === 'true'
export const staffSessionHash = (id: string) => createHash('sha256').update(`staff:${id}`).digest('hex')

export function requireStaffRequest(req: Request) {
  if (!staffAuthEnabled() || process.env.OPERATIONS_STORE !== 'supabase') throw new AdminAccessError('ACCESS_UNAVAILABLE')
  assertLocalPreviewRequest(localPreviewContext(req))
}

function configuration() {
  if (typeof window !== 'undefined') throw new Error('Staff auth is server-only')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return { url, key }
}

const privateFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20_000) })
export function staffServiceClient() {
  const { url } = configuration()
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!secret) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: privateFetch } })
}

export function staffRequestClient(req: Request) {
  requireStaffRequest(req)
  const { url, key } = configuration()
  const jar = new Map(parseCookieHeader(req.headers.get('cookie') ?? '').map(item => [item.name, item.value]))
  const changed = new Map<string, { name: string; value: string; options: CookieOptions }>()
  const client = createServerClient(url, key, {
    cookieOptions: { name: STAFF_COOKIE, path: '/', httpOnly: true, sameSite: 'lax', secure: false },
    global: { fetch: privateFetch },
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll(items) {
        for (const item of items) { jar.set(item.name, item.value); changed.set(item.name, item) }
      },
    },
  })
  return {
    client,
    finish(response: Response) {
      response.headers.set('cache-control', 'private, no-store')
      response.headers.set('vary', 'Cookie')
      for (const item of changed.values()) response.headers.append('set-cookie', serializeCookieHeader(item.name, item.value, { ...item.options, path: '/', httpOnly: true, sameSite: 'lax', secure: false }))
      return response
    },
  }
}
export type StaffRequestContext = ReturnType<typeof staffRequestClient>

export type StaffMembership = AdminMembership & { passwordChangeRequired: boolean }
export function membershipFromUser(user: User): StaffMembership {
  // Only the fresh Auth server record is accepted here, never JWT or user_metadata.
  const value: unknown = user.app_metadata.lk_staff
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminAccessError('ACCESS_DENIED')
  const record = value as Record<string, unknown>
  if (record.company_id !== STAFF_COMPANY || (record.role !== 'owner' && record.role !== 'admin')
    || record.status !== 'active' || typeof user.app_metadata.lk_staff_password_change_required !== 'boolean') throw new AdminAccessError('ACCESS_DENIED')
  return { userId: user.id, companyId: STAFF_COMPANY, role: record.role, status: 'active', passwordChangeRequired: user.app_metadata.lk_staff_password_change_required }
}

export type StaffIdentity = {
  session: VerifiedAdminSession; user: User; membership: StaffMembership; tokenHash: string; expiresAt: number;
  emailVerification: EmailVerificationState | null;
}

export async function verifyStaffIdentity(context: StaffRequestContext, registered = true): Promise<StaffIdentity | null> {
  const { data: stored, error: storedError } = await context.client.auth.getSession()
  if (storedError) throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  if (!stored.session) return null
  // getSession supplies transport tokens only. Both identity and claims are verified.
  const token = stored.session.access_token
  const [{ data: verified, error: claimsError }, { data: account, error: userError }] = await Promise.all([
    context.client.auth.getClaims(token), context.client.auth.getUser(token),
  ])
  if (claimsError || userError) {
    const error = claimsError ?? userError
    throw new AdminAccessError(error?.status && error.status >= 500 ? 'ACCESS_UNAVAILABLE' : 'AUTHENTICATION_REQUIRED')
  }
  const claims = verified?.claims, user = account.user
  if (!claims || !user || !user.email_confirmed_at || user.is_anonymous || claims.sub !== user.id
    || claims.iss !== `${configuration().url.replace(/\/$/, '')}/auth/v1`
    || !(claims.aud === 'authenticated' || (Array.isArray(claims.aud) && claims.aud.includes('authenticated')))
    || typeof claims.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.session_id)
    || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()
    || (claims.aal !== 'aal1' && claims.aal !== 'aal2')) throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  const membership = membershipFromUser(user)
  const emailMode = emailVerificationEnabled()
  const email = emailMode ? staffEmailAddress(user.email) : undefined
  const service = staffServiceClient()
  const { data: active, error: activeError } = await service.rpc('lk_staff_session_active', { input_session_id: claims.session_id, input_user_id: user.id })
  if (activeError) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  if (active !== true) throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  const tokenHash = staffSessionHash(claims.session_id)
  let expiresAt = Date.now() + STAFF_SESSION_MS
  let emailVerification: EmailVerificationState | null = null
  if (registered) {
    const { data: row, error } = await service.from('lk_sessions').select('mode,account_sub,expires_at').eq('token_hash', tokenHash).maybeSingle()
    if (error) throw new AdminAccessError('ACCESS_UNAVAILABLE')
    if (!row || row.mode !== 'staff' || row.account_sub !== user.id || typeof row.expires_at !== 'number'
      || !Number.isFinite(row.expires_at) || row.expires_at <= Date.now()) throw new AdminAccessError('AUTHENTICATION_REQUIRED')
    expiresAt = row.expires_at
    if (email) {
      const { data, error: emailError } = await service.rpc('lk_staff_email_command', { command: 'status', args: { token_hash: tokenHash, user_id: user.id, email_hash: staffEmailHash(email) } })
      if (emailError) throw new AdminAccessError('ACCESS_UNAVAILABLE')
      emailVerification = parseEmailVerification(data)
    }
  }
  // Unenrolling a factor can leave an old aal2 JWT valid until refresh. The
  // current Auth record must still contain the verified factor we support.
  const hasFactor = user.factors?.some(f => f.factor_type === 'totp' && f.status === 'verified')
  const sessionExpiresAt = Math.min(claims.exp * 1000, expiresAt)
  const verifiedUntil = emailVerification?.verifiedUntil
  const proof = typeof verifiedUntil === 'number' && verifiedUntil > Date.now()
    ? { userId: user.id, sessionId: claims.session_id, expiresAt: Math.min(verifiedUntil, sessionExpiresAt) } : undefined
  return { user, membership, tokenHash, expiresAt, emailVerification, session: { userId: user.id, sessionId: claims.session_id, expiresAt: sessionExpiresAt, assurance: claims.aal === 'aal2' && hasFactor ? 'aal2' : 'aal1', ...(proof ? { emailVerification: proof } : {}) } }
}

export async function requiredIdentity(context: StaffRequestContext) {
  const identity = await verifyStaffIdentity(context)
  if (!identity) throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  return identity
}

export async function requiredReadyIdentity(context: StaffRequestContext) {
  const identity = await requiredIdentity(context)
  if (identity.membership.passwordChangeRequired) throw new AdminAccessError('ACCESS_DENIED')
  if (emailVerificationEnabled() && !identity.session.emailVerification) throw new AdminAccessError('EMAIL_VERIFICATION_REQUIRED')
  await authorizeAdmin({ verifySession: async () => identity.session, findMembership: async () => identity.membership, now: Date.now }, { companyId: STAFF_COMPANY, permission: 'operations.read' })
  return identity
}

export async function requireStaffAdmin(req: Request, permission: AdminPermission = 'operations.read') {
  try {
    const identity = await requiredIdentity(staffRequestClient(req))
    if (identity.membership.passwordChangeRequired) throw new AdminAccessError('ACCESS_DENIED')
    if (emailVerificationEnabled() && (!identity.session.emailVerification || identity.session.emailVerification.expiresAt <= Date.now())) throw new AdminAccessError('EMAIL_VERIFICATION_REQUIRED')
    const grant = await authorizeAdmin({ verifySession: async () => identity.session, findMembership: async () => identity.membership, now: Date.now }, { companyId: STAFF_COMPANY, permission })
    return { ...grant, tokenHash: identity.tokenHash, expiresAt: identity.expiresAt }
  } catch (error) {
    if (error instanceof AdminAccessError) throw error
    throw new AdminAccessError('ACCESS_UNAVAILABLE')
  }
}

export function staffStatus(identity: StaffIdentity | null) {
  if (!identity) return { authenticated: false, stage: 'signed_out' as const }
  if (emailVerificationEnabled()) {
    const verified = identity.session.emailVerification && identity.session.emailVerification.expiresAt > Date.now()
    const stage = identity.membership.passwordChangeRequired ? 'password_change' : verified ? 'ready' : 'email_verify'
    return { authenticated: true, stage, email: identity.user.email,
      ...(identity.emailVerification ? { emailVerification: { sent: identity.emailVerification.sent, expiresAt: identity.emailVerification.expiresAt, retryAt: identity.emailVerification.retryAt } } : {}) }
  }
  const factors = (identity.user.factors ?? []).filter(f => f.factor_type === 'totp' && f.status === 'verified').map(f => ({ id: f.id, friendlyName: f.friendly_name ?? 'Authenticator' }))
  const stage = identity.membership.passwordChangeRequired ? 'password_change' : identity.session.assurance === 'aal2' ? 'ready' : factors.length ? 'mfa_verify' : 'mfa_enroll'
  return { authenticated: true, stage, email: identity.user.email, factors }
}
