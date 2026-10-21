import { createClient } from '@supabase/supabase-js'
import { WorkError, type WorkStore } from '../management.ts'
export const currentWorkStore: WorkStore = {
  async command<T>(command: string, args: Record<string, unknown>): Promise<T> {
    if (typeof window !== 'undefined') throw new Error('Current work storage is server-only')
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
    if (process.env.OPERATIONS_STORE !== 'supabase' || !url || !key) throw new WorkError(503, 'unavailable', 'Current work storage is unavailable.')
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) }) } })
    let result
    try { result = await client.rpc('lk_current_work_command', { command, args }) } catch { throw new WorkError(503, 'outcome_unknown', 'The saved result is unknown. Check or retry the same request.', 'unknown') }
    const { data, error } = result
    if (error) {
      const status = ({ LK400: 400, LK401: 401, LK403: 403, LK404: 404, LK409: 409, LK422: 422 } as Record<string, number>)[error.code]
      let detail: Record<string, unknown> = {}; try { detail = JSON.parse(error.details ?? '{}') } catch { /* Only explicit structured conflict metadata is exposed. */ }
      const code = typeof detail.code === 'string' && ['revision_conflict','idempotency_conflict','state_conflict','booking_busy','cancellation_started'].includes(detail.code) ? detail.code : ({ 400: 'malformed_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'state_conflict', 422: 'validation' } as Record<number, string>)[status] ?? 'outcome_unknown'
      throw new WorkError(status ?? 503, code, status ? 'The request could not be applied. Refresh its saved status or correct the input.' : 'The saved result is unknown. Check or retry the same request.', status ? 'not_applied' : 'unknown', Number.isSafeInteger(detail.currentRevision) ? Number(detail.currentRevision) : undefined)
    }
    return data as T
  },
}
