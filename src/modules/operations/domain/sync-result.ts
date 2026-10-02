function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export type SyncOutcomeState = 'completed' | 'partial' | 'skipped' | 'busy' | 'failed'
export interface SyncOutcome {
  state: SyncOutcomeState
  message: string
  /** Repeat polling preserves its 60-second cadence; intervention failures back off. */
  retryAfterMs: number
  /** 2 means no complete run (remaining pages, an unselected target, or a held lease). */
  exitCode: 0 | 1 | 2
}

const POLL_DELAY = 60_000
const INTERVENTION_DELAY = 300_000
const ERROR_MESSAGES: Record<string, string> = {
  google_reconnect_required: 'Google permission has expired or was revoked. Reconnect the company account.',
  google_temporary: 'Google is temporarily unavailable. Retry later.',
  google_configuration: 'Google integration configuration needs attention.',
  google_permission_denied: 'Google access is not permitted. Check the granted permissions and API settings.',
  google_invalid_response: 'Google returned an invalid response. Retry or review the integration settings.',
  google_not_connected: 'Connect the company Google account before syncing.',
  google_connection_changed: 'The Google connection changed during sync. Retry the operation.',
}
const INTERVENTION_CODES = new Set([
  'google_reconnect_required', 'google_configuration', 'google_permission_denied',
  'google_invalid_response', 'google_not_connected',
])

function failureOutcome(message: string, code?: string): SyncOutcome {
  return { state: 'failed', message, retryAfterMs: code && INTERVENTION_CODES.has(code) ? INTERVENTION_DELAY : POLL_DELAY, exitCode: 1 }
}

/** Never copy an exception/provider message or arbitrary result fields into UI/worker logs. */
export function summarizeSyncError(error: unknown): SyncOutcome {
  if (isRecord(error)) {
    if (typeof error.code === 'string' && Object.hasOwn(ERROR_MESSAGES, error.code)) {
      return failureOutcome(ERROR_MESSAGES[error.code], error.code)
    }
    if (error.code === 'sync_busy' || error.status === 409) {
      return { state: 'busy', message: 'Sync is already in progress; this run did not process any work.', retryAfterMs: POLL_DELAY, exitCode: 2 }
    }
  }
  return failureOutcome('Integration sync failed. Retry later.')
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function integrationOutcome(name: 'Gmail' | 'Calendar', status: Record<string, unknown>): SyncOutcome {
  if (status.busy === true || status.code === 'sync_busy') {
    return { state: 'busy', message: `${name} sync is already in progress.`, retryAfterMs: POLL_DELAY, exitCode: 2 }
  }
  if ((typeof status.error === 'string' && status.error.trim()) || typeof status.code === 'string') {
    const code = typeof status.code === 'string' ? status.code : undefined
    return failureOutcome(code && Object.hasOwn(ERROR_MESSAGES, code)
      ? `${name}: ${ERROR_MESSAGES[code]}` : `${name} sync failed; retry available.`, code)
  }
  if (count(status.failed) !== null && Number(status.failed) > 0) {
    return failureOutcome(`${name} sync failed for ${status.failed} operation(s); retry available.`)
  }
  if (typeof status.skipped === 'string' && status.skipped.trim()) {
    return { state: 'skipped', message: `${name} was not run because no ${name === 'Gmail' ? 'label' : 'calendar'} is selected.`, retryAfterMs: POLL_DELAY, exitCode: 2 }
  }
  if (status.partial === true) {
    return { state: 'partial', message: `${name} processed part of the backlog; more pages remain for the next run.`, retryAfterMs: POLL_DELAY, exitCode: 2 }
  }
  const processed = name === 'Gmail' ? count(status.imported) : count(status.synced)
  if (processed === null) return failureOutcome(`${name} sync returned an invalid result. Please retry.`)
  const scanned = count(status.scanned)
  const reviewed = count(status.reviewed)
  const conflicts = count(status.conflicts)
  const details = [`${name === 'Gmail' ? 'imported' : 'synced'} ${processed}`]
  if (scanned !== null) details.push(`scanned ${scanned}`)
  if (reviewed !== null) details.push(`reviewed ${reviewed}`)
  if (conflicts !== null && conflicts > 0) details.push(`conflicts ${conflicts}`)
  return { state: 'completed', message: `${name}: ${details.join(', ')}.`, retryAfterMs: POLL_DELAY, exitCode: 0 }
}

/** A 200 response, no selected target, or a remaining cursor is not a complete sync. */
export function summarizeSyncResult(result: unknown): SyncOutcome {
  if (!isRecord(result) || !isRecord(result.gmail) || !isRecord(result.calendar)) {
    return failureOutcome('Sync returned an invalid result. Please retry.')
  }
  const outcomes = [integrationOutcome('Gmail', result.gmail), integrationOutcome('Calendar', result.calendar)]
  const priority: SyncOutcomeState[] = ['failed', 'busy', 'partial', 'skipped', 'completed']
  const state = priority.find((candidate) => outcomes.some((item) => item.state === candidate))!
  return {
    state,
    message: outcomes.map((item) => item.message).join(' '),
    retryAfterMs: Math.max(...outcomes.map((item) => item.retryAfterMs)),
    exitCode: state === 'failed' ? 1 : state === 'completed' ? 0 : 2,
  }
}

/** Compatibility for callers that only need actual failures, not progress notices. */
export function syncFailureMessage(result: unknown): string | null {
  const outcome = summarizeSyncResult(result)
  return outcome.state === 'failed' ? outcome.message : null
}
