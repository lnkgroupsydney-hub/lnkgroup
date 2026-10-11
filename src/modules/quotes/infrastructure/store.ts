import { createClient } from '@supabase/supabase-js'
import { QuoteRequestError } from '../domain/contracts.ts'
import type { QuoteRequestStore } from '../application/requests.ts'
export const quoteRequestStore: QuoteRequestStore = {
  async command<T>(command: string, args: Record<string, unknown>): Promise<T> {
    if (typeof window !== 'undefined') throw new Error('Quote request store is server-only')
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
    if (process.env.OPERATIONS_STORE !== 'supabase' || !url || !key) throw new QuoteRequestError(503, 'Private quote storage is unavailable. Keep your entries and retry.')
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(20000) }) } })
    const { data, error } = await client.rpc('lk_quote_requests_command', { command, args })
    if (error) {
      const status = ({ LK400: 400, LK401: 401, LK403: 403, LK404: 404, LK409: 409, LK429: 429 } as Record<string, number>)[error.code]
      throw new QuoteRequestError(status ?? 503, status ? error.message : 'Private quote storage is unavailable. Keep your entries and retry.')
    }
    return data as T
  },
}
