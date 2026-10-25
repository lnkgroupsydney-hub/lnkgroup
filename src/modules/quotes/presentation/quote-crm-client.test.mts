import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteCrmLinkClient, parseQuoteCrmRelation, type QuoteCrmContext, type QuoteCrmDraft, type QuoteCrmLinkOptions } from './quote-crm-client.ts';
import type { Customer, CustomerProperty, ResolveCustomerInput, ResolveCustomerResult } from '../../customers/domain/contracts.ts';
import { CustomerRequestError } from '../../customers/presentation/customer-client.ts';
const requestId = '00000000-0000-4000-8000-000000000001';
const customer = { id: '00000000-0000-4000-8000-000000000002', companyId: 'lk-group', name: 'Synthetic', status: 'active', revision: 1 };
test('CRM relation verifies request and independent revision', () => {
  assert.deepEqual(parseQuoteCrmRelation({requestId,crmRevision:0,customer:null,property:null},requestId),{requestId,crmRevision:0,customer:null,property:null});
  for (const crmRevision of [-1, 0.5, '1']) assert.throws(()=>parseQuoteCrmRelation({requestId,crmRevision,customer:null,property:null},requestId));
  assert.throws(()=>parseQuoteCrmRelation({requestId:'other',crmRevision:0,customer:null,property:null},requestId));
});
test('CRM relation rejects property from another client or company', () => {
  const property = {id:'00000000-0000-4000-8000-000000000003',companyId:'lk-group',customerId:customer.id,label:'Synthetic site',address:{line1:'Synthetic'},revision:1};
  assert.equal(parseQuoteCrmRelation({requestId,crmRevision:2,customer,property},requestId).property?.id,property.id);
  for (const bad of [{...property,customerId:requestId},{...property,companyId:'other'}]) assert.throws(()=>parseQuoteCrmRelation({requestId,crmRevision:2,customer,property:bad},requestId));
  assert.throws(()=>parseQuoteCrmRelation({requestId,crmRevision:2,customer:null,property},requestId));
});

const timestamp = '2026-10-20T00:00:00.000Z';
function linkFixture() {
  const client: Customer = { ...customer, companyId: 'lk-group', status: 'active', email: 'synthetic@example.invalid', phone: null, address: null, archivedAt: null, createdAt: timestamp, updatedAt: timestamp };
  const property: CustomerProperty = { id: '00000000-0000-4000-8000-000000000003', companyId: 'lk-group', customerId: client.id, label: 'Synthetic site', address: { line1: '10 Synthetic Street', unit: '1', suburb: 'Sydney', state: 'NSW', postcode: '2000', country: 'AU' }, contactName: null, notes: null, status: 'active', archivedAt: null, revision: 3, createdAt: timestamp, updatedAt: timestamp };
  const initial: QuoteCrmContext = { source: { requestId, revision: 7, contact: { name: client.name, email: client.email!, phone: '', siteAddress: property.address.line1, suburb: 'Sydney', postcode: '2000' } }, relation: { requestId, crmRevision: 0, customer: null, property: null } };
  const draft: QuoteCrmDraft = { decision: { kind: 'existing', customerId: client.id, expectedRevision: 1, reason: 'Reviewed the client' }, property: { label: 'Entered site', address: { ...property.address, unit: null }, contactName: null, notes: 'Original property input' } };
  const result: ResolveCustomerResult = { outcome: 'client_reused', customer: { ...client, revision: 2 }, property, propertyOutcome: 'property_reused', crmRevision: 1 };
  return { client, property, initial, draft, result };
}
const response = (value: unknown, status = 200) => Response.json(value, { status });
const propertyReview = (properties: unknown[]) => response({ code: 'needs_property_review', error: 'Review matching properties.', properties }, 409);
type Reply = (input: ResolveCustomerInput, signal?: AbortSignal | null) => Response | Promise<Response>;
async function withTransport(run: (calls: ResolveCustomerInput[], replies: Reply[]) => Promise<void>) {
  const original = globalThis.fetch, calls: ResolveCustomerInput[] = [], replies: Reply[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/admin/customers/resolve');
    assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.cache, 'no-store');
    const input = JSON.parse(String(init?.body)) as ResolveCustomerInput; calls.push(input);
    const reply = replies.shift(); assert.ok(reply, 'Unexpected additional request');
    return reply(input, init?.signal);
  };
  try { await run(calls, replies); } finally { globalThis.fetch = original; }
}
function setup(options: Partial<QuoteCrmLinkOptions> = {}) {
  const f = linkFixture(); let keys = 0;
  const machine = createQuoteCrmLinkClient({ initial: f.initial, readLatest: async () => structuredClone(f.initial), newKey: () => `fixed-key-${++keys}`, ...options });
  return { ...f, machine, keys: () => keys };
}

test('quote property review cancel restores original input and context without another save or private reference mutation', async () => withTransport(async (calls, replies) => {
  const f = setup(); replies.push(() => propertyReview([f.property]));
  await f.machine.save(f.draft); assert.equal(f.machine.getState().kind, 'property_review');
  const reviewed = f.machine.getState(); assert.equal(reviewed.kind, 'property_review');
  if (reviewed.kind === 'property_review') { reviewed.context.source.revision = 99; reviewed.properties[0].address.line1 = 'External mutation'; }
  f.machine.cancelReview();
  assert.deepEqual(f.machine.getState(), { kind: 'ready', context: f.initial, draft: f.draft, error: null });
  assert.equal(calls.length, 1); assert.equal(f.keys(), 1);
}));

test('choosing an existing property reuses the key, original source and client revisions and removes the new-property payload', async () => withTransport(async (calls, replies) => {
  const f = setup(); replies.push(() => propertyReview([f.property]), () => response(f.result));
  await f.machine.save(f.draft);
  f.initial.source.revision = 999; f.draft.property!.notes = 'External edit';
  await f.machine.useExistingProperty(f.property.id);
  assert.equal(f.machine.getState().kind, 'saved'); assert.equal(f.keys(), 1);
  assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey); assert.deepEqual(calls[1].source, calls[0].source);
  assert.deepEqual(calls[1].decision, calls[0].decision); assert.equal(calls[1].propertyId, f.property.id);
  assert.equal(calls[1].expectedPropertyRevision, f.property.revision);
  assert.equal('property' in calls[1], false); assert.equal('propertyDecision' in calls[1], false);
  assert.equal(calls[1].source?.expectedSourceRevision, 7);
}));

test('different property requires a valid reason and sends the entire reviewed id/revision set with the original property', async () => withTransport(async (calls, replies) => {
  const f = setup(), second = { ...f.property, id: '00000000-0000-4000-8000-000000000004', revision: 5, status: 'archived' as const };
  replies.push(() => propertyReview([f.property, second]), () => response({ ...f.result, property: { ...f.property, id: '00000000-0000-4000-8000-000000000005', address: f.draft.property!.address }, propertyOutcome: 'property_created' }));
  await f.machine.save(f.draft);
  for (const reason of ['', ' ', 'x'.repeat(501), 'bad\u0000reason']) { await f.machine.confirmDifferentProperty(reason); assert.equal(calls.length, 1); assert.equal(f.machine.getState().kind, 'property_review'); }
  await f.machine.useExistingProperty(second.id); await f.machine.useExistingProperty(requestId); assert.equal(calls.length, 1);
  await f.machine.confirmDifferentProperty('  Verified separate unit and street details  ');
  assert.equal(f.machine.getState().kind, 'saved'); assert.equal(f.keys(), 1);
  assert.deepEqual(calls[1].property, calls[0].property); assert.deepEqual(calls[1].source, calls[0].source); assert.equal(calls[1].idempotencyKey, calls[0].idempotencyKey);
  assert.equal('expectedPropertyRevision' in calls[1], false);
  assert.deepEqual(calls[1].propertyDecision, { kind: 'different_property', reason: 'Verified separate unit and street details', reviewedProperties: [f.property, second].map(p => ({ id: p.id, revision: p.revision })) });
}));

test('a confirmed validation error preserves review, original property and key across existing-to-different and different-to-existing choices', async () => withTransport(async (calls, replies) => {
  for (const first of ['existing', 'different']) {
    const f = setup(); replies.push(() => propertyReview([f.property]), () => response({ error: 'Please correct the decision.', code: 'validation' }, 400), () => response(f.result));
    await f.machine.save(f.draft);
    if (first === 'existing') await f.machine.useExistingProperty(f.property.id); else await f.machine.confirmDifferentProperty('Different unit verified');
    const state = f.machine.getState(); assert.equal(state.kind, 'property_review'); if (state.kind === 'property_review') assert.match(state.error!, /correct/);
    if (first === 'existing') await f.machine.confirmDifferentProperty('Corrected property reason'); else await f.machine.useExistingProperty(f.property.id);
    const batch = calls.slice(-3); assert.equal(new Set(batch.map(c => c.idempotencyKey)).size, 1);
    if (first === 'existing') { assert.deepEqual(batch[2].property, batch[0].property); assert.equal('expectedPropertyRevision' in batch[2],false); }
    else { assert.equal('property' in batch[2], false); assert.equal(batch[2].expectedPropertyRevision,f.property.revision); }
    assert.deepEqual(batch[2].source, batch[0].source); assert.equal(f.machine.getState().kind, 'saved');
  }
}));

test('network, timeout, 5xx and malformed success keep the exact reviewed attempt frozen for retry', async () => withTransport(async (calls, replies) => {
  const failures: Reply[] = [() => { throw new TypeError('Network lost'); }, () => response({ error: 'Timeout' }, 408), () => response({ error: 'Unavailable' }, 503), () => response({ customer: { name: 'Unverified' } }), () => new Response('invalid json')];
  for (const failure of failures) {
    const f = setup(); replies.push(() => propertyReview([f.property]), failure, () => response(f.result));
    await f.machine.save(f.draft); await f.machine.useExistingProperty(f.property.id);
    const uncertain = f.machine.getState(); assert.equal(uncertain.kind, 'uncertain');
    const count = calls.length;
    await f.machine.save({}); f.machine.cancelReview(); await f.machine.confirmDifferentProperty('Changed input'); await f.machine.useExistingProperty(f.property.id); f.machine.restartFromLatest(); await f.machine.refreshConflict();
    assert.deepEqual(f.machine.getState(), uncertain); assert.equal(calls.length, count);
    await f.machine.retry(); assert.deepEqual(calls.at(-1), calls.at(-2)); assert.equal(f.machine.getState().kind, 'saved'); assert.equal(f.keys(), 1);
  }
}));

test('uncertain different-property creation retries the exact reason, property and full candidate revision snapshot', async () => withTransport(async (calls, replies) => {
  const f = setup(); replies.push(() => propertyReview([f.property]), () => { throw new Error('Lost reply'); }, () => response({ ...f.result, propertyOutcome: 'property_created' }));
  await f.machine.save(f.draft); await f.machine.confirmDifferentProperty('Different site verified');
  assert.equal(f.machine.getState().kind, 'uncertain'); await f.machine.retry();
  assert.deepEqual(calls[2], calls[1]); assert.deepEqual(calls[2].property, calls[0].property); assert.equal(f.machine.getState().kind, 'saved');
}));

test('409 loads a real latest comparison without rebasing source/input and requires an explicit restart with a new key', async () => withTransport(async (calls, replies) => {
  const f = linkFixture(), latest = structuredClone(f.initial); latest.source.revision = 8; latest.source.contact.siteAddress = 'Changed street'; latest.relation.crmRevision = 2;
  let reads = 0; const s = setup({ readLatest: async () => { reads++; return latest; } });
  replies.push(() => propertyReview([f.property]), () => response({ error: 'Quote changed.', code: 'conflict' }, 409), () => response({ ...f.result, crmRevision: 3 }));
  await s.machine.save(f.draft); await s.machine.useExistingProperty(f.property.id);
  const state = s.machine.getState(); assert.equal(state.kind, 'conflict'); assert.equal(reads, 1);
  if (state.kind === 'conflict') { assert.deepEqual(state.context, f.initial); assert.deepEqual(state.latest, latest); assert.deepEqual(state.draft, f.draft); }
  await s.machine.save(f.draft); await s.machine.retry(); s.machine.cancelReview(); assert.equal(calls.length, 2);
  s.machine.restartFromLatest(); assert.deepEqual(s.machine.getState(), { kind: 'ready', context: latest, draft: {}, error: null });
  await s.machine.save(f.draft); assert.equal(calls[2].source?.expectedSourceRevision, 8); assert.equal(calls[2].source?.expectedCrmRevision, 2); assert.notEqual(calls[2].idempotencyKey, calls[0].idempotencyKey);
  assert.equal(s.machine.getState().kind, 'saved');
}));

test('failed or wrong-request latest reads stay in conflict and cannot restart until a verified latest context is available', async () => withTransport(async (calls, replies) => {
  const f = linkFixture(); let phase = 0;
  const s = setup({ readLatest: async () => { if (!phase++) throw new Error('Latest unavailable'); if (phase === 2) return { ...f.initial, source: { ...f.initial.source, requestId: '00000000-0000-4000-8000-000000000009' } }; return f.initial; } });
  replies.push(() => response({ code: 'conflict', error: 'Changed' }, 409)); await s.machine.save(f.draft);
  for (let i = 0; i < 2; i++) { const state = s.machine.getState(); assert.equal(state.kind, 'conflict'); if (state.kind === 'conflict') { assert.equal(state.latest, null); assert.ok(state.latestError); } s.machine.restartFromLatest(); assert.equal(s.machine.getState().kind, 'conflict'); await s.machine.refreshConflict(); }
  s.machine.restartFromLatest(); assert.equal(s.machine.getState().kind, 'ready'); assert.equal(calls.length, 1);
}));

test('401 and 403 erase quote, customer, property candidates, input, pending request and raw errors', async () => withTransport(async (calls, replies) => {
  for (const status of [401, 403]) {
    let losses = 0; const f = setup({ onAccessLost: () => { losses++; } });
    replies.push(() => propertyReview([f.property]), () => response({ error: 'private-name private-address', properties: [f.property] }, status));
    await f.machine.save(f.draft); await f.machine.useExistingProperty(f.property.id);
    assert.deepEqual(f.machine.getState(), { kind: 'access_lost' }); assert.equal(losses, 1);
    const count = calls.length; await f.machine.retry(); await f.machine.save(f.draft); await f.machine.refreshConflict(); f.machine.cancelReview(); f.machine.loseAccess(); assert.equal(calls.length, count); assert.equal(losses, 1);
  }
}));

test('permission loss in latest reads clears comparison snapshots and ignores late reads and saves', async () => withTransport(async (_calls, replies) => {
  const f = linkFixture();
  for (const status of [401, 403]) {
    let losses = 0;
    const s = setup({ readLatest: async () => { throw new CustomerRequestError('private comparison', status, { property: f.property }); }, onAccessLost: () => { losses++; } });
    replies.push(() => response({ error: 'Changed' }, 409)); await s.machine.save(f.draft);
    assert.deepEqual(s.machine.getState(), { kind: 'access_lost' }); assert.equal(losses, 1);
  }
  let finishRead!: (value: QuoteCrmContext) => void;
  const s = setup({ readLatest: () => new Promise(resolve => { finishRead = resolve; }) });
  replies.push(() => response({ error: 'Changed' }, 409)); const saving = s.machine.save(f.draft);
  await new Promise(resolve => setImmediate(resolve)); s.machine.loseAccess(); finishRead(f.initial); await saving;
  assert.deepEqual(s.machine.getState(), { kind: 'access_lost' });
  let finishSave!: (response: Response) => void, changes = 0;
  const late = setup({ onChange: () => { changes++; } }); replies.push(() => new Promise(resolve => { finishSave = resolve; }));
  const pending = late.machine.save(f.draft); late.machine.loseAccess(); const afterLoss = changes; finishSave(response(f.result)); await pending;
  assert.deepEqual(late.machine.getState(), { kind: 'access_lost' }); assert.equal(changes, afterLoss);
}));

test('dispose clears memory and ignores late callbacks; saving blocks duplicate requests', async () => withTransport(async (calls, replies) => {
  let finish!: (response: Response) => void, notifications = 0, losses = 0;
  const f = setup({ onChange: () => { notifications++; }, onAccessLost: () => { losses++; } });
  replies.push(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.machine.save(f.draft); await f.machine.save(f.draft); await f.machine.retry(); f.machine.cancelReview(); assert.equal(calls.length, 1);
  f.machine.dispose(); const before = notifications; finish(response(f.result)); await pending;
  assert.deepEqual(f.machine.getState(), { kind: 'access_lost' }); assert.equal(notifications, before); assert.equal(losses, 0);
}));

test('malformed, empty, duplicate, cross-client/company and stale property candidates cannot be selected or confirmed', async () => withTransport(async (calls, replies) => {
  const f = linkFixture();
  const invalid = [[], [null], [f.property, f.property], [{ ...f.property, companyId: 'other' }], [{ ...f.property, customerId: requestId }], [{ ...f.property, revision: 0 }], [{ ...f.property, revision: 1.5 }], [{ ...f.property, address: null }], [{ ...f.property, status: 'missing' }], [{ ...f.property, id: 'bad' }], Array.from({ length: 101 }, () => f.property)];
  for (const properties of invalid) {
    const s = setup(); replies.push(() => propertyReview(properties)); await s.machine.save(s.draft);
    assert.equal(s.machine.getState().kind, 'conflict'); const count = calls.length;
    await s.machine.confirmDifferentProperty('Invalid review'); await s.machine.useExistingProperty(f.property.id); assert.equal(calls.length, count);
  }
  const s = setup(); replies.push(() => propertyReview([f.property])); await s.machine.save({ property: f.draft.property }); assert.equal(s.machine.getState().kind, 'conflict');
}));

test('legacy auto resolution of an already linked client accepts scoped property review and preserves the source revision', async () => withTransport(async (calls, replies) => {
  const f = linkFixture(), initial = { ...f.initial, relation: { ...f.initial.relation, crmRevision: 2, customer: f.client } };
  const s = setup({ initial }); replies.push(() => propertyReview([f.property]), () => response({ ...f.result, crmRevision: 3 }));
  await s.machine.save({ property: f.draft.property }); await s.machine.useExistingProperty(f.property.id);
  assert.equal(s.machine.getState().kind, 'saved'); assert.equal(calls[1].source?.expectedCrmRevision, 2); assert.equal('decision' in calls[1], false);
}));

test('unchanged CRM relation accepts the server no-op revision and preserves the linked property when no property was submitted', async () => withTransport(async (calls, replies) => {
  const f = linkFixture(), initial = { ...f.initial, relation: { ...f.initial.relation, crmRevision: 4, customer: f.client, property: f.property } };
  const s = setup({ initial }); replies.push(() => response({ ...f.result, crmRevision: 4 }));
  await s.machine.save({}); assert.equal(s.machine.getState().kind, 'saved'); assert.equal(calls.length, 1);
}));

test('malformed saved customer/property/revision or outcomes are uncertain and exact retries can recover', async () => withTransport(async (calls, replies) => {
  const f = linkFixture();
  const invalid = [{ ...f.result, crmRevision: 0 }, { ...f.result, crmRevision: 3 }, { ...f.result, customer: { ...f.result.customer, companyId: 'other' } }, { ...f.result, property: { ...f.property, customerId: requestId } }, { ...f.result, property: null }, { ...f.result, propertyOutcome: null }, { ...f.result, outcome: 'needs_property_review' }];
  for (const result of invalid) {
    const s = setup(); replies.push(() => response(result), () => response(f.result)); await s.machine.save(s.draft); assert.equal(s.machine.getState().kind, 'uncertain');
    await s.machine.retry(); assert.deepEqual(calls.at(-1), calls.at(-2)); assert.equal(s.machine.getState().kind, 'saved');
  }
}));

test('customer review can continue into property review using the same key and original property/source snapshot', async () => withTransport(async (calls, replies) => {
  const f = setup(); replies.push(() => response({ code: 'needs_review', error: 'Review clients.', candidates: [{ customer: f.client, matchedBy: ['email'] }] }, 409), () => propertyReview([f.property]), () => response(f.result));
  await f.machine.save({ property: f.draft.property }); assert.equal(f.machine.getState().kind, 'customer_review');
  await f.machine.save({ property: f.draft.property }); assert.equal(calls.length, 1);
  await f.machine.save({ ...f.draft, property: { ...f.draft.property!, notes: 'Edited review' } }); assert.equal(calls.length, 1);
  await f.machine.save(f.draft); assert.equal(f.machine.getState().kind, 'property_review'); await f.machine.useExistingProperty(f.property.id);
  assert.equal(f.machine.getState().kind, 'saved'); assert.equal(new Set(calls.map(c => c.idempotencyKey)).size, 1); assert.deepEqual(calls[2].source, calls[0].source);
}));

test('customer review different-person decisions require complete current candidate revisions and restore input on cancel', async () => withTransport(async (calls, replies) => {
  const f = setup(); replies.push(() => response({ code: 'needs_review', candidates: [{ customer: f.client, matchedBy: [] }] }, 409));
  const draft = { property: f.draft.property }; await f.machine.save(draft);
  await f.machine.save({ ...draft, decision: { kind: 'different_person', reason: 'Verified', reviewedCandidates: [] } }); assert.equal(calls.length, 1);
  f.machine.cancelReview(); assert.deepEqual(f.machine.getState(), { kind: 'ready', context: f.initial, draft, error: null });
}));

test('initial validation failure returns editable input while malformed review envelopes require latest comparison', async () => withTransport(async (_calls, replies) => {
  const f = setup(); replies.push(() => response({ code: 'validation', error: 'Enter a property label.' }, 400)); await f.machine.save(f.draft);
  const ready = f.machine.getState(); assert.equal(ready.kind, 'ready'); if (ready.kind === 'ready') { assert.deepEqual(ready.draft, f.draft); assert.match(ready.error!, /label/); }
  replies.push(() => response({ code: 'needs_property_review', properties: 'unverified' }, 409)); await f.machine.save(f.draft); assert.equal(f.machine.getState().kind, 'conflict');
}));

test('direct existing-property selection requires a reviewed revision and freezes it through an unknown retry',async()=>withTransport(async(calls,replies)=>{
 const f=setup()
 for(const expectedPropertyRevision of [undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  await f.machine.save({decision:f.draft.decision,propertyId:f.property.id,...(expectedPropertyRevision===undefined?{}:{expectedPropertyRevision})})
  const state=f.machine.getState();assert.equal(state.kind,'ready');if(state.kind==='ready')assert.match(state.error!,/reviewed revision/)
  assert.equal(calls.length,0)
 }
 await f.machine.save({expectedPropertyRevision:1});assert.equal(calls.length,0)
 const draft={decision:f.draft.decision,propertyId:f.property.id,expectedPropertyRevision:f.property.revision}
 replies.push(()=>{throw new Error('Lost reply')},()=>response(f.result))
 await f.machine.save(draft);assert.equal(f.machine.getState().kind,'uncertain');draft.expectedPropertyRevision=99
 await f.machine.retry();assert.equal(f.machine.getState().kind,'saved');assert.deepEqual(calls[1],calls[0]);assert.equal(calls[1].expectedPropertyRevision,f.property.revision)
}));

test('customer review cannot silently replace the originally selected property revision',async()=>withTransport(async(calls,replies)=>{
 const f=setup(),draft={propertyId:f.property.id,expectedPropertyRevision:f.property.revision}
 replies.push(()=>response({code:'needs_review',candidates:[{customer:f.client,matchedBy:['email']}]},409),()=>response(f.result))
 await f.machine.save(draft);assert.equal(f.machine.getState().kind,'customer_review')
 await f.machine.save({...draft,expectedPropertyRevision:f.property.revision+1,decision:f.draft.decision});assert.equal(calls.length,1)
 await f.machine.save({...draft,decision:f.draft.decision});assert.equal(f.machine.getState().kind,'saved');assert.equal(calls[1].expectedPropertyRevision,draft.expectedPropertyRevision);assert.equal(calls[1].idempotencyKey,calls[0].idempotencyKey)
}));
