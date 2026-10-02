export type ContactDetails = { name: string; email: string; phone: string; siteAddress: string; suburb: string; postcode: string; details: string; consent: true };
export type ServiceDetails = { serviceId: 'cabinet-painting'; intent: string; surfaces: string[]; doorCount: number | null; drawerCount: number | null; material: string; colourPreference: string };
export type QuoteDraftInput = { contact: ContactDetails; service: ServiceDetails | null };
export type QuoteDraft = { id: string; revision: number; payload: QuoteDraftInput; savedAt: string };
export const QUOTE_PROGRESS = ['Your details', 'Service & photos', 'Assessment & price', 'Approve', 'Start date', 'Review & sign', 'Submit'] as const;
export const PROJECT_INTENTS = ['full-repainting', 'partial-touch-ups', 'colour-change', 'advice'] as const;
export const TARGET_SURFACES = ['doors', 'drawers', 'frames', 'panels', 'repairs', 'unknown'] as const;
export class DraftValidationError extends Error {}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DraftValidationError('Please check your details.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (required && !value.trim())) throw new DraftValidationError(`Check ${label}.`);
  return value.trim();
}
function count(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 500) throw new DraftValidationError('Counts must be whole numbers from 0 to 500.');
  return value as number;
}
export function validateQuoteDraft(value: unknown): QuoteDraftInput {
  const input = record(value), c = record(input.contact);
  const email = text(c.email, 'email address', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DraftValidationError('Enter a valid email address.');
  const postcode = text(c.postcode, 'postcode', 4);
  if (!/^\d{4}$/.test(postcode)) throw new DraftValidationError('Enter a four-digit postcode.');
  if (c.consent !== true) throw new DraftValidationError('Confirm permission to save your details.');
  const contact: ContactDetails = { name:text(c.name,'name',120), email, phone:text(c.phone,'phone',40,false), siteAddress:text(c.siteAddress,'site address',240), suburb:text(c.suburb,'suburb',100), postcode, details:text(c.details,'project details',3000,false), consent:true };
  let service: ServiceDetails | null = null;
  if (input.service !== null) {
    const s = record(input.service);
    if (s.serviceId !== 'cabinet-painting' || !PROJECT_INTENTS.includes(s.intent as typeof PROJECT_INTENTS[number])) throw new DraftValidationError('Choose a cabinet painting service.');
    if (!Array.isArray(s.surfaces) || !s.surfaces.length || s.surfaces.length > TARGET_SURFACES.length || s.surfaces.some(item => !TARGET_SURFACES.includes(item))) throw new DraftValidationError('Choose the cabinet surfaces.');
    const surfaces = [...new Set(s.surfaces as string[])];
    if (surfaces.includes('unknown') && surfaces.length > 1) throw new DraftValidationError('Choose known surfaces or Not sure yet.');
    service = {serviceId:'cabinet-painting', intent:s.intent as string, surfaces, doorCount:count(s.doorCount), drawerCount:count(s.drawerCount), material:text(s.material,'material',100,false), colourPreference:text(s.colourPreference,'colour preference',100,false)};
  }
  return {contact,service};
}
