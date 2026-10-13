import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidEmail, isValidAustralianPhone, isValidAustralianPostcode, isValidInteger, isValidText } from './input.ts';

test('email checks ASCII mailbox/domain boundaries without changing caller formatting', () => {
  for (const email of [' Name+tag@Example.COM ', "o'neil@example.com", 'first.last@sub.example.invalid', `${'a'.repeat(64)}@example.com`]) assert.equal(isValidEmail(email), true, email);
  for (const email of ['a@localhost', '.a@example.com', 'a.@example.com', 'a..b@example.com', 'a@.example.com', 'a@example..com', 'a@-example.com', 'a@example-.com', `a@${'x'.repeat(64)}.com`, `${'a'.repeat(65)}@example.com`, '김@example.com', 'a@exämple.com', 'a\u0000@example.com', 'a@example.com\n', 'a@b.c'.repeat(60)]) assert.equal(isValidEmail(email), false, email);
});

test('AU phones accept domestic/service/international equivalents and retain presentation', () => {
  for (const phone of ['', ' ', '0412 345 678', '(02) 9876-5432', '03 9876 5432', '07 9876 5432', '08 9876 5432', '13 12 34', '1300 123 456', '1800 123 456', '180 1234', '+61 412 345 678', '0061 2 9876 5432', '+61\u00a0412\u00a0345\u00a0678']) assert.equal(isValidAustralianPhone(phone), true, phone);
  for (const phone of ['123', '1234567890', '0512 345 678', '+61 0412 345 678', '0061 02 9876 5432', '+64 21 123 4567', '+1 212 123 4567', '0412 345 678 ext 2', '0412A345678', '0412\n345678', '0412\t345678', '04+12345678', '()--', '041234567890', ' '.repeat(81)]) assert.equal(isValidAustralianPhone(phone), false, phone);
});

test('human single-line fields support Unicode and address punctuation while rejecting controls and markup', () => {
  const options = { maxLength: 240, required: true, requireLetter: true };
  for (const value of ["O'Neil & Sons 2", '김 고객', '3/12A Smith-Jones Road', 'München', 'Apartment 8 – Example Street']) assert.equal(isValidText(value, options), true, value);
  for (const value of ['12345', '---', '<img src=x>', '<script', 'https://example.com', 'Name\nOther', 'Name\tOther', 'Name\u007f']) assert.equal(isValidText(value, options), false, value);
  assert.equal(isValidText('Line one\r\nLine two\t< 2 mm', { maxLength: 100, multiline: true }), true);
  assert.equal(isValidText('Notes\u007f', { maxLength: 100, multiline: true }), false);
  assert.equal(isValidText('', { maxLength: 100, requireLetter: true }), true);
});

test('postcode strings and numeric limits preserve leading zeros, null and numeric-string boundaries', () => {
  assert.equal(isValidAustralianPostcode('0820'), true);
  for (const value of [820, '820', '20000', '20a0', ' 2000']) assert.equal(isValidAustralianPostcode(value), false);
  for (const value of [0, 500]) assert.equal(isValidInteger(value, 0, 500), true);
  for (const value of [-1, 501, 1.5, '4', null, NaN, Infinity]) assert.equal(isValidInteger(value, 0, 500), false);
});
