export type CustomerSourceType = 'enquiry' | 'submission'
export interface Customer {
  id: string; companyId: 'lk-group'; name: string; email: string | null; phone: string | null; address: string | null
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
  id: string; action: 'create' | 'link' | 'unlink'; sourceType: CustomerSourceType | null; sourceId: string | null
  reason: string; actorUserId: string; createdAt: string; revision: number
}
export interface CustomerDetail {
  customer: Customer; records: CustomerRecord[]; audit: CustomerAudit[]
  purchases: { status: 'unavailable' }; billing: { status: 'unavailable' }
}
export interface CustomerPage { customers: Customer[]; page: number; pageSize: number; total: number }
export interface UnlinkedRecordPage { records: CustomerRecord[]; page: number; pageSize: number; total: number }
export interface CreateCustomerInput { name: string; email?: string | null; phone?: string | null; address?: string | null; idempotencyKey: string }
export interface ChangeCustomerLinkInput {
  action: 'link' | 'unlink'; sourceType: CustomerSourceType; sourceId: string; reason: string; expectedRevision: number; idempotencyKey: string
}
export interface CustomerSearch { q: string; page: number; pageSize: number }
export interface CustomerActor { userId: string; sessionId: string; companyId: string }
