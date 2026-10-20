import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transpileModule, JsxEmit, ModuleKind } from 'typescript';
import type { LiveQuoteRequest } from '../index.ts';
import type { CustomerAccessState } from './customer-access-client.ts';
const componentUrl = new URL('./customer-access-panel.tsx', import.meta.url);
const validatedInputUrl = new URL('../../../shared/ui/validated-input.tsx', import.meta.url);
const cssUrl = new URL('../../../shared/ui/validated-input.module.css', import.meta.url);
const policyUrl = new URL('../../../shared/validation/input.ts', import.meta.url);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@/shared/ui/validated-input') return { url: validatedInputUrl.href, shortCircuit: true };
  if (specifier === '@/shared/validation/input') return { url: policyUrl.href, shortCircuit: true };
  return nextResolve(specifier, context);
}, load(url, context, nextLoad) {
  if (url === cssUrl.href) return { format: 'module', shortCircuit: true, source: 'export default { field: "validated-field", error: "validated-error" };' };
  if (![componentUrl.href, validatedInputUrl.href].includes(url)) return nextLoad(url, context);
  return { format: 'module', shortCircuit: true, source: transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
} });
const { CustomerAccessPanel, bookingAccessMatches, bookingChallengeMatches } = await import(componentUrl.href); hook.deregister();
const request: LiveQuoteRequest = { id: 'b65b5359-f90d-45be-b4b9-c249aa7f6daf', reference: 'RQ-1234567890ABCDEF1234567890ABCDEF', status: 'draft', savedAt: '2026-10-12T00:00:00Z', createdAt: '2026-10-12T00:00:00Z', revision: 2, mode: 'live', companyId: 'lk-group', customerId: null, consentVersion: 'quote-storage-review-v1', reviewRequestedAt: null, payload: { contact: { name: 'Fixture', email: 'fixture@example.test', phone: '', siteAddress: 'Fixture address', suburb: 'Sydney', postcode: '2000', details: '', consent: true }, service: null } };
const anonymous: CustomerAccessState = { customer: null, requests: [], currentRequestId: null };
const verified: CustomerAccessState = { customer: { email: 'fixture@example.test', expiresAt: '2026-10-12T01:00:00Z' }, requests: [{ id: request.id, reference: request.reference, status: request.status, savedAt: request.savedAt, revision: request.revision }], currentRequestId: request.id };
const noop = () => {};
function render(initialState: CustomerAccessState, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(CustomerAccessPanel, { request, initialState, onRestored: noop, onPrivateAccessLost: noop, onSignedOut: noop, onIdentityChange: noop, onBusyChange: noop, ...extra }));
}
test('unverified writing access offers specific-quote email binding and accessible email recovery', () => {
  const html = render(anonymous);
  assert.match(html, /type="email" autoComplete="email" required/); assert.match(html, /name="customer-email"/);
  assert.match(html, /Verify email and keep this quote/);
  assert.match(html, /fixture@example.test/);
  assert.match(html, /Email verification saves access only/);
  assert.doesNotMatch(html, /Your linked quotes|Sign out of customer access/);
});
test('authenticated quote list identifies the open quote and preserves unsaved changes on switching', () => {
  const html = render(verified);
  assert.match(html, /Your linked quotes/); assert.match(html, /Currently open/);
  assert.match(html, /Sign out of customer access/); assert.doesNotMatch(html, /Verify email and keep this quote/);
  const other = { ...verified, currentRequestId: null, requests: [{ ...verified.requests[0], id: '9c26b6f4-3f62-4a68-95ab-fbf3f64231a6' }] };
  const dirty = render(other, { hasUnsavedChanges: true });
  assert.match(dirty, /disabled="">Open saved quote/);
  assert.match(dirty, /Save your current changes before linking or switching quotes/);
});
test('a guest draft with a different saved email requires verifying that address before switching customer identity', () => {
  const html = render({ customer: { email: 'other@example.test', expiresAt: '2026-10-12T01:00:00Z' }, requests: [], currentRequestId: null });
  assert.match(html, /different email/); assert.match(html, /No quotes have been linked/);
  assert.match(html, /Verify email and keep this quote/); assert.match(html, /Verify that saved address below/);
  assert.doesNotMatch(html, /Currently open|Your linked quotes/);
});

test('new-quote entry preserves unlinked and dirty requests while permitting a current linked saved quote', () => {
  assert.match(render(anonymous), /disabled="">Start a new quote/);
  assert.match(render(verified), /class="secondary">Start a new quote/);
  assert.match(render(verified, { hasUnsavedChanges: true }), /disabled="">Start a new quote/);
  assert.match(render({ ...verified, currentRequestId: null }), /disabled="">Start a new quote/);
  assert.match(render(anonymous), /verify the email of this specific quote/);
});

test('booking mode has one saved-email challenge and keeps management choices out of the visit step', () => {
  const html = render(anonymous, { mode: 'booking' });
  assert.match(html, /name="booking-saved-email"/); assert.match(html, /readOnly=""/);
  assert.match(html, /value="fixture@example.test"/); assert.match(html, /Send verification code/);
  assert.doesNotMatch(html, /name="customer-email"|Your linked quotes|Start a new quote|Refresh saved quotes|Verify email and keep this quote/);
  assert.match(render(anonymous, { mode: 'booking', hasUnsavedChanges: true }), /disabled="">Send verification code/);
});

test('booking OTP can be skipped only for an unexpired matching identity and current linked request', () => {
  const current = { ...verified, customer: { ...verified.customer!, expiresAt: new Date(Date.now() + 600_000).toISOString() } };
  assert.equal(bookingAccessMatches(request, current), true);
  assert.doesNotMatch(render(current, { mode: 'booking' }), /Send verification code/);
  assert.equal(bookingAccessMatches(request, { ...current, currentRequestId: null }), false);
  assert.equal(bookingAccessMatches(request, { ...current, requests: [] }), false);
  assert.equal(bookingAccessMatches(request, { ...current, customer: { ...current.customer, email: 'other@example.test' } }), false);
  assert.equal(bookingAccessMatches(request, verified), false);
  assert.equal(bookingAccessMatches(null, current), false);
});

test('booking code binding fails closed when request, saved email or revision changes', () => {
  const binding = { requestId: request.id, expectedRevision: request.revision, email: request.payload.contact.email.toUpperCase() };
  assert.equal(bookingChallengeMatches(request, binding), true);
  assert.equal(bookingChallengeMatches({ ...request, revision: request.revision + 1 }, binding), false);
  assert.equal(bookingChallengeMatches({ ...request, id: '9c26b6f4-3f62-4a68-95ab-fbf3f64231a6' }, binding), false);
  assert.equal(bookingChallengeMatches({ ...request, payload: { ...request.payload, contact: { ...request.payload.contact, email: 'other@example.test' } } }, binding), false);
  assert.equal(bookingChallengeMatches(request, null), false);
});
test('explicit saved-entry selection allows reopening the already selected quote', () => {
  const html = render(verified, { selectionRequired: true });
  assert.match(html, /class="secondary">Open saved quote/);
  assert.doesNotMatch(html, /Currently open/);
});
