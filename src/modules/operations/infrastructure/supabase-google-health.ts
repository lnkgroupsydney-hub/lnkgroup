import { createOperationsClient } from './supabase-client.ts'
import { AppError } from '../domain/validation.ts'
import type { CloudConnection } from './supabase-auth.ts'
import type { GoogleConnectionState } from '../domain/contracts.ts'
import { googleFailure, type GoogleHealthCode } from './google-errors.ts'

export type HealthKind = 'auth' | 'gmail' | 'calendar'

export async function googleHealthCommand<T>(action: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await createOperationsClient().rpc('lk_google_health', { action, args })
  if (error) throw new AppError(error.code === 'LK409' ? 409 : 503, error.code === 'LK409' ? 'Google connection changed; retry the operation' : 'Google connection status storage unavailable; review database setup or retry')
  return data as T
}

export async function recordGoogleHealth(row: CloudConnection, kind: HealthKind, code: GoogleHealthCode, observedAt: number, holder?: string): Promise<boolean> {
  return googleHealthCommand<boolean>('record', {
    kind, code, observed_at: observedAt, holder: holder ?? null,
    account_sub: row.account_sub, expected_access_cipher: row.access_cipher,
    expected_refresh_cipher: row.refresh_cipher,
    expected_target: kind === 'gmail' ? row.selected_gmail_label_id : kind === 'calendar' ? row.selected_calendar_id : null,
  })
}

export function connectionState(row: CloudConnection | null, kind: 'gmail' | 'calendar', configured: boolean): { status: GoogleConnectionState; checkedAt: string | null; error: string | null; connected: boolean } {
  if (!configured) return { status: 'configuration_error', checkedAt: null, error: 'Google connection is not configured', connected: false }
  if (!row) return { status: 'not_connected', checkedAt: null, error: null, connected: false }
  const authCode = row.auth_health_code ?? 'unverified'
  const ownCode = (kind === 'gmail' ? row.gmail_health_code : row.calendar_health_code) ?? 'unverified'
  const code = authCode.startsWith('google_') ? authCode : ownCode
  const checked = authCode.startsWith('google_') ? row.auth_health_checked_at : kind === 'gmail' ? row.gmail_health_checked_at : row.calendar_health_checked_at
  const checkedAt = checked ? new Date(checked).toISOString() : null
  const states: Partial<Record<GoogleHealthCode, GoogleConnectionState>> = { google_reconnect_required: 'reconnect_required', google_temporary: 'retrying', google_configuration: 'configuration_error', google_permission_denied: 'permission_denied', google_invalid_response: 'retrying', google_connection_changed: 'retrying', google_not_connected: 'not_connected' }
  if (states[code]) return { status: states[code]!, checkedAt, error: googleFailure({ code }).message, connected: !['google_reconnect_required', 'google_not_connected'].includes(code) }
  const target = kind === 'gmail' ? row.selected_gmail_label_id : row.selected_calendar_id
  return { status: !target ? 'target_required' : code === 'ready' ? 'ready' : code === 'partial' ? 'partial' : 'unverified', checkedAt, error: null, connected: true }
}
