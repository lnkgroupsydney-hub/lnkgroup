import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSchedule, scheduleStatus } from './admin-schedule-view.ts';
import type { LiveCompanyBookingState, LiveCompanySegment } from '../domain/live-contracts.ts';

const request = (segments?: LiveCompanySegment[], booking?: string): LiveCompanyBookingState => ({
  submission: { reference: 'SYNTHETIC-001', preferredDate: '2026-10-20', snapshot: { payload: { contact: { name: 'Synthetic Client', email: 'qa@example.invalid', phone: '', siteAddress: 'Unit 2 Synthetic Street', suburb: 'Synthetic suburb', postcode: '2000' } } } },
  proposal: segments ? { status: 'draft', segments } : null, booking: booking ? { status: booking } : null,
}) as unknown as LiveCompanyBookingState;
const allDay: LiveCompanySegment = { kind: 'all_day', startDate: '2026-10-20', endDate: '2026-10-22', startAt: '2026-10-19T13:00:00Z', endAt: '2026-10-21T13:00:00Z' };
const timed: LiveCompanySegment = { kind: 'timed', startDate: '2026-10-20', endDate: '2026-10-21', startLocal: '2026-10-20T23:30', endLocal: '2026-10-21T01:00', startAt: '2026-10-20T12:30:00Z', endAt: '2026-10-20T14:00:00Z' };

test('schedule follows saved booking status before proposal status and never infers completion', () => {
  assert.equal(scheduleStatus(request()), 'requested');
  assert.equal(scheduleStatus(request([allDay])), 'draft');
  for (const state of ['confirming', 'confirmed', 'review_required']) assert.equal(scheduleStatus(request([allDay], state)), state);
});
test('day filter uses Sydney all-day end-exclusive dates and keeps gaps open', () => {
  const state = request([allDay, { ...allDay, startDate: '2026-10-24', endDate: '2026-10-25' }]);
  for (const day of ['2026-10-20', '2026-10-21', '2026-10-24']) assert.equal(matchesSchedule(state, '', '', day), true);
  for (const day of ['2026-10-19', '2026-10-22', '2026-10-23', '2026-10-25']) assert.equal(matchesSchedule(state, '', '', day), false);
});
test('timed midnight end does not occupy the next Sydney date but overnight visits do', () => {
  assert.equal(matchesSchedule(request([timed]), '', '', '2026-10-21'), true);
  assert.equal(matchesSchedule(request([{ ...timed, endLocal: '2026-10-21T00:00' }]), '', '', '2026-10-21'), false);
  assert.equal(matchesSchedule(request([{ ...timed, endLocal: '2026-10-21T00:00:00' }]), '', '', '2026-10-21'), false);
});
test('loaded record filters combine identity, status and preference date without inventing a visit', () => {
  const state = request();
  assert.equal(matchesSchedule(state, '  QA@EXAMPLE.INVALID ', 'requested', '2026-10-20'), true);
  assert.equal(matchesSchedule(state, 'unit 2', '', ''), true);
  assert.equal(matchesSchedule(state, '', 'confirmed', ''), false);
  assert.equal(matchesSchedule(state, '', '', '2026-10-21'), false);
  assert.equal(matchesSchedule(state, 'some other client', '', ''), false);
});
test('invalid dates are rejected even if their text falls inside a broad saved range', () => {
  const state = request([{ ...allDay, startDate: '2026-01-01', endDate: '2027-01-01' }]);
  for (const day of ['2026-02-30', '2026-13-01', '20/10/2026']) assert.equal(matchesSchedule(state, '', '', day), false);
});
