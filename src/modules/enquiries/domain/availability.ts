/** Only normalized occupancy reaches this boundary: no customer or provider event data. */
export type AvailabilityInterval = {
  occupancy: 'confirmed' | 'opaque' | 'transparent'
} & (
  | { kind: 'all_day'; startDate: string; endDateExclusive: string }
  | { kind: 'timed'; startAt: string; endAt: string }
)

export interface AvailabilitySnapshot {
  /** Server-owned revision of the availability evidence, not a customer-supplied token. */
  revision: string
  checkedAt: string
  expiresAt: string
  rangeStart: string
  rangeEndExclusive: string
  sourceState: 'complete' | 'partial' | 'unavailable'
  /** Explicitly approved resource/working rules; absence never means all dates are free. */
  rulesReady: boolean
  intervals: readonly AvailabilityInterval[]
}

export type AvailabilityReason = 'requestable' | 'past' | 'busy' | 'outside_coverage' |
  'lookup_unavailable' | 'partial_lookup' | 'rules_not_ready' | 'stale_snapshot' |
  'invalid_snapshot' | 'invalid_date' | 'availability_changed'
export interface AvailabilityDay {
  date: string
  selectable: boolean
  reason: AvailabilityReason
}

const SYDNEY_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit',
})
function validDate(value: string): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}
function instant(value: string): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !validDate(value.slice(0, 10))) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}
function sydneyDate(timestamp: number): string {
  const parts = SYDNEY_DATE.formatToParts(timestamp)
  const get = (type: string) => parts.find(part => part.type === type)!.value
  return `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`
}
function blocked(date: string, reason: AvailabilityReason): AvailabilityDay {
  return { date, selectable: false, reason }
}

type BlockingSpan = { first: string; last: string }
type SnapshotCheck = { valid: true; spans: BlockingSpan[]; checkedAt: number } | { valid: false; reason: AvailabilityReason }
function checkSnapshot(snapshot: AvailabilitySnapshot, now: number): SnapshotCheck {
  if (!snapshot || typeof snapshot.revision !== 'string' || !snapshot.revision.trim() ||
      !validDate(snapshot.rangeStart) || !validDate(snapshot.rangeEndExclusive) || snapshot.rangeEndExclusive <= snapshot.rangeStart ||
      !Array.isArray(snapshot.intervals) || !['complete', 'partial', 'unavailable'].includes(snapshot.sourceState)) {
    return { valid: false, reason: 'invalid_snapshot' }
  }
  const checkedAt = instant(snapshot.checkedAt), expiresAt = instant(snapshot.expiresAt)
  if (checkedAt === null || expiresAt === null || expiresAt <= checkedAt || checkedAt > now) return { valid: false, reason: 'invalid_snapshot' }
  if (now >= expiresAt) return { valid: false, reason: 'stale_snapshot' }
  if (snapshot.sourceState === 'unavailable') return { valid: false, reason: 'lookup_unavailable' }
  if (snapshot.sourceState === 'partial') return { valid: false, reason: 'partial_lookup' }
  if (snapshot.rulesReady !== true) return { valid: false, reason: 'rules_not_ready' }
  const spans: BlockingSpan[] = []
  for (const interval of snapshot.intervals) {
    if (!interval || !['confirmed', 'opaque', 'transparent'].includes(interval.occupancy)) return { valid: false, reason: 'invalid_snapshot' }
    let first: string, last: string
    if (interval.kind === 'all_day') {
      if (!validDate(interval.startDate) || !validDate(interval.endDateExclusive) || interval.endDateExclusive <= interval.startDate) return { valid: false, reason: 'invalid_snapshot' }
      first = interval.startDate
      // Calendar all-day dates are Sydney civil dates, not UTC instants to convert.
      last = new Date(Date.parse(`${interval.endDateExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    } else if (interval.kind === 'timed') {
      const start = instant(interval.startAt), end = instant(interval.endAt)
      if (start === null || end === null || end <= start) return { valid: false, reason: 'invalid_snapshot' }
      first = sydneyDate(start)
      // Exclusive midnight does not occupy the following day, including across DST.
      last = sydneyDate(end - 1)
    } else return { valid: false, reason: 'invalid_snapshot' }
    if (interval.occupancy !== 'transparent') spans.push({ first, last })
  }
  return { valid: true, spans, checkedAt }
}

/** A requestable start is only a preference; this does not calculate duration or reserve resources. */
export function maskStartDates(snapshot: AvailabilitySnapshot, dates: readonly string[], now: string): AvailabilityDay[] {
  const timestamp = instant(now)
  if (timestamp === null) return dates.map(date => blocked(date, 'invalid_snapshot'))
  const today = sydneyDate(timestamp)
  const checked = checkSnapshot(snapshot, timestamp)
  return dates.map(date => {
    if (!validDate(date)) return blocked(date, 'invalid_date')
    if (date < today) return blocked(date, 'past')
    if (!checked.valid) return blocked(date, checked.reason)
    if (date < snapshot.rangeStart || date >= snapshot.rangeEndExclusive) return blocked(date, 'outside_coverage')
    if (checked.spans.some(span => date >= span.first && date <= span.last)) return blocked(date, 'busy')
    return { date, selectable: true, reason: 'requestable' }
  })
}

/**
 * The application must fetch freshSnapshot server-side after validationStartedAt.
 * Recheck under the eventual submission transaction/version guard. A passing result
 * is not an atomic hold or a confirmed booking and cannot replace that guard.
 */
export function validateStartDateSubmission(input: {
  date: string
  selectedSnapshotRevision: string
  freshSnapshot: AvailabilitySnapshot
  validationStartedAt: string
  now: string
}): AvailabilityDay {
  const { date, freshSnapshot, selectedSnapshotRevision } = input
  const now = instant(input.now), startedAt = instant(input.validationStartedAt)
  if (now === null || startedAt === null || startedAt > now) return blocked(date, 'invalid_snapshot')
  const checked = checkSnapshot(freshSnapshot, now)
  if (!checked.valid) return blocked(date, checked.reason)
  if (checked.checkedAt < startedAt) return blocked(date, 'stale_snapshot')
  const current = maskStartDates(freshSnapshot, [date], input.now)[0]
  if (!current.selectable) return current
  if (!selectedSnapshotRevision || selectedSnapshotRevision !== freshSnapshot.revision) return blocked(date, 'availability_changed')
  return current
}
