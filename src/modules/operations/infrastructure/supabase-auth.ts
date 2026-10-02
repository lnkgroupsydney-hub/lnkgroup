import { randomBytes, createHash } from 'node:crypto'
import { AppError } from '../domain/validation.ts'
import { operationsCommand as command } from './supabase-client.ts'
import { GoogleIntegrationError, googleFailure, googleResponseFailure, type GoogleHealthCode } from './google-errors.ts'
import { googleHealthCommand, recordGoogleHealth, type HealthKind } from './supabase-google-health.ts'
import { cookie, cookieValue, sha, encrypt, decrypt, GOOGLE_SCOPES, OWNER_EMAIL, SESSION_MS, OAUTH_COOKIE, redirectUri, googleConfigured, localLoginAvailable } from './auth.ts'

export type CloudConnection = {
  account_sub:string; email:string; access_cipher:string; refresh_cipher:string; expires_at:number;
  selected_calendar_id:string|null; calendar_sync_token:string|null; calendar_last_synced_at:string|null; calendar_error:string|null;
  selected_gmail_label_id:string|null; gmail_page_token:string|null; gmail_last_synced_at:string|null; gmail_error:string|null;
  auth_health_code?:GoogleHealthCode; auth_health_checked_at?:number|null;
  gmail_health_code?:GoogleHealthCode; gmail_health_checked_at?:number|null;
  calendar_health_code?:GoogleHealthCode; calendar_health_checked_at?:number|null;
}
export type CloudSession = { token_hash:string; mode:'local'|'google'; account_sub:string|null; expires_at:number }
const sessionCookie = 'lk_ops_session'
const random = () => randomBytes(32).toString('base64url')
export const getConnection = () => command<CloudConnection|null>('connection_get')

export async function getSession(req:Request): Promise<CloudSession|null> {
  const token = cookieValue(req,sessionCookie)
  if (!token || token.length > 200) return null
  const session = await command<CloudSession|null>('session_get', { token_hash: sha(token) })
  if (session?.mode === 'local' && !localLoginAvailable()) return null
  return session
}
export async function requireSession(req:Request): Promise<CloudSession> {
  const session=await getSession(req)
  if (!session) throw new AppError(401,'Authentication required')
  return session
}
export async function createSession(mode:'local'|'google',accountSub:string|null): Promise<string> {
  if (mode === 'local' && !localLoginAvailable()) throw new AppError(503, 'Local operations login is not enabled')
  const token=random()
  await command('session_put',{token_hash:sha(token),mode,account_sub:accountSub,expires_at:Date.now()+SESSION_MS})
  return cookie(sessionCookie,token,SESSION_MS/1000,'Lax')
}
export async function destroySession(req:Request): Promise<void> {
  const token=cookieValue(req,sessionCookie)
  if(token) await command('session_delete',{token_hash:sha(token)})
}
export async function startOAuth(req:Request): Promise<{url:string;cookie:string}> {
  if(!googleConfigured()) throw new AppError(503,'Google connection is not configured')
  const state=random(),nonce=random(),verifier=random(),session=await getSession(req)
  await command('oauth_put',{state_hash:sha(state),nonce_hash:sha(nonce),verifier,session_hash:session?.token_hash??null,expires_at:Date.now()+600000})
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth')
  const params={client_id:process.env.GOOGLE_CLIENT_ID!,redirect_uri:redirectUri(),response_type:'code',scope:GOOGLE_SCOPES.join(' '),access_type:'offline',prompt:'consent select_account',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}
  Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value))
  return {url:url.toString(),cookie:cookie(OAUTH_COOKIE,nonce,600,'Lax')}
}
type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }

function tokenResponse(value: unknown): TokenResponse {
  if (!value || typeof value !== 'object') throw new AppError(502, 'Google returned an invalid token response')
  const tokens = value as Partial<TokenResponse>
  if (typeof tokens.access_token !== 'string' || !tokens.access_token ||
    (tokens.refresh_token !== undefined && (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token)) ||
    (tokens.expires_in !== undefined && (!Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)) ||
    (tokens.scope !== undefined && typeof tokens.scope !== 'string')) {
    throw new AppError(502, 'Google returned an invalid token response')
  }
  return tokens as TokenResponse
}

function requireGoogleScopes(scope: string | undefined): void {
  const granted = new Set((scope || '').split(/\s+/))
  const email = granted.has('email') || granted.has('https://www.googleapis.com/auth/userinfo.email')
  if (!email || !GOOGLE_SCOPES.filter((value) => value !== 'email').every((value) => granted.has(value))) {
    throw new GoogleIntegrationError('google_reconnect_required')
  }
}

export async function finishOAuth(req:Request,state:string,code:string): Promise<string|null> {
  if(!googleConfigured()||!state||!code||state.length>200||code.length>3000) throw new AppError(400,'Invalid Google response')
  const row=await command<{nonce_hash:string;verifier:string;session_hash:string|null;expires_at:number}|null>('oauth_take',{state_hash:sha(state)})
  const nonce=cookieValue(req,OAUTH_COOKIE)
  if(!row||row.expires_at<Date.now()||!nonce||sha(nonce)!==row.nonce_hash) throw new AppError(400,'Google sign-in expired; try again')
  if(row.session_hash&&(await getSession(req))?.token_hash!==row.session_hash) throw new AppError(401,'Owner session changed; try again')
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,redirect_uri:redirectUri(),grant_type:'authorization_code',code_verifier:row.verifier}),cache:'no-store',signal:AbortSignal.timeout(15000)})
  if(!response.ok) throw new AppError(502,'Google sign-in could not be completed')
  const tokens = tokenResponse(await response.json())
  requireGoogleScopes(tokens.scope)
  const userResponse=await fetch('https://www.googleapis.com/oauth2/v3/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},cache:'no-store',signal:AbortSignal.timeout(15000)})
  if(!userResponse.ok) throw new AppError(502,'Google account could not be verified')
  const user=await userResponse.json() as {sub?:string;email?:string;email_verified?:boolean}
  if(typeof user.sub!=='string'||!user.sub||user.email_verified!==true||typeof user.email!=='string'||user.email.toLowerCase()!==OWNER_EMAIL.toLowerCase()) throw new AppError(403,'Only the approved company Google account can connect')
  const previous=await getConnection()
  const refresh=tokens.refresh_token?encrypt(tokens.refresh_token):previous?.account_sub===user.sub?previous.refresh_cipher:null
  if(!refresh) throw new AppError(403,'Google offline access was not granted')
  await googleHealthCommand('reconnect',{account_sub:user.sub,email:OWNER_EMAIL,access_cipher:encrypt(tokens.access_token),refresh_cipher:refresh,expires_at:Date.now()+Math.max(60,tokens.expires_in||3600)*1000})
  return row.session_hash?null:createSession('google',user.sub)
}
export async function accessToken(holder?:string): Promise<{token:string;account:string;connection:CloudConnection}> {
  const row=await getConnection()
  if(!googleConfigured()) throw new GoogleIntegrationError('google_configuration')
  if(!row) throw new GoogleIntegrationError('google_not_connected')
  if(row.auth_health_code==='google_reconnect_required') throw new GoogleIntegrationError('google_reconnect_required')
  if(row.expires_at>Date.now()+60000) return {token:decrypt(row.access_cipher),account:row.account_sub,connection:row}
  const observedAt=Date.now()
  let tokens:TokenResponse
  try {
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,refresh_token:decrypt(row.refresh_cipher),grant_type:'refresh_token'}),cache:'no-store',signal:AbortSignal.timeout(15000)})
    if(!response.ok) throw await googleResponseFailure(response,true)
    try { tokens=tokenResponse(await response.json()) } catch { throw new GoogleIntegrationError('google_invalid_response') }
    // Google may omit unchanged scope on refresh. Reduced grants fail closed.
    if(tokens.scope!==undefined) requireGoogleScopes(tokens.scope)
  } catch(error) {
    const failure=googleFailure(error)
    await recordGoogleHealth(row,'auth',failure.code,observedAt,holder)
    throw failure
  }
  const updated={...row,access_cipher:encrypt(tokens.access_token),refresh_cipher:tokens.refresh_token?encrypt(tokens.refresh_token):row.refresh_cipher,expires_at:Date.now()+Math.max(60,tokens.expires_in||3600)*1000}
  const saved=await command<boolean>('connection_refresh',{
    account_sub:row.account_sub,expected_access_cipher:row.access_cipher,expected_refresh_cipher:row.refresh_cipher,
    access_cipher:updated.access_cipher,refresh_cipher:updated.refresh_cipher,expires_at:updated.expires_at,
  })
  if(!saved) {
    const current=await getConnection()
    if(!current||current.account_sub!==row.account_sub||current.expires_at<=Date.now()+60000||current.auth_health_code==='google_reconnect_required') throw new GoogleIntegrationError('google_connection_changed')
    return {token:decrypt(current.access_cipher),account:current.account_sub,connection:current}
  }
  await recordGoogleHealth(updated,'auth','ready',observedAt,holder)
  return {token:tokens.access_token,account:row.account_sub,connection:updated}
}

export async function googleRequest(kind:Exclude<HealthKind,'auth'>,url:string,init:RequestInit={},holder?:string):Promise<Response> {
  const {token,connection}=await accessToken(holder),observedAt=Date.now()
  let response:Response
  try {
    response=await fetch(url,{...init,headers:{...init.headers,Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(15000)})
  } catch {
    const failure=new GoogleIntegrationError('google_temporary')
    await recordGoogleHealth(connection,kind,failure.code,observedAt,holder)
    throw failure
  }
  // Resource-specific 400/404/409/410/412 remain with the reader/Calendar conflict flow.
  if([401,403,429].includes(response.status)||response.status>=500) {
    const failure=await googleResponseFailure(response)
    await recordGoogleHealth(connection,failure.code==='google_reconnect_required'?'auth':kind,failure.code,observedAt,holder)
    throw failure
  }
  return response
}
