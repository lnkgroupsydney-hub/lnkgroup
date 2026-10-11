import { validateQuoteDraft, DraftValidationError } from '../../enquiries/domain.ts'
import { QuoteRequestError, type ReviewQuoteRequestInput, type SaveQuoteRequestInput } from './contracts.ts'
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
export function requestId(value: unknown) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new QuoteRequestError(400, 'Invalid request identifier.')
  return value.toLowerCase()
}
function command(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QuoteRequestError(400, 'Request details required.')
  const input = value as Record<string, unknown>
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision as number) < 0 || (input.expectedRevision as number) > 2147483646) throw new QuoteRequestError(400, 'Invalid saved revision.')
  requestId(input.idempotencyKey)
  return input
}
export function validateSaveRequest(value: unknown): SaveQuoteRequestInput {
  const input = command(value)
  if (input.storageConsent !== true) throw new QuoteRequestError(400, 'Confirm that your details can be stored for company review.')
  try { return { expectedRevision: input.expectedRevision as number, idempotencyKey: requestId(input.idempotencyKey), payload: validateQuoteDraft(input.payload), storageConsent: true } }
  catch (error) { if (error instanceof DraftValidationError) throw new QuoteRequestError(400, error.message); throw error }
}
export function validateReviewRequest(value: unknown): ReviewQuoteRequestInput {
  const input = command(value)
  if (input.expectedRevision === 0) throw new QuoteRequestError(400, 'Save your contact and service details first.')
  return { expectedRevision: input.expectedRevision as number, idempotencyKey: requestId(input.idempotencyKey) }
}
export function requestSearch(params: URLSearchParams) {
  if (['page', 'pageSize', 'q'].some(name => params.getAll(name).length > 1)) throw new QuoteRequestError(400, 'Invalid request search.')
  const page = params.get('page') ?? '1', size = params.get('pageSize') ?? '20', q = (params.get('q') ?? '').trim()
  if (!/^\d{1,6}$/.test(page) || !/^\d{1,2}$/.test(size) || Number(page) < 1 || Number(page) > 100000 || Number(size) < 1 || Number(size) > 50 || q.length > 120 || /[\u0000-\u001f]/.test(q)) throw new QuoteRequestError(400, 'Invalid request search.')
  return { page: Number(page), pageSize: Number(size), q }
}
