import { timingSafeEqual } from 'node:crypto'
import { processLiveBookingDeliveryBatch } from '@/modules/quotes/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Authenticated scheduler endpoint; query parameters never provide authentication. */
export async function GET(request: Request) {
  const secret = process.env.LIVE_BOOKING_CRON_SECRET || process.env.CRON_SECRET
  const header = request.headers.get('authorization') ?? ''
  const expected = secret ? `Bearer ${secret}` : ''
  const suppliedBytes = Buffer.from(header), expectedBytes = Buffer.from(expected)
  const authenticated = !!secret && secret.length >= 32 && suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes)
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  if (!authenticated) return Response.json({ error: 'Unauthorized' }, { status: 401, headers })
  try {
    const result = await processLiveBookingDeliveryBatch()
    return Response.json(result, { status: result.storageErrors ? 503 : 200, headers })
  } catch { return Response.json({ error: 'Saved booking delivery could not finish.' }, { status: 503, headers }) }
}
export const POST = GET
