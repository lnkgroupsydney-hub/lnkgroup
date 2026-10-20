'use client';

import { useCallback, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type Ref } from 'react';
import { isValidAustralianPhone, isValidEmail, isValidText } from '@/shared/validation/input';
import styles from './validated-input.module.css';

export type FieldValidation = 'email' | 'phone' | 'postcode' | 'count' | 'text' | 'code' | 'password';
export type FieldValidationOptions = {
  validation?: FieldValidation;
  validationLabel?: string;
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  min?: number | string;
  max?: number | string;
  multiline?: boolean;
  requireLetter?: boolean;
  codeLengths?: readonly number[];
  inputType?: string;
  pattern?: string;
  step?: number | string;
};

export function getFieldValidationError(value: string, options: FieldValidationOptions = {}): string {
  const { validation = 'text', validationLabel = 'this field', required, minLength, requireLetter, multiline = false } = options;
  const maxLength = options.maxLength ?? (validation === 'email' ? 254 : validation === 'phone' ? 40 : Number.MAX_SAFE_INTEGER);
  const inputLength = value.length;
  if (validation === 'password') {
    if (!value.length) return required ? 'Enter your password.' : '';
    return value.length < (minLength ?? 0) || value.length > maxLength ? `Use ${minLength ?? 1} to ${maxLength} characters for ${validationLabel}.` : '';
  }
  if (!isValidText(value, { maxLength, multiline })) return inputLength > maxLength ? `Use no more than ${maxLength} characters for ${validationLabel}.` : `Use plain ${multiline ? 'text' : 'single-line text'} without markup or control characters for ${validationLabel}.`;
  if (!value || (!value.trim() && !['postcode', 'count', 'code'].includes(validation))) return required ? `Enter ${validationLabel}.` : '';
  if (minLength && value.trim().length < minLength) return `Enter at least ${minLength} characters for ${validationLabel}.`;
  if (validation === 'email' && !isValidEmail(value)) return 'Enter a valid email address, such as name@example.com.';
  if (validation === 'phone' && !isValidAustralianPhone(value)) return 'Enter an Australian phone number, such as 0491 570 159 or +61 491 570 159.';
  if (validation === 'postcode' && !/^[0-9]{4}$/.test(value)) return 'Enter a four-digit Australian postcode.';
  if (validation === 'count') {
    const min = Number(options.min ?? 0), max = Number(options.max ?? 500);
    if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) return `Enter a whole number from ${min} to ${max}, or leave it blank if unknown.`;
  }
  if (validation === 'code') {
    const lengths = options.codeLengths ?? [6];
    if (!/^[0-9]+$/.test(value) || !lengths.includes(value.length)) return `Enter the ${lengths.join(' or ')}-digit code exactly as received.`;
  }
  if (validation === 'text' && !isValidText(value, { maxLength, required, multiline, requireLetter })) return `Enter a valid ${validationLabel}${requireLetter ? ' containing at least one letter' : ''}.`;
  return '';
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
function revealDetails(control: Control) {
  for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
}
function visibleControl(control: Control) {
  if (!control.willValidate || control.matches(':disabled') || ('readOnly' in control && control.readOnly)) return false;
  for (let ancestor: HTMLElement | null = control; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || getComputedStyle(ancestor).display === 'none' || getComputedStyle(ancestor).visibility === 'hidden') return false;
  }
  return true;
}
/** Check only this section, using current DOM values even before a React update. */
export function reportSectionValidity(container: HTMLElement | null): boolean {
  if (!container) return false;
  const controls = Array.from(container.querySelectorAll<Control>('input, textarea, select')).filter(visibleControl);
  let first: Control | undefined;
  for (const control of controls) {
    if (control.dataset.fieldValidation) {
      const options = JSON.parse(control.dataset.fieldValidation) as FieldValidationOptions;
      control.setCustomValidity(getFieldValidationError(control.value, options));
      control.dispatchEvent(new CustomEvent('lk-field-validation'));
    }
    if (!control.checkValidity()) first ??= control;
  }
  if (!first) return true;
  revealDetails(first); first.reportValidity(); first.focus();
  return false;
}

type ValidationProps = Pick<FieldValidationOptions, 'validation' | 'validationLabel' | 'requireLetter' | 'codeLengths'>;
type InputProps = InputHTMLAttributes<HTMLInputElement> & ValidationProps & { ref?: Ref<HTMLInputElement> };
type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & Omit<ValidationProps, 'validation' | 'codeLengths'> & { ref?: Ref<HTMLTextAreaElement> };
function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}
function useFieldValidation<T extends HTMLInputElement | HTMLTextAreaElement>(options: FieldValidationOptions, value: unknown, forwardedRef?: Ref<T>) {
  const control = useRef<T | null>(null);
  const attachRef = useCallback((element: T | null) => { control.current = element; assignRef(forwardedRef, element); }, [forwardedRef]);
  const [feedback, setFeedback] = useState({ shown: false, value: '', message: '', constraints: '' });
  const touched = useRef(false);
  const serialized = JSON.stringify(options);
  useLayoutEffect(() => {
    const element = control.current;
    if (!element) return;
    const currentOptions = JSON.parse(serialized) as FieldValidationOptions;
    element.setCustomValidity(getFieldValidationError(element.value, currentOptions));
    function requested() { touched.current = true; setFeedback({ shown: true, value: element!.value, message: getFieldValidationError(element!.value, currentOptions), constraints: serialized }); }
    element.addEventListener('lk-field-validation', requested);
    return () => element.removeEventListener('lk-field-validation', requested);
  }, [serialized, value]);
  function check(element: HTMLInputElement | HTMLTextAreaElement, show: boolean) {
    const message = getFieldValidationError(element.value, options);
    element.setCustomValidity(message);
    if (show || touched.current) { touched.current = true; setFeedback({ shown: true, value: element.value, message: message || (element.validity.valid ? '' : element.validationMessage), constraints: serialized }); }
  }
  const error = !feedback.shown ? '' : typeof value === 'string'
    ? getFieldValidationError(value, options) || (feedback.value === value && feedback.constraints === serialized ? feedback.message : '')
    : feedback.message;
  return { attachRef, error, serialized, check };
}

export function ValidatedInput({ validation = 'text', validationLabel, requireLetter, codeLengths, ref, id, maxLength, minLength, onBlur, onChange, onInvalid, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }: InputProps) {
  const generatedId = useId(), inputId = id ?? `field-${generatedId}`, errorId = `${inputId}-validation-error`;
  const { attachRef, error, serialized, check } = useFieldValidation<HTMLInputElement>({ validation, validationLabel, requireLetter, codeLengths, maxLength, minLength, min: props.min, max: props.max, required: props.required, inputType: props.type, pattern: props.pattern, step: props.step }, props.value, ref);
  return <span className={styles.field}>
    <input {...props} id={inputId} ref={attachRef} data-field-validation={serialized} aria-invalid={Boolean(error) || invalid || undefined} aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
      onChange={event => { check(event.currentTarget, false); onChange?.(event); }}
      onBlur={event => { check(event.currentTarget, true); onBlur?.(event); }}
      onInvalid={event => { check(event.currentTarget, true); revealDetails(event.currentTarget); onInvalid?.(event); }} />
    {error && <span className={styles.error} id={errorId}>{error}</span>}
  </span>;
}
export function ValidatedTextarea({ validationLabel, requireLetter, ref, id, maxLength, minLength, onBlur, onChange, onInvalid, 'aria-describedby': describedBy, 'aria-invalid': invalid, ...props }: TextareaProps) {
  const generatedId = useId(), inputId = id ?? `field-${generatedId}`, errorId = `${inputId}-validation-error`;
  const { attachRef, error, serialized, check } = useFieldValidation<HTMLTextAreaElement>({ validation: 'text', validationLabel, requireLetter, maxLength, minLength, required: props.required, multiline: true }, props.value, ref);
  return <span className={styles.field}>
    <textarea {...props} id={inputId} ref={attachRef} data-field-validation={serialized} aria-invalid={Boolean(error) || invalid || undefined} aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
      onChange={event => { check(event.currentTarget, false); onChange?.(event); }}
      onBlur={event => { check(event.currentTarget, true); onBlur?.(event); }}
      onInvalid={event => { check(event.currentTarget, true); revealDetails(event.currentTarget); onInvalid?.(event); }} />
    {error && <span className={styles.error} id={errorId}>{error}</span>}
  </span>;
}
