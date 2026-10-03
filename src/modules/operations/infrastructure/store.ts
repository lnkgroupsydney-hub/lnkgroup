import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ChangeRequest, Enquiry, EnquiryInput } from '../domain/contracts.ts'
import { AppError } from '../domain/validation.ts'
import { getDb, transaction } from './local-db.ts'

type EnquiryRow = { id: string; reference: string; source: 'web'|'gmail'; payload_json: string; status: 'submitted'|'provisional'; revision: number; created_at: string; start_at: string|null; end_at: string|null; schedule_notes: string|null; calendar_status: 'pending'|'synced'|'conflict'|'retrying'; calendar_error: string|null; sender_review_required: number; attachment_count: number }
type ChangeRow = { id: string; enquiry_id: string; reference: string; kind: 'move'|'delete'|'invalid'; proposed_start_at: string|null; proposed_end_at: string|null; proposed_preferred_date: string|null; status: 'pending'|'approved'|'rejected'; revision: number; created_at: string }

export function rowToEnquiry(row: EnquiryRow): Enquiry {
  const payload = JSON.parse(row.payload_json) as EnquiryInput & {demoSubmissionId?:string}
  return {
    ...payload, id: row.id, reference: row.reference, source: row.source,
    status: row.status, revision: row.revision, createdAt: row.created_at,
    startAt: row.start_at, endAt: row.end_at, scheduleNotes: row.schedule_notes,
    calendarStatus: row.calendar_status, calendarError: row.calendar_error,
    acknowledgement: row.source === 'web', senderReviewRequired: !!row.sender_review_required,
    attachmentCount: row.attachment_count,
  }
}

export function getEnquiry(id: string, db = getDb()): Enquiry | null {
  const row = db.prepare('SELECT * FROM enquiries WHERE id=?').get(id) as EnquiryRow | undefined
  return row ? rowToEnquiry(row) : null
}

export function listEnquiries(db = getDb()): Enquiry[] {
  return (db.prepare('SELECT * FROM enquiries ORDER BY created_at DESC LIMIT 500').all() as EnquiryRow[]).map(rowToEnquiry)
}

export function listChanges(db = getDb()): ChangeRequest[] {
  return (db.prepare('SELECT c.*, e.reference FROM change_requests c JOIN enquiries e ON e.id=c.enquiry_id WHERE c.status=\'pending\' ORDER BY c.created_at DESC LIMIT 500').all() as ChangeRow[]).map((r) => ({
    id: r.id, enquiryId: r.enquiry_id, reference: r.reference, kind: r.kind,
    proposedStartAt: r.proposed_start_at, proposedEndAt: r.proposed_end_at,
    proposedPreferredDate: r.proposed_preferred_date, status: r.status,
    revision: r.revision, createdAt: r.created_at,
  }))
}

export function createEnquiry(input: EnquiryInput, db = getDb()): Enquiry {
  const idempotencyKey = input.idempotencyKey
  const payload = { ...input }
  delete (payload as Partial<EnquiryInput>).idempotencyKey
  const json = JSON.stringify(payload)
  const hash = createHash('sha256').update(json).digest('hex')
  return transaction(db, () => {
    const existing = db.prepare('SELECT * FROM enquiries WHERE idempotency_key=?').get(idempotencyKey) as (EnquiryRow & { payload_hash: string }) | undefined
    if (existing) {
      if (existing.payload_hash !== hash) throw new AppError(409, 'Idempotency key was used for another enquiry')
      return rowToEnquiry(existing)
    }
    const id = randomUUID()
    const reference = `KCP-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO enquiries(id,reference,source,idempotency_key,payload_hash,payload_json,status,revision,created_at,calendar_status)
      VALUES(?,?,'web',?,?,?,'submitted',1,?,'pending')`).run(id, reference, idempotencyKey, hash, json, now)
    db.prepare('INSERT INTO outbox(enquiry_id,revision,updated_at) VALUES(?,1,?)').run(id, now)
    return getEnquiry(id, db)!
  })
}

export interface GmailImportedCandidate {
  messageId: string
  threadId: string
  internalDate: string | null
  senderName: string | null
  senderEmail: string | null
  senderReviewRequired: true
  subject: string
  bodyText: string
  bodyStatus: 'available'|'empty'|'invalid_encoding'|'unavailable'|'truncated'
  attachments: { filename: string|null; mimeType: string|null; size: number|null }[]
  attachmentCount: number
}

export function saveImportedGmailEnquiry(accountSub: string, candidate: GmailImportedCandidate, db = getDb()): Enquiry {
  return transaction(db, () => {
    const seen = db.prepare('SELECT enquiry_id FROM gmail_seen WHERE account_sub=? AND message_id=?').get(accountSub, candidate.messageId) as { enquiry_id: string } | undefined
    if (seen) return getEnquiry(seen.enquiry_id, db)!
    const message = { messageId:candidate.messageId, receivedAt:candidate.internalDate, senderName:candidate.senderName, senderEmail:candidate.senderEmail, subject:candidate.subject.slice(0, 300), bodyText:candidate.bodyText.slice(0, 12000), bodyStatus:candidate.bodyStatus, attachmentCount:candidate.attachmentCount }
    const thread = db.prepare('SELECT enquiry_id FROM gmail_threads WHERE account_sub=? AND thread_id=?').get(accountSub, candidate.threadId) as { enquiry_id:string } | undefined
    if (thread) {
      const current = getEnquiry(thread.enquiry_id, db)!
      const messages = [...(current.gmail?.messages || []), message].sort((a,b) => (a.receivedAt || '').localeCompare(b.receivedAt || '') || a.messageId.localeCompare(b.messageId))
      const historyTruncated = !!current.gmail?.historyTruncated || messages.length > 30
      const kept = messages.slice(-30)
      const payload = { ...JSON.parse((db.prepare('SELECT payload_json FROM enquiries WHERE id=?').get(current.id) as { payload_json:string }).payload_json), gmail:{ threadId:candidate.threadId, messages:kept, historyTruncated } }
      db.prepare('UPDATE enquiries SET payload_json=?,revision=revision+1,attachment_count=attachment_count+? WHERE id=?').run(JSON.stringify(payload), candidate.attachmentCount, current.id)
      db.prepare('INSERT INTO gmail_seen(account_sub,message_id,enquiry_id) VALUES(?,?,?)').run(accountSub,candidate.messageId,current.id)
      db.prepare('UPDATE outbox SET revision=revision+1 WHERE enquiry_id=?').run(current.id)
      db.prepare("UPDATE change_requests SET enquiry_revision=enquiry_revision+1,revision=revision+1 WHERE enquiry_id=? AND status='pending'").run(current.id)
      return getEnquiry(current.id, db)!
    }
    const id = randomUUID()
    const reference = `KCP-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`
    const payload = {
      serviceId: 'cabinet-painting', projectIntent: candidate.subject.slice(0, 160) || 'Email enquiry',
      targetSurfaces: [], suburb: '', postcode: '', doorCount: null, drawerCount: null,
      material: '', colourPreference: '', notes: candidate.bodyText.slice(0, 3000),
      name: (candidate.senderName || '').slice(0, 120), email: (candidate.senderEmail || '').slice(0, 254),
      phone: '', siteAddress: '', preferredDate: null,
      gmail: { threadId:candidate.threadId, messages:[message], historyTruncated:false },
    }
    const createdAt = candidate.internalDate || new Date().toISOString()
    db.prepare(`INSERT INTO enquiries(id,reference,source,payload_json,status,revision,created_at,calendar_status,sender_review_required,attachment_count)
      VALUES(?,?,'gmail',?,'submitted',1,?,'pending',1,?)`).run(id, reference, JSON.stringify(payload), createdAt, candidate.attachmentCount)
    db.prepare('INSERT INTO gmail_seen(account_sub,message_id,enquiry_id) VALUES(?,?,?)').run(accountSub, candidate.messageId, id)
    db.prepare('INSERT INTO gmail_threads(account_sub,thread_id,enquiry_id) VALUES(?,?,?)').run(accountSub, candidate.threadId, id)
    return getEnquiry(id, db)!
  })
}

export function scheduleEnquiry(id: string, expectedRevision: number, startAt: string, endAt: string, notes: string, db = getDb()): Enquiry {
  return transaction(db, () => {
    const current = getEnquiry(id, db)
    if (!current) throw new AppError(404, 'Enquiry not found')
    if (current.revision !== expectedRevision) throw new AppError(409, 'Enquiry changed; reload before saving')
    const revision = current.revision + 1
    const now = new Date().toISOString()
    db.prepare("UPDATE enquiries SET start_at=?,end_at=?,schedule_notes=?,status='provisional',revision=?,calendar_status='pending',calendar_error=NULL WHERE id=?").run(startAt, endAt, notes, revision, id)
    db.prepare('INSERT INTO outbox(enquiry_id,revision,updated_at) VALUES(?,?,?) ON CONFLICT(enquiry_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at').run(id, revision, now)
    db.prepare("UPDATE change_requests SET status='rejected',revision=revision+1 WHERE enquiry_id=? AND status='pending'").run(id)
    return getEnquiry(id, db)!
  })
}

export function rateLimit(db: DatabaseSync, bucket: string, max: number, windowMs: number): void {
  transaction(db, () => {
    const now = Date.now()
    const row = db.prepare('SELECT count,reset_at FROM rate_buckets WHERE bucket=?').get(bucket) as { count: number; reset_at: number } | undefined
    const next = row && row.reset_at > now ? row.count + 1 : 1
    if (next > max) throw new AppError(429, 'Please try again later')
    db.prepare('INSERT INTO rate_buckets(bucket,count,reset_at) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at').run(bucket, next, row && row.reset_at > now ? row.reset_at : now + windowMs)
  })
}
