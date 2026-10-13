import { parseQuoteDraft } from '../../enquiries/domain.ts';
import type { LiveQuoteRequest } from '../index.ts';

export class LiveRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function parseLiveRequest(value: unknown): LiveQuoteRequest {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-f0-9-]{36}$/.test(value.id)
    || typeof value.reference !== 'string' || !/^RQ-[A-F0-9]{32}$/.test(value.reference)
    || value.mode !== 'live' || value.companyId !== 'lk-group'
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !['draft', 'review_requested'].includes(String(value.status))
    || typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt))
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || value.consentVersion !== 'quote-storage-review-v1'
    || (value.customerId !== null && typeof value.customerId !== 'string')
    || (value.status === 'draft' ? value.reviewRequestedAt !== null : typeof value.reviewRequestedAt !== 'string' || !Number.isFinite(Date.parse(value.reviewRequestedAt)))) {
    throw new Error('The server did not confirm your saved request. Keep your entries and retry.');
  }
  return { ...value, payload: parseQuoteDraft(value.payload) } as LiveQuoteRequest;
}
export async function liveRequest(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(25_000) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new LiveRequestError(response.status, isRecord(body) && typeof body.error === 'string' ? body.error : 'The request could not be completed. Please retry.');
  if (!isRecord(body)) throw new Error('An invalid response was received. Please retry.');
  return body;
}
export function displayTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' }).format(new Date(value));
}
export const intentLabels: Record<string, string> = { 'full-repainting': 'Full cabinet repainting', 'partial-touch-ups': 'Partial painting or touch-ups', 'colour-change': 'Colour change', advice: 'I need advice' };
export const surfaceLabels: Record<string, string> = { doors: 'Cabinet doors', drawers: 'Drawer fronts', frames: 'Exposed frames', panels: 'End panels', repairs: 'Areas needing repair', unknown: 'Not sure yet' };

/** The cookie is shared by tabs. Serialize its first creation before any reads. */
export async function withWritingSessionLock<T>(locks: Pick<LockManager, 'request'> | undefined, operation: () => Promise<T>): Promise<T> {
  if (!locks) throw new Error('This browser cannot open a safe writing session. Use a current browser over HTTPS, or localhost for local testing.');
  return locks.request('lk-live-quote-session', { mode: 'exclusive' }, operation);
}
