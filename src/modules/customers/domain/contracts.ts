export type CustomerSourceType = 'enquiry' | 'submission' | 'quote_request'
export interface Customer {
  id: string; companyId: 'lk-group'; name: string; email: string | null; phone: string | null; address: string | null
  status: 'active' | 'archived'; archivedAt: string | null
  revision: number; createdAt: string; updatedAt: string
}
export interface CustomerRecord {
  sourceType: CustomerSourceType; sourceId: string; reference: string; name: string | null
  email: string | null; phone: string | null; address: string | null; createdAt: string; status: string
  photos: { id: string; url: string }[]
  relatedEnquiryIds: string[]
  booking: { status: string; revision: number; syncStatus: string; confirmedAt: string | null } | null
  links: { detail: string | null; quotePdf: string | null; agreementPdf: string | null; photos: string | null }
}
export interface CustomerAudit {
  id: string; action: 'create' | 'link' | 'unlink' | 'update' | 'archive' | 'restore' | 'property_create' | 'property_update' | 'property_archive' | 'property_restore' | 'resolve'; sourceType: CustomerSourceType | null; sourceId: string | null
  reason: string; actorUserId: string; createdAt: string; revision: number
}
export interface CustomerDetail {
  customer: Customer; properties: CustomerProperty[]; records: CustomerRecord[]; audit: CustomerAudit[]
  purchases: { status: 'unavailable' }; billing: { status: 'unavailable' }
}
export interface CustomerPage { customers: Customer[]; page: number; pageSize: number; total: number }
export interface UnlinkedRecordPage { records: CustomerRecord[]; page: number; pageSize: number; total: number }
export interface CreateCustomerInput { name: string; email?: string | null; phone?: string | null; address?: string | null; idempotencyKey: string }
export interface ChangeCustomerLinkInput {
  action: 'link' | 'unlink'; sourceType: CustomerSourceType; sourceId: string; reason: string; expectedRevision: number; idempotencyKey: string
}
export interface CustomerSearch { q: string; page: number; pageSize: number; status?: 'active' | 'archived' | 'all' }
export interface CustomerActor { userId: string; sessionId: string; companyId: string }

export interface PropertyAddress { line1: string; unit: string | null; suburb: string; state: string; postcode: string; country: 'AU' }
export interface PropertyInput { label: string; address: PropertyAddress; contactName: string | null; notes: string | null }
export interface CustomerProperty extends PropertyInput { id: string; companyId: 'lk-group'; customerId: string; status: 'active' | 'archived'; archivedAt: string | null; revision: number; createdAt: string; updatedAt: string }
export interface CustomerCandidate { customer: Customer; matchedBy: ('email' | 'phone' | 'name')[] }
export interface CustomerMutation { expectedRevision: number; reason: string; idempotencyKey: string }
export type CustomerDecision = { kind: 'auto' } | { kind: 'existing'; customerId: string; expectedRevision: number; reason: string } | { kind: 'different_person'; reason: string; reviewedCandidates: { id: string; revision: number }[] }
export interface ResolveCustomerInput extends CreateCustomerInput { decision?: CustomerDecision; property?: PropertyInput; propertyId?: string; expectedPropertyRevision?: number; propertyDecision?: PropertyDecision; source?: { type: 'quote_request'; id: string; expectedCrmRevision: number; expectedSourceRevision: number } }
export interface ResolveCustomerResult { outcome: 'client_created' | 'client_reused'; customer: Customer; property: CustomerProperty | null; propertyOutcome: 'property_created' | 'property_reused' | null; crmRevision?: number }

export type CustomerResolution = ResolveCustomerResult

export interface PropertyDecision { kind: 'different_property'; reason: string; reviewedProperties: {id: string; revision: number}[] }
