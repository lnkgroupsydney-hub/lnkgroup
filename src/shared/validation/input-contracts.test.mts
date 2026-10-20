import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuoteDraft, parseQuoteDraft } from '../../modules/enquiries/domain/quote-draft.ts';
import { validateEnquiry } from '../../modules/operations/domain/validation.ts';
import { validateCreateCustomer } from '../../modules/customers/domain/validation.ts';
import { validateBookingSignature, parseBookingSignature } from '../../modules/quotes/domain/booking-flow.ts';

const contact = { name: "김 O'Neil & Sons 2", email: 'Client@Example.COM', phone: '(02) 9876-5432', siteAddress: '3/12A Smith-Jones Road', suburb: 'Ermington', postcode: '0820', details: 'Repair < 2 mm\r\nThen paint\tcarefully', consent: true };
const draft = { contact, service: { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors'], doorCount: 500, drawerCount: null, material: '', colourPreference: '' } };

test('new quote/enquiry/customer writes share checks and retain their existing stored formatting', () => {
  const quote = validateQuoteDraft(draft);
  assert.equal(quote.contact.name, contact.name); assert.equal(quote.contact.phone, contact.phone); assert.equal(quote.contact.email, 'client@example.com'); assert.equal(quote.contact.postcode, '0820'); assert.equal(quote.contact.details, contact.details);
  const enquiry = validateEnquiry({ ...contact, notes: contact.details, serviceId: 'cabinet-painting', projectIntent: 'Paint cabinets', targetSurfaces: ['doors'], doorCount: 500, drawerCount: null, acknowledgement: true, preferredDate: null, idempotencyKey: 'new-enquiry' });
  assert.equal(enquiry.phone, contact.phone); assert.equal(enquiry.email, 'client@example.com'); assert.equal(enquiry.notes, contact.details);
  const customer = validateCreateCustomer({ name: contact.name, email: contact.email, phone: contact.phone, address: contact.siteAddress, idempotencyKey: 'new-customer' });
  assert.equal(customer.email, contact.email); assert.equal(customer.phone, contact.phone); assert.equal(customer.address, contact.siteAddress);
});

test('new malformed contact writes fail while legacy saved quote payloads remain readable', () => {
  for (const changed of [{ email: 'a..b@example.com' }, { phone: 'call me later' }, { name: '<b>Old name</b>' }, { suburb: '1234' }, { siteAddress: 'https://example.com' }, { name: 'Old\tname' }]) {
    const legacy = { ...draft, contact: { ...contact, ...changed } };
    assert.throws(() => validateQuoteDraft(legacy));
    assert.equal(parseQuoteDraft(legacy).contact.name, legacy.contact.name);
  }
  assert.throws(() => parseQuoteDraft({ ...draft, contact: { ...contact, details: 'Bad\u0000text' } }), 'Stored mode still validates the original boundary');
});

test('stored numeric or markup signer names remain readable while new signatures require a human name', () => {
  for (const name of ['12345', '<b>Old signer</b>']) {
    const signature = { name, method: 'typed', strokes: [], acknowledged: true };
    assert.equal(parseBookingSignature(signature).name, name);
    assert.throws(() => validateBookingSignature(signature));
  }
  assert.equal(validateBookingSignature({ name: contact.name, method: 'typed', strokes: [], acknowledged: true }).name, contact.name);
});
