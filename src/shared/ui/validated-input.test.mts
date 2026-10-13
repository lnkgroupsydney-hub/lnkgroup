import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transpileModule, JsxEmit, ModuleKind } from 'typescript';

const componentUrl = new URL('./validated-input.tsx', import.meta.url);
const cssUrl = new URL('./validated-input.module.css', import.meta.url);
const policyUrl = new URL('../validation/input.ts', import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/shared/validation/input') return { url: policyUrl.href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === cssUrl.href) return { format: 'module', shortCircuit: true, source: 'export default { field: "validated-field", error: "validated-error" };' };
    if (url !== componentUrl.href) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: transpileModule(readFileSync(componentUrl, 'utf8'), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});
const { getFieldValidationError: error, ValidatedInput, ValidatedTextarea, reportSectionValidity } = await import(componentUrl.href);
hook.deregister();

test('raw count and postcode checks reject coercible input and preserve leading zeroes', () => {
  for (const value of ['', '0', '500', '012']) assert.equal(error(value, { validation: 'count', min: 0, max: 500 }), '');
  for (const value of [' ', '-1', '501', '1.5', '1e2', '+12', ' 12', '１２', 'Infinity']) assert.notEqual(error(value, { validation: 'count' }), '');
  assert.equal(error('0123', { validation: 'postcode', required: true, maxLength: 4 }), '');
  for (const value of ['', '123', '12345', '21a5', ' 2115']) assert.notEqual(error(value, { validation: 'postcode', required: true, maxLength: 4 }), '');
});
test('contact checks support Australian formatting and reject malformed email, foreign numbers and disguised names', () => {
  for (const value of ['', ' ', '0491 570 159', '(02) 5550 1234', '+61 491 570 159', '0061 491 570 159', '13 12 34', '1300 123 456']) assert.equal(error(value, { validation: 'phone', maxLength: 40 }), '');
  for (const value of ['+1 202 555 0123', 'call Lisa', 'https://example.com', '<b>phone</b>', '000']) assert.notEqual(error(value, { validation: 'phone', maxLength: 40 }), '');
  assert.equal(error('name@example.com', { validation: 'email', required: true }), '');
  for (const value of ['a@@example.com', '.a@example.com', 'a..b@example.com', 'a@example', 'a'.repeat(65) + '@example.com', 'a\n@example.com']) assert.notEqual(error(value, { validation: 'email', required: true }), '');
  for (const value of ['김지미 李', 'José O’Neill', '12A Example Road']) assert.equal(error(value, { required: true, requireLetter: true, maxLength: 120 }), '');
  for (const value of ['12345', 'https://example.com', '<script>name</script>']) assert.notEqual(error(value, { required: true, requireLetter: true, maxLength: 120 }), '');
});
test('text controls, line breaks, maxlength and minimum length use the same validation policy', () => {
  const note = '김지미\nSecond line\twith tab';
  assert.equal(error(note, { multiline: true, maxLength: 100 }), '');
  assert.notEqual(error(note, { maxLength: 100 }), '');
  assert.notEqual(error('Text\u0007', { multiline: true, maxLength: 100 }), '');
  assert.notEqual(error('a'.repeat(101), { maxLength: 100 }), '');
  assert.notEqual(error('a', { required: true, minLength: 2, maxLength: 100 }), '');
  assert.equal(error('  <secret>password  ', { validation: 'password', required: true, minLength: 16, maxLength: 128 }), '');
});
test('shared fields keep maxlength metadata without native paste truncation and preserve existing descriptions', () => {
  const input = renderToStaticMarkup(createElement(ValidatedInput, { id: 'count', validation: 'count', maxLength: 4, value: '1e2', 'aria-describedby': 'count-help', readOnly: true }));
  assert.match(input, /data-field-validation=.*maxLength/);
  assert.match(input, /value="1e2"/);
  assert.match(input, /aria-describedby="count-help"/);
  assert.doesNotMatch(input, /maxlength=/i);
  const textarea = renderToStaticMarkup(createElement(ValidatedTextarea, { maxLength: 10, value: 'Long raw pasted value', readOnly: true }));
  assert.match(textarea, /Long raw pasted value/);
  assert.doesNotMatch(textarea, /maxlength=/i);
});
test('section guard revalidates the current DOM value and excludes disabled, readonly and hidden neighbours', () => {
  const previousStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  const previousDetails = Object.getOwnPropertyDescriptor(globalThis, 'HTMLDetailsElement');
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: (element: { style?: object }) => ({ display: 'block', visibility: 'visible', ...element.style }) });
  Object.defineProperty(globalThis, 'HTMLDetailsElement', { configurable: true, value: class {} });
  const make = (value: string, extra: object = {}) => ({ value, dataset: { fieldValidation: JSON.stringify({ validation: 'count', min: 0, max: 500 }) }, parentElement: null, willValidate: true, readOnly: false, hidden: false, message: '', checked: 0, announced: 0, focused: false,
    matches() { return false; }, setCustomValidity(message: string) { this.message = message; }, checkValidity() { this.checked++; return !this.message; }, reportValidity() { return !this.message; }, focus() { this.focused = true; }, dispatchEvent() { this.announced++; }, ...extra });
  try {
    const stale = make('1e2'), visible = make('0'), disabled = make('-1', { willValidate: false }), readonly = make('-1', { readOnly: true }), hidden = make('-1', { parentElement: { hidden: true, parentElement: null } }), cssHidden = make('-1', { parentElement: { style: { display: 'none' }, parentElement: null } });
    const section = { querySelectorAll: () => [visible, disabled, readonly, hidden, cssHidden, stale] } as unknown as HTMLElement;
    assert.equal(reportSectionValidity(section), false);
    assert.equal(stale.focused, true); assert.equal(stale.announced, 1); assert.notEqual(stale.message, '');
    for (const excluded of [disabled, readonly, hidden, cssHidden]) assert.equal(excluded.checked, 0);
    stale.value = '500';
    assert.equal(reportSectionValidity(section), true);
  } finally {
    if (previousStyle) Object.defineProperty(globalThis, 'getComputedStyle', previousStyle); else Reflect.deleteProperty(globalThis, 'getComputedStyle');
    if (previousDetails) Object.defineProperty(globalThis, 'HTMLDetailsElement', previousDetails); else Reflect.deleteProperty(globalThis, 'HTMLDetailsElement');
  }
});
