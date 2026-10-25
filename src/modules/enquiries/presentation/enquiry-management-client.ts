import { workId, workObject, type WorkMutation, type WorkReceipt, type EnquiryDetail, type EnquiryRow } from '../management.ts'
export type WorkPhase = 'idle' | 'loading' | 'saving' | 'saved' | 'empty' | 'error' | 'unknown' | 'conflict' | 'access_lost'
const workFields = ['revisionId','payload.quantities.doorCount','payload.quantities.drawerCount','payload.quantities.moderateRepair','payload.extraItems','payload.customerNote','expectedRevision','reason','assigneeUserId','body','payload.contact.name','payload.contact.email','payload.contact.phone','payload.contact.siteAddress','payload.contact.suburb','payload.contact.postcode','payload.contact.details','payload.service','payload.service.serviceId','payload.service.intent','payload.service.surfaces','payload.service.doorCount','payload.service.drawerCount','payload.service.material','payload.service.colourPreference','payload.internalNotes','takeOffEndLocal','installStartLocal','installEndLocal','companyNote'] as const
export type WorkField = typeof workFields[number] | `payload.extraItems.${number}` | `payload.extraItems.${number}.${'id'|'description'|'amountCents'|'reason'}` | 'acknowledged' | 'acknowledgmentVersion' | 'signature'
export type WorkFieldErrors = Partial<Record<WorkField, string>>
export type WorkClientError = { status: number; error: string; code: string; outcome: 'not_applied' | 'unknown'; currentRevision?: number; fields: WorkFieldErrors | null }
export type WorkClientState<T> = { status?: number; phase: WorkPhase; data: T | null; input: Record<string, unknown> | null; receipt: WorkReceipt | null; error: string | null; code: string | null; currentRevision?: number; fields: WorkFieldErrors | null }
type Pending = { path: string; method: string; body: Record<string, unknown> }
function fieldErrors(value: unknown): WorkFieldErrors | null {
  try {
    if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).length > 32) return null
    const result = Object.create(null) as WorkFieldErrors, descriptors = Object.getOwnPropertyDescriptors(value)
    let length = 0
    const fields = [...workFields, ...Object.keys(descriptors).filter(field => /^(?:payload\.extraItems\.(?:[0-9]|[12][0-9])(?:\.(?:id|description|amountCents|reason))?|acknowledged|acknowledgmentVersion|signature)$/.test(field))] as WorkField[]
    for (const field of fields) {
      if (!Object.hasOwn(descriptors, field)) continue
      const property = descriptors[field]
      if (!property?.enumerable || !Object.hasOwn(property, 'value') || typeof property.value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(property.value)) continue
      const message = property.value.trim()
      if (!message || message.length > 500) continue
      length += field.length + message.length
      if (length > 4096) return null
      result[field] = message
    }
    return Object.keys(result).length ? result : null
  } catch { return null }
}
export class CurrentWorkClient<T> {
  private generation = 0
  private readGeneration = 0
  private readController: AbortController | null = null
  private pending: Pending | null = null
  private hadUnknown = false
  private state: WorkClientState<T> = { phase: 'idle', data: null, input: null, receipt: null, error: null, code: null, fields: null }
  private request: typeof fetch
  private key: () => string
  private parse: (value: unknown) => T
  private receiptScope?: { entityId: string; entityType: WorkReceipt['entityType'] }
  constructor(parse: (value: unknown) => T, request?: typeof fetch, key: () => string = () => crypto.randomUUID(), receiptScope?: { entityId: string; entityType: WorkReceipt['entityType'] }) {
    this.parse = parse
    this.receiptScope = receiptScope
    this.request = request ? (input, init) => request(input, init) : (input, init) => globalThis.fetch(input, init)
    this.key = key
  }
  lifetime(): number { return this.generation }
  snapshot(): WorkClientState<T> { return structuredClone(this.state) }
  pendingRequest(): Pending | null { return this.pending ? structuredClone(this.pending) : null }
  clear() { this.generation++; this.readGeneration++; this.readController?.abort(); this.pending = null; this.hadUnknown = false; this.state = { phase: 'idle', data: null, input: null, receipt: null, error: null, code: null, fields: null } }
  private clearResult() { this.state.receipt = null; this.state.error = null; this.state.code = null; this.state.fields = null; delete this.state.currentRevision; delete this.state.status }
  private unknown() { this.hadUnknown = true; this.clearResult(); this.state.phase = 'unknown'; this.state.code = 'outcome_unknown'; this.state.error = 'The saved result is unknown. Check or retry the unchanged request.' }
  accessLost() { this.clear(); this.state.phase = 'access_lost'; this.state.error = 'Staff access changed. Sign in again before continuing.' }
  async read(path: string) {
    if (this.state.phase === 'access_lost') return this.snapshot()
    const generation = this.generation, lane = ++this.readGeneration
    this.readController?.abort(); this.readController = new AbortController()
    const current = () => generation === this.generation && lane === this.readGeneration
    let status: number | undefined
    if (!this.pending) { this.state.phase = 'loading'; delete this.state.status }
    try {
      const response = await this.request(path, { credentials: 'same-origin', cache: 'no-store', signal: this.readController.signal })
      if (!current()) return this.snapshot()
      if (response.status === 401 || response.status === 403) { this.accessLost(); this.state.status = response.status; return this.snapshot() }
      status = response.status
      const body: unknown = await response.json()
      if (!current()) return this.snapshot()
      if (!response.ok) throw new Error('The saved record could not be loaded. Retry the read.')
      this.state.data = this.parse(body)
      if (!this.pending) this.state.phase = this.state.data === null ? 'empty' : 'idle'
    } catch (error) { if (current() && !this.pending) { this.state.phase = 'error'; this.state.status = status; this.state.error = error instanceof Error ? error.message : 'The saved record could not be loaded.' } }
    return this.snapshot()
  }
  async mutate(path: string, method: string, input: Record<string, unknown>) {
    if (this.state.phase === 'access_lost') return this.snapshot()
    if (this.pending) throw new Error('Check or retry the unchanged pending request before starting another save.')
    this.generation++; this.hadUnknown = false
    this.pending = structuredClone({ path, method, body: { ...input, idempotencyKey: this.key() } })
    this.state.input = structuredClone(input)
    return this.retry()
  }
  async continueCommand(path: string, input: { idempotencyKey: string }) {
    if (this.state.phase === 'access_lost') return this.snapshot()
    if (this.pending) throw new Error('Resolve the pending request before continuing cancellation.')
    this.generation++; this.hadUnknown = false; this.state.input = null
    this.pending = structuredClone({ path, method: 'POST', body: { idempotencyKey: workId(input.idempotencyKey) } })
    return this.retry()
  }
  async retry() {
    if (!this.pending || this.state.phase === 'access_lost') throw new Error('There is no pending request to retry.')
    if (this.state.phase === 'saving') throw new Error('The request is already in progress.')
    const pending = structuredClone(this.pending), generation = this.generation
    this.readGeneration++; this.readController?.abort(); this.clearResult(); this.state.phase = 'saving'
    try {
      const response = await this.request(pending.path, { method: pending.method, credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.body), signal: AbortSignal.timeout(35000) })
      if (generation !== this.generation) return this.snapshot()
      if (response.status === 401 || response.status === 403) { this.accessLost(); return this.snapshot() }
      const body: unknown = await response.json()
      if (generation !== this.generation) return this.snapshot()
      const raw = workObject(body)
      if (!response.ok) {
        const definite = raw.outcome === 'not_applied' && (response.status >= 400 && response.status < 500 || response.status === 503)
        const fieldProperty = response.status === 422 && definite ? Object.getOwnPropertyDescriptor(raw, 'fields') : undefined
        const failure: WorkClientError = { status: response.status, error: typeof raw.error === 'string' ? raw.error : 'The request could not be completed.', code: typeof raw.code === 'string' ? raw.code : 'outcome_unknown', outcome: definite ? 'not_applied' : 'unknown', fields: fieldProperty?.enumerable && Object.hasOwn(fieldProperty, 'value') ? fieldErrors(fieldProperty.value) : null }
        if (!definite) this.unknown()
        else if (response.status === 503 && this.hadUnknown) this.state.phase = 'unknown'
        else {
          this.generation++; this.hadUnknown = false; this.pending = null
          this.state.phase = response.status === 409 ? 'conflict' : 'error'
          if (response.status === 409 && Number.isSafeInteger(raw.currentRevision) && Number(raw.currentRevision) >= 0) this.state.currentRevision = Number(raw.currentRevision)
        }
        this.state.error = failure.error + (definite && response.status === 503 && this.hadUnknown ? ' The previous save is still unconfirmed. Check or retry the unchanged request.' : ''); this.state.code = failure.code; this.state.fields = failure.fields
        return this.snapshot()
      }
      const receipt = parseWorkReceipt(raw.receipt, String(pending.body.idempotencyKey), pending.path, this.receiptScope)
      this.clearResult(); this.state.receipt = receipt
      this.generation++; this.pending = null; this.hadUnknown = false; this.state.phase = 'saved'
    } catch { if (generation === this.generation) this.unknown() }
    return this.snapshot()
  }
  async check(path: string) {
    if (!this.pending || this.state.phase === 'access_lost') throw new Error('There is no pending request to check.')
    const generation = this.generation, pending = this.pending, key = String(pending.body.idempotencyKey)
    const current = () => generation === this.generation && pending === this.pending
    try {
      const response = await this.request(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000) })
      if (!current()) return this.snapshot()
      if (response.status === 401 || response.status === 403) { this.accessLost(); return this.snapshot() }
      if (response.status === 404) { this.unknown(); return this.snapshot() }
      if (!response.ok) throw new Error()
      const body = workObject(await response.json())
      if (!current()) return this.snapshot()
      const receipt = parseWorkReceipt(body.receipt, key, pending.path, this.receiptScope)
      this.clearResult(); this.state.receipt = receipt
      this.generation++; this.pending = null; this.hadUnknown = false; this.state.phase = 'saved'
    } catch { if (current()) this.unknown() }
    return this.snapshot()
  }
}
export function parseWorkReceipt(value: unknown, key?: string, path?: string, scope?: { entityId: string; entityType: WorkReceipt['entityType'] }): WorkReceipt {
  const raw = workObject(value)
  if (key && raw.idempotencyKey !== key || !['enquiry','staff_quote_draft','simple_booking','company_revision'].includes(String(raw.entityType)) || typeof raw.action !== 'string' || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || typeof raw.committedAt !== 'string' || !Number.isFinite(Date.parse(raw.committedAt))) throw new Error('The saved receipt could not be verified.')
  const expected = path?.match(/\/(enquiries|quote-requests|live-bookings)\/([a-f0-9-]{36})(?:\/|$)/i)
  if (expected && (raw.entityId !== expected[2] || raw.entityType !== (path?.includes('/company-revisions') ? 'company_revision' : ({ enquiries: 'enquiry', 'quote-requests': 'staff_quote_draft', 'live-bookings': 'simple_booking' } as Record<string,string>)[expected[1]]))) throw new Error('The receipt belongs to another record.')
  if (scope && (raw.entityId !== scope.entityId || raw.entityType !== scope.entityType)) throw new Error('The receipt belongs to another record.')
  workId(raw.idempotencyKey); workId(raw.entityId); if (raw.childId !== undefined) workId(raw.childId)
  return raw as WorkReceipt
}
function enquiryRow(value: unknown): EnquiryRow { const row = workObject(value), e = workObject(row.enquiry), m = workObject(row.management); workId(e.id); if (m.enquiryId !== e.id || !['active','archived'].includes(String(m.status)) || !Number.isSafeInteger(m.revision) || Number(m.revision) < 0 || !['web','gmail'].includes(String(e.source)) || !['submitted','provisional'].includes(String(e.status))) throw new Error('The enquiry did not match its management record.'); const summary=workObject(e.summary); for (const k of ['name','email','phone','siteAddress','details']) if(typeof summary[k]!=='string') throw new Error('Invalid enquiry summary.'); return row as EnquiryRow }
export function parseEnquiryDetail(value: unknown): EnquiryDetail { const raw=workObject(value); enquiryRow(raw); if(!Array.isArray(raw.notes)||!Array.isArray(raw.audit)||typeof raw.canWrite!=='boolean')throw new Error('Invalid enquiry detail.'); for(const note of raw.notes){const n=workObject(note);workId(n.id);if(n.enquiryId!==workObject(raw.enquiry).id||typeof n.body!=='string')throw new Error('Invalid enquiry note.')}return raw as EnquiryDetail }
export function parseEnquiryList(value: unknown): { enquiries: EnquiryRow[]; total: number; page: number; pageSize: number } { const raw=workObject(value);if(!Array.isArray(raw.enquiries)||!Number.isSafeInteger(raw.total)||Number(raw.total)<0||!Number.isSafeInteger(raw.page)||!Number.isSafeInteger(raw.pageSize))throw new Error('Invalid enquiry list.');raw.enquiries.forEach(enquiryRow);return raw as {enquiries:EnquiryRow[];total:number;page:number;pageSize:number} }
export function enquiryActions<T>(client: CurrentWorkClient<T>, id: string) { const base=`/api/admin/enquiries/${workId(id)}`; return {
 detail:()=>client.read(base), assign:(input:Omit<WorkMutation,'idempotencyKey'>&{assigneeUserId:string|null})=>client.mutate(base,'PATCH',input),
 addNote:(input:Omit<WorkMutation,'idempotencyKey'>&{body:string})=>client.mutate(`${base}/notes`,'POST',input),
 editNote:(noteId:string,input:Omit<WorkMutation,'idempotencyKey'>&{body:string})=>client.mutate(`${base}/notes/${workId(noteId)}`,'PATCH',input),
 archive:(input:Omit<WorkMutation,'idempotencyKey'>)=>client.mutate(`${base}/archive`,'POST',input),restore:(input:Omit<WorkMutation,'idempotencyKey'>)=>client.mutate(`${base}/restore`,'POST',input),
 check:()=>{const pending=client.pendingRequest();if(!pending)throw new Error('No pending request.');return client.check(`${base}/commands/${workId(pending.body.idempotencyKey)}`)}, retry:()=>client.retry(),
} }

export function parseEnquiryAssignees(value:unknown):{assignees:{userId:string;label:string}[]} { const raw=workObject(value);if(!Array.isArray(raw.assignees))throw new Error('Invalid assignees.');for(const value of raw.assignees){const row=workObject(value);workId(row.userId);if(typeof row.label!=='string')throw new Error('Invalid assignee label.')}return raw as {assignees:{userId:string;label:string}[]} }
