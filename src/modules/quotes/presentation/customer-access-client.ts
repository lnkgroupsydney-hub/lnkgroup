import { isRecord, liveRequest, parseLiveRequest, withWritingSessionLock } from './request-client.ts';

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
