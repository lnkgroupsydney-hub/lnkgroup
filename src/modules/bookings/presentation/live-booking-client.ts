import { COMPANY_BOOKING_ACK_TEXT, COMPANY_BOOKING_ACK_VERSION, type LiveCompanyBookingState, type LiveCompanyCalendarCheck, type LiveCompanyProposal, type LiveCompanyReview } from '../domain/live-contracts.ts';

export class LiveCompanyRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status=status; }
}
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validDate(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function money(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0; }
export function parseCompanyProposal(value: unknown): LiveCompanyProposal {
  if (!record(value) || typeof value.id !== 'string' || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !Number.isSafeInteger(value.revision) || !['draft','published'].includes(String(value.status)) || typeof value.hash !== 'string' || !value.hash || value.currency !== 'AUD' || !money(value.amountExGst) || !money(value.gst) || !money(value.total) || value.total !== Number(value.amountExGst) + Number(value.gst) || typeof value.scope !== 'string' || typeof value.adjustmentReason !== 'string' || !record(value.calendarTarget) || typeof value.calendarTarget.calendarId !== 'string' || !Array.isArray(value.segments) || !value.segments.length || value.segments.some(s => !record(s) || !['all_day','timed'].includes(String(s.kind)) || !validDate(s.startAt) || !validDate(s.endAt) || Date.parse(String(s.startAt)) >= Date.parse(String(s.endAt)) || typeof s.startDate !== 'string' || typeof s.endDate !== 'string')) throw new Error('The company proposal could not be verified. Refresh its saved status.');
  return value as unknown as LiveCompanyProposal;
}
export function parseCompanyState(body: Record<string, unknown>, requestId: string): LiveCompanyBookingState | null {
  const value = body.state;
  if (value === null) return null;
  if (!record(value) || value.requestId !== requestId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !record(value.submission) || value.submission.requestId !== requestId || !Array.isArray(value.proposals) || !record(value.acknowledgment) || value.acknowledgment.version !== COMPANY_BOOKING_ACK_VERSION || value.acknowledgment.text !== COMPANY_BOOKING_ACK_TEXT) throw new Error('The saved company booking did not match this request. Refresh before continuing.');
  const proposal = value.proposal === null ? null : parseCompanyProposal(value.proposal);
  const proposals = value.proposals.map(parseCompanyProposal);
  if (proposal && !proposals.some(p => p.id === proposal.id && p.hash === proposal.hash)) throw new Error('The proposal history does not match the current version.');
  if (value.acceptance !== null && (!record(value.acceptance) || typeof value.acceptance.proposalId !== 'string' || typeof value.acceptance.proposalHash !== 'string' || !validDate(value.acceptance.acceptedAt) || !record(value.acceptance.signature) || typeof value.acceptance.signature.name !== 'string' || value.acceptance.acknowledgmentVersion !== COMPANY_BOOKING_ACK_VERSION)) throw new Error('The company proposal acknowledgment could not be verified.');
  if (value.booking !== null && (!record(value.booking) || !['confirming','confirmed','review_required'].includes(String(value.booking.status)) || typeof value.booking.proposalId !== 'string' || typeof value.booking.proposalHash !== 'string' || !Array.isArray(value.booking.events))) throw new Error('The confirmation status could not be verified.');
  for(const linked of [value.acceptance,value.booking]) if(record(linked)&&!proposals.some(p=>p.id===linked.proposalId&&p.hash===linked.proposalHash)) throw new Error('A saved confirmation points to another company proposal. Refresh its current status.');
  return { ...value, proposal, proposals } as unknown as LiveCompanyBookingState;
}
export function parseCompanyReview(body: Record<string, unknown>, proposal: LiveCompanyProposal): LiveCompanyReview {
  const value = body.review;
  if (!record(value) || typeof value.reviewProof !== 'string' || !value.reviewProof || !validDate(value.expiresAt) || Date.parse(String(value.expiresAt)) <= Date.now() || !record(value.acknowledgment) || value.acknowledgment.version !== COMPANY_BOOKING_ACK_VERSION || value.acknowledgment.text !== COMPANY_BOOKING_ACK_TEXT) throw new Error('The review expired. Refresh the company proposal and review it again.');
  const current = parseCompanyProposal(value.proposal);
  if (current.id !== proposal.id || current.hash !== proposal.hash || current.status !== 'published') throw new Error('The company proposal changed. Refresh before signing.');
  return { ...value, proposal: current } as unknown as LiveCompanyReview;
}
export function parseCompanyCheck(body: Record<string, unknown>): LiveCompanyCalendarCheck {
  const value = body.check;
  if (!record(value) || !validDate(value.checkedAt) || !validDate(value.expiresAt) || typeof value.revision !== 'string' || !Array.isArray(value.conflicts) || value.conflicts.some(c => !record(c) || !Number.isSafeInteger(c.segmentIndex) || !['google','database'].includes(String(c.source)) || !validDate(c.startAt) || !validDate(c.endAt) || typeof c.message !== 'string')) throw new Error('The complete period conflict check could not be verified.');
  return value as unknown as LiveCompanyCalendarCheck;
}
export async function companyBookingRequest(path: string, requestId: string, init: RequestInit = {}) {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', headers: { ...init.headers, 'x-lk-quote-request-id': requestId }, signal: init.signal ?? AbortSignal.timeout(35_000) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new LiveCompanyRequestError(response.status, record(body) && typeof body.error === 'string' ? body.error : 'This booking request could not be completed. Check its saved status and retry.');
  if (!record(body)) throw new Error('The company booking response could not be read. Check its saved status.');
  return body;
}
export function dollarsToCents(value: string): number {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter the final price in Australian dollars with no more than two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000) throw new Error('The final supply price must be greater than zero and no more than A$1,000,000.');
  return cents;
}
export function shiftDay(date: string, days: number) { const value = new Date(`${date}T12:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value.getTime()) || value.toISOString().slice(0,10)!==date) throw new Error('Enter a valid date.'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0,10); }
export const companyMoney = (cents: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
export const companyTime = (value: string) => new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' }).format(new Date(value));
export function companySegmentLabel(segment: LiveCompanyProposal['segments'][number]) { return segment.kind === 'all_day' ? `${segment.startDate} to ${shiftDay(segment.endDate,-1)} inclusive · All day (Sydney)` : `${companyTime(segment.startAt)} → ${companyTime(segment.endAt)} (Sydney)`; }
export function companyPeriodSummary(proposal: LiveCompanyProposal) {
  let days=0, minutes=0;
  for(const period of proposal.segments) if(period.kind==='all_day') days+=(Date.parse(`${period.endDate}T12:00:00Z`)-Date.parse(`${period.startDate}T12:00:00Z`))/86_400_000; else minutes+=(Date.parse(period.endAt)-Date.parse(period.startAt))/60_000;
  return `${days} all-day work dates · ${Number((minutes/60).toFixed(2))} hours in timed periods · ${proposal.segments.length} periods`;
}
export function currentAcceptance(state: LiveCompanyBookingState) { return Boolean(state.proposal && state.acceptance?.proposalId === state.proposal.id && state.acceptance.proposalHash === state.proposal.hash); }
export function companyProcessingRetryable(state: LiveCompanyBookingState) {
  const retryable=(status:string)=>['pending','sending','retrying','outcome_unknown'].includes(status);
  if(state.booking?.status==='review_required')return false;
  if(state.booking)return state.booking.status==='confirming'||retryable(state.booking.emailStatus);
  return Boolean(state.proposal?.status==='published'&&retryable(state.proposal.emailStatus)||currentAcceptance(state)&&state.acceptance&&retryable(state.acceptance.emailStatus));
}
export function newerCompanyState(previous: LiveCompanyBookingState | null, next: LiveCompanyBookingState | null) { return previous && next && previous.requestId === next.requestId && previous.revision > next.revision ? previous : next; }
/** Clean saved inputs follow a newer server revision, including our own publish.
 * Unsaved input and an uncertain command must retain their original revision. */
export function companyDraftAfterRead<T extends {revision:number;dirty:boolean}>(local:T,latest:T,uncertain:boolean):T {
  return local.dirty||uncertain||local.revision>=latest.revision?local:latest;
}
export type CompanyPeriodInput = { key: string; kind: 'all_day' | 'timed'; startDate: string; lastDate: string; startLocal: string; endLocal: string };
export function periodPayload(periods: CompanyPeriodInput[]) {
  if (!periods.length || periods.length > 20) throw new Error('Enter between one and twenty actual work periods.');
  return periods.map(p => {
    if (p.kind === 'all_day') { if (!p.startDate || !p.lastDate || p.lastDate < p.startDate) throw new Error('Every all-day period needs a start date and a last work day on or after that date.'); return {kind: p.kind, startDate: p.startDate, endDate: shiftDay(p.lastDate,1)}; }
    if (!p.startLocal || !p.endLocal || p.endLocal <= p.startLocal) throw new Error('Every timed period needs a start and a later end, in Sydney local time.');
    return {kind:p.kind,startLocal:p.startLocal,endLocal:p.endLocal};
  });
}
