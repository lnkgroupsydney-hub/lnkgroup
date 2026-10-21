export type WorkActor = { companyId: string; userId: string; sessionId: string }
export type WorkMutation = { expectedRevision: number; idempotencyKey: string; reason: string }
export type WorkReceipt = { idempotencyKey: string; entityType: 'enquiry' | 'staff_quote_draft' | 'simple_booking'; entityId: string; action: string; revision: number; committedAt: string; childId?: string }
export type WorkAudit = { id: string; action: string; actorUserId: string | null; actorSessionId: string | null; reason: string; priorRevision: number; revision: number; details: Record<string, unknown>; createdAt: string }
export type EnquirySummary = { name: string; email: string; phone: string; siteAddress: string; details: string }
export type EnquiryManagement = { enquiryId: string; status: 'active' | 'archived'; revision: number; assigneeUserId: string | null; archivedAt: string | null; updatedAt: string | null }
export type EnquiryRow = { enquiry: { id: string; reference: string; source: 'web' | 'gmail'; status: 'submitted' | 'provisional'; revision: number; createdAt: string; summary: EnquirySummary }; management: EnquiryManagement }
export type EnquiryNote = { id: string; enquiryId: string; body: string; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string }
export type EnquiryDetail = EnquiryRow & { notes: EnquiryNote[]; audit: WorkAudit[]; canWrite: boolean }
export class WorkError extends Error {
  readonly status: number; readonly code: string; readonly outcome: 'not_applied' | 'unknown'; readonly currentRevision?: number
  constructor(status: number, code: string, message: string, outcome: 'not_applied' | 'unknown' = 'not_applied', currentRevision?: number) { super(message); this.status = status; this.code = code; this.outcome = outcome; this.currentRevision = currentRevision }
}
export function workObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkError(422, 'validation', 'An object is required.')
  return value as Record<string, unknown>
}
export function workExact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new WorkError(422, 'validation', 'Only the documented fields may be changed.')
}
export function workId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new WorkError(422, 'validation', 'A valid identifier is required.')
  return value.toLowerCase()
}
export function workText(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || required && !value.trim()) throw new WorkError(422, 'validation', 'Enter valid plain text within the field limit.')
  return value.trim()
}
export function workMutation(value: Record<string, unknown>): WorkMutation {
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 || Number(value.expectedRevision) > 2147483646) throw new WorkError(422, 'validation', 'A current whole-number revision is required.')
  if (typeof value.reason === 'string' && /[\u0000-\u001f\u007f]/.test(value.reason)) throw new WorkError(422, 'validation', 'Enter a single-line reason.')
  return { expectedRevision: Number(value.expectedRevision), idempotencyKey: workId(value.idempotencyKey), reason: workText(value.reason, 500) }
}
export function workSearch(params: URLSearchParams, statuses: string[], defaultStatus: string) {
  for (const key of params.keys()) if (!['q','page','pageSize','status','staffDraft'].includes(key) || params.getAll(key).length !== 1) throw new WorkError(422, 'validation', 'Invalid search.')
  const page = params.get('page') ?? '1', size = params.get('pageSize') ?? '20', q = (params.get('q') ?? '').trim(), status = params.get('status') ?? defaultStatus
  if (!/^\d{1,6}$/.test(page) || Number(page) < 1 || Number(page) > 100000 || !/^\d{1,2}$/.test(size) || Number(size) < 1 || Number(size) > 50 || q.length > 120 || /[\u0000-\u001f\u007f]/.test(q) || !statuses.includes(status)) throw new WorkError(422, 'validation', 'Invalid search.')
  return { page: Number(page), pageSize: Number(size), q, status }
}
