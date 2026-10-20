import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuoteCrmRelation } from './quote-crm-client.ts';
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
