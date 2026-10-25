import { isValidAustralianPhone, isValidAustralianPostcode, isValidEmail, isValidInteger, isValidText } from '../../../shared/validation/input.ts';

export type ContactDetails = { name: string; email: string; phone: string; siteAddress: string; suburb: string; postcode: string; details: string; consent: true };
export type ServiceDetails = { serviceId: 'cabinet-painting'; intent: string; surfaces: string[]; doorCount: number | null; drawerCount: number | null; material: string; colourPreference: string };
export type QuoteDraftInput = { contact: ContactDetails; service: ServiceDetails | null };
export type QuoteDraft = { id: string; revision: number; payload: QuoteDraftInput; savedAt: string };
export const QUOTE_PROGRESS = ['Your details', 'Service details', 'Photos', 'Assessment & price', 'Approve', 'Start date', 'Review & sign', 'Submit'] as const;
export const PROJECT_INTENTS = ['full-repainting', 'partial-touch-ups', 'colour-change', 'advice'] as const;
export const TARGET_SURFACES = ['doors', 'drawers', 'frames', 'panels', 'repairs', 'unknown'] as const;
export class DraftValidationError extends Error { readonly field?: string; constructor(message: string, field?: string) { super(message); this.field = field } }
export type QuoteDraftIssue = { field: string; code: 'validation'; message: string }
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
/** Staff work copies may retain normalized source fields; source must come from trusted storage. */
export function validateQuoteDraftAgainstSource(value: unknown, source: unknown): QuoteDraftInput {
  return quoteDraft(value, false, parseQuoteDraft(source));
}
export function quoteDraftIssues(value: unknown): QuoteDraftIssue[] {
  const issues: QuoteDraftIssue[] = [];
  quoteDraft(value, false, undefined, issues);
  return issues;
}
function quoteDraft(value: unknown, stored: boolean, source?: QuoteDraftInput, issues?: QuoteDraftIssue[]): QuoteDraftInput {
  const input = record(value), c = record(input.contact);
  const check = <T>(path: string, fn: () => T): T => {
    try { return fn(); } catch (error) {
      if (!(error instanceof DraftValidationError)) throw error;
      const field = `payload.${path}`;
      if (!issues) throw new DraftValidationError(error.message, field);
      issues.push({ field, code: 'validation', message: error.message });
      return undefined as T;
    }
  };
  const unchanged = (group: 'contact' | 'service', key: string, value: unknown) => {
    const prior = source?.[group] as Record<string, unknown> | null | undefined;
    const normalized = typeof value === 'string' ? (key === 'email' ? value.trim().toLowerCase() : value.trim()) : value;
    return !!prior && JSON.stringify(normalized) === JSON.stringify(prior[key]);
  };
  const field = (group: 'contact' | 'service', key: string, value: unknown, label: string, max: number, required = true) =>
    check(`${group}.${key}`, () => text(value, label, max, required, stored || unchanged(group, key, value)));
  const email = check('contact.email', () => {
    const value = text(c.email, 'email address', 254, true, stored || unchanged('contact', 'email', c.email)).toLowerCase();
    if (stored || unchanged('contact', 'email', c.email) ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) : !isValidEmail(value)) throw new DraftValidationError('Enter a valid email address.');
    return value;
  });
  const postcode = check('contact.postcode', () => {
    const value = text(c.postcode, 'postcode', 4, true, stored || unchanged('contact', 'postcode', c.postcode));
    if (!isValidAustralianPostcode(value)) throw new DraftValidationError('Enter a four-digit postcode.');
    return value;
  });
  const phone = check('contact.phone', () => {
    const legacy = stored || unchanged('contact', 'phone', c.phone), value = text(c.phone, 'phone', 40, false, legacy);
    if (!legacy && !isValidAustralianPhone(value)) throw new DraftValidationError('Enter a valid Australian phone number.');
    return value;
  });
  check('contact.consent', () => { if (c.consent !== true) throw new DraftValidationError('Confirm permission to save your details.'); });
  const contact: ContactDetails = { name:field('contact','name',c.name,'name',120), email, phone, siteAddress:field('contact','siteAddress',c.siteAddress,'site address',240), suburb:field('contact','suburb',c.suburb,'suburb',100), postcode, details:field('contact','details',c.details,'project details',3000,false), consent:true };
  let service: ServiceDetails | null = null;
  if (input.service !== null) {
    const s = record(input.service);
    check('service.serviceId', () => { if (s.serviceId !== 'cabinet-painting') throw new DraftValidationError('Choose a cabinet painting service.'); });
    check('service.intent', () => { if (!PROJECT_INTENTS.includes(s.intent as typeof PROJECT_INTENTS[number])) throw new DraftValidationError('Choose a cabinet painting service.'); });
    const surfaces = check('service.surfaces', () => {
      if (!Array.isArray(s.surfaces) || !s.surfaces.length || s.surfaces.length > TARGET_SURFACES.length || s.surfaces.some(item => !TARGET_SURFACES.includes(item))) throw new DraftValidationError('Choose the cabinet surfaces.');
      const value = [...new Set(s.surfaces as string[])];
      if (value.includes('unknown') && value.length > 1) throw new DraftValidationError('Choose known surfaces or Not sure yet.');
      return value;
    });
    service = {serviceId:'cabinet-painting', intent:s.intent as string, surfaces, doorCount:check('service.doorCount',()=>count(s.doorCount)), drawerCount:check('service.drawerCount',()=>count(s.drawerCount)), material:field('service','material',s.material,'material',100,false), colourPreference:field('service','colourPreference',s.colourPreference,'colour preference',100,false)};
  }
  return {contact,service};
}
