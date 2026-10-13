import { parseSingleForwarded } from '../../shared/http/forwarded.ts'
import test, {after, beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {createHmac, randomUUID} from 'node:crypto'
import {AdminAccessError} from './index.ts'
import {requireStaffAdmin, requireStaffRequest, staffRequestClient, staffSessionHash, STAFF_COOKIE} from './infrastructure/staff-auth.ts'
import {staffLoginPost, staffLogoutPost, staffMfaEnrollPost, staffMfaVerifyPost, staffOperationsSessionGet, staffPasswordPost, staffSessionGet, staffEmailSendPost, staffEmailVerifyPost, staffSessionsGet, staffSessionsRevokeOthersPost} from './server.ts'
import { staffEmailCodeHash, staffEmailHash } from './infrastructure/email-verification.ts'
import {startOAuth,finishOAuth} from '../operations/infrastructure/supabase-auth.ts'
import {GOOGLE_SCOPES,OWNER_EMAIL,googleConfigured,localLoginAvailable} from '../operations/infrastructure/auth.ts'

// Real Supabase SDK/SSR clients, signed synthetic tokens and an intercepted Auth
// and PostgREST transport. No .env files or external provider requests are used.
const base='http://127.0.0.1:3002', provider='https://staff-auth.invalid'
const userId=randomUUID(), sessionId=randomUUID(), factorId=randomUUID()
const signingKey='synthetic-hmac-staff-auth-test-only'
type FakeUser={id:string;aud:string;email:string;email_confirmed_at:string;created_at:string;is_anonymous:boolean;app_metadata:Record<string,unknown>;user_metadata:Record<string,unknown>;factors:Array<{id:string;factor_type:string;status:string;friendly_name:string}>}
let user:FakeUser, registry:Map<string,{mode:string;account_sub:string;expires_at:number}>
let active=true, assurance='aal2', rpcFailure=false, passwordFailure=false, rejectCode=false, logoutFailure=false, revokeRace=false, sessionsRpcFailure=false
let requests:string[]=[], writes:string[]=[]
let oauthStates:Map<string,Record<string,unknown>>, googleRequests=0
let emailState: { challengeId:string; sent:boolean; expiresAt:number; retryAt:number; verifiedUntil:number|null } | null = null
let emailDigest='', emailCode='', emailProviderFailure=false, emailAcknowledgementFailure=false, emailAcknowledgementLost=false, emailRequests=0
function claims(extra:Record<string,unknown>={}) {return {iss:`${provider}/auth/v1`,sub:userId,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),session_id:sessionId,aal:assurance,...extra}}
function jwt(extra:Record<string,unknown>={}) {
 const head=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
 const body=Buffer.from(JSON.stringify(claims(extra))).toString('base64url')
 return `${head}.${body}.${createHmac('sha256',signingKey).update(`${head}.${body}`).digest('base64url')}`
}
function session(extra:Record<string,unknown>={}) {return {access_token:jwt(extra),refresh_token:'synthetic-refresh-token',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:structuredClone(user)}}
function cookie(extra:Record<string,unknown>={}) {return `${STAFF_COOKIE}=base64-${Buffer.from(JSON.stringify(session(extra))).toString('base64url')}`}
function request(path:string, options:{body?:unknown;cookie?:string;origin?:string;headers?:Record<string,string>;raw?:string;urlBase?:string}={}) {
 const post=options.body!==undefined || options.raw!==undefined
 return new Request(`${options.urlBase??base}${path}`,{method:post?'POST':'GET',headers:{cookie:options.cookie??cookie(),...(post?{'content-type':'application/json',origin:options.origin??base}:{}),...options.headers},...(post?{body:options.raw??JSON.stringify(options.body)}:{})})
}
function errorCode(code:string) {return (error:unknown)=>error instanceof AdminAccessError&&error.code===code}
const originalFetch=globalThis.fetch
globalThis.fetch=async(input,init)=>{
 const req=new Request(input,init),url=new URL(req.url)
 if(url.origin==='https://api.resend.com') {
  assert.equal(url.pathname,'/emails'); assert.equal(req.method,'POST')
  const message=await req.json() as {to:string[];text:string;subject:string}
  assert.deepEqual(message.to,['lnkgroupsydney@gmail.com'])
  assert.equal(message.subject,'L&K Group EMS sign-in code')
  assert.equal(req.headers.get('idempotency-key'),`lk-staff-email:${emailState?.challengeId}`)
  emailCode=message.text.match(/code is: (\d{6})/)?.[1]??''
  assert.match(emailCode,/^\d{6}$/);emailRequests++
  return emailProviderFailure?Response.json({message:'SYNTHETIC_PROVIDER_PRIVATE'},{status:503}):Response.json({id:'synthetic-email'})
 }
 if(url.origin==='https://oauth2.googleapis.com' && url.pathname==='/token') {
  googleRequests++;return Response.json({access_token:'synthetic-google-access',refresh_token:'synthetic-google-refresh',expires_in:3600,scope:GOOGLE_SCOPES.join(' ')})
 }
 if(url.origin==='https://www.googleapis.com' && url.pathname==='/oauth2/v3/userinfo') {
  googleRequests++;return Response.json({sub:'synthetic-google-company',email:OWNER_EMAIL,email_verified:true})
 }
 assert.equal(url.origin,provider,'Unexpected external request')
 requests.push(`${req.method} ${url.pathname}`)
 if(url.pathname==='/auth/v1/token')return Response.json(session())
 if(url.pathname.startsWith('/auth/v1/') && !url.pathname.startsWith('/auth/v1/admin/')) {
  const token=req.headers.get('authorization')?.replace(/^Bearer /,'')??''
  const [header,payload,signature]=token.split('.')
  if(!header||!payload||signature!==createHmac('sha256',signingKey).update(`${header}.${payload}`).digest('base64url')) return Response.json({message:'Invalid JWT',code:'bad_jwt'},{status:401})
 }
 if(url.pathname==='/auth/v1/user' && req.method==='GET')return Response.json(user)
 if(url.pathname==='/auth/v1/user' && req.method==='PUT') {
  writes.push('password')
  if(passwordFailure)return Response.json({msg:'Password unchanged',code:'same_password'},{status:422})
  return Response.json(user)
 }
 if(url.pathname===`/auth/v1/admin/users/${userId}` && req.method==='PUT') {
  const body=await req.json() as {app_metadata:Record<string,unknown>}
  writes.push('metadata');user.app_metadata={...user.app_metadata,...body.app_metadata}
  return Response.json(user)
 }
 if(url.pathname==='/auth/v1/logout') {writes.push(`logout:${url.searchParams.get('scope')}`);return logoutFailure?Response.json({message:'SYNTHETIC_PRIVATE_FAILURE'},{status:503}):new Response(null,{status:204})}
 if(url.pathname==='/auth/v1/factors' && req.method==='POST') {
  writes.push('enroll');user.factors=[{id:factorId,factor_type:'totp',status:'unverified',friendly_name:'Test authenticator'}]
  return Response.json({id:factorId,type:'totp',totp:{qr_code:'<svg></svg>',secret:'SYNTHETICSECRET',uri:'otpauth://totp/test'}})
 }
 if(url.pathname===`/auth/v1/factors/${factorId}/challenge`)return Response.json({id:'synthetic-challenge',expires_at:Math.floor(Date.now()/1000)+60})
 if(url.pathname===`/auth/v1/factors/${factorId}/verify`) {
  writes.push('verify')
  if(rejectCode)return Response.json({msg:'Invalid code',code:'mfa_verification_failed'},{status:400})
  assurance='aal2';user.factors[0].status='verified';return Response.json(session())
 }
 if(url.pathname==='/rest/v1/rpc/lk_staff_session_active') {
  const body=await req.json() as {input_session_id:string;input_user_id:string}
  assert.equal(body.input_session_id,sessionId);assert.equal(body.input_user_id,userId)
  return rpcFailure?Response.json({code:'XX000',message:'Synthetic failure'},{status:400}):Response.json(active)
 }
 if(url.pathname==='/rest/v1/rpc/lk_staff_sessions_command') {
  const {command,input_token_hash:hash,input_user_id:owner}=await req.json() as {command:string;input_token_hash:string;input_user_id:string}
  assert.equal(hash,staffSessionHash(sessionId));assert.equal(owner,userId)
  if(sessionsRpcFailure)return Response.json({message:'SYNTHETIC_DB_PRIVATE_FAILURE'},{status:503})
  if(revokeRace)registry.delete(hash)
  const current=registry.get(hash)
  if(!current||current.mode!=='staff'||current.account_sub!==owner||current.expires_at<=Date.now())return Response.json({code:'P0001',message:'STAFF_SESSION_REQUIRED'},{status:400})
  const others=[...registry].filter(([key,row])=>key!==hash&&row.mode==='staff'&&row.account_sub===owner)
  if(command==='list') {
   const activeOthers=others.filter(([,row])=>row.expires_at>Date.now()).sort((a,b)=>a[1].expires_at-b[1].expires_at)
   return Response.json({current:{expiresAt:current.expires_at},otherSessionCount:activeOthers.length,otherSessions:activeOthers.slice(0,50).map(([,row])=>({expiresAt:row.expires_at})),truncated:activeOthers.length>50})
  }
  assert.equal(command,'revoke_others');writes.push('sessions_revoke_others')
  for(const [key]of others)registry.delete(key)
  return Response.json({removedSessionCount:others.length})
 }
 if(url.pathname==='/rest/v1/rpc/lk_staff_email_command') {
  const {command,args}=await req.json() as {command:string;args:Record<string,unknown>}
  assert.equal(args.token_hash,staffSessionHash(sessionId));assert.equal(args.user_id,userId);assert.equal(args.email_hash,staffEmailHash(user.email))
  if(command==='status')return Response.json(emailState)
  if(command==='issue') {
   emailDigest=String(args.code_hash)
   emailState={challengeId:String(args.challenge_id),sent:false,expiresAt:Date.now()+600_000,retryAt:Date.now()+60_000,verifiedUntil:null}
   return Response.json(emailState)
  }
  assert.equal(args.challenge_id,emailState?.challengeId)
  if(command==='sent') {if(emailAcknowledgementFailure)return Response.json({updated:false});emailState!.sent=true;return emailAcknowledgementLost?Response.json({code:'XX000'},{status:503}):Response.json({updated:true})}
  if(command==='failed') {emailState!.sent=false;writes.push('email_failed');return Response.json({updated:true})}
  if(command==='verify') {
   const verified=!!emailState?.sent&&emailState.expiresAt>Date.now()&&emailDigest===args.code_hash
   if(verified){emailState!.sent=false;emailState!.verifiedUntil=registry.get(staffSessionHash(sessionId))!.expires_at}
   return Response.json({verified,...(verified?{verifiedUntil:emailState!.verifiedUntil}:{})})
  }
  throw new Error('Unexpected email command')
 }
 if(url.pathname==='/rest/v1/rpc/lk_operations_command') {
  const body=await req.json() as {command:string;args:Record<string,unknown>}
  if(body.command==='session_put') {writes.push('session_put');registry.set(String(body.args.token_hash),{mode:String(body.args.mode),account_sub:String(body.args.account_sub),expires_at:Number(body.args.expires_at)})}
  else if(body.command==='session_delete') {writes.push('session_delete');registry.delete(String(body.args.token_hash))}
  else if(body.command==='oauth_put') {oauthStates.set(String(body.args.state_hash),body.args)}
  else if(body.command==='oauth_take') {const row=oauthStates.get(String(body.args.state_hash));oauthStates.delete(String(body.args.state_hash));return Response.json(row??null)}
  else if(body.command==='connection_get')return Response.json(null)
  else assert.equal(body.command,'rate_limit')
  return Response.json(true)
 }
 if(url.pathname==='/rest/v1/rpc/lk_google_health') {const body=await req.json() as {action:string};assert.equal(body.action,'reconnect');writes.push('google_reconnect');return Response.json(true)}
 if(url.pathname==='/rest/v1/lk_sessions') {
  if(req.method==='DELETE') {writes.push('other_registry_delete');return new Response(null,{status:204})}
  const row=registry.get(url.searchParams.get('token_hash')?.replace(/^eq\./,'')??'')
  return Response.json(row?[row]:[])
 }
 throw new Error(`Unhandled synthetic provider route: ${req.method} ${url.pathname}`)
}
beforeEach(()=>{
 Object.assign(process.env,{STAFF_ADMIN_AUTH_ENABLED:'true',OPERATIONS_STORE:'supabase',LOCAL_OPERATIONS_ENABLED:'true',APP_BASE_URL:base,NEXT_PUBLIC_SUPABASE_URL:provider,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-publishable',SUPABASE_SECRET_KEY:'synthetic-secret',GOOGLE_CLIENT_ID:'synthetic-google-client',GOOGLE_CLIENT_SECRET:'synthetic-google-secret',GOOGLE_TOKEN_ENCRYPTION_KEY:'44'.repeat(32)})
 user={id:userId,aud:'authenticated',email:'synthetic-admin@example.invalid',email_confirmed_at:new Date().toISOString(),created_at:new Date().toISOString(),is_anonymous:false,app_metadata:{lk_staff:{company_id:'lk-group',role:'owner',status:'active'},lk_staff_password_change_required:false},user_metadata:{},factors:[{id:factorId,factor_type:'totp',status:'verified',friendly_name:'Test authenticator'}]}
 registry=new Map([[staffSessionHash(sessionId),{mode:'staff',account_sub:userId,expires_at:Date.now()+3600_000}]])
 active=true;assurance='aal2';rpcFailure=false;passwordFailure=false;rejectCode=false;logoutFailure=false;revokeRace=false;sessionsRpcFailure=false;requests=[];writes=[]
 oauthStates=new Map();googleRequests=0
 process.env.STAFF_ADMIN_SECOND_STEP='totp';process.env.STAFF_EMAIL_OTP_SECRET='66'.repeat(32);process.env.RESEND_API_KEY='synthetic-resend';process.env.RESEND_FROM_EMAIL='L&K Demo <onboarding@resend.dev>'
 emailState=null;emailDigest='';emailCode='';emailProviderFailure=false;emailAcknowledgementFailure=false;emailAcknowledgementLost=false;emailRequests=0
})
after(()=>{globalThis.fetch=originalFetch})

test('fresh server membership overrides stale cookie and token roles on every request',async()=>{
 const req=request('/api/operations')
 const principal=await requireStaffAdmin(req,'integrations.manage')
 assert.equal(principal.role,'owner');assert.equal(principal.tokenHash,staffSessionHash(sessionId))
 user.app_metadata.lk_staff={company_id:'lk-group',role:'owner',status:'revoked'}
 await assert.rejects(requireStaffAdmin(req),errorCode('ACCESS_DENIED'))
 assert.ok(requests.filter(path=>path==='GET /auth/v1/user').length>=4)
})
test('user-editable metadata and signed stale JWT metadata cannot grant membership',async()=>{
 const req=request('/api/operations',{cookie:cookie({app_metadata:{lk_staff:{company_id:'lk-group',role:'owner',status:'active'}}})})
 user.user_metadata={lk_staff:{company_id:'lk-group',role:'owner',status:'active'}};delete user.app_metadata.lk_staff
 await assert.rejects(requireStaffAdmin(req),errorCode('ACCESS_DENIED'))
 assert.ok(!requests.some(path=>path.includes('/rest/')))
})
test('temporary password and aal1 sessions expose onboarding but never operations',async()=>{
 user.app_metadata.lk_staff_password_change_required=true
 let req=request('/api/admin-auth/session')
 assert.equal((await (await staffSessionGet(req)).json()).stage,'password_change')
 assert.equal((await (await staffOperationsSessionGet(req)).json()).authenticated,false)
 await assert.rejects(requireStaffAdmin(req),errorCode('ACCESS_DENIED'))
 user.app_metadata.lk_staff_password_change_required=false;assurance='aal1';req=request('/api/admin-auth/session')
 assert.equal((await (await staffSessionGet(req)).json()).stage,'mfa_verify')
 await assert.rejects(requireStaffAdmin(req),errorCode('MFA_REQUIRED'))
 user.factors=[];assert.equal((await (await staffSessionGet(request('/api/admin-auth/session'))).json()).stage,'mfa_enroll')
})
test('a removed or unverified current MFA factor invalidates an otherwise signed aal2 claim',async()=>{
 const req=request('/api/admin-auth/session')
 for(const factors of [[],[{id:factorId,factor_type:'totp',status:'unverified',friendly_name:'Test authenticator'}]]) {
  user.factors=factors
  await assert.rejects(requireStaffAdmin(req),errorCode('MFA_REQUIRED'))
  assert.equal((await (await staffSessionGet(req)).json()).stage,'mfa_enroll')
  assert.equal((await (await staffOperationsSessionGet(req)).json()).authenticated,false)
 }
})
test('revoked Auth sessions, missing registry, wrong principal or legacy mode fail closed',async()=>{
 const req=request('/api/operations')
 active=false;await assert.rejects(requireStaffAdmin(req),errorCode('AUTHENTICATION_REQUIRED'));active=true
 for(const row of [undefined,{mode:'google',account_sub:userId,expires_at:Date.now()+3600_000},{mode:'staff',account_sub:randomUUID(),expires_at:Date.now()+3600_000},{mode:'staff',account_sub:userId,expires_at:Date.now()-1}]) {
  registry.clear();if(row)registry.set(staffSessionHash(sessionId),row)
  await assert.rejects(requireStaffAdmin(req),errorCode('AUTHENTICATION_REQUIRED'))
 }
})
test('invalid claims or forged signatures never query authorization storage',async()=>{
 for(const extra of [{sub:randomUUID()},{iss:'https://foreign.invalid/auth/v1'},{aud:'anon'},{session_id:'bad'},{exp:1},{aal:'unknown'}]) {
  requests=[];await assert.rejects(requireStaffAdmin(request('/api/operations',{cookie:cookie(extra)})),errorCode('AUTHENTICATION_REQUIRED'))
  assert.ok(!requests.some(path=>path.includes('/rest/')))
 }
 const forged=session();forged.access_token=forged.access_token.replace(/.$/,'!')
 const forgedCookie=`${STAFF_COOKIE}=base64-${Buffer.from(JSON.stringify(forged)).toString('base64url')}`
 await assert.rejects(requireStaffAdmin(request('/api/operations',{cookie:forgedCookie})),errorCode('AUTHENTICATION_REQUIRED'))
})
test('provider failure is unavailable and ordinary staff cannot manage integrations',async()=>{
 rpcFailure=true;await assert.rejects(requireStaffAdmin(request('/api/operations')),errorCode('ACCESS_UNAVAILABLE'));rpcFailure=false
 user.app_metadata.lk_staff={company_id:'lk-group',role:'admin',status:'active'}
 assert.equal((await requireStaffAdmin(request('/api/operations'),'operations.write')).role,'admin')
 await assert.rejects(requireStaffAdmin(request('/api/google/connect'),'integrations.manage'),errorCode('ACCESS_DENIED'))
})
test('wrong company or unsupported roles fail closed and errors expose no provider or credential data',async()=>{
 const req=request('/api/admin-auth/session')
 for(const membership of [{company_id:'other-company',role:'owner',status:'active'},{company_id:'lk-group',role:'superuser',status:'active'},{company_id:'lk-group',role:'owner',status:'invited'}]) {
  user.app_metadata.lk_staff=membership;const response=await staffSessionGet(req)
  assert.equal(response.status,403)
  assert.deepEqual(await response.json(),{error:'You do not have access to this resource.',code:'ACCESS_DENIED'})
 }
 user.app_metadata.lk_staff={company_id:'lk-group',role:'owner',status:'active'};rpcFailure=true
 const response=await staffSessionGet(req),text=await response.text()
 assert.equal(response.status,503)
 assert.equal(response.headers.get('cache-control'),'private, no-store')
 assert.ok(!text.includes('Synthetic failure')&&!text.includes('synthetic-secret')&&!text.includes('access_token')&&!text.includes(user.email))
})
test('auth mutations reject foreign origin and malformed or oversized input without network',async()=>{
 for(const action of [staffLoginPost,staffLogoutPost,staffPasswordPost,staffMfaEnrollPost,staffMfaVerifyPost])assert.equal((await action(request('/api/admin-auth/action',{body:{},origin:'https://foreign.invalid'}))).status,403)
 assert.equal(requests.length,0)
 assert.equal((await staffLoginPost(request('/api/admin-auth/login',{raw:'[]'}))).status,400)
 for(const email of ['a@localhost','a..b@example.com','a@-example.com','김@example.com']) {
  const before=requests.length
  assert.equal((await staffLoginPost(request('/api/admin-auth/login',{cookie:'',body:{email,password:'synthetic-password'}}))).status,400)
  assert.equal(requests.length,before,'Invalid credentials must not reach the Auth provider')
 }
 assert.equal((await staffLoginPost(request('/api/admin-auth/login',{raw:'x'.repeat(4100)}))).status,413)
 assert.equal(requests.length,0)
})
test('password login registers staff session and returns onboarding without exposing credentials',async()=>{
 registry.clear();assurance='aal1';user.app_metadata.lk_staff_password_change_required=true
 const response=await staffLoginPost(request('/api/admin-auth/login',{cookie:'',body:{email:user.email,password:'synthetic-temporary-password'}}))
 assert.equal(response.status,200);assert.equal((await response.json()).stage,'password_change')
 assert.ok(registry.has(staffSessionHash(sessionId)));assert.ok(response.headers.get('set-cookie')?.includes('HttpOnly'))
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('vary'),'Cookie')
})
test('password setup clears only the independent flag after successful Auth change',async()=>{
 user.app_metadata.lk_staff_password_change_required=true;assurance='aal1'
 const req=()=>request('/api/admin-auth/password',{body:{password:'synthetic-new-password-long'}})
 passwordFailure=true;assert.equal((await staffPasswordPost(req())).status,400)
 assert.equal(user.app_metadata.lk_staff_password_change_required,true);assert.ok(!writes.includes('metadata'))
 passwordFailure=false;writes=[]
 assert.equal((await staffPasswordPost(req())).status,200)
 assert.deepEqual(writes,['password','other_registry_delete','logout:others','metadata'])
 assert.equal(user.app_metadata.lk_staff_password_change_required,false)
 assert.deepEqual(user.app_metadata.lk_staff,{company_id:'lk-group',role:'owner',status:'active'})
})
test('MFA enrollment and verification are gated and transition to a fresh aal2 session',async()=>{
 assurance='aal1';user.factors=[];user.app_metadata.lk_staff_password_change_required=true
 assert.equal((await staffMfaEnrollPost(request('/api/admin-auth/mfa/enroll',{body:{}}))).status,403)
 user.app_metadata.lk_staff_password_change_required=false
 const enrolled=await staffMfaEnrollPost(request('/api/admin-auth/mfa/enroll',{body:{}}));assert.equal(enrolled.status,200)
 assert.equal((await enrolled.json()).factorId,factorId)
 assert.equal((await staffMfaVerifyPost(request('/api/admin-auth/mfa/verify',{body:{factorId:randomUUID(),code:'123456'}}))).status,400)
 rejectCode=true;assert.equal((await staffMfaVerifyPost(request('/api/admin-auth/mfa/verify',{body:{factorId,code:'123456'}}))).status,400)
 rejectCode=false;const response=await staffMfaVerifyPost(request('/api/admin-auth/mfa/verify',{body:{factorId,code:'123456'}}))
 assert.equal(response.status,200);assert.ok(response.headers.get('set-cookie')?.includes('HttpOnly'))
 assert.equal((await (await staffSessionGet(request('/api/admin-auth/session'))).json()).stage,'ready')
})
test('logout removes only the verified current registry and clears cookies after membership revocation',async()=>{
 user.app_metadata.lk_staff={company_id:'lk-group',role:'owner',status:'revoked'}
 const response=await staffLogoutPost(request('/api/admin-auth/logout',{body:{}}))
 assert.equal(response.status,200);assert.equal(registry.has(staffSessionHash(sessionId)),false)
 assert.deepEqual(writes,['session_delete','logout:local']);assert.ok(response.headers.get('set-cookie')?.includes('Max-Age=0'))
})
test('staff host checks reject configured-host mismatch before any provider call',()=>{
 assert.throws(()=>staffRequestClient(request('/api/admin-auth/session',{headers:{host:'foreign.invalid'}})),errorCode('LOCAL_PREVIEW_ORIGIN_DENIED'))
 assert.equal(requests.length,0)
})
test('staff Google reconnect binds current session and never mints a legacy administrator cookie',async()=>{
 const started=await startOAuth(request('/api/google/connect'))
 assert.equal([...oauthStates.values()][0].session_hash,staffSessionHash(sessionId))
 const state=new URL(started.url).searchParams.get('state')!
 const req=request('/api/google/callback',{cookie:`${cookie()}; ${started.cookie.split(';')[0]}`})
 assert.equal(await finishOAuth(req,state,'synthetic-code'),null)
 assert.equal(googleRequests,2);assert.deepEqual(writes,['google_reconnect']);assert.equal(oauthStates.size,0)
})
test('Google callback refuses old unbound state and fresh role revocation before token exchange',async()=>{
 let started=await startOAuth(request('/api/google/connect'))
 const record=[...oauthStates.values()][0];record.session_hash=null
 let state=new URL(started.url).searchParams.get('state')!
 await assert.rejects(finishOAuth(request('/api/google/callback',{cookie:`${cookie()}; ${started.cookie.split(';')[0]}`}),state,'synthetic-code'),(error:unknown)=>error instanceof Error&&'status'in error&&error.status===401)
 assert.equal(googleRequests,0)
 started=await startOAuth(request('/api/google/connect'));state=new URL(started.url).searchParams.get('state')!
 user.app_metadata.lk_staff={company_id:'lk-group',role:'admin',status:'active'}
 await assert.rejects(finishOAuth(request('/api/google/callback',{cookie:`${cookie()}; ${started.cookie.split(';')[0]}`}),state,'synthetic-code'),(error:unknown)=>error instanceof Error&&'status'in error&&error.status===403)
 assert.equal(googleRequests,0);assert.deepEqual(writes,[])
})

test('email verification requires an explicit send and grants only the current confirmed session at aal1',async()=>{
 process.env.STAFF_ADMIN_SECOND_STEP='email';user.email='lnkgroupsydney@gmail.com';assurance='aal1';user.factors=[]
 assert.equal((await(await staffSessionGet(request('/api/admin-auth/session'))).json()).stage,'email_verify')
 assert.equal(emailRequests,0)
 await assert.rejects(requireStaffAdmin(request('/api/operations')),errorCode('EMAIL_VERIFICATION_REQUIRED'))
 const sent=await staffEmailSendPost(request('/api/admin-auth/email/send',{body:{email:'attacker@example.invalid'}}));assert.equal(sent.status,200)
 assert.equal(emailRequests,1)
 assert.equal(emailDigest,staffEmailCodeHash({tokenHash:staffSessionHash(sessionId),userId,emailHash:staffEmailHash(user.email),challengeId:emailState!.challengeId,code:emailCode}))
 const responseText=await sent.text();assert.ok(!responseText.includes(emailCode)&&!responseText.includes(emailDigest))
 const wrongCode=String((Number(emailCode)+1)%1_000_000).padStart(6,'0')
 assert.equal((await staffEmailVerifyPost(request('/api/admin-auth/email/verify',{body:{code:wrongCode}}))).status,400)
 assert.equal((await staffEmailVerifyPost(request('/api/admin-auth/email/verify',{body:{code:emailCode}}))).status,200)
 assert.equal(assurance,'aal1')
 assert.equal((await(await staffSessionGet(request('/api/admin-auth/session'))).json()).stage,'ready')
 assert.equal((await requireStaffAdmin(request('/api/operations'))).userId,userId)
 assert.equal((await staffEmailVerifyPost(request('/api/admin-auth/email/verify',{body:{code:emailCode}}))).status,400)
 emailState!.verifiedUntil=Date.now()-1
 await assert.rejects(requireStaffAdmin(request('/api/operations')),errorCode('EMAIL_VERIFICATION_REQUIRED'))
})

test('email mode cannot be bypassed by aal2, stale claims, changed email, temporary passwords or cross-origin sends',async()=>{
 process.env.STAFF_ADMIN_SECOND_STEP='email';user.email='lnkgroupsydney@gmail.com'
 await assert.rejects(requireStaffAdmin(request('/api/operations')),errorCode('EMAIL_VERIFICATION_REQUIRED'))
 assert.equal((await(await staffSessionGet(request('/api/admin-auth/session'))).json()).stage,'email_verify')
 assert.equal((await staffEmailSendPost(request('/api/admin-auth/email/send',{body:{},origin:'https://foreign.invalid'}))).status,403)
 assert.equal((await staffEmailVerifyPost(request('/api/admin-auth/email/verify',{body:{code:'123456'},origin:'https://foreign.invalid'}))).status,403)
 user.app_metadata.lk_staff_password_change_required=true
 assert.equal((await staffEmailSendPost(request('/api/admin-auth/email/send',{body:{}}))).status,403)
 user.app_metadata.lk_staff_password_change_required=false;user.email='changed@example.invalid'
 assert.equal((await staffEmailSendPost(request('/api/admin-auth/email/send',{body:{}}))).status,403)
 assert.equal(emailRequests,0)
})

test('failed or uncertain email delivery cannot activate a code or expose provider details',async()=>{
 process.env.STAFF_ADMIN_SECOND_STEP='email';user.email='lnkgroupsydney@gmail.com';assurance='aal1';user.factors=[]
 for(const failureMode of ['provider','ack_rejected','ack_response_lost']){
  emailProviderFailure=failureMode==='provider';emailAcknowledgementFailure=failureMode==='ack_rejected';emailAcknowledgementLost=failureMode==='ack_response_lost'
  const response=await staffEmailSendPost(request('/api/admin-auth/email/send',{body:{}}))
  assert.equal(response.status,503)
  const text=await response.text();assert.ok(!text.includes('SYNTHETIC_PROVIDER_PRIVATE')&&!text.includes(emailCode))
  assert.equal(emailState!.sent,false)
  assert.equal((await staffEmailVerifyPost(request('/api/admin-auth/email/verify',{body:{code:emailCode}}))).status,400)
  await assert.rejects(requireStaffAdmin(request('/api/operations')),errorCode('EMAIL_VERIFICATION_REQUIRED'))
 }
 assert.ok(writes.includes('email_failed'))
})

test('email code digest binds the challenge, session, account and destination',()=>{
 const input={tokenHash:staffSessionHash(sessionId),userId,emailHash:staffEmailHash('lnkgroupsydney@gmail.com'),challengeId:randomUUID(),code:'123456'}
 const digest=staffEmailCodeHash(input)
 for(const patch of [{tokenHash:'a'.repeat(64)},{userId:randomUUID()},{emailHash:'b'.repeat(64)},{challengeId:randomUUID()},{code:'654321'}])assert.notEqual(staffEmailCodeHash({...input,...patch}),digest)
 process.env.STAFF_EMAIL_OTP_SECRET='';assert.throws(()=>staffEmailCodeHash(input),errorCode('ACCESS_UNAVAILABLE'))
})


test('session security returns only this staff account expiry times and a bounded exact count',async()=>{
 const expiry=Date.now()+600_000
 for(let i=0;i<51;i++)registry.set(`synthetic-other-${i}`,{mode:'staff',account_sub:userId,expires_at:expiry+i})
 registry.set('foreign',{mode:'staff',account_sub:randomUUID(),expires_at:expiry})
 registry.set('legacy',{mode:'google',account_sub:userId,expires_at:expiry})
 registry.set('expired',{mode:'staff',account_sub:userId,expires_at:Date.now()-1})
 const response=await staffSessionsGet(request('/api/admin-auth/sessions'))
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store')
 const result=await response.json()
 assert.equal(result.otherSessionCount,51);assert.equal(result.otherSessions.length,50);assert.equal(result.truncated,true)
 assert.deepEqual(Object.keys(result.current),['expiresAt']);assert.ok(result.otherSessions.every((row:object)=>Object.keys(row).join(',')==='expiresAt'))
 assert.ok(!JSON.stringify(result).includes(userId));assert.ok(!JSON.stringify(result).includes(staffSessionHash(sessionId)))
})

test('session security is unavailable before password and second-step verification or after revocation',async()=>{
 for(const handler of [staffSessionsGet,staffSessionsRevokeOthersPost]) {
  const req=()=>request('/api/admin-auth/sessions',{...(handler===staffSessionsRevokeOthersPost?{body:{}}:{})})
  user.app_metadata.lk_staff_password_change_required=true;assert.equal((await handler(req())).status,403)
  user.app_metadata.lk_staff_password_change_required=false;assurance='aal1';assert.equal((await handler(req())).status,403)
  assurance='aal2';user.app_metadata.lk_staff={company_id:'lk-group',role:'admin',status:'revoked'};assert.equal((await handler(req())).status,403)
  user.app_metadata.lk_staff={company_id:'lk-group',role:'admin',status:'active'}
 }
 assert.ok(!writes.includes('sessions_revoke_others'));assert.ok(!writes.includes('logout:others'))
})

test('other-session removal keeps current cookie registry email proof and membership intact',async()=>{
 process.env.STAFF_ADMIN_SECOND_STEP='email';user.email='lnkgroupsydney@gmail.com';assurance='aal1'
 emailState={challengeId:randomUUID(),sent:false,expiresAt:Date.now()+600_000,retryAt:Date.now()+60_000,verifiedUntil:Date.now()+600_000}
 const originalProof=structuredClone(emailState),originalMembership=structuredClone(user.app_metadata)
 registry.set('other',{mode:'staff',account_sub:userId,expires_at:Date.now()+600_000})
 registry.set('foreign',{mode:'staff',account_sub:randomUUID(),expires_at:Date.now()+600_000})
 registry.set('legacy',{mode:'local',account_sub:userId,expires_at:Date.now()+600_000})
 const response=await staffSessionsRevokeOthersPost(request('/api/admin-auth/sessions/revoke-others',{body:{}}))
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{esnAccessRemoved:true,authCleanupComplete:true,removedSessionCount:1})
 assert.equal(response.headers.get('set-cookie'),null)
 assert.ok(registry.has(staffSessionHash(sessionId)));assert.ok(!registry.has('other'));assert.ok(registry.has('foreign'));assert.ok(registry.has('legacy'))
 assert.deepEqual(emailState,originalProof);assert.deepEqual(user.app_metadata,originalMembership)
 assert.deepEqual(writes,['sessions_revoke_others','logout:others'])
 assert.equal((await (await staffSessionGet(request('/api/admin-auth/session'))).json()).stage,'ready')
})

test('Auth cleanup failure preserves committed ESN removal and retries with zero other rows',async()=>{
 registry.set('other',{mode:'staff',account_sub:userId,expires_at:Date.now()+600_000});logoutFailure=true
 let response=await staffSessionsRevokeOthersPost(request('/api/admin-auth/sessions/revoke-others',{body:{}}))
 assert.equal(response.status,503);const result=await response.json()
 assert.equal(result.code,'AUTH_CLEANUP_PENDING');assert.equal(result.esnAccessRemoved,true);assert.equal(result.authCleanupComplete,false)
 assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));assert.ok(!registry.has('other'));assert.ok(registry.has(staffSessionHash(sessionId)));assert.equal(response.headers.get('set-cookie'),null)
 logoutFailure=false;response=await staffSessionsRevokeOthersPost(request('/api/admin-auth/sessions/revoke-others',{body:{}}))
 assert.equal(response.status,200);assert.equal((await response.json()).removedSessionCount,0)
 assert.equal(writes.filter(value=>value==='logout:others').length,2)
})

test('transaction recheck rejects a removed current registry without calling Auth cleanup',async()=>{
 revokeRace=true
 const response=await staffSessionsRevokeOthersPost(request('/api/admin-auth/sessions/revoke-others',{body:{}}))
 assert.equal(response.status,401);assert.ok(!writes.includes('logout:others'))
})

test('session registry failures fail closed without provider cleanup',async()=>{
 sessionsRpcFailure=true
 assert.equal((await staffSessionsGet(request('/api/admin-auth/sessions'))).status,503)
 assert.equal((await staffSessionsRevokeOthersPost(request('/api/admin-auth/sessions/revoke-others',{body:{}}))).status,503)
 assert.ok(!writes.includes('logout:others'))
})

test('other-session command rejects cross-origin malformed and identity-targeting input',async()=>{
 for(const options of [{body:{userId:randomUUID()}},{body:{tokenHash:'foreign'}},{body:{scope:'global'}},{raw:'[]'},{raw:'null'},{raw:'{}',headers:{'content-type':'text/plain'}},{body:{},origin:'https://foreign.invalid'}]) {
  const response=await staffSessionsRevokeOthersPost(request('/api/admin-auth/sessions/revoke-others',options))
  assert.ok([400,403,415].includes(response.status))
 }
 assert.ok(!writes.includes('sessions_revoke_others'));assert.ok(!writes.includes('logout:others'))
})

test('an admin can manage their own sessions without owner-only integration privileges',async()=>{
 user.app_metadata.lk_staff={company_id:'lk-group',role:'admin',status:'active'}
 assert.equal((await staffSessionsGet(request('/api/admin-auth/sessions'))).status,200)
 assert.equal((await staffSessionsRevokeOthersPost(request('/api/admin-auth/sessions/revoke-others',{body:{}}))).status,200)
})

const deployedBase='https://lnkgroup.vercel.app'
function deployedRequest(path:string,options:Parameters<typeof request>[1]={}) {
 return request(path,{...options,urlBase:deployedBase,origin:options.origin??deployedBase,
  headers:{host:'lnkgroup.vercel.app','x-forwarded-host':'lnkgroup.vercel.app','x-forwarded-proto':'https','x-forwarded-port':'443',...options.headers}})
}
function configureDeployed() {process.env.APP_BASE_URL=deployedBase;process.env.LOCAL_OPERATIONS_ENABLED='false'}
function assertSecureCookies(response:Response) {
 const values=response.headers.getSetCookie();assert.ok(values.length)
 for(const value of values) {
  assert.match(value,/^lk-staff-auth(?:\.\d+)?=/)
  assert.match(value,/; Secure(?:;|$)/);assert.match(value,/; HttpOnly(?:;|$)/)
  assert.match(value,/; SameSite=Lax(?:;|$)/);assert.match(value,/; Path=\/(?:;|$)/)
  assert.doesNotMatch(value,/; Domain=/)
 }
}

test('configured HTTPS staff login works with local preview disabled and sets host-only secure cookies',async()=>{
 configureDeployed()
 assert.deepEqual(requireStaffRequest(deployedRequest('/api/admin-auth/session')),{origin:deployedBase,secure:true,mode:'https'})
 const response=await staffLoginPost(deployedRequest('/api/admin-auth/login',{cookie:'',body:{email:user.email,password:'synthetic-password'}}))
 assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).stage,'ready')
 assertSecureCookies(response)
 assert.equal((await requireStaffAdmin(deployedRequest('/api/operations'))).role,'owner')
 assert.equal((await(await staffOperationsSessionGet(deployedRequest('/api/operations/session'))).json()).authenticated,true)
 assert.equal(localLoginAvailable(),false)
})

test('HTTPS session refresh and revoked-member logout retain secure cookie flags',async()=>{
 configureDeployed()
 const expired=session();expired.expires_at=Math.floor(Date.now()/1000)-60
 const refreshed=await staffSessionGet(deployedRequest('/api/admin-auth/session',{cookie:`${STAFF_COOKIE}=base64-${Buffer.from(JSON.stringify(expired)).toString('base64url')}`}))
 assert.equal(refreshed.status,200,await refreshed.clone().text());assertSecureCookies(refreshed)
 assert.ok(requests.includes('POST /auth/v1/token'))
 user.app_metadata.lk_staff={company_id:'lk-group',role:'owner',status:'revoked'}
 const cleared=await staffLogoutPost(deployedRequest('/api/admin-auth/logout',{body:{}}))
 assert.equal(cleared.status,200);assertSecureCookies(cleared)
 assert.ok(cleared.headers.getSetCookie().some(value=>value.includes('Max-Age=0')))
 assert.equal(registry.has(staffSessionHash(sessionId)),false)
})

test('HTTPS rejects foreign URLs authorities and ambiguous proxy headers before any provider call',async()=>{
 configureDeployed()
 const invalid=[
  request('/api/admin-auth/session',{urlBase:'https://foreign.invalid',headers:{host:'lnkgroup.vercel.app','x-forwarded-host':'lnkgroup.vercel.app','x-forwarded-proto':'https'}}),
  request('/api/admin-auth/session',{urlBase:'http://lnkgroup.vercel.app',headers:{host:'lnkgroup.vercel.app','x-forwarded-proto':'https'}}),
  new Request(`${deployedBase}/api/admin-auth/session`),
  ...[
   {host:'foreign.invalid'},{host:'lnkgroup.vercel.app:443'},
   {'x-forwarded-host':'foreign.invalid'},{'x-forwarded-host':'lnkgroup.vercel.app, foreign.invalid'},
   {'x-forwarded-proto':'http'},{'x-forwarded-proto':'https, http'},{'x-forwarded-port':'80'},
   {forwarded:'host=foreign.invalid;proto=https'},{forwarded:'host=lnkgroup.vercel.app;proto=http'},
   {forwarded:'host=lnkgroup.vercel.app;proto=https, host=foreign.invalid;proto=https'},
   {forwarded:'host=lnkgroup.vercel.app;host=foreign.invalid;proto=https'},
   {forwarded:'host="lnkgroup.vercel.app\\";proto=https'},
  ].map(headers=>deployedRequest('/api/admin-auth/session',{headers})),
 ]
 for(const req of invalid) {
  assert.throws(()=>staffRequestClient(req),errorCode('STAFF_ORIGIN_DENIED'))
  const response=await staffSessionGet(req);assert.equal(response.status,403);assert.equal(response.headers.get('set-cookie'),null)
 }
 assert.equal(requests.length,0)
 const coherent=deployedRequest('/api/admin-auth/session',{headers:{forwarded:'for="192.0.2.1";host="lnkgroup.vercel.app";proto=https'}})
 assert.equal(requireStaffRequest(coherent).secure,true)
})

test('HTTPS mutations require exact origin including direct admin grants and deny missing origin',async()=>{
 configureDeployed()
 for(const req of [
  deployedRequest('/api/admin-auth/login',{body:{},origin:'https://foreign.invalid'}),
  deployedRequest('/api/admin-auth/login',{body:{},origin:'https://branch.lnkgroup.vercel.app'}),
  deployedRequest('/api/admin-auth/login',{body:{},headers:{'sec-fetch-site':'cross-site'}}),
  new Request(`${deployedBase}/api/operations`,{method:'POST',headers:{host:'lnkgroup.vercel.app',cookie:cookie()}}),
 ]) {
  assert.equal((await staffLoginPost(req)).status,403)
  await assert.rejects(requireStaffAdmin(req,'operations.write'),errorCode('STAFF_ORIGIN_DENIED'))
 }
 assert.equal(requests.length,0)
})

test('HTTPS never converts customer draft customer auth or legacy cookies into staff sessions',async()=>{
 configureDeployed()
 const req=deployedRequest('/api/admin-auth/session',{cookie:`lk_quote_draft=synthetic-draft; lk_ops_session=synthetic-legacy; lk-customer-auth=${cookie().split('=')[1]}`})
 const response=await staffSessionGet(req)
 assert.deepEqual(await response.json(),{authenticated:false,stage:'signed_out'})
 await assert.rejects(requireStaffAdmin(req),errorCode('AUTHENTICATION_REQUIRED'))
 assert.equal(requests.length,0)
})

test('HTTPS staff Google reconnect uses the configured callback and current staff binding',async()=>{
 configureDeployed()
 assert.equal(googleConfigured(),true)
 const started=await startOAuth(deployedRequest('/api/google/connect'))
 const url=new URL(started.url),state=url.searchParams.get('state')!
 assert.equal(url.searchParams.get('redirect_uri'),`${deployedBase}/api/google/callback`)
 assert.match(started.cookie,/; Secure$/)
 assert.equal([...oauthStates.values()][0].session_hash,staffSessionHash(sessionId))
 const response=await finishOAuth(deployedRequest('/api/google/callback',{cookie:`${cookie()}; ${started.cookie.split(';')[0]}`,headers:{'sec-fetch-site':'cross-site'}}),state,'synthetic-code')
 assert.equal(response,null);assert.equal(googleRequests,2);assert.deepEqual(writes,['google_reconnect'])
})

test('Google HTTPS configuration is unavailable without staff store or a valid fixed origin',()=>{
 configureDeployed()
 assert.equal(googleConfigured(),true)
 for(const configured of ['https://lnkgroup.vercel.app/path','https://lnkgroup.vercel.app?next=1','https://user@lnkgroup.vercel.app','https://localhost','https://*.vercel.app']) {
  process.env.APP_BASE_URL=configured
  assert.equal(googleConfigured(),false,configured)
  assert.throws(()=>staffRequestClient(deployedRequest('/api/admin-auth/session')),errorCode('ACCESS_UNAVAILABLE'))
 }
 process.env.APP_BASE_URL=deployedBase;process.env.OPERATIONS_STORE='sqlite';assert.equal(googleConfigured(),false)
 process.env.OPERATIONS_STORE='supabase';process.env.STAFF_ADMIN_AUTH_ENABLED='false';assert.equal(googleConfigured(),false)
})

test('local staff transport retains the Next loopback alias and denies forwarded or disabled preview',()=>{
 const normalized=request('/api/admin-auth/session',{urlBase:'http://localhost:3002',headers:{host:'127.0.0.1:3002'}})
 assert.deepEqual(requireStaffRequest(normalized),{origin:base,secure:false,mode:'local'})
 for(const headers of [
  {'x-forwarded-host':'foreign.invalid'}, {'x-forwarded-proto':'https'},
  {'x-forwarded-port':'443'}, {forwarded:'host=lnkgroup.vercel.app;proto=https'},
 ]) assert.throws(()=>staffRequestClient(request('/api/admin-auth/session',{headers})),errorCode('LOCAL_PREVIEW_ORIGIN_DENIED'))
 process.env.LOCAL_OPERATIONS_ENABLED='false'
 assert.throws(()=>staffRequestClient(normalized),errorCode('LOCAL_PREVIEW_UNAVAILABLE'))
 configureDeployed()
 assert.throws(()=>staffRequestClient(normalized),errorCode('STAFF_ORIGIN_DENIED'))
 assert.equal(requests.length,0)
})

test('staff HTTPS accepts opaque Vercel sig/exp while authority mismatches remain denied',async()=>{
 configureDeployed();const forwarded='for=192.0.2.1;host="lnkgroup.vercel.app";proto=https;sig=synthetic==;exp=123';
 const coherent=deployedRequest('/api/admin-auth/session',{headers:{forwarded}});assert.equal(requireStaffRequest(coherent).origin,deployedBase);assert.equal((await staffSessionGet(coherent)).status,200);
 const before=requests.length;
 for(const headers of [{host:'foreign.invalid',forwarded},{'x-forwarded-host':'foreign.invalid',forwarded},{'x-forwarded-proto':'http',forwarded},{'x-forwarded-port':'80',forwarded},{forwarded:forwarded.replace('lnkgroup.vercel.app','foreign.invalid')},{forwarded:forwarded.replace('proto=https','proto=http')}]){
  const req=deployedRequest('/api/admin-auth/session',{headers});assert.throws(()=>staffRequestClient(req),errorCode('STAFF_ORIGIN_DENIED'));assert.equal((await staffSessionGet(req)).status,403);
 }
 assert.equal(requests.length,before);
})
test('staff HTTPS rejects duplicate or malformed Forwarded extension parameters before provider access',async()=>{
 configureDeployed();
 for(const extension of ['sig=x;SIG=y','exp=1;EXP=2','invalid name=x','sig="unterminated','sig="escaped\\value"','sig=one,two','sig=','sig=x;']){
  const req=deployedRequest('/api/admin-auth/session',{headers:{forwarded:`host=lnkgroup.vercel.app;proto=https;${extension}`}});assert.throws(()=>staffRequestClient(req),errorCode('STAFF_ORIGIN_DENIED'));assert.equal((await staffSessionGet(req)).status,403);
 }
 assert.equal(requests.length,0);
 assert.equal(parseSingleForwarded('host=lnkgroup.vercel.app;sig="bad\u0000value"'),null);
})


test('staff integration discovery lists missing OAuth settings consistently without exposing secret values',async()=>{
 configureDeployed()
 const req=deployedRequest('/api/operations/session')
 const initial=await staffOperationsSessionGet(req);assert.equal(initial.status,200)
 const configured=await initial.json();assert.equal(configured.googleConfigured,true);assert.deepEqual(configured.missingConfiguration,[])
 for(const name of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_TOKEN_ENCRYPTION_KEY'] as const){
  const saved=process.env[name];delete process.env[name]
  try{const response=await staffOperationsSessionGet(req);assert.equal(response.status,200);const value=await response.json();assert.equal(value.authenticated,true);assert.equal(value.googleConfigured,false);assert.deepEqual(value.missingConfiguration,[name]);assert.ok(!JSON.stringify(value).includes('synthetic-google-secret'))}finally{process.env[name]=saved}
 }
 process.env.GOOGLE_TOKEN_ENCRYPTION_KEY='invalid-non-hex-key'
 const invalid=await(await staffOperationsSessionGet(req)).json();assert.equal(invalid.googleConfigured,false);assert.deepEqual(invalid.missingConfiguration,['GOOGLE_TOKEN_ENCRYPTION_KEY'])
 process.env.GOOGLE_TOKEN_ENCRYPTION_KEY='44'.repeat(32);process.env.GOOGLE_CLIENT_ID='   '
 const blank=await(await staffOperationsSessionGet(req)).json();assert.equal(blank.googleConfigured,false);assert.deepEqual(blank.missingConfiguration,['GOOGLE_CLIENT_ID'])
})
