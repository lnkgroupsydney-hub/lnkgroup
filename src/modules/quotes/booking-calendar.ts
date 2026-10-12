import { createHash } from 'node:crypto'
import { getConnection, googleRequest } from '../operations/calendar-access.ts'
import { readCalendarOccupancy } from '../operations/availability.ts'
import { maskStartDates, type AvailabilityInterval } from '../enquiries/availability.ts'
import { QuoteRequestError } from './domain/contracts.ts'
import { bookingDate, type LiveCalendarTarget } from './domain/booking-flow.ts'
import { liveBookingStore } from './infrastructure/booking-flow-store.ts'

const COMPANY_EMAIL = 'lnkgroupsydney@gmail.com'
const GOOGLE = 'https://www.googleapis.com/calendar/v3'
type Connection = { account_sub: string; email: string } | null
export interface LiveCalendarPorts {
  connection: () => Promise<Connection>
  request: (url: string, init?: RequestInit) => Promise<Response>
  confirmed: (target: LiveCalendarTarget) => Promise<{ segments: { startDate: string; endDate: string }[] }>
  target: () => string | undefined
  now: () => Date
}
const ports: LiveCalendarPorts = {
  connection: getConnection,
  request: (url, init) => googleRequest('calendar', url, init),
  confirmed: target => liveBookingStore.command('occupancy', { ...target }),
  target: () => process.env.LIVE_QUOTE_CALENDAR_ID,
  now: () => new Date(),
}
const unavailable = () => new QuoteRequestError(503, 'Company Calendar could not be checked. Please retry before choosing a date.')
const review = (message = 'Company Calendar changed. The company must review this request before its Calendar entry can be saved.') => Object.assign(new QuoteRequestError(409, message), { code: 'calendar_review_required' })
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
function today(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-')
}
function offsetMonth(month: string, offset: number): string {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7)
}
async function connectionTarget(deps: LiveCalendarPorts): Promise<LiveCalendarTarget> {
  const connection = await deps.connection(), calendarId = deps.target()?.trim()
  // An explicit operational target prevents a legacy test Calendar silently becoming live.
  if (!connection?.account_sub || connection.email.toLowerCase() !== COMPANY_EMAIL || calendarId?.toLowerCase() !== COMPANY_EMAIL) throw unavailable()
  return { accountSub: connection.account_sub, calendarId: COMPANY_EMAIL }
}
function sameTarget(left: LiveCalendarTarget, right: LiveCalendarTarget): boolean {
  return left.accountSub === right.accountSub && left.calendarId === right.calendarId
}
export async function resolveLiveCalendarTarget(deps: LiveCalendarPorts = ports): Promise<LiveCalendarTarget> {
  const before = await connectionTarget(deps)
  const response = await deps.request(`${GOOGLE}/users/me/calendarList/${encodeURIComponent(before.calendarId)}`)
  if (!response.ok) throw unavailable()
  const value = await response.json() as { id?: string; accessRole?: string; primary?: boolean }
  if (value.id !== before.calendarId || value.accessRole !== 'owner' || value.primary !== true || !sameTarget(before, await connectionTarget(deps))) throw unavailable()
  return before
}
export async function readLiveBookingAvailability(month: string, deps: LiveCalendarPorts = ports) {
  const minMonth = today(deps.now()).slice(0, 7), maxMonth = offsetMonth(minMonth, 3)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < minMonth || month > maxMonth) throw new QuoteRequestError(400, 'Choose a month within the displayed Calendar.')
  const target = await resolveLiveCalendarTarget(deps), rangeStart = `${month}-01`, rangeEndExclusive = `${offsetMonth(month, 1)}-01`
  const [google, local] = await Promise.all([
    readCalendarOccupancy(rangeStart, rangeEndExclusive, {
      connection: async () => { const value = await connectionTarget(deps); return { account_sub: value.accountSub, selected_calendar_id: value.calendarId } },
      request: url => deps.request(url),
    }),
    deps.confirmed(target),
  ])
  if (!sameTarget(target, await connectionTarget(deps)) || google.calendarId !== target.calendarId || !Array.isArray(local?.segments)) throw unavailable()
  const intervals: AvailabilityInterval[] = [...google.intervals, ...local.segments.map(segment => ({ kind: 'all_day' as const, occupancy: 'confirmed' as const, startDate: segment.startDate, endDateExclusive: segment.endDate }))]
  // Stable content revision: repeated reads of unchanged occupancy do not invalidate review.
  const revision = digest({ target, rangeStart, rangeEndExclusive, intervals: intervals.map(interval => JSON.stringify(interval)).sort() })
  const checkedAt = deps.now().toISOString(), expiresAt = new Date(Date.parse(checkedAt) + 120000).toISOString()
  const dates: string[] = []
  for (let date = rangeStart; date < rangeEndExclusive; date = nextDay(date)) dates.push(date)
  const days = maskStartDates({ revision, checkedAt, expiresAt, rangeStart, rangeEndExclusive, sourceState: 'complete', rulesReady: true, intervals }, dates, checkedAt)
  // Malformed provider/local data must not look like a completed but empty schedule.
  if (days.some(day => day.reason === 'invalid_snapshot')) throw unavailable()
  return { ...target, month, days, revision, checkedAt, expiresAt, minMonth, maxMonth }
}
export async function assertLiveBookingDate(date: string, expectedAvailabilityRevision?: string, deps: LiveCalendarPorts = ports) {
  bookingDate(date)
  const result = await readLiveBookingAvailability(date.slice(0, 7), deps)
  const day = result.days.find(item => item.date === date)
  if (!day?.selectable) throw new QuoteRequestError(409, day?.reason === 'busy' ? 'That date is now booked. Choose another available start date.' : 'That date is no longer available. Refresh the Calendar and choose again.')
  if (expectedAvailabilityRevision && expectedAvailabilityRevision !== result.revision) throw new QuoteRequestError(409, 'Calendar availability changed. Refresh the Calendar and confirm your preferred date again.')
  return { calendarId: result.calendarId, accountSub: result.accountSub, revision: result.revision, checkedAt: result.checkedAt, expiresAt: result.expiresAt }
}

export interface PendingLiveCalendarInput extends LiveCalendarTarget { id: string; reference: string; preferredDate: string; snapshotHash: string; leaseExpiresAt?: string }
type Event = { id?: string; etag?: string; status?: string; summary?: string; visibility?: string; transparency?: string; htmlLink?: string; start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }; attendees?: unknown[]; recurrence?: unknown[]; recurringEventId?: string; extendedProperties?: { private?: Record<string, string> } }
export const livePendingEventId = (submissionId: string) => `a${digest(`live-quote-pending:${submissionId}`)}`
function eventPlan(input: PendingLiveCalendarInput) {
  return {
    id: livePendingEventId(input.id), summary: `Pending booking request · ${input.reference}`,
    description: 'Preferred start date only. Company review of scope, price, duration and availability is required. This entry does not reserve time or confirm a booking. Review the request in the company EMS.',
    status: 'tentative', visibility: 'private', transparency: 'transparent',
    start: { date: input.preferredDate }, end: { date: nextDay(input.preferredDate) },
    extendedProperties: { private: { kind: 'live-quote-booking-request-v1', submissionId: input.id, snapshotHash: input.snapshotHash } },
  }
}
function matches(event: Event, input: PendingLiveCalendarInput): boolean {
  const plan = eventPlan(input), owner = event.extendedProperties?.private
  return event.id === plan.id && typeof event.etag === 'string' && !!event.etag && event.status === plan.status && event.summary === plan.summary && event.visibility === 'private' && event.transparency === 'transparent' &&
    event.start?.date === plan.start.date && !event.start.dateTime && event.end?.date === plan.end.date && !event.end.dateTime && !event.recurrence?.length && !event.recurringEventId && !event.attendees?.length &&
    owner?.kind === plan.extendedProperties.private.kind && owner.submissionId === input.id && owner.snapshotHash === input.snapshotHash
}
export async function ensureLivePendingCalendar(input: PendingLiveCalendarInput, deps: LiveCalendarPorts = ports): Promise<{ eventId: string; etag: string; eventUrl: string | null }> {
  bookingDate(input.preferredDate)
  if (!sameTarget(input, await resolveLiveCalendarTarget(deps))) throw review()
  const plan = eventPlan(input), path = `${GOOGLE}/calendars/${encodeURIComponent(input.calendarId)}/events`, itemPath = `${path}/${plan.id}`
  async function get(): Promise<Event | null> {
    const response = await deps.request(itemPath)
    if (response.status === 404) return null
    // A deleted event is an external decision, never permission to recreate it.
    if (response.status === 410) throw review()
    if (!response.ok) throw unavailable()
    const value = await response.json() as Event
    if (!value || value.status === 'cancelled') throw review()
    return value
  }
  let event = await get()
  if (event && !matches(event, input)) throw review()
  if (!event) {
    if (input.preferredDate < today(deps.now())) throw review('The preferred date has passed. The company must review an alternative date.')
    try { await assertLiveBookingDate(input.preferredDate, undefined, deps) } catch (error) {
      if (error instanceof QuoteRequestError && error.status === 409) throw review('The preferred date became unavailable. The company must review an alternative date.')
      throw error
    }
    if (!sameTarget(input, await connectionTarget(deps))) throw review()
    // Never start a provider mutation after a lengthy paginated lookup has consumed the lease.
    if (input.leaseExpiresAt && (!Number.isFinite(Date.parse(input.leaseExpiresAt)) || Date.parse(input.leaseExpiresAt) <= deps.now().getTime() + 35000)) throw unavailable()
    const response = await deps.request(`${path}?sendUpdates=none`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(plan) })
    if (!response.ok && response.status !== 409) throw unavailable()
    // A successful write response alone is insufficient: verify the stored event.
    event = await get()
    if (!event || !matches(event, input)) throw review()
  }
  if (!sameTarget(input, await connectionTarget(deps))) throw review()
  let eventUrl: string | null = null
  try { const url = new URL(event.htmlLink ?? ''); if (url.protocol === 'https:' && url.hostname === 'www.google.com' && url.pathname.startsWith('/calendar/')) eventUrl = url.href } catch { /* Optional provider link. */ }
  return { eventId: event.id!, etag: event.etag!, eventUrl }
}
