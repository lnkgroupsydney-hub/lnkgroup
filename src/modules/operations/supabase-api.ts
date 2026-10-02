import {AppError,validateEnquiry,validateSchedule} from './domain/validation.ts'
import {safe,json,body,requireOrigin,idFrom} from './server-api.ts'
import {OWNER_EMAIL,googleConfigured,localLoginAvailable,verifyLocalPassword,clearSessionCookie,clearOauthCookie} from './infrastructure/auth.ts'
import {operationsCommand as command} from './infrastructure/supabase-client.ts'
import * as auth from './infrastructure/supabase-auth.ts'
import {createEnquiry,dashboardData,importGmail,enquiryFromRow,type CloudEnquiryRow} from './infrastructure/supabase-store.ts'
import * as calendar from './infrastructure/supabase-calendar.ts'
import {listGmailLabels,readEnquiryMessagePage} from '../gmail-intake/index.ts'
import {randomUUID} from 'node:crypto'
import {localEnabled} from './infrastructure/local-db.ts'
import {googleFailure} from './infrastructure/google-errors.ts'
import {connectionState,googleHealthCommand,recordGoogleHealth} from './infrastructure/supabase-google-health.ts'

export const sessionGet=safe(async(req)=>{
 const session=await auth.getSession(req)
 const missing=[!localEnabled()&&'LOCAL_OPERATIONS_ENABLED + loopback APP_BASE_URL',!process.env.NEXT_PUBLIC_SUPABASE_URL&&'NEXT_PUBLIC_SUPABASE_URL',!process.env.SUPABASE_SECRET_KEY&&'SUPABASE_SECRET_KEY',!process.env.LOCAL_OWNER_PASSWORD&&'LOCAL_OWNER_PASSWORD',!process.env.GOOGLE_CLIENT_ID&&'GOOGLE_CLIENT_ID',!process.env.GOOGLE_CLIENT_SECRET&&'GOOGLE_CLIENT_SECRET',!/^[0-9a-fA-F]{64}$/.test(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY||'')&&'GOOGLE_TOKEN_ENCRYPTION_KEY'].filter(Boolean)
 return json({authenticated:!!session,mode:session?.mode??null,ownerEmail:OWNER_EMAIL,localLoginAvailable:localLoginAvailable(),googleConfigured:googleConfigured(),missingConfiguration:missing,storage:'supabase'})
})
export const loginPost=safe(async(req)=>{
 if(!localLoginAvailable())throw new AppError(503,'Local operations login is not enabled')
 const x=await body(req,2000)
 await command('rate_limit',{bucket:'login:global',max:8,window:900000})
 if(!verifyLocalPassword(x.password))throw new AppError(401,'Invalid credentials')
 const response=json({authenticated:true,mode:'local'})
 response.headers.append('set-cookie',await auth.createSession('local',null));return response
})
export const logoutPost=safe(async(req)=>{
 requireOrigin(req);await auth.requireSession(req);await auth.destroySession(req)
 const response=json({authenticated:false});response.headers.append('set-cookie',clearSessionCookie());return response
})
export const enquiryPost=safe(async(req)=>{
 const saved=await createEnquiry(validateEnquiry(await body(req)))
 return json({id:saved.id,reference:saved.reference,status:saved.status,calendarStatus:saved.calendarStatus},201)
})
export const operationsGet=safe(async(req)=>{
 await auth.requireSession(req)
 const [data,c]=await Promise.all([dashboardData(),auth.getConnection()])
 return json({enquiries:data.enquiries,changes:data.changes,storage:'supabase',calendar:{configured:googleConfigured(),...connectionState(c,'calendar',googleConfigured()),email:c?.email??null,selectedCalendarId:c?.selected_calendar_id??null,lastSyncedAt:c?.calendar_last_synced_at??null},gmail:{configured:googleConfigured(),...connectionState(c,'gmail',googleConfigured()),selectedLabelId:c?.selected_gmail_label_id??null,lastSyncedAt:c?.gmail_last_synced_at??null,quarantine:data.quarantine}})
})
export const schedulePost=safe(async(req)=>{
 await auth.requireSession(req);const x=await body(req,3000)
 if(!Number.isInteger(x.expectedRevision)||(x.expectedRevision as number)<1)throw new AppError(400,'Invalid revision')
 const dates=validateSchedule(x.startLocal,x.endLocal)
 if(x.notes!==undefined&&(typeof x.notes!=='string'||x.notes.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x.notes)))throw new AppError(400,'Invalid notes')
 const row=await command<CloudEnquiryRow>('schedule',{id:idFrom(req,'enquiries'),revision:x.expectedRevision,start:dates.startAt,end:dates.endAt,notes:(x.notes as string||'').trim()})
 return json({enquiry:enquiryFromRow(row)})
})
export const calendarsGet=safe(async(req)=>{await auth.requireSession(req);return json({calendars:await calendar.ownedCalendars()})})
export const calendarPost=safe(async(req)=>{
 await auth.requireSession(req);const x=await body(req,1000);if(typeof x.calendarId!=='string')throw new AppError(400,'Invalid calendar')
 await calendar.selectCalendar(x.calendarId);return json({selectedCalendarId:x.calendarId})
})
async function gmailRequest(path:string,init:RequestInit={},holder?:string) {
 if(!path.startsWith('/')||path.startsWith('//'))throw new AppError(400,'Invalid Gmail path')
 return auth.googleRequest('gmail',`https://gmail.googleapis.com/gmail/v1/users/me${path}`,init,holder)
}
export const gmailLabelsGet=safe(async(req)=>{await auth.requireSession(req);return json({labels:await listGmailLabels({request:gmailRequest})})})
export const gmailLabelPost=safe(async(req)=>{
 await auth.requireSession(req);const x=await body(req,1000)
 if(typeof x.labelId!=='string'||x.labelId.length>512)throw new AppError(400,'Invalid Gmail label')
 if(!(await listGmailLabels({request:gmailRequest})).some(l=>l.id===x.labelId))throw new AppError(403,'Choose a user-created Gmail label')
 await googleHealthCommand('select',{kind:'gmail',id:x.labelId});return json({selectedLabelId:x.labelId})
})
async function syncGmail(holder:string) {
 const c=await auth.getConnection();if(!c?.selected_gmail_label_id)return {imported:0,scanned:0,partial:false,skipped:'No label selected'}
 const {account}=await auth.accessToken(holder);let pageToken=c.gmail_page_token||undefined,imported=0,scanned=0,restarted=false
 const request=async(path:string,init?:RequestInit)=>{await calendar.renew(holder);return gmailRequest(path,init,holder)}
 for(let i=0;i<20;i++){
  await calendar.renew(holder)
  let page:Awaited<ReturnType<typeof readEnquiryMessagePage>>
  try { page=await readEnquiryMessagePage({request,labelId:c.selected_gmail_label_id,pageToken,maxResults:100,isAlreadyImported:async(message:string)=>command<boolean>('gmail_seen',{account,message})}) }
  catch(error) {
   if(pageToken&&!restarted&&error&&typeof error==='object'&&'code' in error&&error.code==='gmail_invalid_page_token') {
    await googleHealthCommand('reset_gmail_cursor',{holder,account,label:c.selected_gmail_label_id,expected_token:pageToken})
    restarted=true;pageToken=undefined
    continue
   }
   throw error
  }
  scanned+=page.messages.length+page.alreadyImportedCount+page.missingMessageCount+page.skippedOutboundCount
  for(const item of page.rejectedMessages)await command('gmail_quarantine',{holder,account,message:item.messageId,reason:item.reason})
  for(const candidate of page.messages){await importGmail(account,candidate,holder);imported++}
  await calendar.renew(holder);pageToken=page.nextPageToken||undefined
  await command('gmail_cursor',{holder,account,label:c.selected_gmail_label_id,token:pageToken??null})
  if(!pageToken)return {imported,scanned,partial:false}
 }
 return {imported,scanned,partial:true}
}
export async function syncAll() {
 const holder=randomUUID();if(!await command<boolean>('sync_acquire',{holder}))throw new AppError(409,'Sync already in progress')
 let gmail:unknown={imported:0,scanned:0,partial:false,skipped:'No label selected'},cal:unknown={synced:0,conflicts:0,failed:0,scanned:0,reviewed:0,skipped:'No calendar selected'}
 const failureResult=async(error:unknown,kind:'gmail'|'calendar',started:number)=>{
  const failure=googleFailure(error),current=await auth.getConnection()
  const alreadyRecorded=error&&typeof error==='object'&&'code' in error&&String(error.code).startsWith('google_')
  if(current&&!alreadyRecorded)await recordGoogleHealth(current,kind,failure.code,started,holder)
  return {error:failure.message,code:failure.code,retryable:failure.retryable}
 }
 try{
  let started=Date.now()
  try{
   const result=await syncGmail(holder);gmail=result
   const current=await auth.getConnection()
   if(current?.selected_gmail_label_id)await recordGoogleHealth(current,'gmail',result.partial?'partial':'ready',started,holder)
  }catch(error){gmail=await failureResult(error,'gmail',started)}
  const c=await auth.getConnection();started=Date.now()
  if(c?.selected_calendar_id)try{
   const pushed=await calendar.pushPending(c.selected_calendar_id,holder)
   const pulled=await calendar.pullChanges(c.selected_calendar_id,holder);cal={...pushed,...pulled}
   const current=await auth.getConnection()
   if(current)await recordGoogleHealth(current,'calendar',pushed.failed?'google_temporary':'ready',started,holder)
  }catch(error){cal=await failureResult(error,'calendar',started)}
  return {gmail,calendar:cal}
 }finally{await command('sync_release',{holder})}
}
export const syncPost=safe(async(req)=>{requireOrigin(req);await auth.requireSession(req);return json(await syncAll())})
export const changePost=safe(async(req)=>{
 await auth.requireSession(req);const x=await body(req,1000)
 if((x.action!=='approve'&&x.action!=='reject')||!Number.isInteger(x.expectedRevision)||(x.expectedRevision as number)<1)throw new AppError(400,'Invalid change decision')
 return json(await calendar.decideChange(idFrom(req,'changes'),x.action,x.expectedRevision as number))
})
export const googleConnectGet=safe(async(req)=>{
 if(req.headers.get('sec-fetch-site')==='cross-site')throw new AppError(403,'Same-site navigation required')
 const started=await auth.startOAuth(req)
 return new Response(null,{status:302,headers:{location:started.url,'set-cookie':started.cookie,'cache-control':'no-store'}})
})
export const googleCallbackGet=safe(async(req)=>{
 const url=new URL(req.url);if(url.searchParams.has('error'))throw new AppError(400,'Google permission was not granted')
 const session=await auth.finishOAuth(req,url.searchParams.get('state')||'',url.searchParams.get('code')||'')
 const destination=new URL('/admin',process.env.APP_BASE_URL)
 destination.searchParams.set('google','connected')
 const response=new Response(null,{status:302,headers:{location:destination.toString(),'cache-control':'no-store'}})
 response.headers.append('set-cookie',clearOauthCookie());if(session)response.headers.append('set-cookie',session)
 response.headers.set('cache-control','no-store');return response
})
