import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { AppError } from '../domain/validation.ts'
import { getDb, localEnabled } from './local-db.ts'

export const OWNER_EMAIL = 'Lnkgroupsydney@gmail.com'
const SESSION_COOKIE = 'lk_ops_session'
export const OAUTH_COOKIE = 'lk_google_oauth'
export const SESSION_MS = 12 * 3600000
export const GOOGLE_SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/gmail.readonly',
]

export interface OwnerSession { mode: 'local'|'google'; accountSub: string | null; tokenHash: string }

export function sha(value: string): string { return createHash('sha256').update(value).digest('hex') }
function random(): string { return randomBytes(32).toString('base64url') }
export function cookieValue(req: Request, key: string): string | null {
  const cookie = req.headers.get('cookie') || ''
  const found = cookie.split(';').map((v) => v.trim()).find((v) => v.startsWith(`${key}=`))
  return found ? found.slice(key.length + 1) : null
}
export function cookie(key: string, value: string, maxAge: number, sameSite: 'Strict'|'Lax'): string {
  return `${key}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${process.env.APP_BASE_URL?.startsWith('https:') ? '; Secure' : ''}`
}
export function clearSessionCookie(): string { return cookie(SESSION_COOKIE, '', 0, 'Lax') }
export function clearOauthCookie(): string { return cookie(OAUTH_COOKIE, '', 0, 'Lax') }

export function getSession(req: Request, db = getDb()): OwnerSession | null {
  const raw = cookieValue(req, SESSION_COOKIE)
  if (!raw || raw.length > 200) return null
  const tokenHash = sha(raw)
  const row = db.prepare('SELECT mode,account_sub,expires_at FROM sessions WHERE token_hash=?').get(tokenHash) as { mode:'local'|'google'; account_sub:string|null; expires_at:number } | undefined
  if (!row || row.expires_at <= Date.now()) return null
  return { mode: row.mode, accountSub: row.account_sub, tokenHash }
}

export function requireSession(req: Request, db = getDb()): OwnerSession {
  const session = getSession(req, db)
  if (!session) throw new AppError(401, 'Authentication required')
  return session
}

export function createSession(mode: 'local'|'google', accountSub: string | null, db = getDb()): string {
  const token = random()
  db.prepare('INSERT INTO sessions(token_hash,mode,account_sub,expires_at) VALUES(?,?,?,?)').run(sha(token), mode, accountSub, Date.now() + SESSION_MS)
  return cookie(SESSION_COOKIE, token, SESSION_MS / 1000, 'Lax')
}

export function destroySession(req: Request, db = getDb()): void {
  const raw = cookieValue(req, SESSION_COOKIE)
  if (raw) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(raw))
}

export function localLoginAvailable(): boolean { return localEnabled() && !!process.env.LOCAL_OWNER_PASSWORD }
export function googleConfigured(): boolean {
  return localEnabled() && !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && /^[0-9a-fA-F]{64}$/.test(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || ''))
}

export function verifyLocalPassword(password: unknown): boolean {
  const expected = process.env.LOCAL_OWNER_PASSWORD
  if (!localLoginAvailable() || typeof password !== 'string' || password.length > 300 || !expected) return false
  const salt = 'L&K Group local owner password v1'
  const actualHash = scryptSync(password, salt, 32)
  const expectedHash = scryptSync(expected, salt, 32)
  return timingSafeEqual(actualHash, expectedHash)
}

function encryptionKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || ''
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) throw new AppError(503, 'Google token encryption is not configured')
  return Buffer.from(raw, 'hex')
}

export function encrypt(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

export function decrypt(value: string): string {
  const data = Buffer.from(value, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
}

export function redirectUri(): string { return `${process.env.APP_BASE_URL}/api/google/callback` }

export function startGoogleOAuth(req: Request, db = getDb()): { url: string; cookie: string } {
  if (!googleConfigured()) throw new AppError(503, 'Google connection is not configured')
  const state = random(), nonce = random(), verifier = random()
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const session = getSession(req, db)
  db.prepare('INSERT INTO oauth_states(state_hash,nonce_hash,verifier,session_hash,expires_at) VALUES(?,?,?,?,?)').run(sha(state), sha(nonce), verifier, session?.tokenHash || null, Date.now() + 600000)
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!)
  url.searchParams.set('redirect_uri', redirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent select_account')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return { url: url.toString(), cookie: cookie(OAUTH_COOKIE, nonce, 600, 'Lax') }
}

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string }

export async function finishGoogleOAuth(req: Request, state: string, code: string, db = getDb()): Promise<{ sessionCookie: string | null }> {
  if (!googleConfigured() || !state || !code || state.length > 200 || code.length > 3000) throw new AppError(400, 'Invalid Google response')
  const row = db.prepare('SELECT * FROM oauth_states WHERE state_hash=?').get(sha(state)) as { nonce_hash:string; verifier:string; session_hash:string|null; expires_at:number } | undefined
  db.prepare('DELETE FROM oauth_states WHERE state_hash=?').run(sha(state))
  const nonce = cookieValue(req, OAUTH_COOKIE)
  if (!row || row.expires_at < Date.now() || !nonce || sha(nonce) !== row.nonce_hash) throw new AppError(400, 'Google sign-in expired; try again')
  if (row.session_hash) {
    const current = getSession(req, db)
    if (!current || current.tokenHash !== row.session_hash) throw new AppError(401, 'Owner session changed; try again')
  }
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: row.verifier }),
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new AppError(502, 'Google sign-in could not be completed')
  const tokens = await response.json() as TokenResponse
  const granted = new Set((tokens.scope || '').split(' '))
  const emailGranted = granted.has('email') || granted.has('https://www.googleapis.com/auth/userinfo.email')
  const requiredGranted = GOOGLE_SCOPES.filter((scope) => scope !== 'email').every((scope) => granted.has(scope))
  if (!tokens.access_token || !emailGranted || !requiredGranted) throw new AppError(403, 'Required Google permissions were not granted')
  const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!userResponse.ok) throw new AppError(502, 'Google account could not be verified')
  const user = await userResponse.json() as { sub?:string; email?:string; email_verified?:boolean }
  if (!user.sub || user.email_verified !== true || user.email?.toLowerCase() !== OWNER_EMAIL.toLowerCase()) throw new AppError(403, 'Only the approved company Google account can connect')
  const previous = db.prepare('SELECT account_sub,refresh_cipher FROM google_connection WHERE id=1').get() as { account_sub:string; refresh_cipher:string|null } | undefined
  const refreshCipher = tokens.refresh_token ? encrypt(tokens.refresh_token) : previous?.account_sub === user.sub ? previous.refresh_cipher : null
  if (!refreshCipher) throw new AppError(403, 'Google offline access was not granted')
  const lease = db.prepare('SELECT expires_at FROM sync_lease WHERE id=1').get() as {expires_at:number}|undefined
  if (lease && lease.expires_at > Date.now()) throw new AppError(409, 'Sync in progress; reconnect after it finishes')
  db.prepare(`INSERT INTO google_connection(id,account_sub,email,access_cipher,refresh_cipher,expires_at)
    VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_sub=excluded.account_sub,email=excluded.email,access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,expires_at=excluded.expires_at,
    selected_calendar_id=CASE WHEN google_connection.account_sub=excluded.account_sub THEN google_connection.selected_calendar_id ELSE NULL END,
    selected_gmail_label_id=CASE WHEN google_connection.account_sub=excluded.account_sub THEN google_connection.selected_gmail_label_id ELSE NULL END,
    calendar_sync_token=NULL`).run(user.sub, OWNER_EMAIL, encrypt(tokens.access_token), refreshCipher, Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000)
  return { sessionCookie: row.session_hash ? null : createSession('google', user.sub, db) }
}

export async function getAuthorizedGoogleAccessToken(db = getDb()): Promise<{ accessToken: string; accountSub: string }> {
  const row = db.prepare('SELECT account_sub,access_cipher,refresh_cipher,expires_at FROM google_connection WHERE id=1').get() as { account_sub:string; access_cipher:string; refresh_cipher:string|null; expires_at:number } | undefined
  if (!googleConfigured() || !row) throw new AppError(503, 'Google account is not connected')
  if (row.expires_at > Date.now() + 60000) return { accessToken: decrypt(row.access_cipher), accountSub: row.account_sub }
  if (!row.refresh_cipher) throw new AppError(503, 'Google account needs reconnection')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: decrypt(row.refresh_cipher), grant_type: 'refresh_token' }),
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new AppError(503, 'Google account needs reconnection')
  const tokens = await response.json() as TokenResponse
  if (!tokens.access_token) throw new AppError(503, 'Google account needs reconnection')
  db.prepare('UPDATE google_connection SET access_cipher=?,expires_at=? WHERE id=1 AND account_sub=?').run(encrypt(tokens.access_token), Date.now() + Math.max(60, tokens.expires_in || 3600) * 1000, row.account_sub)
  return { accessToken: tokens.access_token, accountSub: row.account_sub }
}

export function sessionInfo(req: Request): { authenticated:boolean; mode:'local'|'google'|null; ownerEmail:string; localLoginAvailable:boolean; googleConfigured:boolean; missingConfiguration:string[] } {
  const enabled = localEnabled()
  const db = enabled ? getDb() : null
  const session = db ? getSession(req, db) : null
  const missingConfiguration = [
    !enabled && 'LOCAL_OPERATIONS_ENABLED + loopback APP_BASE_URL',
    !process.env.LOCAL_OWNER_PASSWORD && 'LOCAL_OWNER_PASSWORD',
    !process.env.GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID',
    !process.env.GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET',
    !/^[0-9a-fA-F]{64}$/.test(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || '') && 'GOOGLE_TOKEN_ENCRYPTION_KEY',
  ].filter((v): v is string => typeof v === 'string')
  return { authenticated: !!session, mode: session?.mode || null, ownerEmail: OWNER_EMAIL, localLoginAvailable: localLoginAvailable(), googleConfigured: googleConfigured(), missingConfiguration }
}
