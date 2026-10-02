import type { QuoteDraftInput } from './quote-draft.ts';

export const DEMO_VERSION = 'kcp-demo-v1';
export const DEMO_PRICE = { currency: 'AUD', totalCents: 125000, label: 'Demonstration amount only — not a real quote or invoice.' } as const;
export const DEMO_TERMS = [
  'This is a demonstration of the request, signature, email and calendar workflow. It is not a binding quote or contract.',
  'The displayed price and terms are sample data only. No payment is due and no work is authorised.',
  'The selected date is a preferred start date. L&K must review the actual scope, price, terms, duration and conflicts before confirming any booking.',
  'Your signature acknowledges this demonstration summary only. Actual commercial terms will require a separate review and acceptance.',
] as const;

export type SignaturePoint = { x: number; y: number };
export type DemoSignature = { name: string; strokes: SignaturePoint[][]; acknowledged: true };
export interface DemoSnapshot {
  mode: 'demo'; version: typeof DEMO_VERSION; draftId: string; draftRevision: number;
  payload: QuoteDraftInput; preferredDate: string;
  price: typeof DEMO_PRICE; terms: readonly string[];
}
export interface DemoSubmissionStatus {
  id: string; reference: string; submittedAt: string; preferredDate: string;
  emailStatus: 'pending' | 'sending' | 'provider_accepted' | 'retrying' | 'failed' | 'outcome_unknown';
  calendarStatus: 'blocked' | 'pending' | 'synced' | 'retrying' | 'conflict';
  error: string | null;
}
