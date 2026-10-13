/** Framework-free checks only. Callers retain their existing stored formatting. */
export interface TextValidationOptions {
  maxLength: number;
  required?: boolean;
  multiline?: boolean;
  requireLetter?: boolean;
}

const singleLineControl = /[\u0000-\u001f\u007f]/;
const multilineControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const htmlTag = /<(?:!--|\/?[a-z][^>]*(?:>|$))/i;

export function isValidText(value: unknown, options: TextValidationOptions): value is string {
  if (typeof value !== 'string' || value.length > options.maxLength
    || (options.multiline ? multilineControl : singleLineControl).test(value)
    || htmlTag.test(value)) return false;
  const clean = value.trim();
  if (!clean) return !options.required;
  return !options.requireLetter || /\p{L}/u.test(clean) && !/(?:https?:\/\/|www\.)/i.test(clean);
}

export function isValidEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254 || singleLineControl.test(value)) return false;
  const clean = value.trim(), parts = clean.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')
    || !/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/i.test(local) || !domain.includes('.') || domain.length > 253) return false;
  return domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

function domesticPhone(digits: string): boolean {
  return /^(?:0[23478]\d{8}|13\d{4}|(?:1300|1800)\d{6}|180\d{4})$/.test(digits);
}

export function isValidAustralianPhone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 80 || !/^[0-9 +()\-\u00a0]*$/.test(value)) return false;
  if (!value.trim()) return true;
  const compact = value.replace(/[ ()\-\u00a0]/g, '');
  if (compact.startsWith('+61') || compact.startsWith('0061')) {
    const national = compact.slice(compact.startsWith('+61') ? 3 : 4);
    return /^[23478]\d{8}$/.test(national) || domesticPhone(national) && !national.startsWith('0');
  }
  return domesticPhone(compact);
}

export function isValidAustralianPostcode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}$/.test(value);
}

export function isValidInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}
