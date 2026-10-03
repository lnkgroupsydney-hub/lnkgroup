import {AppError,sydneyLocalToInstant,getConnection,googleRequest} from '../operations/calendar-access.ts'

export type BookingWorkSegment = { id: string; startAt: string; endAt: string }
type Connection = { account_sub: string; selected_calendar_id: string | null } | null
type CalendarEvent = {
  id?: unknown
  status?: unknown
  transparency?: unknown
  start?: { date?: unknown; dateTime?: unknown }
  end?: { date?: unknown; dateTime?: unknown }
  extendedProperties?: { private?: { bookingId?: unknown } }
}
type Dependencies = {
  connection: () => Promise<Connection>
  request: (url: string) => Promise<Response>
  now: () => Date
}
const dependencies: Dependencies = {
  connection: getConnection,
  request: (url) => googleRequest('calendar', url),
  now: () => new Date(),
}

function instant(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new AppError(400, 'Invalid booking time')
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new AppError(400, 'Invalid booking time')
  return parsed
}

function eventInterval(event: CalendarEvent): { start: number; end: number } {
  const start = event.start, end = event.end
  if (typeof start?.dateTime === 'string' && typeof end?.dateTime === 'string') {
    try{return { start: instant(start.dateTime), end: instant(end.dateTime) }}
    catch{throw new AppError(503, 'Calendar response is incomplete')}
  }
  if (typeof start?.date === 'string' && typeof end?.date === 'string') {
    try{return { start: Date.parse(sydneyLocalToInstant(`${start.date}T00:00`)), end: Date.parse(sydneyLocalToInstant(`${end.date}T00:00`)) }}
    catch{throw new AppError(503, 'Calendar response is incomplete')}
  }
  throw new AppError(503, 'Calendar response is incomplete')
}

/** A fresh, complete read of the owned demo Calendar; it does not reserve time. */
export async function verifyBookingCalendar(input: {
  segments: readonly BookingWorkSegment[]
  calendarId: string
  bookingId: string
  excludedManagedEventIds: readonly string[]
}, deps: Dependencies = dependencies): Promise<{ checkedAt: string; calendarId: string }> {
  if (!Array.isArray(input.segments) || input.segments.length < 1 || input.segments.length > 20 || !input.calendarId || !input.bookingId) throw new AppError(400, 'Work segments are required')
  const segments = input.segments.map((segment) => ({ start: instant(segment.startAt), end: instant(segment.endAt) }))
  if (segments.some((segment) => segment.end <= segment.start)) throw new AppError(400, 'Invalid work segment')
  const before = await deps.connection()
  if (!before || before.selected_calendar_id !== input.calendarId) throw new AppError(503, 'Selected Calendar changed or is unavailable')
  const ownIds = new Set(input.excludedManagedEventIds)
  const start = Math.min(...segments.map((segment) => segment.start))
  const end = Math.max(...segments.map((segment) => segment.end))
  let page: string | undefined
  let busy = false
  const pageTokens = new Set<string>()
  do {
    const q = new URLSearchParams({
      singleEvents: 'true', showDeleted: 'false', timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString(),
      timeZone: 'Australia/Sydney', maxResults: '2500',
      fields: 'accessRole,nextPageToken,items(id,status,transparency,start,end,extendedProperties)',
    })
    if (page) q.set('pageToken', page)
    const response = await deps.request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?${q}`)
    if (!response.ok) throw new AppError(503, 'Calendar availability is unavailable')
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError(503, 'Calendar response is incomplete')
    const result = data as { accessRole?: unknown; items?: unknown; nextPageToken?: unknown }
    if (result.accessRole !== 'owner' || (result.items !== undefined && !Array.isArray(result.items))) throw new AppError(503, 'Calendar response is incomplete')
    for (const raw of (result.items || []) as unknown[]) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(503, 'Calendar response is incomplete')
      const event = raw as CalendarEvent
      if (event.status === 'cancelled') continue
      if (event.status !== 'confirmed' && event.status !== 'tentative') throw new AppError(503, 'Calendar response is incomplete')
      if (event.transparency !== undefined && event.transparency !== 'transparent' && event.transparency !== 'opaque') throw new AppError(503, 'Calendar response is incomplete')
      if (event.transparency === 'transparent') continue
      if (typeof event.id !== 'string' || !event.id) throw new AppError(503, 'Calendar response is incomplete')
      if (ownIds.has(event.id) && event.extendedProperties?.private?.bookingId === input.bookingId) continue
      const interval = eventInterval(event)
      if (interval.end <= interval.start) throw new AppError(503, 'Calendar response is incomplete')
      if (segments.some((segment) => interval.start < segment.end && segment.start < interval.end)) busy = true
    }
    if (result.nextPageToken !== undefined && (typeof result.nextPageToken !== 'string' || !result.nextPageToken)) throw new AppError(503, 'Calendar response is incomplete')
    page = result.nextPageToken as string | undefined
    if (page) {
      if (pageTokens.has(page) || pageTokens.size >= 100) throw new AppError(503, 'Calendar pagination is incomplete')
      pageTokens.add(page)
    }
  } while (page)
  const after = await deps.connection()
  if (after?.account_sub !== before.account_sub || after?.selected_calendar_id !== input.calendarId) throw new AppError(503, 'Selected Calendar changed during validation')
  if (busy) throw new AppError(409, 'A work segment is no longer available')
  return { checkedAt: deps.now().toISOString(), calendarId: input.calendarId }
}
