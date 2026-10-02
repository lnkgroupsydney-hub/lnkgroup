// Public server entry point: exposes occupancy only, never event titles or attendees.
import { getConnection, googleRequest } from './infrastructure/supabase-auth.ts';

export type CalendarOccupancy = { occupancy: 'opaque' | 'transparent' } & (
  { kind: 'all_day'; startDate: string; endDateExclusive: string } |
  { kind: 'timed'; startAt: string; endAt: string }
);
type AvailabilityConnection = { account_sub: string; selected_calendar_id: string | null } | null;
type Dependencies = {
  connection: () => Promise<AvailabilityConnection>;
  request: (url: string) => Promise<Response>;
};
export async function readCalendarOccupancy(startDate: string, endDateExclusive: string, deps: Dependencies = {
  connection: getConnection,
  request: url => googleRequest('calendar', url),
}): Promise<{ calendarId: string; intervals: CalendarOccupancy[] }> {
  const before = await deps.connection();
  if (!before?.selected_calendar_id) throw new Error('Calendar unavailable');
  const calendarId = before.selected_calendar_id;
  // Widen UTC bounds around Sydney civil dates; the caller clips dates afterwards.
  const min = new Date(Date.parse(`${startDate}T00:00:00Z`) - 86400000).toISOString();
  const max = new Date(Date.parse(`${endDateExclusive}T00:00:00Z`) + 86400000).toISOString();
  const intervals: CalendarOccupancy[] = [];
  const tokens = new Set<string>();
  let page: string | undefined;
  do {
    const query = new URLSearchParams({ singleEvents:'true', showDeleted:'false', timeMin:min, timeMax:max,
      timeZone:'Australia/Sydney', maxResults:'250', fields:'accessRole,nextPageToken,items(status,transparency,start,end)' });
    if (page) query.set('pageToken', page);
    const response = await deps.request(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
    if (!response.ok) throw new Error('Calendar unavailable');
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Calendar response incomplete');
    const body = data as Record<string, unknown>;
    if (body.accessRole !== 'owner' || (body.items !== undefined && !Array.isArray(body.items))) throw new Error('Calendar response incomplete');
    for (const entry of (body.items ?? []) as unknown[]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Calendar response incomplete');
      const event = entry as Record<string, unknown>;
      if (event.status === 'cancelled') continue;
      if (event.status !== 'confirmed' && event.status !== 'tentative') throw new Error('Calendar response incomplete');
      if (event.transparency !== undefined && event.transparency !== 'opaque' && event.transparency !== 'transparent') throw new Error('Calendar response incomplete');
      const occupancy = event.transparency === 'transparent' ? 'transparent' : 'opaque';
      const start = event.start as Record<string, unknown> | undefined, end = event.end as Record<string, unknown> | undefined;
      if (typeof start?.date === 'string' && typeof end?.date === 'string') intervals.push({ occupancy, kind:'all_day', startDate:start.date, endDateExclusive:end.date });
      else if (typeof start?.dateTime === 'string' && typeof end?.dateTime === 'string') intervals.push({ occupancy, kind:'timed', startAt:start.dateTime, endAt:end.dateTime });
      else throw new Error('Calendar response incomplete');
    }
    if (body.nextPageToken !== undefined && (typeof body.nextPageToken !== 'string' || !body.nextPageToken)) throw new Error('Calendar response incomplete');
    page = body.nextPageToken as string | undefined;
    if (page) {
      if (tokens.has(page) || tokens.size >= 7) throw new Error('Calendar response incomplete');
      tokens.add(page);
    }
  } while (page);
  const after = await deps.connection();
  if (after?.account_sub !== before.account_sub || after?.selected_calendar_id !== calendarId) throw new Error('Calendar changed during lookup');
  return { calendarId, intervals };
}
