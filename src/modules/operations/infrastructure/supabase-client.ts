import { createClient } from '@supabase/supabase-js'
import { AppError } from '../domain/validation.ts'

export function supabaseEnabled(): boolean {
  return process.env.OPERATIONS_STORE === 'supabase'
}

export function createOperationsClient() {
  if (typeof window !== 'undefined') throw new Error('Operations client is server-only')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new AppError(503, 'Supabase server configuration is missing')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) }) },
  })
}

export async function operationsCommand<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createOperationsClient().rpc('lk_operations_command', { command, args })
  if (error) {
    const statuses: Record<string, number> = { LK404: 404, LK409: 409, LK429: 429, LK403: 403, LK400: 400 }
    const status = statuses[error.code]
    if (status) throw new AppError(status, error.message)
    throw new AppError(503, 'Supabase operation unavailable; review database setup or retry')
  }
  return data as T
}
