import type { ChangeCustomerLinkInput, CreateCustomerInput, CustomerSearch } from './contracts.ts'
export class CustomerError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status; this.name = 'CustomerError' }
}
const control = /[\u0000-\u001f\u007f]/
export function customerId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new CustomerError(400, 'Invalid ID.')
  return value.toLowerCase()
}
function text(value: unknown, max: number, label: string, required = false): string | null {
  if (value == null && !required) return null
  if (typeof value !== 'string' || control.test(value) || value.length > max) throw new CustomerError(400, `Invalid ${label}.`)
  const clean = value.trim()
  if (!clean && required) throw new CustomerError(400, `Enter ${label}.`)
  return clean || null
}
function key(value: unknown) { return text(value, 120, 'idempotency key', true)! }
export function validateCreateCustomer(value: Record<string, unknown>): CreateCustomerInput {
  const email = text(value.email, 254, 'email')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CustomerError(400, 'Invalid email.')
  return { name: text(value.name, 120, 'name', true)!, email, phone: text(value.phone, 80, 'phone'), address: text(value.address, 500, 'address'), idempotencyKey: key(value.idempotencyKey) }
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
  return { q: text(params.get('q') ?? '', 120, 'search') ?? '', page, pageSize }
}
