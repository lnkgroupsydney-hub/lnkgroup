import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminRecordId, resolveAdminPage } from './admin-navigation.ts';

test('nested record routes retain their owning navigation section and trailing slashes', () => {
  assert.equal(resolveAdminPage('/admin/')?.id, 'overview');
  for (const section of ['customers', 'quotes', 'enquiries', 'schedule']) {
    assert.equal(resolveAdminPage(`/admin/${section}/00000000-0000-4000-8000-000000000001/`)?.id, section);
  }
  assert.equal(resolveAdminPage('/admin/customers/00000000-0000-4000-8000-000000000001/properties/123')?.id, 'customers');
});
test('navigation resolver rejects lookalike names and routes outside the workspace', () => {
  for (const path of ['/admin/quotes-old', '/admin/customers-old/123', '/administrator', '/services/cabinet-painting', '/admin/not-approved']) assert.equal(resolveAdminPage(path), null);
});
test('record paths accept only an entire UUID and do not accept URL or path injection', () => {
  assert.equal(isAdminRecordId('00000000-0000-4000-8000-000000000001'), true);
  assert.equal(isAdminRecordId('ABCDEFAB-ABCD-4000-8000-1234567890AB'), true);
  for (const value of ['123', '../settings', 'https://example.invalid', '00000000-0000-4000-8000-000000000001/extra', '00000000-0000-4000-8000-000000000001?next=/admin']) assert.equal(isAdminRecordId(value), false);
});
