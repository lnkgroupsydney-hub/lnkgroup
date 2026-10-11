import { createClient } from '@supabase/supabase-js'
import type { QuoteRequestStore } from '../application/requests.ts'
import { QuoteRequestError } from '../domain/contracts.ts'
export function privateQuoteClient() {
  if (typeof window !== 'undefined') throw new Error('Private quote storage is server-only')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY
  if (process.env.OPERATIONS_STORE !== 'supabase' || !url || !key) throw new QuoteRequestError(503, 'Private photo storage is unavailable. Keep your photos and retry.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(25000) }) } })
}
export const quoteMediaStore: QuoteRequestStore = {
  async command<T>(command: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await privateQuoteClient().rpc('lk_quote_media_command', { command, args })
    if (error) {
      const status = ({ LK400: 400, LK401: 401, LK403: 403, LK404: 404, LK409: 409, LK413: 413, LK429: 429 } as Record<string, number>)[error.code]
      throw new QuoteRequestError(status ?? 503, status ? error.message : 'Photo analysis storage is unavailable. Your saved information is retained; retry shortly.')
    }
    return data as T
  },
}
