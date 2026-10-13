import { isRecord, liveRequest, parseLiveRequest, withWritingSessionLock, LiveRequestError } from './request-client.ts';
import { isValidAustralianPhone, isValidEmail, isValidText } from '../../../shared/validation/input.ts';
import { validateQuoteDraft, type QuoteDraftInput } from '../../enquiries/domain.ts';
import type { LiveQuoteRequest } from '../domain/contracts.ts';

export interface CustomerQuoteSummary {
  id: string; reference: string; status: 'draft' | 'review_requested'; savedAt: string; revision: number;
}
export interface CustomerAccessState {
  customer: { email: string; expiresAt: string } | null;
  requests: CustomerQuoteSummary[];
  currentRequestId: string | null;
}
export interface CustomerCodeChallenge { sent: true; retryAfterSeconds: number; expiresInSeconds: number }
const uuid = /^[a-f0-9-]{36}$/i;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function parseCustomerAccess(value: unknown): CustomerAccessState {
  if (!isRecord(value) || !Array.isArray(value.requests) || (value.currentRequestId !== null && (typeof value.currentRequestId !== 'string' || !uuid.test(value.currentRequestId)))) throw new Error('Your email access could not be confirmed. Please retry.');
  if (value.customer !== null && (!isRecord(value.customer) || typeof value.customer.email !== 'string' || !value.customer.email.includes('@') || !timestamp(value.customer.expiresAt))) throw new Error('Your email access could not be confirmed. Please retry.');
  const requests = value.requests.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !uuid.test(item.id) || typeof item.reference !== 'string' || !/^RQ-[A-F0-9]{32}$/.test(item.reference) || !['draft', 'review_requested'].includes(String(item.status)) || !timestamp(item.savedAt) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 1) throw new Error('Your saved quote list could not be confirmed. Please retry.');
    return { id: item.id, reference: item.reference, status: item.status, savedAt: item.savedAt, revision: item.revision } as CustomerQuoteSummary;
  });
  if (new Set(requests.map(item => item.id)).size !== requests.length || (value.customer === null && (requests.length || value.currentRequestId !== null)) || (value.currentRequestId !== null && !requests.some(item => item.id === value.currentRequestId))) throw new Error('Your saved quote access could not be confirmed. Please retry.');
  return { customer: value.customer as CustomerAccessState['customer'], requests, currentRequestId: value.currentRequestId as string | null };
}
export function parseCustomerChallenge(value: unknown): CustomerCodeChallenge {
  if (!isRecord(value) || value.sent !== true || !Number.isSafeInteger(value.retryAfterSeconds) || Number(value.retryAfterSeconds) < 0 || Number(value.retryAfterSeconds) > 900 || !Number.isSafeInteger(value.expiresInSeconds) || Number(value.expiresInSeconds) < 1 || Number(value.expiresInSeconds) > 3600) throw new Error('The verification email could not be confirmed. Please retry.');
  return { sent: true, retryAfterSeconds: Number(value.retryAfterSeconds), expiresInSeconds: Number(value.expiresInSeconds) };
}
export const EMPTY_CUSTOMER_ACCESS: CustomerAccessState = { customer: null, requests: [], currentRequestId: null };
export const CUSTOMER_ACCESS_CHANNEL = 'lk-live-quote-access';
export const CUSTOMER_ACCESS_CHANGED = 'access-changed';
export const CUSTOMER_NEW_QUOTE_STARTED = 'new-quote-started';
export type QuoteContactPrefill = { name: string; email: string; phone: string };
export type BrowserDraftSummary = { id: string; reference: string };
export class QuoteEntryTransitionError extends LiveRequestError {
  readonly browserDraft: BrowserDraftSummary | null;
  constructor(status: number, message: string, browserDraft: BrowserDraftSummary | null = null) { super(status, message); this.browserDraft = browserDraft; }
}
export function parseQuoteContactPrefill(value: unknown): QuoteContactPrefill | null {
  if (!isRecord(value) || !isValidText(value.name, { maxLength: 120, requireLetter: true }) || !isValidEmail(value.email) || typeof value.phone !== 'string' || value.phone.length > 40 || !isValidAustralianPhone(value.phone)) return null;
  return { name: value.name, email: value.email, phone: value.phone };
}
type PendingSave = { path: string; method: string; body: string };
function firstSavePayload(attempt: PendingSave | null): QuoteDraftInput | null {
  if (!attempt || attempt.path !== '/api/quote/requests' || attempt.method !== 'PUT') return null;
  try {
    const body: unknown = JSON.parse(attempt.body);
    if (!isRecord(body) || body.expectedRevision !== 0 || body.storageConsent !== true || typeof body.idempotencyKey !== 'string' || !uuid.test(body.idempotencyKey)) return null;
    const payload = validateQuoteDraft(body.payload);
    return payload.service === null ? payload : null;
  } catch { return null; }
}
export function isPendingFirstSave(attempt: PendingSave | null) { return firstSavePayload(attempt) !== null; }
/** Associate only an unchanged first revision; preserve its original replay body/key. */
export function pendingFirstSaveMatches(attempt: PendingSave | null, request: LiveQuoteRequest) {
  const payload = firstSavePayload(attempt);
  if (!payload || request.revision !== 1 || request.status !== 'draft') return false;
  try { return JSON.stringify(payload) === JSON.stringify(validateQuoteDraft(request.payload)); }
  catch { return false; }
}
async function entryLogout(body: Record<string, unknown>) {
  const response = await fetch('/api/quote/requests/customer/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
  const result: unknown = await response.json();
  if (!response.ok) {
    const draft = isRecord(result) && result.code === 'unlinked_browser_draft' && isRecord(result.browserDraft) && typeof result.browserDraft.id === 'string' && uuid.test(result.browserDraft.id) && typeof result.browserDraft.reference === 'string' && /^RQ-[A-F0-9]{32}$/.test(result.browserDraft.reference) ? { id: result.browserDraft.id, reference: result.browserDraft.reference } : null;
    throw new QuoteEntryTransitionError(response.status, isRecord(result) && typeof result.error === 'string' ? result.error : 'The quote session could not be changed. Your entries are still here.', draft);
  }
  if (!isRecord(result) || result.signedOut !== true || typeof result.writingSessionPreserved !== 'boolean') throw new Error('The quote session change could not be confirmed. Your entries are still here.');
  return result;
}
/** One lock covers every cookie transition and the final empty-session check. */
export async function startNewQuote() {
  return withWritingSessionLock(navigator.locks, async () => {
    const result = await entryLogout({ intent: 'start-new' });
    const session = await liveRequest('/api/quote/requests/session', { method: 'POST' });
    if (session.ready !== true) throw new Error('The new quote session could not be confirmed. Your entries are still here.');
    await requireEmptyQuoteSession();
    return parseQuoteContactPrefill(result.contact);
  });
}
async function requireEmptyQuoteSession() {
  const current = await liveRequest('/api/quote/requests');
  if (current.request !== null) {
    const request = parseLiveRequest(current.request);
    throw new QuoteEntryTransitionError(409, 'A saved quote is still active. Your current entries are unchanged. Open your saved quotes or continue this browser’s draft.', { id: request.id, reference: request.reference });
  }
}
/** Reconcile an uncertain transition without issuing another logout. */
export async function checkNewQuoteSession() {
  return withWritingSessionLock(navigator.locks, async () => {
    const session = await liveRequest('/api/quote/requests/session', { method: 'POST' });
    if (session.ready !== true) throw new Error('The quote session could not be confirmed. Your entries are still here.');
    await requireEmptyQuoteSession();
  });
}
export async function resumeBrowserDraft(expectedRequestId: string) {
  if (!uuid.test(expectedRequestId)) throw new Error('This browser’s draft could not be identified.');
  return withWritingSessionLock(navigator.locks, async () => {
    const result = await entryLogout({ intent: 'resume-browser-draft', expectedRequestId });
    if (result.writingSessionPreserved !== true || result.requestId !== expectedRequestId) throw new Error('Access to this browser’s draft could not be confirmed. Your entries are still here.');
    return readCurrentCustomerRequest(expectedRequestId);
  });
}
/** Do not rotate away the only guest cookie for an unlinked saved quote. */
export function canStartAnotherQuote(request: { id: string; email: string } | null, access: CustomerAccessState, hasUnsavedChanges: boolean) {
  return Boolean(request && !hasUnsavedChanges && access.customer && access.customer.email.toLowerCase() === request.email.toLowerCase() && access.currentRequestId === request.id && access.requests.some(item => item.id === request.id));
}
/** Recovery clears expired customer access only; the existing writing cookie must survive. */
export function canRecoverExpiredCustomerAccess(request: { id: string } | null, access: CustomerAccessState, hasUnsavedChanges: boolean, accessExpired: boolean) {
  return accessExpired && !request && !hasUnsavedChanges && !access.customer && !access.currentRequestId && access.requests.length === 0;
}
export function consumeQuoteHandoff(location: Pick<Location, 'hash' | 'pathname' | 'search'>, replace: (url: string) => void): string | null {
  if (!location.hash.startsWith('#restore=')) return null;
  const value = location.hash.slice('#restore='.length);
  replace(`${location.pathname}${location.search}`);
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('This quote recovery link is invalid. Reopen your original saved quote to request a new link.');
  return value;
}
export async function customerMutation(path: string, body: unknown) {
  return withWritingSessionLock(navigator.locks, () => liveRequest(`/api/quote/requests/customer/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}
export async function readCustomerAccess() { return parseCustomerAccess(await liveRequest('/api/quote/requests/customer')); }
export async function readCurrentCustomerRequest(expectedId: string) {
  const result = await liveRequest('/api/quote/requests', { headers: { 'x-lk-quote-request-id': expectedId } });
  const request = parseLiveRequest(result.request);
  if (request.id !== expectedId) throw new Error('The active quote changed in another tab. Reload your saved quotes before continuing.');
  return request;
}
/** A newer action, session change or unmount invalidates earlier responses. */
export class CustomerAccessLifetime {
  private version = 0;
  private open = true;
  begin() { return ++this.version; }
  accepts(version: number) { return this.open && version === this.version; }
  isOpen() { return this.open; }
  invalidate() { this.version++; }
  close() { this.open = false; this.invalidate(); }
  reopen() { this.open = true; }
}
