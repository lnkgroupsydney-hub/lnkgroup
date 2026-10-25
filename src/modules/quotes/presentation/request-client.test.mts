import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveRequest, withWritingSessionLock } from './request-client.ts';
import { PREVIOUS_QUOTE_PRICING_VERSION, QUOTE_PRICING_VERSION } from '../domain/pricing.ts';
import { quoteRequestStatusLabel, quoteRequestTone } from './request-status-tone.ts';
const row = { id: 'b65b5359-f90d-45be-b4b9-c249aa7f6daf', reference: 'RQ-1234567890ABCDEF1234567890ABCDEF', mode: 'live', companyId: 'lk-group', revision: 1, status: 'draft', savedAt: '2026-10-08T00:00:00Z', createdAt: '2026-10-08T00:00:00Z', consentVersion: 'quote-storage-review-v1', reviewRequestedAt: null, customerId: null, payload: { contact: { name: 'Synthetic client', email: 'client@example.test', phone: '', siteAddress: 'Test address', suburb: 'Test suburb', postcode: '2000', details: '', consent: true }, service: null } };
test('live response parser requires actual saved identifiers, company, status and validated contact data', () => {
 assert.equal(parseLiveRequest(row).payload.contact.email, 'client@example.test');
 for (const invalid of [{...row,mode:'demo'}, {...row,companyId:'someone-else'}, {...row,revision:0}, {...row,status:'confirmed'}, {...row,savedAt:'bad'}, {...row,payload:{contact:{},service:null}}]) assert.throws(()=>parseLiveRequest(invalid));
});
test('request restore accepts saved old and new policies, preserves old responses and rejects unknown pricing', () => {
 assert.equal(parseLiveRequest(row).pricingVersion, undefined);
 for (const pricingVersion of [PREVIOUS_QUOTE_PRICING_VERSION, QUOTE_PRICING_VERSION]) assert.equal(parseLiveRequest({ ...row, pricingVersion }).pricingVersion, pricingVersion);
 assert.throws(() => parseLiveRequest({ ...row, pricingVersion: 'unsupported-pricing' }));
});
test('writing-session bootstrap is serialized across tabs so late Set-Cookie cannot replace the saved owner', async () => {
 let queue = Promise.resolve(); let cookie = ''; let creations = 0; const writes: string[] = [];
 const locks = { request: (_name: string, _options: unknown, callback: () => Promise<string>) => { const current=queue.then(callback); queue=current.then(()=>undefined); return current; } };
 const bootstrap = () => withWritingSessionLock(locks as unknown as LockManager, async () => { if (!cookie) { await Promise.resolve(); cookie=`owner-${++creations}`; } return cookie; });
 const [a,b] = await Promise.all([bootstrap().then(owner=>{writes.push(owner);return owner;}),bootstrap()]);
 assert.equal(creations,1); assert.equal(a,b); assert.deepEqual(writes,[cookie]);
});
test('unsupported session serialization fails before issuing cookies or sending private writes', async () => {
 let ran=false;
 await assert.rejects(withWritingSessionLock(undefined, async()=>{ran=true;}), /safe writing session/);
 assert.equal(ran,false);
});

test('quote request badges distinguish drafts from company review requests', () => {
 assert.equal(quoteRequestTone('draft'), 'neutral'); assert.equal(quoteRequestStatusLabel('draft'), 'Draft');
 assert.equal(quoteRequestTone('review_requested'), 'warning'); assert.equal(quoteRequestStatusLabel('review_requested'), 'Review requested');
});
