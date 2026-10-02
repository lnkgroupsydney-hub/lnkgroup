import test from 'node:test'
import assert from 'node:assert/strict'
import { maskStartDates, validateStartDateSubmission, type AvailabilitySnapshot } from './availability.ts'

const NOW = '2026-10-01T22:00:00Z' // 2 October in Sydney.
function snapshot(overrides: Partial<AvailabilitySnapshot> = {}): AvailabilitySnapshot {
  return {
    revision: 'availability-1', checkedAt: NOW, expiresAt: '2026-10-01T22:05:00Z',
    rangeStart: '2026-10-02', rangeEndExclusive: '2026-11-01',
    sourceState: 'complete', rulesReady: true, intervals: [], ...overrides,
  }
}
function day(date: string, current = snapshot(), now = NOW) { return maskStartDates(current, [date], now)[0] }

test('past dates use Sydney today rather than the UTC date and stay inside fetched coverage', () => {
  assert.equal(day('2026-10-01').reason, 'past')
  assert.equal(day('2026-10-02').reason, 'requestable')
  assert.equal(day('2026-11-01').reason, 'outside_coverage')
  assert.equal(day('2026-02-30').reason, 'invalid_date')
  assert.equal(day('2026-10-02T00:00:00Z').reason, 'invalid_date')
})

test('confirmed and opaque multi-day bookings block each occupied date with exclusive all-day ends', () => {
  const current = snapshot({ intervals: [
    { occupancy: 'confirmed', kind: 'all_day', startDate: '2026-10-03', endDateExclusive: '2026-10-06' },
    { occupancy: 'opaque', kind: 'all_day', startDate: '2026-10-07', endDateExclusive: '2026-10-08' },
  ] })
  assert.deepEqual(maskStartDates(current, ['2026-10-02','2026-10-03','2026-10-04','2026-10-05','2026-10-06','2026-10-07','2026-10-08'], NOW).map(item => item.selectable), [true,false,false,false,true,false,true])
})

test('timed bookings convert to Sydney dates and do not block their exclusive midnight end', () => {
  const current = snapshot({ intervals: [
    { occupancy: 'opaque', kind: 'timed', startAt: '2026-10-02T13:30:00Z', endAt: '2026-10-03T14:00:00Z' },
  ] })
  // 23:30 on 2 Oct through midnight on 4 Oct Sydney.
  assert.equal(day('2026-10-02', current).reason, 'busy')
  assert.equal(day('2026-10-03', current).reason, 'busy')
  assert.equal(day('2026-10-04', current).reason, 'requestable')
})

test('DST spring-forward and fall-back days use actual instants rather than fixed 24-hour days', () => {
  const spring = snapshot({ intervals: [{ occupancy:'confirmed', kind:'timed', startAt:'2026-10-04T00:00:00+10:00', endAt:'2026-10-05T00:00:00+11:00' }] })
  assert.equal(day('2026-10-04', spring).reason, 'busy')
  assert.equal(day('2026-10-05', spring).reason, 'requestable')
  const autumnNow = '2027-04-01T00:00:00Z'
  const autumn = snapshot({ checkedAt:autumnNow, expiresAt:'2027-04-01T00:05:00Z', rangeStart:'2027-04-01', rangeEndExclusive:'2027-05-01', intervals:[{ occupancy:'opaque', kind:'timed', startAt:'2027-04-04T00:00:00+11:00', endAt:'2027-04-05T00:00:00+10:00' }] })
  assert.equal(day('2027-04-04', autumn, autumnNow).reason, 'busy')
  assert.equal(day('2027-04-05', autumn, autumnNow).reason, 'requestable')
})

test('year boundaries and leap days preserve all-day end exclusion', () => {
  const now = '2027-12-30T00:00:00Z'
  const current = snapshot({ checkedAt:now, expiresAt:'2027-12-30T00:05:00Z', rangeStart:'2027-12-30', rangeEndExclusive:'2028-03-02', intervals:[
    { occupancy:'confirmed', kind:'all_day', startDate:'2027-12-31', endDateExclusive:'2028-01-02' },
    { occupancy:'opaque', kind:'all_day', startDate:'2028-02-28', endDateExclusive:'2028-03-01' },
  ] })
  assert.equal(day('2028-01-01', current, now).reason, 'busy')
  assert.equal(day('2028-01-02', current, now).reason, 'requestable')
  assert.equal(day('2028-02-29', current, now).reason, 'busy')
  assert.equal(day('2028-03-01', current, now).reason, 'requestable')
})

test('transparent proposal events do not create an unapproved resource hold', () => {
  const current = snapshot({ intervals:[{ occupancy:'transparent', kind:'all_day', startDate:'2026-10-03', endDateExclusive:'2026-10-06' }] })
  assert.equal(day('2026-10-04', current).reason, 'requestable')
  current.intervals = [...current.intervals, { occupancy:'confirmed', kind:'all_day', startDate:'2026-10-04', endDateExclusive:'2026-10-05' }]
  assert.equal(day('2026-10-04', current).reason, 'busy')
})

test('unavailable, partial, unapproved, expired and malformed evidence all fail closed', () => {
  for (const [current, reason] of [
    [snapshot({sourceState:'unavailable'}), 'lookup_unavailable'],
    [snapshot({sourceState:'partial'}), 'partial_lookup'],
    [snapshot({rulesReady:false}), 'rules_not_ready'],
    [snapshot({checkedAt:'2026-10-01T21:00:00Z',expiresAt:NOW}), 'stale_snapshot'],
    [snapshot({checkedAt:'2026-10-01T22:01:00Z'}), 'invalid_snapshot'],
    [snapshot({intervals:[{occupancy:'opaque',kind:'timed',startAt:'2026-10-03T10:00:00',endAt:'2026-10-03T11:00:00'}]}), 'invalid_snapshot'],
    [snapshot({intervals:[{occupancy:'opaque',kind:'all_day',startDate:'2026-10-05',endDateExclusive:'2026-10-05'}]}), 'invalid_snapshot'],
  ] as const) {
    assert.deepEqual(day('2026-10-03', current), {date:'2026-10-03',selectable:false,reason})
  }
})

test('submission requires a new server lookup and rejects newly occupied or changed evidence', () => {
  const input = {date:'2026-10-03',selectedSnapshotRevision:'availability-1',freshSnapshot:snapshot(),validationStartedAt:NOW,now:NOW}
  assert.equal(validateStartDateSubmission(input).reason, 'requestable')
  assert.equal(validateStartDateSubmission({...input,validationStartedAt:'2026-10-01T22:00:01Z',now:'2026-10-01T22:00:02Z'}).reason, 'stale_snapshot')
  assert.equal(validateStartDateSubmission({...input,freshSnapshot:snapshot({revision:'availability-2'})}).reason, 'availability_changed')
  assert.equal(validateStartDateSubmission({...input,freshSnapshot:snapshot({revision:'availability-2',intervals:[{occupancy:'confirmed',kind:'all_day',startDate:'2026-10-03',endDateExclusive:'2026-10-04'}]})}).reason, 'busy')
  assert.equal(validateStartDateSubmission({...input,date:'2026-10-01'}).reason, 'past')
})

test('date masks reveal only date decisions and never expose interval or provider fields', () => {
  const evidence = snapshot({ intervals:[Object.assign({occupancy:'opaque' as const,kind:'all_day' as const,startDate:'2026-10-03',endDateExclusive:'2026-10-04'},{title:'private name',eventId:'private-id',address:'private address'})] })
  const result = maskStartDates(evidence, ['2026-10-03','2026-10-04'], NOW)
  assert.deepEqual(Object.keys(result[0]).sort(), ['date','reason','selectable'])
  assert.doesNotMatch(JSON.stringify(result), /private|eventId|address/)
})
