import { createClient } from '@supabase/supabase-js'
import { CustomerError } from '../domain/validation.ts'
import type { CustomerStore } from '../application/customers.ts'
export const customerStore: CustomerStore = {
  async command<T>(command: string, args: Record<string, unknown>): Promise<T> {
    if (typeof window !== 'undefined') throw new Error('Customer store is server-only')
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
    if (process.env.OPERATIONS_STORE !== 'supabase' || !url || !key) throw new CustomerError(503, 'Customer storage is unavailable.')
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) }) } })
    const { data, error } = await client.rpc('lk_customers_command', { command, args })
    if (error) {
      const status = ({ LK400: 400, LK403: 403, LK404: 404, LK409: 409 } as Record<string, number>)[error.code]
      throw new CustomerError(status ?? 503, status ? error.message : 'Customer storage is unavailable. Review migration setup or retry.')
    }
    return data as T
  },
}
