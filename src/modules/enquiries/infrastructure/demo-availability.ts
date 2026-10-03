import { createHash } from 'node:crypto';
import { readCalendarOccupancy } from '../../operations/availability.ts';
import { maskStartDates, type AvailabilitySnapshot } from '../domain/availability.ts';
import { QuoteHttpError } from './quote-draft-api.ts';
import {bookingOccupancy} from '../../bookings/server.ts';

export function sydneyToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function monthRange(month: unknown, now = new Date()) {
  if (typeof month !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw new QuoteHttpError(400,'Choose a valid calendar month.');
  const [year, number] = month.split('-').map(Number);
  const [currentYear, currentMonth] = sydneyToday(now).split('-').map(Number);
  const offset = (year-currentYear)*12 + number-currentMonth;
  if (offset < 0 || offset > 3) throw new QuoteHttpError(400,'Choose a date within the displayed four months.');
  const start = `${month}-01`;
  const end = new Date(Date.UTC(year,number,1)).toISOString().slice(0,10);
  const dates: string[] = [];
  for (let stamp = Date.parse(`${start}T00:00:00Z`); stamp < Date.parse(`${end}T00:00:00Z`); stamp += 86400000) dates.push(new Date(stamp).toISOString().slice(0,10));
  return { start, end, dates };
}
export async function demoAvailability(month: unknown, read = readCalendarOccupancy, occupancy = bookingOccupancy) {
  const { start, end, dates } = monthRange(month);
  const min = new Date(Date.parse(`${start}T00:00:00Z`) - 86400000).toISOString();
  const max = new Date(Date.parse(`${end}T00:00:00Z`) + 86400000).toISOString();
  // Both sources must complete. A failed DB read cannot be mistaken for free time.
  const [{calendarId,intervals:calendarIntervals},held] = await Promise.all([read(start,end),occupancy(min,max)]);
  const intervals = [...calendarIntervals,...held.map(span=>({kind:'timed' as const,occupancy:'opaque' as const,startAt:span.startAt,endAt:span.endAt}))];
  const checkedAt = new Date().toISOString();
  const normalized = intervals.map(item => JSON.stringify(item)).sort();
  const revision = createHash('sha256').update(JSON.stringify({calendarId,start,end,normalized,policy:'demo-preferred-day-v1'})).digest('hex');
  const snapshot: AvailabilitySnapshot = { revision, checkedAt, expiresAt:new Date(Date.parse(checkedAt)+120000).toISOString(), rangeStart:start, rangeEndExclusive:end,
    sourceState:'complete', rulesReady:true, intervals };
  // Demo policy only: every non-past, non-busy day can be requested. It promises
  // no operating hours, duration, capacity or reservation and is never live pricing.
  const days = maskStartDates(snapshot,dates,checkedAt);
  if (days.some(day => day.reason === 'invalid_snapshot')) throw new QuoteHttpError(503,'Calendar information is incomplete. Please retry.');
  return { calendarId, snapshot, public:{days,revision,checkedAt,expiresAt:snapshot.expiresAt} };
}
