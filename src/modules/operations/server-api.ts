import { createHash, randomUUID } from 'node:crypto'
import { AppError, validateEnquiry, validateSchedule } from './domain/validation.ts'
import { acquireSyncLease, getDb, localEnabled, releaseSyncLease, renewSyncLease } from './infrastructure/local-db.ts'
import { clearOauthCookie, clearSessionCookie, createSession, destroySession, finishGoogleOAuth, getAuthorizedGoogleAccessToken, googleConfigured, requireSession, sessionInfo, startGoogleOAuth, verifyLocalPassword } from './infrastructure/auth.ts'
import { createEnquiry, listChanges, listEnquiries, rateLimit, saveImportedGmailEnquiry, scheduleEnquiry } from './infrastructure/store.ts'
import { decideChange, listOwnedCalendars, pullChanges, pushPending, selectCalendar } from './infrastructure/google-calendar.ts'
import { listGmailLabels, readEnquiryMessagePage } from '../gmail-intake/index.ts'

type JsonValue = Record<string, unknown>
export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers:{ 'cache-control':'no-store' } }) }

export function safe(handler: (req: Request) => Promise<Response> | Response): (req: Request) => Promise<Response> {
  return async (req) => {
    try { return await handler(req) }
    catch (error) {
      if (error instanceof AppError) return json({ error:error.message }, error.status)
      return json({ error:'Operation unavailable; retry or review configuration' }, 503)
    }
  }
}

export function requireOrigin(req: Request): void {
  const base = process.env.APP_BASE_URL
  if (!base) throw new AppError(503, 'Local operations are not configured')
  const origin = req.headers.get('origin')
  if (origin !== new URL(base).origin || req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError(403, 'Same-origin request required')
}

export async function body(req: Request, max = 12000): Promise<JsonValue> {
  requireOrigin(req)
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError(415, 'JSON required')
  const length = Number(req.headers.get('content-length') || 0)
  if (length > max) throw new AppError(413, 'Request too large')
  const reader = req.body?.getReader()
  if (!reader) throw new AppError(400, 'Body required')
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > max) { await reader.cancel(); throw new AppError(413, 'Request too large') }
    chunks.push(value)
  }
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) }
  catch { throw new AppError(400, 'Invalid JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AppError(400, 'Invalid JSON object')
  return parsed as JsonValue
}

export function idFrom(req: Request, segment: string): string {
  const path = new URL(req.url).pathname.split('/')
  const i = path.indexOf(segment)
  const id = path[i + 1]
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new AppError(400, 'Invalid ID')
  return id
}

function connectionRow(): { account_sub:string; email:string; selected_calendar_id:string|null; calendar_last_synced_at:string|null; calendar_error:string|null; selected_gmail_label_id:string|null; gmail_last_synced_at:string|null; gmail_error:string|null; gmail_page_token:string|null } | null {
  if (!localEnabled()) return null
  return getDb().prepare('SELECT account_sub,email,selected_calendar_id,calendar_last_synced_at,calendar_error,selected_gmail_label_id,gmail_last_synced_at,gmail_error,gmail_page_token FROM google_connection WHERE id=1').get() as ReturnType<typeof connectionRow>
}

export const sessionGet = safe((req) => json(sessionInfo(req)))

export const loginPost = safe(async (req) => {
  if (!localEnabled()) throw new AppError(503, 'Local operations are not enabled')
  const x = await body(req, 2000)
  const db = getDb()
  rateLimit(db, 'login:global', 8, 15 * 60000)
  if (!verifyLocalPassword(x.password)) throw new AppError(401, 'Invalid credentials')
  const response = json({ authenticated:true, mode:'local' })
  response.headers.append('set-cookie', createSession('local', null, db))
  return response
})

export const logoutPost = safe(async (req) => {
  requireOrigin(req)
  requireSession(req)
  destroySession(req)
  const response = json({ authenticated:false })
  response.headers.append('set-cookie', clearSessionCookie())
  return response
})

export const enquiryPost = safe(async (req) => {
  if (!localEnabled()) throw new AppError(503, 'Enquiry intake is not enabled')
  const x = validateEnquiry(await body(req, 12000))
  const db = getDb()
  const existing = db.prepare('SELECT 1 FROM enquiries WHERE idempotency_key=?').get(x.idempotencyKey)
  if (!existing) {
    const identity = createHash('sha256').update(x.email).digest('hex').slice(0, 24)
    rateLimit(db, `enquiry:${identity}`, 5, 3600000)
    rateLimit(db, 'enquiry:global', 100, 3600000)
  }
  const saved = createEnquiry(x, db)
  return json({ id:saved.id, reference:saved.reference, status:saved.status, calendarStatus:saved.calendarStatus }, 201)
})

export const operationsGet = safe((req) => {
  requireSession(req)
  const conn = connectionRow()
  return json({
    enquiries:listEnquiries(), changes:listChanges(),
    calendar:{ configured:googleConfigured(), connected:!!conn && googleConfigured(), email:conn?.email || null, selectedCalendarId:conn?.selected_calendar_id || null, lastSyncedAt:conn?.calendar_last_synced_at || null, error:conn?.calendar_error || null },
    gmail:{ configured:googleConfigured(), connected:!!conn && googleConfigured(), selectedLabelId:conn?.selected_gmail_label_id || null, lastSyncedAt:conn?.gmail_last_synced_at || null, error:conn?.gmail_error || null,
      quarantine:(getDb().prepare('SELECT message_id,reason,last_seen_at FROM gmail_quarantine ORDER BY last_seen_at DESC LIMIT 100').all() as {message_id:string;reason:string;last_seen_at:string}[]).map((q) => ({ messageId:q.message_id, reason:q.reason, lastSeenAt:q.last_seen_at })) },
  })
})

export const schedulePost = safe(async (req) => {
  requireSession(req)
  const x = await body(req, 3000)
  if (!Number.isInteger(x.expectedRevision) || (x.expectedRevision as number) < 1) throw new AppError(400, 'Invalid revision')
  const dates = validateSchedule(x.startLocal, x.endLocal)
  if (x.notes !== undefined && (typeof x.notes !== 'string' || x.notes.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x.notes))) throw new AppError(400, 'Invalid notes')
  const enquiry = scheduleEnquiry(idFrom(req, 'enquiries'), x.expectedRevision as number, dates.startAt, dates.endAt, (x.notes as string || '').trim())
  return json({ enquiry })
})

export const calendarsGet = safe(async (req) => {
  requireSession(req)
  return json({ calendars: await listOwnedCalendars() })
})

export const calendarPost = safe(async (req) => {
  requireSession(req)
  const x = await body(req, 1000)
  if (typeof x.calendarId !== 'string') throw new AppError(400, 'Invalid calendar')
  await selectCalendar(x.calendarId)
  return json({ selectedCalendarId:x.calendarId })
})

async function gmailRequest(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new AppError(400, 'Invalid Gmail path')
  const { accessToken } = await getAuthorizedGoogleAccessToken()
  return fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, { ...init, headers:{ Authorization:`Bearer ${accessToken}`, ...(init.headers || {}) }, cache:'no-store', signal:AbortSignal.timeout(15000) })
}

export const gmailLabelsGet = safe(async (req) => {
  requireSession(req)
  return json({ labels:await listGmailLabels({ request:gmailRequest }) })
})

export const gmailLabelPost = safe(async (req) => {
  requireSession(req)
  const x = await body(req, 1000)
  if (typeof x.labelId !== 'string' || x.labelId.length > 512) throw new AppError(400, 'Invalid Gmail label')
  const labels = await listGmailLabels({ request:gmailRequest })
  if (!labels.some((l) => l.id === x.labelId)) throw new AppError(403, 'Choose a user-created Gmail label')
  const db = getDb()
  const lease = db.prepare('SELECT expires_at FROM sync_lease WHERE id=1').get() as {expires_at:number}|undefined
  if (lease && lease.expires_at > Date.now()) throw new AppError(409, 'Sync in progress; retry label selection')
  db.prepare('UPDATE google_connection SET selected_gmail_label_id=?,gmail_page_token=NULL,gmail_last_synced_at=NULL,gmail_error=NULL WHERE id=1').run(x.labelId)
  return json({ selectedLabelId:x.labelId })
})

async function syncGmail(holder: string): Promise<{ imported:number; scanned:number; partial:boolean }> {
  const db = getDb()
  const conn = connectionRow()
  if (!conn?.selected_gmail_label_id) return { imported:0, scanned:0, partial:false }
  const { accountSub } = await getAuthorizedGoogleAccessToken(db)
  const leasedRequest = async (path:string, init?:RequestInit) => {
    if (!renewSyncLease(db, holder)) throw new AppError(409, 'Sync lease expired')
    return gmailRequest(path, init)
  }
  let pageToken = conn.gmail_page_token || undefined
  let imported = 0, scanned = 0
  for (let pageNo=0; pageNo<20; pageNo++) {
    if (!renewSyncLease(db, holder)) throw new AppError(409, 'Sync lease expired')
    const page = await readEnquiryMessagePage({
      request:leasedRequest, labelId:conn.selected_gmail_label_id, pageToken, maxResults:100,
      isAlreadyImported:async (messageId:string) => !!db.prepare('SELECT 1 FROM gmail_seen WHERE account_sub=? AND message_id=?').get(accountSub,messageId),
    })
    scanned += page.messages.length + page.alreadyImportedCount + page.missingMessageCount + page.skippedOutboundCount
    const now = new Date().toISOString()
    for (const item of page.rejectedMessages) {
      db.prepare('INSERT INTO gmail_quarantine(account_sub,message_id,reason,first_seen_at,last_seen_at) VALUES(?,?,?,?,?) ON CONFLICT(account_sub,message_id) DO UPDATE SET reason=excluded.reason,last_seen_at=excluded.last_seen_at').run(accountSub,item.messageId,item.reason,now,now)
    }
    for (const candidate of page.messages) {
      saveImportedGmailEnquiry(accountSub, candidate, db)
      db.prepare('DELETE FROM gmail_quarantine WHERE account_sub=? AND message_id=?').run(accountSub,candidate.messageId)
      imported++
    }
    if (!renewSyncLease(db, holder)) throw new AppError(409, 'Sync lease expired')
    pageToken = page.nextPageToken || undefined
    db.prepare('UPDATE google_connection SET gmail_page_token=?,gmail_last_synced_at=?,gmail_error=NULL WHERE id=1 AND account_sub=? AND selected_gmail_label_id=?').run(pageToken || null, pageToken ? null : new Date().toISOString(), accountSub, conn.selected_gmail_label_id)
    if (!pageToken) return { imported, scanned, partial:false }
  }
  return { imported, scanned, partial:true }
}

export async function syncAll(): Promise<{ gmail:unknown; calendar:unknown }> {
  const db = getDb(), holder = randomUUID()
  if (!acquireSyncLease(db, holder)) throw new AppError(409, 'Sync already in progress')
  let gmail:unknown = { imported:0, scanned:0, partial:false, skipped:'No label selected' }
  let calendar:unknown = { synced:0, conflicts:0, failed:0, scanned:0, reviewed:0, skipped:'No calendar selected' }
  try {
    try { gmail = await syncGmail(holder) }
    catch { db.prepare("UPDATE google_connection SET gmail_error='Gmail sync failed; retry available' WHERE id=1").run(); gmail = { error:'Gmail sync failed; retry available' } }
    try { const pushed = await pushPending(db, holder); const pulled = await pullChanges(db, holder); calendar = { ...pushed, ...pulled } }
    catch { db.prepare("UPDATE google_connection SET calendar_error='Calendar sync failed; retry available' WHERE id=1").run(); calendar = { error:'Calendar sync failed; retry available' } }
    return { gmail, calendar }
  } finally { releaseSyncLease(db, holder) }
}

export const syncPost = safe(async (req) => { requireSession(req); requireOrigin(req); return json(await syncAll()) })

export const changePost = safe(async (req) => {
  requireSession(req)
  const x = await body(req, 1000)
  if (x.action !== 'approve' && x.action !== 'reject') throw new AppError(400, 'Invalid action')
  if (!Number.isInteger(x.expectedRevision)) throw new AppError(400, 'Invalid revision')
  return json(await decideChange(idFrom(req, 'changes'), x.action, x.expectedRevision as number))
})

export const googleConnectGet = safe((req) => {
  if (req.headers.get('sec-fetch-site') === 'cross-site') throw new AppError(403, 'Same-site navigation required')
  const { url, cookie } = startGoogleOAuth(req)
  return new Response(null, { status:302, headers:{ location:url, 'set-cookie':cookie, 'cache-control':'no-store' } })
})

export const googleCallbackGet = safe(async (req) => {
  const url = new URL(req.url)
  const state = url.searchParams.get('state') || ''
  const code = url.searchParams.get('code') || ''
  const result = await finishGoogleOAuth(req, state, code)
  const response = new Response(null, { status:302, headers:{ location:`${process.env.APP_BASE_URL}/admin?google=connected`, 'cache-control':'no-store' } })
  response.headers.append('set-cookie', clearOauthCookie())
  if (result.sessionCookie) response.headers.append('set-cookie', result.sessionCookie)
  return response
})
