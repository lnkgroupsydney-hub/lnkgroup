import { createHash } from 'node:crypto'
import { isValidEmail } from '../../../shared/validation/input.ts'
import { AdminAccessError } from '../domain/errors.ts'
import {
  STAFF_SESSION_MS, requiredIdentity, requiredReadyIdentity, staffRequestClient, staffServiceClient,
  staffSessionHash, staffStatus, verifyStaffIdentity, type StaffRequestContext,
} from './staff-auth.ts'
import { emailVerificationEnabled, newStaffEmailCode, parseEmailVerification, sendStaffEmailCode, staffEmailAddress, staffEmailCodeHash, staffEmailHash } from './email-verification.ts'

class InputError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

function authRoute(handler: (req: Request, context: StaffRequestContext) => Promise<Response>) {
  return async (req: Request) => {
    let context: StaffRequestContext | undefined
    try {
      context = staffRequestClient(req)
      return context.finish(await handler(req, context))
    } catch (error) {
      const known = error instanceof AdminAccessError || error instanceof InputError
      const response = Response.json({ error: known ? error.message : 'Administrator access is temporarily unavailable.', ...(error instanceof AdminAccessError ? { code: error.code } : {}) }, { status: known ? error.status : 503, headers: { 'cache-control': 'private, no-store', vary: 'Cookie' } })
      return context ? context.finish(response) : response
    }
  }
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new InputError(415, 'JSON is required.')
  if (Number(req.headers.get('content-length') ?? 0) > 4096) throw new InputError(413, 'Request is too large.')
  const reader = req.body?.getReader()
  if (!reader) throw new InputError(400, 'Request body is required.')
  const chunks: Uint8Array[] = []; let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 4096) { await reader.cancel(); throw new InputError(413, 'Request is too large.') }
    chunks.push(value)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch { throw new InputError(400, 'Invalid request.') }
}

async function rateLimit(bucket: string, max: number, window: number) {
  const { error } = await staffServiceClient().rpc('lk_operations_command', { command: 'rate_limit', args: { bucket, max, window } })
  if (error) {
    if (error.code === 'LK429') throw new InputError(429, 'Too many attempts. Try again later.')
    throw new AdminAccessError('ACCESS_UNAVAILABLE')
  }
}

export const staffSessionGet = authRoute(async (_req, context) => Response.json(staffStatus(await verifyStaffIdentity(context))))

export const staffSessionsGet = authRoute(async (_req, context) => {
  const identity = await requiredReadyIdentity(context)
  const { data, error } = await staffServiceClient().rpc('lk_staff_sessions_command', {
    command: 'list', input_token_hash: identity.tokenHash, input_user_id: identity.user.id,
  })
  if (error?.message === 'STAFF_SESSION_REQUIRED') throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  if (error || !Number.isSafeInteger(data?.current?.expiresAt) || !Number.isSafeInteger(data?.otherSessionCount)
    || data.otherSessionCount < 0 || !Array.isArray(data.otherSessions) || data.otherSessions.length > 50
    || data.otherSessions.some((row: { expiresAt: number }) => !Number.isSafeInteger(row?.expiresAt))
    || data.truncated !== (data.otherSessionCount > data.otherSessions.length)) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return Response.json({ current: { expiresAt: data.current.expiresAt }, otherSessionCount: data.otherSessionCount,
    otherSessions: data.otherSessions.map((row: { expiresAt: number }) => ({ expiresAt: row.expiresAt })), truncated: data.truncated })
})

export const staffSessionsRevokeOthersPost = authRoute(async (req, context) => {
  const input = await body(req)
  if (Object.keys(input).length) throw new InputError(400, 'This request must contain an empty JSON object.')
  const identity = await requiredReadyIdentity(context)
  const { data, error } = await staffServiceClient().rpc('lk_staff_sessions_command', {
    command: 'revoke_others', input_token_hash: identity.tokenHash, input_user_id: identity.user.id,
  })
  if (error?.message === 'STAFF_SESSION_REQUIRED') throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  if (error || !Number.isSafeInteger(data?.removedSessionCount) || data.removedSessionCount < 0) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  // ESN access is already removed. Retrying this endpoint also retries provider
  // cleanup when there are no remaining registry rows, without changing ours.
  let cleanupComplete = false
  try { cleanupComplete = !(await context.client.auth.signOut({ scope: 'others' })).error } catch { /* Report the committed ESN removal separately. */ }
  return Response.json({ esnAccessRemoved: true, authCleanupComplete: cleanupComplete, removedSessionCount: data.removedSessionCount,
    ...(!cleanupComplete ? { code: 'AUTH_CLEANUP_PENDING', error: 'Other ESN sessions have lost access. Auth cleanup could not be confirmed; retry to finish cleanup. Your current session is still open.' } : {}) },
  { status: cleanupComplete ? 200 : 503 })
})

export const staffOperationsSessionGet = authRoute(async (_req, context) => {
  const identity = await verifyStaffIdentity(context), status = staffStatus(identity)
  if (status.stage !== 'ready' || !identity) return Response.json({ authenticated: false, mode: null, localLoginAvailable: false, googleConfigured: false })
  const missingConfiguration = [
    !process.env.GOOGLE_CLIENT_ID?.trim() && 'GOOGLE_CLIENT_ID',
    !process.env.GOOGLE_CLIENT_SECRET?.trim() && 'GOOGLE_CLIENT_SECRET',
    !/^[a-f0-9]{64}$/i.test(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? '') && 'GOOGLE_TOKEN_ENCRYPTION_KEY',
  ].filter((value): value is string => typeof value === 'string')
  return Response.json({ authenticated: true, mode: 'staff', ownerEmail: identity.user.email, staffRole: identity.membership.role,
    storage: 'supabase', localLoginAvailable: false, googleConfigured: missingConfiguration.length === 0, missingConfiguration })
})

export const staffLoginPost = authRoute(async (req, context) => {
  const input = await body(req)
  if (!isValidEmail(input.email)
    || typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 256) throw new InputError(400, 'Enter your email and password.')
  const email = input.email.trim().toLowerCase()
  await rateLimit(`staff-login:${createHash('sha256').update(email).digest('hex')}`, 8, 900_000)
  const { error } = await context.client.auth.signInWithPassword({ email, password: input.password })
  if (error) throw new InputError(error.status === 429 ? 429 : 401, 'Sign-in failed. Check your details or try again later.')
  try {
    const identity = await verifyStaffIdentity(context, false)
    if (!identity) throw new AdminAccessError('AUTHENTICATION_REQUIRED')
    const { error: saveError } = await staffServiceClient().rpc('lk_operations_command', { command: 'session_put', args: {
      token_hash: identity.tokenHash, mode: 'staff', account_sub: identity.user.id, expires_at: Date.now() + STAFF_SESSION_MS,
    } })
    if (saveError) throw new AdminAccessError('ACCESS_UNAVAILABLE')
    return Response.json(staffStatus(identity))
  } catch (error) {
    await context.client.auth.signOut({ scope: 'local' })
    throw error
  }
})

export const staffLogoutPost = authRoute(async (_req, context) => {
  // Logout also works for expired/revoked membership: remove only the session
  // identified by cryptographically verified claims, then clear local cookies.
  const { data } = await context.client.auth.getClaims()
  if (typeof data?.claims.session_id === 'string') {
    const { error } = await staffServiceClient().rpc('lk_operations_command', { command: 'session_delete', args: { token_hash: staffSessionHash(data.claims.session_id) } })
    if (error) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  }
  const { error } = await context.client.auth.signOut({ scope: 'local' })
  if (error) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return Response.json({ authenticated: false, stage: 'signed_out' })
})

export const staffPasswordPost = authRoute(async (req, context) => {
  const identity = await requiredIdentity(context)
  if (!identity.membership.passwordChangeRequired) throw new InputError(409, 'Initial password setup is already complete.')
  const input = await body(req)
  if (typeof input.password !== 'string' || input.password.length < 16 || input.password.length > 128) throw new InputError(400, 'Use a new password between 16 and 128 characters.')
  await rateLimit(`staff-password:${identity.user.id}`, 8, 900_000)
  const { error } = await context.client.auth.updateUser({ password: input.password })
  if (error) throw new InputError(400, 'The password could not be changed. Use a different password or sign in again.')
  // Update one independent server-owned flag, never a stale role/status object.
  const service = staffServiceClient()
  const { error: registryError } = await service.from('lk_sessions').delete().eq('mode', 'staff').eq('account_sub', identity.user.id).neq('token_hash', identity.tokenHash)
  if (registryError) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  const { error: signOutError } = await context.client.auth.signOut({ scope: 'others' })
  if (signOutError) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  const { error: metadataError } = await service.auth.admin.updateUserById(identity.user.id, { app_metadata: { lk_staff_password_change_required: false } })
  if (metadataError) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return Response.json({ updated: true })
})

export const staffMfaEnrollPost = authRoute(async (req, context) => {
  await body(req)
  const identity = await requiredIdentity(context)
  if (identity.membership.passwordChangeRequired) throw new AdminAccessError('ACCESS_DENIED')
  if (identity.user.factors?.some(f => f.status === 'verified')) throw new InputError(409, 'Use your registered authenticator to continue.')
  await rateLimit(`staff-mfa-enroll:${identity.user.id}`, 6, 900_000)
  // Remove only abandoned, unverified factors owned by this authenticated user.
  for (const factor of identity.user.factors ?? []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      const { error } = await context.client.auth.mfa.unenroll({ factorId: factor.id })
      if (error) throw new AdminAccessError('ACCESS_UNAVAILABLE')
    }
  }
  const { data, error } = await context.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'L&K administrator', issuer: 'L&K Group ESN' })
  if (error) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return Response.json({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
})

export const staffMfaVerifyPost = authRoute(async (req, context) => {
  const identity = await requiredIdentity(context)
  if (identity.membership.passwordChangeRequired) throw new AdminAccessError('ACCESS_DENIED')
  const input = await body(req)
  if (typeof input.factorId !== 'string' || !identity.user.factors?.some(f => f.id === input.factorId && f.factor_type === 'totp')
    || typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new InputError(400, 'Enter the six-digit code from your authenticator.')
  await rateLimit(`staff-mfa-verify:${identity.user.id}`, 10, 300_000)
  const { error } = await context.client.auth.mfa.challengeAndVerify({ factorId: input.factorId, code: input.code })
  if (error) throw new InputError(400, 'The code was not accepted. Check the current code and try again.')
  return Response.json({ verified: true })
})

async function emailIdentity(context: StaffRequestContext) {
  if (!emailVerificationEnabled()) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  const identity = await requiredIdentity(context)
  if (identity.membership.passwordChangeRequired) throw new AdminAccessError('ACCESS_DENIED')
  const email = staffEmailAddress(identity.user.email)
  return { identity, email, binding: { token_hash: identity.tokenHash, user_id: identity.user.id, email_hash: staffEmailHash(email) } }
}

export const staffEmailSendPost = authRoute(async (req, context) => {
  await body(req)
  const { identity, email, binding } = await emailIdentity(context)
  await rateLimit(`staff-email-send:${identity.user.id}`, 6, 3_600_000)
  const { challengeId, code } = newStaffEmailCode()
  const codeHash = staffEmailCodeHash({ tokenHash: identity.tokenHash, userId: identity.user.id, emailHash: binding.email_hash, challengeId, code })
  const service = staffServiceClient()
  const { data, error } = await service.rpc('lk_staff_email_command', { command: 'issue', args: { ...binding, challenge_id: challengeId, code_hash: codeHash } })
  if (error?.message === 'STAFF_EMAIL_RATE_LIMITED') throw new InputError(429, 'Wait one minute before requesting another email code.')
  if (error) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  const state = parseEmailVerification(data)
  if (!state || state.challengeId !== challengeId) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  try {
    await sendStaffEmailCode({ email, challengeId, code })
    const accepted = await service.rpc('lk_staff_email_command', { command: 'sent', args: { ...binding, challenge_id: challengeId } })
    if (accepted.error || accepted.data?.updated !== true) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  } catch {
    // Invalidate only this challenge after an uncertain send/acknowledgement.
    // If cleanup is also unavailable, verification still requires possession of
    // the sent code; a later resend supersedes it and stale replies cannot revive it.
    await service.rpc('lk_staff_email_command', { command: 'failed', args: { ...binding, challenge_id: challengeId } })
    throw new InputError(503, 'The verification email could not be confirmed. Wait one minute and request a new code.')
  }
  return Response.json({ sent: true, expiresAt: state.expiresAt, retryAt: state.retryAt })
})

export const staffEmailVerifyPost = authRoute(async (req, context) => {
  const { identity, binding } = await emailIdentity(context)
  await rateLimit(`staff-email-verify:${identity.user.id}`, 10, 900_000)
  const input = await body(req)
  if (typeof input.code !== 'string' || !/^\d{6}$/.test(input.code)) throw new InputError(400, 'Enter the six-digit code from the newest verification email.')
  const challengeId = identity.emailVerification?.challengeId
  if (!challengeId) throw new InputError(400, 'Request a verification email first.')
  const codeHash = staffEmailCodeHash({ tokenHash: identity.tokenHash, userId: identity.user.id, emailHash: binding.email_hash, challengeId, code: input.code })
  const { data, error } = await staffServiceClient().rpc('lk_staff_email_command', { command: 'verify', args: { ...binding, challenge_id: challengeId, code_hash: codeHash } })
  if (error) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  if (data?.verified !== true) throw new InputError(400, 'The code is incorrect, expired, or already used. Use the newest email or request another code.')
  return Response.json({ verified: true })
})
