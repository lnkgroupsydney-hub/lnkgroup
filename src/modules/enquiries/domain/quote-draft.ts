import { isValidAustralianPhone, isValidAustralianPostcode, isValidEmail, isValidInteger, isValidText } from '../../../shared/validation/input.ts';

export type ContactDetails = { name: string; email: string; phone: string; siteAddress: string; suburb: string; postcode: string; details: string; consent: true };
export type ServiceDetails = { serviceId: 'cabinet-painting'; intent: string; surfaces: string[]; doorCount: number | null; drawerCount: number | null; material: string; colourPreference: string };
export type QuoteDraftInput = { contact: ContactDetails; service: ServiceDetails | null };
export type QuoteDraft = { id: string; revision: number; payload: QuoteDraftInput; savedAt: string };
export const QUOTE_PROGRESS = ['Your details', 'Service details', 'Photos', 'Assessment & price', 'Approve', 'Start date', 'Review & sign', 'Submit'] as const;
export const PROJECT_INTENTS = ['full-repainting', 'partial-touch-ups', 'colour-change', 'advice'] as const;
export const TARGET_SURFACES = ['doors', 'drawers', 'frames', 'panels', 'repairs', 'unknown'] as const;
export class DraftValidationError extends Error {}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DraftValidationError('Please check your details.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = true, stored = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim())) throw new DraftValidationError(`Check ${label}.`);
  if (!stored && !isValidText(value, { maxLength: max, required, multiline: label === 'project details', requireLetter: ['name', 'site address', 'suburb'].includes(label) })) throw new DraftValidationError(`Check ${label}.`);
  return value.trim();
}
function count(value: unknown): number | null {
  if (value === null) return null;
  if (!isValidInteger(value, 0, 500)) throw new DraftValidationError('Counts must be whole numbers from 0 to 500.');
  return value as number;
}
export function validateQuoteDraft(value: unknown): QuoteDraftInput {
  return quoteDraft(value, false);
}
/** Stored snapshots retain the prior contract; stricter checks apply to new writes. */
export function parseQuoteDraft(value: unknown): QuoteDraftInput {
  return quoteDraft(value, true);
}
function quoteDraft(value: unknown, stored: boolean): QuoteDraftInput {
  const input = record(value), c = record(input.contact);
  const field = (value: unknown, label: string, max: number, required = true) => text(value, label, max, required, stored);
  const email = field(c.email, 'email address', 254).toLowerCase();
  if (stored ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) : !isValidEmail(email)) throw new DraftValidationError('Enter a valid email address.');
  const postcode = field(c.postcode, 'postcode', 4);
  if (!isValidAustralianPostcode(postcode)) throw new DraftValidationError('Enter a four-digit postcode.');
  const phone = field(c.phone, 'phone', 40, false);
  if (!stored && !isValidAustralianPhone(phone)) throw new DraftValidationError('Enter a valid Australian phone number.');
  if (c.consent !== true) throw new DraftValidationError('Confirm permission to save your details.');
  const contact: ContactDetails = { name:field(c.name,'name',120), email, phone, siteAddress:field(c.siteAddress,'site address',240), suburb:field(c.suburb,'suburb',100), postcode, details:field(c.details,'project details',3000,false), consent:true };
  let service: ServiceDetails | null = null;
  if (input.service !== null) {
    const s = record(input.service);
    if (s.serviceId !== 'cabinet-painting' || !PROJECT_INTENTS.includes(s.intent as typeof PROJECT_INTENTS[number])) throw new DraftValidationError('Choose a cabinet painting service.');
    if (!Array.isArray(s.surfaces) || !s.surfaces.length || s.surfaces.length > TARGET_SURFACES.length || s.surfaces.some(item => !TARGET_SURFACES.includes(item))) throw new DraftValidationError('Choose the cabinet surfaces.');
    const surfaces = [...new Set(s.surfaces as string[])];
    if (surfaces.includes('unknown') && surfaces.length > 1) throw new DraftValidationError('Choose known surfaces or Not sure yet.');
    service = {serviceId:'cabinet-painting', intent:s.intent as string, surfaces, doorCount:count(s.doorCount), drawerCount:count(s.drawerCount), material:field(s.material,'material',100,false), colourPreference:field(s.colourPreference,'colour preference',100,false)};
  }
  return {contact,service};
}
