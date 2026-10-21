import { requireStaffAdmin } from '../../admin-access/server.ts'
import { AdminAccessError } from '../../admin-access/index.ts'
import { currentWorkCommand, WorkError, workObject, workExact, workId, workMutation, workSearch, workText, type WorkActor, type WorkStore } from '../management.ts'
import { currentWorkStore } from './management-store.ts'
export interface WorkApiDependencies { authorize(req: Request, permission: 'operations.read' | 'operations.write'): Promise<WorkActor>; store: WorkStore; baseUrl(): string | undefined; enqueue?(requestId: string): void; enabled?(): boolean }
export const workJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store', vary: 'Cookie', 'x-content-type-options': 'nosniff' } })
export async function readWorkInput(req: Request, base: string | undefined) {
  if (!base) throw new WorkError(503, 'unavailable', 'Administrator requests are unavailable.')
  if (req.headers.get('origin') !== new URL(base).origin || req.headers.get('sec-fetch-site') === 'cross-site') throw new WorkError(403, 'forbidden', 'Same-origin request required.')
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') ?? '')) throw new WorkError(415, 'unsupported_media_type', 'JSON required.')
  const length = req.headers.get('content-length'), max = 32768
  if (length && (!/^\d+$/.test(length) || Number(length) > max)) throw new WorkError(413, 'request_too_large', 'Request too large.')
  const reader = req.body?.getReader(); if (!reader) throw new WorkError(400, 'malformed_request', 'Body required.')
  const chunks: Uint8Array[] = []; let size = 0
  try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > max) { await reader.cancel(); throw new WorkError(413, 'request_too_large', 'Request too large.') } chunks.push(next.value) } }
  finally { reader.releaseLock() }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw new WorkError(400, 'malformed_request', 'Invalid JSON.') }
  return workObject(value)
}
export function workApiBoundary(deps: WorkApiDependencies) {
  return async (req: Request, command: string, values: { id?: string; noteId?: string; key?: string } = {}, write?: (raw: Record<string, unknown>) => Record<string, unknown>, status = 200) => {
    let dispatched = false
    try {
      const actor = await deps.authorize(req, write ? 'operations.write' : 'operations.read')
      if (write && deps.enabled && !deps.enabled()) throw new WorkError(503, 'unavailable', 'Current work changes are paused.')
      const input = write ? write(await readWorkInput(req, deps.baseUrl())) : command === 'enquiry_list' ? workSearch(new URL(req.url).searchParams, ['active','archived','all'], 'active') : command === 'quote_list' ? quoteSearch(new URL(req.url).searchParams) : {}
      const ids = { ...(values.id ? { id: workId(values.id) } : {}), ...(values.noteId ? { noteId: workId(values.noteId) } : {}), ...(values.key ? { idempotencyKey: workId(values.key) } : {}) }
      dispatched = true
      const result = await currentWorkCommand(deps.store, actor, command, { ...input, ...ids })
      if (command === 'booking_cancel' || command === 'booking_cancel_retry') deps.enqueue?.(ids.id!)
      return workJson(result, status)
    } catch (error) {
      if (error instanceof WorkError) return workJson({ error: error.message, code: error.code, outcome: error.outcome, ...(error.currentRevision !== undefined ? { currentRevision: error.currentRevision } : {}) }, error.status)
      if (error instanceof AdminAccessError) return workJson({ error: error.message, code: error.status === 401 ? 'unauthorized' : error.status === 403 ? 'forbidden' : 'unavailable', outcome: 'not_applied' }, error.status)
      return workJson({ error: dispatched && write ? 'The saved result is unknown. Retry the unchanged request.' : 'Current work is unavailable.', code: dispatched && write ? 'outcome_unknown' : 'unavailable', outcome: dispatched && write ? 'unknown' : 'not_applied' }, 503)
    }
  }
}
export const workApiDefaults: WorkApiDependencies = { authorize: requireStaffAdmin, store: currentWorkStore, baseUrl: () => process.env.APP_BASE_URL }
export function createEnquiryManagementApi(deps: WorkApiDependencies) {
  const run = workApiBoundary(deps)
  const mutation = (raw: Record<string, unknown>, extra: string[] = []) => { workExact(raw, ['expectedRevision','idempotencyKey','reason',...extra]); return workMutation(raw) }
  return {
    list: (req: Request) => run(req, 'enquiry_list'),
    assignees: (req: Request) => run(req, 'enquiry_assignees'),
    detail: (req: Request, id: string) => run(req, 'enquiry_detail', { id }),
    assign: (req: Request, id: string) => run(req, 'enquiry_assign', { id }, raw => ({ ...mutation(raw, ['assigneeUserId']), assigneeUserId: raw.assigneeUserId === null ? null : workId(raw.assigneeUserId) })),
    note: (req: Request, id: string, noteId?: string) => run(req, noteId ? 'enquiry_note_update' : 'enquiry_note_add', { id, noteId }, raw => ({ ...mutation(raw, ['body']), body: workText(raw.body, 3000) }), noteId ? 200 : 201),
    archive: (req: Request, id: string) => run(req, 'enquiry_archive', { id }, raw => mutation(raw)),
    restore: (req: Request, id: string) => run(req, 'enquiry_restore', { id }, raw => mutation(raw)),
    receipt: (req: Request, id: string, key: string) => run(req, 'enquiry_receipt', { id, key }),
  }
}
export const enquiryManagementApi = createEnquiryManagementApi(workApiDefaults)

function quoteSearch(params: URLSearchParams) { const search = workSearch(params, ['all','draft','review_requested'], 'all'), staffDraft = params.get('staffDraft') ?? 'all'; if (!['all','saved','none'].includes(staffDraft)) throw new WorkError(422, 'validation', 'Invalid staff draft filter.'); return { ...search, staffDraft } }
