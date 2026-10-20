import type { ChangeCustomerLinkInput, CreateCustomerInput, CustomerSearch, PropertyInput, CustomerMutation, CustomerDecision, ResolveCustomerInput, PropertyDecision } from './contracts.ts'
import { isValidAustralianPhone, isValidEmail, isValidText } from '../../../shared/validation/input.ts'
export class CustomerError extends Error {
  readonly status: number
  candidates?: unknown
  properties?: unknown
  constructor(status: number, message: string) { super(message); this.status = status; this.name = 'CustomerError' }
}
const malformedUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
export function customerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new CustomerError(400, 'Invalid ID.')
  return value.toLowerCase()
}
function storedText(value: unknown, max: number, label: string, required = false): string | null {
  if (value == null && !required) return null
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || malformedUnicode.test(value)) throw new CustomerError(400, `Invalid ${label}.`)
  const clean = value.trim()
  if (!clean && required) throw new CustomerError(400, `Enter ${label}.`)
  return clean || null
}
function text(value: unknown, max: number, label: string, required = false): string | null {
  const clean = storedText(value, max, label, required)
  if (clean && !isValidText(clean, { maxLength: max, requireLetter: ['name', 'address'].includes(label) })) throw new CustomerError(400, `Invalid ${label}.`)
  return clean
}
function key(value: unknown) { return text(value, 120, 'idempotency key', true)! }
/** Lookup and explicit reuse do not write these stored contact fields. */
export function validateCustomerLookup(value: Record<string, unknown>) {
  const email = storedText(value.email, 254, 'email')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CustomerError(400, 'Invalid email.')
  return { name: storedText(value.name, 120, 'name', true)!, email, phone: storedText(value.phone, 80, 'phone'), address: storedText(value.address, 500, 'address') }
}
export function validateCreateCustomer(value: Record<string, unknown>): CreateCustomerInput {
  const email = text(value.email, 254, 'email')
  if (email && !isValidEmail(email)) throw new CustomerError(400, 'Invalid email.')
  const phone = text(value.phone, 80, 'phone')
  if (phone && !isValidAustralianPhone(phone)) throw new CustomerError(400, 'Enter a valid Australian phone number.')
  return { name: text(value.name, 120, 'name', true)!, email, phone, address: text(value.address, 500, 'address'), idempotencyKey: key(value.idempotencyKey) }
}
export function validateCustomerLink(value: Record<string, unknown>): ChangeCustomerLinkInput {
  if (value.action !== 'link' && value.action !== 'unlink') throw new CustomerError(400, 'Invalid link action.')
  if (value.sourceType !== 'enquiry' && value.sourceType !== 'submission') throw new CustomerError(400, 'Invalid source type.')
  if (!Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 1) throw new CustomerError(400, 'Invalid revision.')
  return { action: value.action, sourceType: value.sourceType, sourceId: customerId(value.sourceId), reason: text(value.reason, 500, 'reason', true)!, expectedRevision: value.expectedRevision as number, idempotencyKey: key(value.idempotencyKey) }
}
export function customerSearch(params: URLSearchParams): CustomerSearch {
  const page = Number(params.get('page') ?? 1), pageSize = Number(params.get('pageSize') ?? 20)
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new CustomerError(400, 'Invalid pagination.')
  const status = params.get('status') ?? 'active'
  if (!['active','archived','all'].includes(status)) throw new CustomerError(400, 'Invalid status.')
  return { status: status as CustomerSearch['status'], q: text(params.get('q') ?? '', 120, 'search') ?? '', page, pageSize }
}

export function validateMutation(value: Record<string, unknown>): CustomerMutation {
  if (!Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) throw new CustomerError(400, 'Invalid revision.')
  return { expectedRevision: Number(value.expectedRevision), reason: text(value.reason, 500, 'reason', true)!, idempotencyKey: key(value.idempotencyKey) }
}
export function validateProperty(value: Record<string, unknown>): PropertyInput {
  const a = value.address
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new CustomerError(400, 'Structured address required.')
  const address = a as Record<string, unknown>
  if (address.country != null && address.country !== 'AU') throw new CustomerError(400, 'Australian address required.')
  return { label: text(value.label, 120, 'property label', true)!, contactName: text(value.contactName, 120, 'contact name'), notes: text(value.notes, 2000, 'notes'), address: { line1: text(address.line1,300,'street address',true)!, unit: text(address.unit,80,'unit'), suburb: text(address.suburb,120,'suburb',true)!, state: text(address.state,20,'state',true)!, postcode: text(address.postcode,10,'postcode',true)!, country:'AU' } }
}
export function validateDecision(value: unknown): CustomerDecision {
  if (value == null) return {kind:'auto'}
  if (typeof value !== 'object' || Array.isArray(value)) throw new CustomerError(400, 'Invalid customer decision.')
  const d = value as Record<string,unknown>
  if(d.kind === 'auto') return {kind:'auto'}
  const reason = text(d.reason,500,'review reason',true)!
  if(d.kind === 'existing') return {kind:'existing',customerId:customerId(d.customerId),expectedRevision:validateMutation({...d,idempotencyKey:'validation'}).expectedRevision,reason}
  if(d.kind !== 'different_person' || !Array.isArray(d.reviewedCandidates) || d.reviewedCandidates.length>100) throw new CustomerError(400,'Invalid candidate review.')
  return {kind:'different_person',reason,reviewedCandidates:d.reviewedCandidates.map(v=>{ if (!v || typeof v !== 'object') throw new CustomerError(400,'Invalid candidate review.');return {id:customerId(v.id),revision:validateMutation({expectedRevision:v.revision,reason,idempotencyKey:'validation'}).expectedRevision} })}
}
export function validateResolve(value: Record<string,unknown>): ResolveCustomerInput {
  const decision = validateDecision(value.decision)
  const result: ResolveCustomerInput = {...(decision.kind === 'existing' ? {...validateCustomerLookup(value),idempotencyKey:key(value.idempotencyKey)} : validateCreateCustomer(value)),decision}
  if(value.property != null) { if(typeof value.property !== 'object' || Array.isArray(value.property)) throw new CustomerError(400,'Invalid property.');result.property=validateProperty(value.property as Record<string,unknown>) }
  if(value.propertyId != null) result.propertyId=customerId(value.propertyId)
  if(value.propertyDecision != null) result.propertyDecision=validatePropertyDecision(value.propertyDecision)
  if(result.property && result.propertyId) throw new CustomerError(400,'Select or create one property.')
  if(value.source != null) {
    const source = value.source as Record<string,unknown>
    if(!source || source.type !== 'quote_request' || !Number.isSafeInteger(source.expectedCrmRevision) || Number(source.expectedCrmRevision)<0 || !Number.isSafeInteger(source.expectedSourceRevision) || Number(source.expectedSourceRevision)<1) throw new CustomerError(400,'Invalid quote relation.')
    result.source={type:'quote_request',id:customerId(source.id),expectedCrmRevision:Number(source.expectedCrmRevision),expectedSourceRevision:Number(source.expectedSourceRevision)}
  }
  return result
}

export function validatePropertyDecision(value: unknown): PropertyDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CustomerError(400,'Invalid property review.')
  const d=value as Record<string,unknown>,reason=text(d.reason,500,'property review reason',true)!
  if(d.kind !== 'different_property' || !Array.isArray(d.reviewedProperties) || d.reviewedProperties.length>100) throw new CustomerError(400,'Invalid property review.')
  return {kind:'different_property',reason,reviewedProperties:d.reviewedProperties.map(v=>{if(!v || typeof v!=='object') throw new CustomerError(400,'Invalid property review.');return {id:customerId(v.id),revision:validateMutation({expectedRevision:v.revision,reason,idempotencyKey:'validation'}).expectedRevision}})}
}
