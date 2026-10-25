import { workExact, workMutation } from '../../enquiries/management.ts'
import { validateStaffQuotePayload } from '../domain/staff-draft.ts'
export function staffQuoteSaveInput(raw: Record<string, unknown>, source?: unknown) { workExact(raw, ['expectedRevision','idempotencyKey','reason','payload']); return { ...workMutation(raw), payload: validateStaffQuotePayload(raw.payload, source) } }
