import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAustralianAddress, mergeSelectedAddress } from './parse.ts';
import { createPlacesSearchSession, withAddressTimeout, ADDRESS_UNAVAILABLE } from './session.ts';
import { isAddressAutocompleteConfigured, loadGoogleAddressPlaces } from './google-places.ts';
import type { AddressPlacesLibrary, AddressPrediction, AddressSelection, AutocompleteRequest, PlaceAddressComponent } from './types.ts';

const part = (type: string, longText: string, shortText = longText): PlaceAddressComponent => ({ types: [type], longText, shortText });
const house: PlaceAddressComponent[] = [
  part('street_number', '12A'), part('route', 'Example Road'), part('locality', 'Ermington'),
  part('administrative_area_level_1', 'New South Wales', 'NSW'), part('postal_code', '2115'), part('country', 'Australia', 'AU'),
];
const selected = (overrides: Partial<AddressSelection> = {}): AddressSelection => ({
  siteAddress: '12A Example Road', suburb: 'Ermington', postcode: '2115', region: 'NSW', countryCode: 'AU', placeId: 'test-house', ...overrides,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function provider() {
  const requests: AutocompleteRequest[] = [];
  const details: { fields: string[] }[] = [];
  const responses: ReturnType<typeof deferred<{ suggestions: { placePrediction: AddressPrediction }[] }>>[] = [];
  const detailResponses: ReturnType<typeof deferred<void>>[] = [];
  let serial = 0;
  let heldDetails = false;
  const library: AddressPlacesLibrary = {
    AutocompleteSessionToken: class { serial = ++serial; },
    AutocompleteSuggestion: {
      fetchAutocompleteSuggestions(request) {
        requests.push(request);
        const result = deferred<{ suggestions: { placePrediction: AddressPrediction }[] }>();
        responses.push(result);
        return result.promise;
      },
    },
  };
  const prediction = (id: string, components = house): AddressPrediction => ({
    placeId: id, text: { toString: () => `${id} Example Road, Ermington NSW, Australia` },
    toPlace: () => ({
      addressComponents: components,
      fetchFields(request) {
        details.push(request);
        if (!heldDetails) return Promise.resolve();
        const result = deferred<void>();
        detailResponses.push(result);
        return result.promise;
      },
    }),
  });
  return {
    library, requests, details, responses, detailResponses, prediction,
    holdDetails() { heldDetails = true; },
    reply(index: number, ...ids: string[]) { responses[index].resolve({ suggestions: ids.map((id) => ({ placePrediction: prediction(id) })) }); },
  };
}

test('AU components preserve house suffix, state and four-digit postcode', () => {
  assert.deepEqual(parseAustralianAddress(house, 'test-house'), selected());
  assert.equal(parseAustralianAddress(house.map((p) => p.types.includes('postal_code') ? part('postal_code', '0800') : p), 'nt').postcode, '0800');
});

test('AU unit and locality fallbacks are independent of component ordering', () => {
  const address = house.filter((p) => !p.types.includes('locality'));
  address.unshift(part('subpremise', '5B'), part('sublocality_level_1', 'West End'));
  const result = parseAustralianAddress(address.reverse(), 'unit');
  assert.equal(result.siteAddress, 'Unit 5B, 12A Example Road');
  assert.equal(result.suburb, 'West End');
  assert.equal(parseAustralianAddress([part('postal_town', 'Town'), part('sublocality', 'Suburb')], 'town').suburb, 'Town');
});

test('incomplete or non-postal components remain empty; foreign details are rejected', () => {
  assert.deepEqual(parseAustralianAddress(undefined, 'incomplete'), selected({ siteAddress: '', suburb: '', postcode: '', region: '', countryCode: '', placeId: 'incomplete' }));
  assert.equal(parseAustralianAddress([part('postal_code', '2115-123'), part('postal_code_prefix', '21')], 'prefix').postcode, '');
  assert.throws(() => parseAustralianAddress([part('country', 'New Zealand', 'NZ')], 'foreign'), /Australian address/);
});

test('new street selection clears missing locality/postcode and retains only matching unit', () => {
  const current = { siteAddress: 'Unit 5, 12A Example Rd', suburb: 'Ermington', postcode: '2115' };
  assert.deepEqual(mergeSelectedAddress(current, selected(), 'street'), { siteAddress: 'Unit 5, 12A Example Road', suburb: 'Ermington', postcode: '2115' });
  assert.equal(mergeSelectedAddress({ ...current, siteAddress: '5B/12A Example Road' }, selected(), 'street').siteAddress, 'Unit 5B, 12A Example Road');
  assert.equal(mergeSelectedAddress(current, selected({ siteAddress: '25 Example Road' }), 'street').siteAddress, '25 Example Road');
  assert.equal(mergeSelectedAddress(current, selected({ siteAddress: 'Unit 7, 12A Example Road' }), 'street').siteAddress, 'Unit 7, 12A Example Road');
  assert.equal(mergeSelectedAddress(current, selected({ suburb: 'Other suburb', postcode: '2000' }), 'street').siteAddress, '12A Example Road');
  assert.deepEqual(mergeSelectedAddress(current, selected({ suburb: '', postcode: '' }), 'street'), { siteAddress: 'Unit 5, 12A Example Road', suburb: '', postcode: '' });
});

test('suburb and postal changes cannot mix a previous street with a new locality', () => {
  const current = { siteAddress: '12A Example Road', suburb: 'Ermington', postcode: '2115' };
  assert.equal(mergeSelectedAddress(current, selected({ suburb: 'Parramatta', postcode: '2150' }), 'suburb').siteAddress, '');
  assert.deepEqual(mergeSelectedAddress(current, selected({ siteAddress: '', suburb: '', postcode: '2150' }), 'postcode'), { siteAddress: '', suburb: '', postcode: '2150' });
  assert.deepEqual(mergeSelectedAddress(current, selected({ siteAddress: '', postcode: '' }), 'suburb'), { siteAddress: '', suburb: 'Ermington', postcode: '' });
  assert.deepEqual(mergeSelectedAddress(current, selected({ siteAddress: '', suburb: '' }), 'postcode'), { siteAddress: '', suburb: '', postcode: '2115' });
  assert.equal(mergeSelectedAddress(current, selected({ suburb: ' ermington ' }), 'suburb').siteAddress, '');
});

test('an already-edited postcode cannot retain the old street or invent the selected suburb', () => {
  const edited = { siteAddress: '12A Example Road', suburb: 'Ermington', postcode: '2150' };
  assert.deepEqual(mergeSelectedAddress(edited, selected({ siteAddress: '', suburb: '', postcode: '2150' }), 'postcode'), {
    siteAddress: '', suburb: '', postcode: '2150',
  });
});

test('an already-edited suburb sharing a postcode cannot retain the old street', () => {
  const edited = { siteAddress: '12A Example Road', suburb: 'Newington', postcode: '2127' };
  assert.deepEqual(mergeSelectedAddress(edited, selected({ siteAddress: '', suburb: 'Newington', postcode: '2127' }), 'suburb'), {
    siteAddress: '', suburb: 'Newington', postcode: '2127',
  });
});

test('search loads lazily, restricts AU by field, biases without restricting service area', async () => {
  const fake = provider();
  let loads = 0;
  const session = createPlacesSearchSession(async () => { loads++; return fake.library; });
  assert.equal(loads, 0);
  assert.deepEqual(await session.search('12', 'street'), []);
  assert.equal(loads, 0);
  assert.deepEqual(await session.search('e', 'suburb'), []);
  assert.deepEqual(await session.search('2', 'postcode'), []);
  assert.equal(loads, 0);
  for (const [index, kind] of (['street', 'suburb', 'postcode'] as const).entries()) {
    const pending = session.search('example', kind);
    await Promise.resolve();
    fake.reply(index, 'house');
    await pending;
  }
  assert.deepEqual(fake.requests.map((r) => r.includedPrimaryTypes), [
    ['street_address', 'premise', 'subpremise', 'route'], ['locality', 'sublocality', 'sublocality_level_1', 'postal_town'], ['postal_code'],
  ]);
  for (const request of fake.requests) {
    assert.deepEqual(request.includedRegionCodes, ['au']);
    assert.equal(request.language, 'en-AU');
    assert.equal(request.region, 'au');
    assert.ok(request.locationBias);
    assert.equal('locationRestriction' in request, false);
  }
});

test('two-digit postcode prefixes start a search while equally short street and suburb queries do not', async () => {
  const fake = provider();
  const session = createPlacesSearchSession(async () => fake.library);
  assert.deepEqual(await session.search('21', 'street'), []);
  assert.deepEqual(await session.search('er', 'suburb'), []);
  const pending = session.search('21', 'postcode');
  await Promise.resolve();
  assert.equal(fake.requests.length, 1);
  assert.equal(fake.requests[0].input, '21');
  assert.deepEqual(fake.requests[0].includedPrimaryTypes, ['postal_code']);
  fake.reply(0, 'postcode');
  assert.equal((await pending)[0].id, 'postcode');
});

test('details requests only address components and session token rotates after selection and reset', async () => {
  const fake = provider();
  const session = createPlacesSearchSession(async () => fake.library);
  for (let i = 0; i < 2; i++) {
    const search = session.search(`address ${i}`, 'street'); await Promise.resolve(); fake.reply(i, 'house'); await search;
  }
  assert.equal(fake.requests[0].sessionToken, fake.requests[1].sessionToken);
  assert.equal((await session.select('house')).placeId, 'house');
  assert.deepEqual(fake.details, [{ fields: ['addressComponents'] }]);
  const next = session.search('next address', 'street'); await Promise.resolve(); fake.reply(2, 'next'); await next;
  assert.notEqual(fake.requests[1].sessionToken, fake.requests[2].sessionToken);
  session.reset();
  const reset = session.search('reset address', 'street'); await Promise.resolve(); fake.reply(3, 'reset'); await reset;
  assert.notEqual(fake.requests[2].sessionToken, fake.requests[3].sessionToken);
});

test('late searches cannot replace the newest result or make stale predictions selectable', async () => {
  const fake = provider();
  const session = createPlacesSearchSession(async () => fake.library);
  const first = session.search('first', 'street'); await Promise.resolve();
  const second = session.search('second', 'street'); await Promise.resolve();
  fake.reply(1, 'new'); assert.equal((await second)[0].id, 'new');
  fake.reply(0, 'old'); assert.deepEqual(await first, []);
  assert.equal((await session.select('new')).placeId, 'new');
  await assert.rejects(session.select('old'), /search for the address again/);
});

test('late details are rejected after reset or new search instead of overwriting typed fields', async () => {
  for (const action of ['reset', 'search'] as const) {
    const fake = provider(); fake.holdDetails();
    const session = createPlacesSearchSession(async () => fake.library);
    const query = session.search('address', 'street'); await Promise.resolve(); fake.reply(0, 'old'); await query;
    const pending = session.select('old');
    if (action === 'reset') session.reset();
    else await session.search('', 'street');
    fake.detailResponses[0].resolve();
    await assert.rejects(pending, { message: ADDRESS_UNAVAILABLE });
  }
});

test('provider errors and timeouts do not leak provider request data', async () => {
  const session = createPlacesSearchSession(async () => { throw new Error('private query and key'); });
  await assert.rejects(session.search('example', 'street'), { message: ADDRESS_UNAVAILABLE });
  await assert.rejects(withAddressTimeout(new Promise(() => {}), 1), { message: ADDRESS_UNAVAILABLE });
});

test('clearing input invalidates an in-flight provider failure without surfacing stale errors', async () => {
  const fake = provider();
  const session = createPlacesSearchSession(async () => fake.library);
  const pending = session.search('example', 'street'); await Promise.resolve();
  await session.search('', 'street');
  fake.responses[0].reject(new Error('private query'));
  assert.deepEqual(await pending, []);
});

test('absent key never touches the browser or injects a script', async () => {
  const previous = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  try {
    assert.equal(isAddressAutocompleteConfigured(), false);
    await assert.rejects(loadGoogleAddressPlaces(), { message: ADDRESS_UNAVAILABLE });
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = previous;
  }
});

test('browser loader shares one lazy script, respects nonce, and blocks after auth failure', async () => {
  const previousKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const scripts: { src?: string; nonce?: string }[] = [];
  const fake = provider();
  const browser = {} as { __lkAddressMapsReady?: () => void; gm_authFailure?: () => void; google?: unknown };
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: {
    createElement: () => ({}), querySelector: () => ({ nonce: 'test-nonce' }),
    head: { appendChild: (script: typeof scripts[number]) => scripts.push(script) },
  }, configurable: true });
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'public-test-key';
  try {
    const one = loadGoogleAddressPlaces();
    const two = loadGoogleAddressPlaces();
    assert.equal(one, two);
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].nonce, 'test-nonce');
    const url = new URL(scripts[0].src!);
    assert.equal(url.origin, 'https://maps.googleapis.com');
    assert.equal(url.searchParams.get('loading'), 'async');
    browser.google = { maps: { importLibrary: async (name: string) => { assert.equal(name, 'places'); return fake.library; } } };
    browser.__lkAddressMapsReady!();
    assert.equal(await one, fake.library);
    browser.gm_authFailure!();
    await assert.rejects(loadGoogleAddressPlaces(), { message: ADDRESS_UNAVAILABLE });
    assert.equal(scripts.length, 1);
  } finally {
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    else process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = previousKey;
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
