import test from 'node:test';
import assert from 'node:assert/strict';
import { newQuoteHref, quoteApiPath } from './quote-workspace.ts';

const selectedId = 'f4532fd4-8d68-48bf-8c49-cddcc058d754';
const otherId = '20dec8ad-e254-4684-a58c-8c203d695fcc';

test('the original workspace preserves its existing API parameters without adding a selector', () => {
  for (const path of ['/api/quote/draft','/api/quote/availability?month=2026-10','/api/quote/booking/documents/quote?proposalId=proposal-1']) {
    assert.equal(quoteApiPath(path,''),path);
    assert.equal(quoteApiPath(path,'?service=cabinet-painting'),path);
  }
});

test('every private quote API and photo/document URL retains the selected workspace and endpoint query', () => {
  for (const path of [
    '/api/quote/draft/session','/api/quote/draft/session/new','/api/quote/draft','/api/quote/demo',
    '/api/quote/availability?month=2026-10','/api/quote/review','/api/quote/submit','/api/quote/submission',
    '/api/quote/photos','/api/quote/photos/photo-1','/api/quote/photos/photo-1/content',
    '/api/quote/booking','/api/quote/booking/consent',
    '/api/quote/booking/documents/quote?proposalId=proposal-1','/api/quote/booking/documents/agreement?proposalId=proposal-1',
  ]) {
    const actual = new URL(quoteApiPath(path,`?service=cabinet-painting&quote=${selectedId}`),'http://fixture.invalid');
    const expected = new URL(path,'http://fixture.invalid');
    assert.equal(actual.pathname,expected.pathname);
    assert.deepEqual(actual.searchParams.getAll('quote'),[selectedId]);
    for (const [key,value] of expected.searchParams) assert.equal(actual.searchParams.get(key),value);
    assert.equal(actual.searchParams.has('service'),false);
  }
});

test('empty, malformed and duplicate quote selectors reach the server intact rather than falling back to the original owner', () => {
  for (const search of ['?quote=','?quote=not-a-uuid','?quote=%20','?quote=a&quote=b',`?quote=${selectedId}&quote=${otherId}`]) {
    const query = new URL(quoteApiPath('/api/quote/draft',search),'http://fixture.invalid').searchParams;
    assert.equal(query.has('quote'),true);
    assert.deepEqual(query.getAll('quote'),new URLSearchParams(search).getAll('quote'));
  }
});

test('the client default reads the current page selector without duplicating an already selected API URL', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{location:{search:`?quote=${selectedId}`}}});
  try {
    const path = quoteApiPath('/api/quote/booking?proposalId=proposal-1');
    assert.equal(quoteApiPath(path),path);
    assert.equal(new URL(path,'http://fixture.invalid').searchParams.get('quote'),selectedId);
  } finally {
    if(original)Object.defineProperty(globalThis,'window',original);else Reflect.deleteProperty(globalThis,'window');
  }
});

test('new quote navigation requires the exact confirmed local destination for the same attempt UUID', () => {
  const href = `/quote/start?service=cabinet-painting&quote=${selectedId}`;
  assert.equal(newQuoteHref({ready:true,href},selectedId),href);
  for (const response of [
    null,[],{}, {ready:false,href}, {ready:true},
    {ready:true,href:'/quote/start?service=cabinet-painting'},
    {ready:true,href:`/quote/start?service=cabinet-painting&quote=${otherId}`},
    {ready:true,href:`https://example.invalid${href}`},
    {ready:true,href:`//example.invalid${href}`},
    {ready:true,href:`${href}&quote=${otherId}`},
    {ready:true,href:`${href}#fragment`},
    {ready:true,href:'javascript:alert(1)'},
  ]) assert.throws(()=>newQuoteHref(response,selectedId),/could not be confirmed/);
  assert.throws(()=>newQuoteHref({ready:true,href:'/quote/start?service=cabinet-painting&quote=invalid'},'invalid'),/could not be confirmed/);
});
