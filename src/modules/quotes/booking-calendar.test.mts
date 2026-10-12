import test from 'node:test'
import assert from 'node:assert/strict'
import { assertLiveBookingDate, ensureLivePendingCalendar, livePendingEventId, readLiveBookingAvailability, resolveLiveCalendarTarget, type LiveCalendarPorts, type PendingLiveCalendarInput } from './booking-calendar.ts'

const target = { accountSub: 'company-sub', calendarId: 'lnkgroupsydney@gmail.com' }
const input: PendingLiveCalendarInput = { ...target, id: '12345678-1234-4234-8234-123456789012', reference: 'RQ-QA', preferredDate: '2026-10-20', snapshotHash: 'a'.repeat(64) }
function fixture() {
  const events = new Map<string, Record<string, unknown>>()
  const requests: { url: string; init?: RequestInit }[] = []
  let occupancy: unknown[] = [], segments: { startDate: string; endDate: string }[] = []
  const deps: LiveCalendarPorts = {
    connection: async () => ({ account_sub: target.accountSub, email: 'Lnkgroupsydney@gmail.com' }), target: () => target.calendarId,
    now: () => new Date('2026-10-12T01:00:00Z'), confirmed: async () => ({ segments }),
    request: async (url, init) => {
      requests.push({ url, init })
      if (url.includes('/users/me/calendarList/')) return Response.json({ id: target.calendarId, primary: true, accessRole: 'owner' })
      if (init?.method === 'POST') {
        const event = JSON.parse(String(init.body)); if (events.has(event.id)) return new Response(null, { status: 409 })
        events.set(event.id, { ...event, etag: 'etag-1', htmlLink: 'https://www.google.com/calendar/event?eid=test' })
        return Response.json(event)
      }
      if (url.includes('/events?')) return Response.json({ accessRole: 'owner', items: occupancy })
      const event = events.get(url.split('/').at(-1)!); return event ? Response.json(event) : new Response(null, { status: 404 })
    },
  }
  return { deps, events, requests, occupancy: (value: unknown[]) => { occupancy = value }, confirmed: (value: typeof segments) => { segments = value } }
}
test('live target is the verified company primary Calendar, independent from legacy test selection', async () => {
  const f = fixture(); assert.deepEqual(await resolveLiveCalendarTarget(f.deps), target)
  await assert.rejects(resolveLiveCalendarTarget({ ...f.deps, target: () => 'test@group.calendar.google.com' }), /could not be checked/)
  await assert.rejects(resolveLiveCalendarTarget({ ...f.deps, connection: async () => ({ account_sub: 'personal', email: 'personal@example.com' }) }), /could not be checked/)
  await assert.rejects(resolveLiveCalendarTarget({ ...f.deps, request: async () => Response.json({ id: target.calendarId, accessRole: 'writer', primary: true }) }), /could not be checked/)
})
test('opaque, all-day exclusive ends, DST timed intervals and confirmed DB segments mask days; pending is transparent', async () => {
  const f = fixture()
  f.occupancy([
    { status: 'confirmed', start: { date: '2026-10-20' }, end: { date: '2026-10-22' } },
    { status: 'confirmed', start: { dateTime: '2026-10-22T13:00:00Z' }, end: { dateTime: '2026-10-23T13:00:00Z' } },
    { status: 'tentative', transparency: 'transparent', start: { date: '2026-10-25' }, end: { date: '2026-10-26' } },
  ])
  f.confirmed([{ startDate: '2026-10-26', endDate: '2026-10-28' }])
  const result = await readLiveBookingAvailability('2026-10', f.deps), byDate = (d: string) => result.days.find(day => day.date === `2026-10-${d}`)!
  for (const date of ['20', '21', '23', '26', '27']) assert.equal(byDate(date).reason, 'busy')
  for (const date of ['22', '24', '25', '28']) assert.equal(byDate(date).selectable, true)
  assert.equal(byDate('11').reason, 'past'); assert.equal(result.minMonth, '2026-10'); assert.equal(result.maxMonth, '2027-01')
  assert.equal(result.revision, (await readLiveBookingAvailability('2026-10', f.deps)).revision)
  await assert.rejects(assertLiveBookingDate('2026-10-20', result.revision, f.deps), /now booked/)
  await assert.rejects(assertLiveBookingDate('2026-10-22', 'old-revision', f.deps), /availability changed/)
})
test('provider failure, partial pagination, invalid occupancy and changed accounts fail closed', async () => {
  const f = fixture(), request = f.deps.request
  await assert.rejects(readLiveBookingAvailability('2026-10', { ...f.deps, request: async (url, init) => url.includes('/events?') ? new Response(null, { status: 503 }) : request(url, init) }))
  await assert.rejects(readLiveBookingAvailability('2026-10', { ...f.deps, request: async (url, init) => url.includes('/events?') ? Response.json({ accessRole: 'owner', nextPageToken: 'loop', items: [] }) : request(url, init) }))
  f.occupancy([{ status: 'confirmed', start: { date: 'invalid' }, end: { date: '2026-10-22' } }])
  await assert.rejects(readLiveBookingAvailability('2026-10', f.deps), /could not be checked/)
  await assert.rejects(readLiveBookingAvailability('2026-10', { ...f.deps, confirmed: async () => { throw new Error('storage unavailable') } }))
  let calls = 0
  await assert.rejects(resolveLiveCalendarTarget({ ...f.deps, connection: async () => ({ account_sub: ++calls === 1 ? target.accountSub : 'changed', email: target.calendarId }) }), /could not be checked/)
})
test('write then independent readback produces one private transparent pending event and response-loss retry deduplicates', async () => {
  const f = fixture(), first = await ensureLivePendingCalendar(input, f.deps)
  assert.equal(first.eventId, livePendingEventId(input.id)); assert.match(first.eventId, /^[a-v0-9]{5,1024}$/)
  assert.equal(first.etag, 'etag-1'); assert.equal(f.events.size, 1)
  const stored = f.events.get(first.eventId)!
  assert.equal(stored.transparency, 'transparent'); assert.equal(stored.status, 'tentative'); assert.equal(stored.visibility, 'private')
  assert.equal('attendees' in stored, false); assert.deepEqual(stored.end, { date: '2026-10-21' })
  assert.ok(f.requests.find(x => x.init?.method === 'POST')!.url.endsWith('sendUpdates=none'))
  const finalRequest = f.requests.at(-1)!; assert.ok(finalRequest.url.endsWith(first.eventId)); assert.equal(finalRequest.init?.method, undefined)
  assert.deepEqual(await ensureLivePendingCalendar(input, f.deps), first)
  assert.equal(f.requests.filter(x => x.init?.method === 'POST').length, 1)
})
test('lost insert response is recovered by stable ID; external edits and deleted events require review without rewriting', async () => {
  const f = fixture(), request = f.deps.request
  let lose = true
  const deps = { ...f.deps, request: async (url: string, init?: RequestInit) => {
    const response = await request(url, init)
    if (init?.method === 'POST' && lose) { lose = false; throw new Error('network response lost') }
    return response
  } }
  await assert.rejects(ensureLivePendingCalendar(input, deps), /response lost/)
  await ensureLivePendingCalendar(input, deps)
  assert.equal(f.events.size, 1); assert.equal(f.requests.filter(x => x.init?.method === 'POST').length, 1)
  const event = f.events.get(livePendingEventId(input.id))!
  event.start = { date: '2026-10-22' }
  await assert.rejects(ensureLivePendingCalendar(input, deps), (error: unknown) => (error as { code?: string }).code === 'calendar_review_required')
  event.status = 'cancelled'
  await assert.rejects(ensureLivePendingCalendar(input, deps), /must review/)
  assert.equal(f.requests.filter(x => x.init?.method === 'POST').length, 1)
})
test('busy date before first write and changed readback never report Calendar saved', async () => {
  const f = fixture()
  f.occupancy([{ status: 'confirmed', start: { date: input.preferredDate }, end: { date: next(input.preferredDate) } }])
  await assert.rejects(ensureLivePendingCalendar(input, f.deps), /became unavailable/)
  assert.equal(f.events.size, 0)
  f.occupancy([])
  const request = f.deps.request
  await assert.rejects(ensureLivePendingCalendar(input, { ...f.deps, request: async (url, init) => {
    const response = await request(url, init)
    if (init?.method === 'POST') f.events.get(livePendingEventId(input.id))!.transparency = 'opaque'
    return response
  } }), /must review/)
})
function next(date: string) { return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) }

test('month-boundary recovery reviews a passed date and a spent lease cannot start a Google write', async () => {
  const f = fixture()
  await assert.rejects(ensureLivePendingCalendar(input, { ...f.deps, now: () => new Date('2026-11-01T01:00:00Z') }), /preferred date has passed/)
  assert.equal(f.events.size, 0)
  await assert.rejects(ensureLivePendingCalendar({ ...input, leaseExpiresAt: '2026-10-12T01:00:10Z' }, f.deps), /could not be checked/)
  assert.equal(f.requests.some(request => request.init?.method === 'POST'), false)
})
