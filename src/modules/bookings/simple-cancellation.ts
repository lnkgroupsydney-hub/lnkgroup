import { randomUUID } from 'node:crypto'
import type { WorkStore } from '../enquiries/management.ts'
import type { CancellationClaim } from './domain/simple-management.ts'
import { removeSimpleBookingEvents } from './live-calendar.ts'
export interface SimpleCancellationPorts { store: WorkStore; remove: typeof removeSimpleBookingEvents; enabled(): boolean; now(): number }
function storedTargetReview(value: unknown): boolean { return !!value && typeof value === 'object' && 'reviewRequired' in value && value.reviewRequired === true }
const recordedTargetReview = () => Object.assign(new Error('The changed Calendar target was recorded for review.'), { cancellationReviewRecorded: true })
export type SimpleCancellationResult = { claimed: number; cancelled: number; retrying: number; reviewRequired: number; storageErrors: number }
export async function processSimpleBookingCancellation(requestId?: string, injected?: SimpleCancellationPorts): Promise<SimpleCancellationResult> {
  const result = { claimed: 0, cancelled: 0, retrying: 0, reviewRequired: 0, storageErrors: 0 }
  const deps = injected ?? { store: (await import('../enquiries/management-server.ts')).currentWorkStore, remove: removeSimpleBookingEvents, enabled: () => process.env.QUOTE_LIVE_ENABLED === 'true', now: Date.now }
  if (!deps.enabled()) return result
  if (requestId !== undefined && !/^[a-f0-9-]{36}$/i.test(requestId)) throw new Error('Invalid cancellation request')
  const token = randomUUID(), command = <T>(name: string, args: Record<string, unknown>) => deps.store.command<T>(name, { ...args, companyId: 'lk-group' })
  let claim: CancellationClaim | null
  try { const value = await command<unknown>('cancel_worker_claim', { ...(requestId ? { requestId } : {}), leaseToken: token }); if (storedTargetReview(value)) { result.reviewRequired++; return result } claim = value as CancellationClaim | null } catch { result.storageErrors++; return result }
  if (!claim) return result
  if (claim.leaseToken !== token || !claim.id || !claim.bookingId || !claim.proposalHash || !Array.isArray(claim.manifest) || Date.parse(claim.leaseExpiresAt) <= deps.now() + 30000) { result.storageErrors++; return result }
  result.claimed++
  const lease = { id: claim.id, bookingId: claim.bookingId, proposalHash: claim.proposalHash, leaseToken: token }
  try {
    const finalProof = await deps.remove(claim, { assertLease: async () => { if (storedTargetReview(await command('cancel_worker_assert', lease))) throw recordedTargetReview() }, recordEvent: async proof => { if (storedTargetReview(await command('cancel_worker_record', { ...lease, ...proof }))) throw recordedTargetReview() } })
    if (storedTargetReview(await command('cancel_worker_finish', { ...lease, finalProof }))) { result.reviewRequired++; return result }
    result.cancelled++
  } catch (error) {
    if (error instanceof Error && 'cancellationReviewRecorded' in error && error.cancellationReviewRecorded === true) { result.reviewRequired++; return result }
    const review = error instanceof Error && 'code' in error && error.code === 'company_calendar_review_required'
    try { const value = await command('cancel_worker_error', { ...lease, status: review ? 'review_required' : 'retrying', errorCode: review ? (error as Error & { cancellationCode?: string }).cancellationCode ?? 'calendar_changed' : 'calendar_outcome_unknown' }); if (review || storedTargetReview(value)) result.reviewRequired++; else result.retrying++ } catch { result.storageErrors++ }
  }
  return result
}
