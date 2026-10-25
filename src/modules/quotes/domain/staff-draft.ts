import { validateQuoteDraft, DraftValidationError, type ServiceDetails, type ContactDetails } from '../../enquiries/domain.ts'
import { WorkError, workExact, workObject, workText } from '../../enquiries/management.ts'
import { validateQuoteDraftAgainstSource, quoteDraftIssues, type QuoteDraftIssue } from '../../enquiries/domain/quote-draft.ts'
import { workField } from '../../enquiries/management.ts'
import type { LiveQuoteRequest, LiveQuoteRequestPage } from './contracts.ts'
import type { WorkAudit } from '../../enquiries/management.ts'
export type StaffQuoteDraftListPage = Omit<LiveQuoteRequestPage, 'requests'> & { requests: (LiveQuoteRequest & { staffDraftRevision: number | null })[] }
export type StaffQuoteDraftPayload = { contact: Omit<ContactDetails, 'consent'>; service: ServiceDetails | null; internalNotes: string }
export type StaffQuoteDraft = { requestId: string; revision: number; status: 'draft'; sourceRevisionAtCreation: number; payload: StaffQuoteDraftPayload; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string }
export type StaffQuoteDraftDetail = { requestId: string; source: LiveQuoteRequest; draft: StaffQuoteDraft | null; audit: WorkAudit[]; canWrite: boolean; sourceIssues: QuoteDraftIssue[] }
export function validateStaffQuotePayload(value: unknown, source?: unknown): StaffQuoteDraftPayload {
  const raw = workObject(value); workExact(raw, ['contact','service','internalNotes'])
  const contact = workObject(raw.contact); workExact(contact, ['name','email','phone','siteAddress','suburb','postcode','details'])
  if (raw.service !== null) workExact(workObject(raw.service), ['serviceId','intent','surfaces','doorCount','drawerCount','material','colourPreference'])
  try {
    // Adapter input is validation-only; no customer consent is stored in a staff work copy.
    const input = { contact: { ...contact, consent: true }, service: raw.service }
    const normalized = source === undefined ? validateQuoteDraft(input) : validateQuoteDraftAgainstSource(input, source)
    const c = normalized.contact
    const editableContact = { name: c.name, email: c.email, phone: c.phone, siteAddress: c.siteAddress, suburb: c.suburb, postcode: c.postcode, details: c.details }
    return { contact: editableContact, service: normalized.service, internalNotes: workField('payload.internalNotes', () => workText(raw.internalNotes, 3000, false)) }
  } catch (error) { if (error instanceof DraftValidationError) throw new WorkError(422, 'validation', error.message, 'not_applied', undefined, error.field ? { [error.field]: error.message } : undefined); throw error }
}

export const staffQuoteSourceIssues = (source: unknown): QuoteDraftIssue[] => quoteDraftIssues(source)
