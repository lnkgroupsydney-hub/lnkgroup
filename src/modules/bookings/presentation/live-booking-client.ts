import { COMPANY_REVISION_ACK, calculateCompanyRevisionPricing, type CompanyRevisionPayload } from '../../quotes/domain/company-revision.ts';
import { BOOKING_SIMPLE_ACK_VERSION, isBookingAcknowledgment, parseBookingSignature } from '../../quotes/domain/booking-flow.ts';
import { COMPANY_BOOKING_SITE_DAMAGE_NOTE, COMPANY_BOOKING_ACK_TEXT, COMPANY_BOOKING_ACK_VERSION, type LiveCompanyBookingState, type LiveCompanyCalendarCheck, type LiveCompanyProposal, type LiveCompanyReview } from '../domain/live-contracts.ts';

export class LiveCompanyRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) { super(message); this.status=status; this.code=code; }
}
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validDate(value: unknown) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function money(value: unknown) { return Number.isSafeInteger(value) && Number(value) >= 0; }
export function parseCompanyProposal(value: unknown): LiveCompanyProposal {
  if (!record(value) || typeof value.id !== 'string' || !Number.isSafeInteger(value.version) || Number(value.version) < 1 || !Number.isSafeInteger(value.revision) || !['draft','published'].includes(String(value.status)) || typeof value.hash !== 'string' || !value.hash || value.currency !== 'AUD' || !money(value.amountExGst) || !money(value.gst) || !money(value.total) || value.total !== Number(value.amountExGst) + Number(value.gst) || typeof value.scope !== 'string' || typeof value.adjustmentReason !== 'string' || !record(value.calendarTarget) || typeof value.calendarTarget.calendarId !== 'string' || !Array.isArray(value.segments) || !value.segments.length || value.segments.some(s => !record(s) || !['all_day','timed'].includes(String(s.kind)) || !validDate(s.startAt) || !validDate(s.endAt) || Date.parse(String(s.startAt)) >= Date.parse(String(s.endAt)) || typeof s.startDate !== 'string' || typeof s.endDate !== 'string')) throw new Error('The company proposal could not be verified. Refresh its saved status.');
  if (value.confirmationBasis != null && !['customer_proposal','signed_request','accepted_revision'].includes(String(value.confirmationBasis)) || value.companyNote != null && typeof value.companyNote !== 'string') throw new Error('The booking confirmation basis could not be verified.');
  if (['signed_request','accepted_revision'].includes(String(value.confirmationBasis)) && (value.segments.length !== 2 || value.segments.some((segment, index) => !record(segment) || segment.kind !== 'timed' || segment.purpose !== (index === 0 ? 'take_off' : 'install')))) throw new Error('The take-off and installation visits could not be verified.');
  if (value.confirmationBasis === 'accepted_revision') { revisionEvidence(value); const payload = {contact:value.contact,quantities:value.quantities,extraItems:value.extraItems,customerNote:value.customerNote} as CompanyRevisionPayload; const pricing=calculateCompanyRevisionPricing(payload); if(value.gst!==0||pricing.total!==value.total||!record(value.pricing)||value.pricing.total!==pricing.total||value.pricing.tax!==0||!record(value.companyRevisionAcknowledgment)||value.companyRevisionAcknowledgment.version!==COMPANY_REVISION_ACK.version||value.companyRevisionAcknowledgment.text!==COMPANY_REVISION_ACK.text)throw new Error('The accepted revision amount could not be verified.');parseBookingSignature(value.companyRevisionSignature); }
  return { ...value, confirmationBasis: value.confirmationBasis ?? undefined, companyNote: value.companyNote ?? undefined } as unknown as LiveCompanyProposal;
}
function revisionEvidence(value: Record<string,unknown>) { for(const k of ['companyRevisionId','companyRevisionAcceptanceId'])if(typeof value[k]!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(String(value[k])))throw new Error('The accepted revision identity is invalid.');for(const k of ['companyRevisionSnapshotHash','companyRevisionSignedContentHash'])if(typeof value[k]!=='string'||!/^[a-f0-9]{64}$/.test(String(value[k])))throw new Error('The accepted revision evidence is invalid.'); }
export function parseCompanyState(body: Record<string, unknown>, requestId: string): LiveCompanyBookingState | null {
  const value = body.state;
  if (value === null) return null;
  if (!record(value) || value.requestId !== requestId || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !record(value.submission) || value.submission.requestId !== requestId || !Array.isArray(value.proposals) || !record(value.acknowledgment) || value.acknowledgment.version !== COMPANY_BOOKING_ACK_VERSION || value.acknowledgment.text !== COMPANY_BOOKING_ACK_TEXT) throw new Error('The saved company booking did not match this request. Refresh before continuing.');
  if (record(value.submission.snapshot) && value.submission.snapshot.version === BOOKING_SIMPLE_ACK_VERSION) {
    const submission = value.submission, snapshot = submission.snapshot;
    if (!record(snapshot) || !record(snapshot.acknowledgment) || !isBookingAcknowledgment(snapshot.acknowledgment.version, snapshot.acknowledgment.text) || snapshot.acknowledgment.version !== BOOKING_SIMPLE_ACK_VERSION || !validLocalMinute(`${submission.preferredDate}T${submission.preferredTime}`) || snapshot.preferredDate !== submission.preferredDate || snapshot.preferredTime !== submission.preferredTime || !record(snapshot.pricing) || !money(snapshot.pricing.total) || Number(snapshot.pricing.total) <= 0) throw new Error('The signed estimate and selected take-off time could not be verified.');
  }
  const proposal = value.proposal === null ? null : parseCompanyProposal(value.proposal);
  const proposals = value.proposals.map(parseCompanyProposal);
  if (record(value.submission.snapshot) && value.submission.snapshot.version === BOOKING_SIMPLE_ACK_VERSION && proposals.some(item => !['signed_request','accepted_revision'].includes(String(item.confirmationBasis)))) throw new Error('The signed booking request was mixed with an earlier proposal workflow.');
  if (proposal && !proposals.some(p => p.id === proposal.id && p.hash === proposal.hash)) throw new Error('The proposal history does not match the current version.');
  if (value.acceptance !== null && (!record(value.acceptance) || typeof value.acceptance.proposalId !== 'string' || typeof value.acceptance.proposalHash !== 'string' || !validDate(value.acceptance.acceptedAt) || !record(value.acceptance.signature) || typeof value.acceptance.signature.name !== 'string' || value.acceptance.acknowledgmentVersion !== COMPANY_BOOKING_ACK_VERSION)) throw new Error('The company proposal acknowledgment could not be verified.');
  if (value.booking !== null && (!record(value.booking) || !['confirming','confirmed','review_required','cancel_pending','cancelled'].includes(String(value.booking.status)) || typeof value.booking.proposalId !== 'string' || typeof value.booking.proposalHash !== 'string' || !Array.isArray(value.booking.events))) throw new Error('The confirmation status could not be verified.');
  if (record(value.booking) && value.booking.confirmationBasis != null && !['signed_request','customer_proposal','accepted_revision'].includes(String(value.booking.confirmationBasis))) throw new Error('The saved booking confirmation basis is invalid.');
  for(const linked of [value.acceptance,value.booking]) if(record(linked)&&!proposals.some(p=>p.id===linked.proposalId&&p.hash===linked.proposalHash)) throw new Error('A saved confirmation points to another company proposal. Refresh its current status.');
  if (proposal?.confirmationBasis === 'signed_request') {
    const submission = value.submission;
    if (!record(submission.snapshot) || submission.snapshot.version !== BOOKING_SIMPLE_ACK_VERSION || proposal.total !== (record(submission.snapshot.pricing) ? submission.snapshot.pricing.total : null) || proposal.segments[0].startLocal !== `${submission.preferredDate}T${submission.preferredTime}` || value.acceptance !== null || record(value.booking) && (value.booking.confirmationBasis !== 'signed_request' || value.booking.signedSubmissionId !== submission.id)) throw new Error('The confirmation did not match the original signed estimate and take-off visit.');
  }
  if(proposal?.confirmationBasis==='accepted_revision'){ const submission=value.submission;if(!record(submission.snapshot)||submission.snapshot.version!==BOOKING_SIMPLE_ACK_VERSION||proposal.segments[0].startLocal!==`${submission.preferredDate}T${submission.preferredTime}`||value.acceptance!==null)throw new Error('The accepted revision did not match the signed take-off request.');if(record(value.booking)){const booking=value.booking;revisionEvidence(booking);if(booking.confirmationBasis!=='accepted_revision'||booking.signedSubmissionId!==submission.id||['companyRevisionId','companyRevisionAcceptanceId','companyRevisionSnapshotHash','companyRevisionSignedContentHash'].some(k=>booking[k]!==proposal[k as keyof LiveCompanyProposal]))throw new Error('The confirmed booking did not match the accepted company revision.');}}
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
  if (!response.ok) throw new LiveCompanyRequestError(response.status, record(body) && typeof body.error === 'string' ? body.error : 'This booking request could not be completed. Check its saved status and retry.', record(body) && typeof body.code === 'string' ? body.code : undefined);
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
  if(state.booking&&['review_required','cancel_pending','cancelled'].includes(state.booking.status))return false;
  if(state.booking)return state.booking.status==='confirming'||retryable(state.booking.emailStatus);
  return Boolean(!['signed_request','accepted_revision'].includes(String(state.proposal?.confirmationBasis))&&state.proposal?.status==='published'&&retryable(state.proposal.emailStatus)||currentAcceptance(state)&&state.acceptance&&retryable(state.acceptance.emailStatus));
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

export type SignedRequestScheduleInput = { takeOffEndLocal: string; installStartLocal: string; installEndLocal: string; companyNote: string };
function validLocalMinute(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  const date = new Date(`${value}:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === value;
}
export function signedRequestConfirmationPayload(state: LiveCompanyBookingState, input: SignedRequestScheduleInput, idempotencyKey: string) {
  const submission = state.submission, start = `${submission.preferredDate}T${submission.preferredTime}`;
  if (submission.snapshot.version !== BOOKING_SIMPLE_ACK_VERSION || !validLocalMinute(start) || state.booking) throw new Error('A current signed take-off date and time is required before booking confirmation.');
  if (!validLocalMinute(input.takeOffEndLocal) || input.takeOffEndLocal <= start) throw new Error('Enter the take-off end after the customer’s selected start, in Sydney time.');
  if (!validLocalMinute(input.installStartLocal) || !validLocalMinute(input.installEndLocal) || input.installStartLocal < input.takeOffEndLocal || input.installEndLocal <= input.installStartLocal) throw new Error('Enter an installation visit after take-off, with a later end time, in Sydney time.');
  if (input.companyNote.length > 3000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.companyNote)) throw new Error('Keep the additional company guidance within 3,000 characters.');
  return { expectedRevision: state.revision, idempotencyKey, ...input, companyNote: input.companyNote.trim() || COMPANY_BOOKING_SITE_DAMAGE_NOTE };
}

export function usesSignedRequestBooking(state: LiveCompanyBookingState) { return state.submission.snapshot.version === BOOKING_SIMPLE_ACK_VERSION; }
