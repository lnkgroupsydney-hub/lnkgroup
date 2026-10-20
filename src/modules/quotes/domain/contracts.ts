import type { QUOTE_PRICING_VERSION, PREVIOUS_QUOTE_PRICING_VERSION } from './pricing.ts'
import type { QuoteDraftInput } from '../../enquiries/domain.ts'
export type { QuoteDraftInput, ContactDetails, ServiceDetails } from '../../enquiries/domain.ts'
export const LIVE_STORAGE_CONSENT_VERSION = 'quote-storage-review-v1'
export interface LiveQuoteRequest {
  pricingVersion?: typeof QUOTE_PRICING_VERSION | typeof PREVIOUS_QUOTE_PRICING_VERSION
  id: string; reference: string; mode: 'live'; companyId: 'lk-group'; revision: number
  status: 'draft' | 'review_requested'; payload: QuoteDraftInput; consentVersion: string
  savedAt: string; createdAt: string; reviewRequestedAt: string | null; customerId: string | null
}
export interface LiveQuoteAudit {
  id: string; action: 'save' | 'request_review'; actorType: 'guest'; revision: number; createdAt: string
}
export interface LiveQuoteRequestPage { requests: LiveQuoteRequest[]; total: number; page: number; pageSize: number }
export interface LiveQuoteRequestDetail { request: LiveQuoteRequest; audit: LiveQuoteAudit[] }
export interface QuoteRequestOwner { hash: string; expiresAt: string; expectedRequestId?: string; customer?: { companyId: string; sessionId: string; authUserId: string; email: string; requestId: string } }
export interface QuoteRequestActor { userId: string; sessionId: string; companyId: string }
export interface SaveQuoteRequestInput { expectedRevision: number; idempotencyKey: string; payload: QuoteDraftInput; storageConsent: true }
export interface ReviewQuoteRequestInput { expectedRevision: number; idempotencyKey: string }
export class QuoteRequestError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
