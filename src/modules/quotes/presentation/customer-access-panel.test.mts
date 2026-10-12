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
const hook = registerHooks({ load(url, context, nextLoad) {
  if (url !== componentUrl.href) return nextLoad(url, context);
  return { format: 'module', shortCircuit: true, source: transpileModule(readFileSync(componentUrl, 'utf8'), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
} });
const { CustomerAccessPanel } = await import(componentUrl.href); hook.deregister();
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
