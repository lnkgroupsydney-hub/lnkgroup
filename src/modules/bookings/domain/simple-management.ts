import { WorkError, workExact, workMutation, workText, workField, type WorkMutation } from '../../enquiries/management.ts'
import type { LiveCompanyBookingState, LiveCompanyEvent } from './live-contracts.ts'
export type SimpleBookingDraftInput = { takeOffEndLocal: string | null; installStartLocal: string | null; installEndLocal: string | null; companyNote: string }
export type SimpleBookingDraft = SimpleBookingDraftInput & { requestId: string; submissionId: string; signedSnapshotHash: string; revision: number; savedBy: string; savedAt: string }
export type CancellationState = { id: string; requestId: string; bookingId: string; status: 'pending' | 'processing' | 'retrying' | 'review_required' | 'cancelled'; requestedAt: string; requestedBy: string; cancelledAt: string | null; errorCode: string | null; occupancyHeld: boolean; totalEvents: number; verifiedDeletedEvents: number }
export type SimpleBookingManagement = { state: LiveCompanyBookingState; draft: SimpleBookingDraft | null; cancellation: CancellationState | null; canWrite: boolean }
export type CancellationClaim = { id: string; requestId: string; bookingId: string; proposalHash: string; leaseToken: string; leaseExpiresAt: string; manifest: LiveCompanyEvent[]; state: LiveCompanyBookingState; cancellation: CancellationState }
export type AbsenceProof = { segmentIndex: number; eventId: string; resultCode: 'absent_404' | 'absent_410' | 'cancelled_tombstone'; verifiedAt: string }
export function simpleDraftInput(raw: Record<string, unknown>, localToInstant: (value: unknown) => string): WorkMutation & SimpleBookingDraftInput {
  workExact(raw, ['expectedRevision','idempotencyKey','reason','takeOffEndLocal','installStartLocal','installEndLocal','companyNote'])
  const input = { ...workMutation(raw), companyNote: workField('companyNote', () => workText(raw.companyNote, 3000, false)), takeOffEndLocal: raw.takeOffEndLocal, installStartLocal: raw.installStartLocal, installEndLocal: raw.installEndLocal }
  const times: Record<string, number | null> = {}
  for (const key of ['takeOffEndLocal','installStartLocal','installEndLocal'] as const) {
    const value = input[key]
    if (value === null) { times[key] = null; continue }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new WorkError(422, 'validation', 'Enter valid Sydney local date and time, or leave it undecided.', 'not_applied', undefined, { [key]: 'Enter valid Sydney local date and time, or leave it undecided.' })
    try { times[key] = Date.parse(localToInstant(value)) } catch { throw new WorkError(422, 'validation', 'This Sydney local time is invalid, ambiguous or nonexistent.', 'not_applied', undefined, { [key]: 'This Sydney local time is invalid, ambiguous or nonexistent.' }) }
  }
  const take = times.takeOffEndLocal, start = times.installStartLocal, end = times.installEndLocal
  if (take !== null && start !== null && start < take || start !== null && end !== null && (end <= start || end - start > 90 * 86400000)) throw new WorkError(422, 'validation', 'Installation must follow take-off with an end after its start, within 90 days.', 'not_applied', undefined, { installStartLocal: 'Installation must follow take-off.', installEndLocal: 'Installation must end after its start, within 90 days.' })
  return input as WorkMutation & SimpleBookingDraftInput
}
