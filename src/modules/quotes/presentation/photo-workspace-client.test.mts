import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePhotoWorkspace, canRequestPhotoAnalysis, validatePhotoFile, photoAnalysisRequestBody, isAllowedPhotoUploadUrl } from './photo-workspace-client.ts';
import { calculateEstimatePricing, calculatePreviousEstimatePricing, calculateLegacyEstimatePricing, pendingCompanyPricing, QUOTE_PRICING_VERSION } from '../domain/pricing.ts';
import { PHOTO_ROLES, type PhotoAnalysis, type ProvisionalPhotoAnalysis } from '../domain/analysis.ts';
import type { ServiceDetails } from '../domain/contracts.ts';
const id = 'b65b5359-f90d-45be-b4b9-c249aa7f6daf', photoId = '205f3d74-69e5-4cbe-b4b4-31d4a382cfad';
const request = { id, reference: 'RQ-1234567890ABCDEF1234567890ABCDEF', mode: 'live', companyId: 'lk-group', revision: 2, status: 'draft', savedAt: '2026-10-11T00:00:00Z', createdAt: '2026-10-11T00:00:00Z', consentVersion: 'quote-storage-review-v1', reviewRequestedAt: null, customerId: null, payload: { contact: { name: 'Synthetic client', email: 'client@example.test', phone: '', siteAddress: 'Test address', suburb: 'Test suburb', postcode: '2000', details: '', consent: true }, service: { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors', 'drawers'], doorCount: 8, drawerCount: 3, material: '', colourPreference: '' } } };
const photo = { id: photoId, requestId: id, role: 'overview', state: 'ready', mimeType: 'image/jpeg', sizeBytes: 100, storedBytes: 80, contentHash: 'a'.repeat(64), width: 100, height: 100, createdAt: request.createdAt, expiresAt: '2026-10-11T01:00:00Z', contentUrl: `/api/quote/requests/photos/${photoId}/content` };
function job() { return { id: '7332878e-3cb6-4986-a579-865b0244bce7', requestId: id, inputRevision: 1, status: 'succeeded', stale: true, createdAt: request.createdAt, completedAt: request.createdAt, attempts: 1, error: null, usage: null, pricing: pendingCompanyPricing(), analysis: { summary: 'Visible cabinet fronts.', outcome: 'analysis_ready', photoQuality: [{ photoId, usable: true, issues: [], retakeInstruction: null }], coverage: PHOTO_ROLES.map(role => ({ role, covered: true, photoIds: [photoId], note: 'Visible in the supplied photo.' })), observedDamage: [], quantities: { doors: { customer: 5, observed: 5, needsConfirmation: false }, drawers: { customer: 2, observed: 2, needsConfirmation: false } }, proposedWork: [], unknowns: [], siteChecks: [] } }; }
test('workspace parser verifies owner association and rejects external photo URLs', () => {
  const body = { request, photos: [photo], jobs: [], latest: null };
  assert.equal(parsePhotoWorkspace(body, id).photos[0].id, photoId);
  assert.throws(() => parsePhotoWorkspace(body, photoId));
  assert.throws(() => parsePhotoWorkspace({ ...body, photos: [{ ...photo, requestId: photoId }] }, id));
  assert.throws(() => parsePhotoWorkspace({ ...body, photos: [{ ...photo, contentUrl: 'https://public.invalid/photo.jpg' }] }, id));
  assert.throws(() => parsePhotoWorkspace({ ...body, photos: [{ ...photo, contentUrl: '/api/admin/private-other-client' }] }, id));
});
test('historical analysis retains saved quantities after request quantities and photos change', () => {
  const savedJob = job();
  const saved = parsePhotoWorkspace({ request, photos: [], jobs: [savedJob], latest: savedJob }, id);
  assert.equal(saved.latest?.analysis?.quantities.doors.customer, 5);
  assert.equal(saved.request.payload.service?.doorCount, 8);
  assert.equal(saved.latest?.stale, true);
});
test('customer result rejects invented pricing and malformed nested analysis before rendering', () => {
  const savedJob = job();
  for (const invalid of [{ ...savedJob, pricing: { ...savedJob.pricing, total: 1250 } }, { ...savedJob, analysis: { ...savedJob.analysis, observedDamage: 'not-an-array' } }, { ...savedJob, analysis: { ...savedJob.analysis, summary: 'Total is $1250.' } }]) assert.throws(() => parsePhotoWorkspace({ request, photos: [], jobs: [invalid], latest: invalid }, id));
});
test('workspace accepts the saved cents estimate and preserves the GST-inclusive total', () => {
  const savedJob = job();
  const pricing = calculateLegacyEstimatePricing(savedJob.analysis as PhotoAnalysis, { ...request.payload.service, doorCount: 5, drawerCount: 2 } as ServiceDetails);
  const current = { ...savedJob, pricing };
  const saved = parsePhotoWorkspace({ request, photos: [], jobs: [current], latest: current }, id);
  assert.equal(saved.latest?.pricing?.status, 'estimate_ready');
  assert.equal(saved.latest?.pricing?.subtotal, 150000);
  assert.equal(saved.latest?.pricing?.tax, 15000);
  assert.equal(saved.latest?.pricing?.total, 165000);
  assert.deepEqual(saved.latest?.pricing, pricing);
});
test('workspace rejects manipulated money, currency, tax, units and duplicate price rows', () => {
  const savedJob = job();
  const pricing = calculateLegacyEstimatePricing(savedJob.analysis as PhotoAnalysis, { ...request.payload.service, doorCount: 5, drawerCount: 2 } as ServiceDetails);
  for (const invalid of [
    { ...pricing, total: 1650 }, { ...pricing, subtotal: 149999 }, { ...pricing, tax: 0 },
    { ...pricing, currency: 'USD' }, { ...pricing, amountUnit: 'dollars' }, { ...pricing, pricingVersion: 'invented' },
    { ...pricing, lineItems: [...pricing.lineItems, pricing.lineItems[0]] },
    { ...pricing, lineItems: pricing.lineItems.map((line, index) => index ? line : { ...line, amount: line.amount + 1 }) },
  ]) {
    const tampered = { ...savedJob, pricing: invalid };
    assert.throws(() => parsePhotoWorkspace({ request, photos: [], jobs: [tampered], latest: tampered }, id));
  }
});
test('workspace preserves concrete review reasons while rejecting a misleading partial total', () => {
  const savedJob = job();
  const pricing = calculateLegacyEstimatePricing({ ...savedJob.analysis, outcome: 'additional_photos_required' } as PhotoAnalysis, { ...request.payload.service, doorCount: 5, drawerCount: 2 } as ServiceDetails);
  const review = { ...savedJob, pricing };
  const saved = parsePhotoWorkspace({ request, photos: [], jobs: [review], latest: review }, id);
  assert.equal(saved.latest?.pricing?.status, 'review_required');
  assert.equal(saved.latest?.pricing?.total, null);
  assert.deepEqual(saved.latest?.pricing, pricing);
  for (const invalid of [{ ...pricing, total: 165000 }, { ...pricing, reviewReasons: [] }, { ...pricing, reviewReasons: [''] }]) {
    const tampered = { ...savedJob, pricing: invalid };
    assert.throws(() => parsePhotoWorkspace({ request, photos: [], jobs: [tampered], latest: tampered }, id));
  }
});
test('analysis availability blocks incomplete uploads and current jobs but permits new revision after stale job', () => {
  const body = { request, photos: [photo], jobs: [], latest: null };
  assert.equal(canRequestPhotoAnalysis(parsePhotoWorkspace(body, id)), true);
  assert.equal(canRequestPhotoAnalysis(parsePhotoWorkspace({ ...body, photos: [{ ...photo, state: 'uploading', contentUrl: null }] }, id)), false);
  const running = { ...job(), status: 'running', stale: false, analysis: null, pricing: null };
  assert.equal(canRequestPhotoAnalysis(parsePhotoWorkspace({ ...body, jobs: [running], latest: running }, id)), false);
  assert.equal(canRequestPhotoAnalysis(parsePhotoWorkspace({ ...body, jobs: [{ ...running, stale: true }], latest: { ...running, stale: true } }, id)), true);
});
test('file guard rejects unsupported, empty and oversized uploads before sending', () => {
  validatePhotoFile({ type: 'image/jpeg', size: 10 * 1024 * 1024 });
  for (const file of [{ type: 'image/svg+xml', size: 50 }, { type: 'image/jpeg', size: 0 }, { type: 'image/png', size: 10 * 1024 * 1024 + 1 }]) assert.throws(() => validatePhotoFile(file));
});

test('analysis serialization requires fresh consent and sends current revision without customer contact data', () => {
  const saved = parsePhotoWorkspace({ request, photos: [photo], jobs: [], latest: null }, id);
  assert.throws(() => photoAnalysisRequestBody(saved, false, { upperNotApplicable: false, damageNotPresent: false }, photoId), /Agree/);
  const body = JSON.parse(photoAnalysisRequestBody(saved, true, { upperNotApplicable: true, damageNotPresent: false }, photoId));
  assert.equal(body.aiConsent, true); assert.equal(body.aiConsentVersion, 'openai-photo-analysis-v1'); assert.equal(body.expectedRevision, 2);
  assert.deepEqual(body.coverage, { upperNotApplicable: true, damageNotPresent: false });
  for (const confidential of [request.payload.contact.name, request.payload.contact.email, request.payload.contact.siteAddress]) assert.equal(JSON.stringify(body).includes(confidential), false);
  const failed = { ...job(), status: 'uncertain', stale: false, analysis: null, pricing: null };
  const retry = parsePhotoWorkspace({ request, photos: [photo], jobs: [failed], latest: failed }, id);
  assert.equal(JSON.parse(photoAnalysisRequestBody(retry, true, { upperNotApplicable: false, damageNotPresent: false }, photoId)).retryOf, failed.id);
  const stale = parsePhotoWorkspace({ request, photos: [photo], jobs: [{ ...failed, stale: true }], latest: { ...failed, stale: true } }, id);
  assert.equal(Object.hasOwn(JSON.parse(photoAnalysisRequestBody(stale, true, { upperNotApplicable: false, damageNotPresent: false }, photoId)), 'retryOf'), false);
});

test('workspace restores mixed historical and AI-quantity results without replacing customer inputs', () => {
  const previous = job();
  const analysis: ProvisionalPhotoAnalysis = { ...previous.analysis, outcome: 'site_review_required', observedDamage: [],
    quantities: {
      doors: { customer: null, observed: 10, estimated: 12, needsConfirmation: true, confidence: 'medium', basisPhotoIds: [photoId], note: 'Estimated from the main cabinet view.' },
      drawers: { customer: null, observed: 4, estimated: 4, needsConfirmation: true, confidence: 'high', basisPhotoIds: [photoId], note: 'Four visible drawer fronts.' },
    },
    estimateScope: { status: 'estimable', extent: 'whole_project', anchorPhotoId: photoId, scopePhotoIds: [photoId], contextPhotoIds: [], conflictingPhotoIds: [], description: 'The main cabinet run.', assumptions: ['Exact quantities require an on-site check.'] },
  };
  const service = { ...request.payload.service, doorCount: null, drawerCount: null } as ServiceDetails;
  const pricing = calculatePreviousEstimatePricing(analysis, service);
  const current = { ...previous, id: 'ae9ea361-bef7-4c6a-9788-4e341f0480bc', analysis, pricing };
  const payload = { request, photos: [photo], jobs: [previous, current], latest: current };
  const parsed = parsePhotoWorkspace(payload, id);
  assert.equal(parsed.jobs[0].pricing?.status, 'awaiting_company_rates');
  assert.equal(parsed.latest?.pricing?.status, 'provisional_estimate');
  assert.equal(parsed.latest?.pricing?.total, 242000);
  assert.equal(parsed.latest?.analysis?.quantities.doors.customer, null);
  assert.equal(parsed.request.payload.service?.doorCount, 8);
  assert.deepEqual(parsed.latest?.analysis, analysis);
  const newest = { ...current, id: '16166211-7267-46bc-8755-aa06b9a0832e', pricing: calculateEstimatePricing(analysis, service) };
  const newPolicy = parsePhotoWorkspace({ ...payload, request: { ...request, pricingVersion: QUOTE_PRICING_VERSION }, jobs: [previous, current, newest], latest: newest }, id);
  assert.equal(newPolicy.jobs[1].pricing?.total, 242000);
  assert.equal(newPolicy.latest?.pricing?.total, 220000);
  assert.equal(newPolicy.latest?.pricing?.tax, 0);
  const mismatchedAnalysis = { ...analysis, quantities: { ...analysis.quantities, doors: { ...analysis.quantities.doors, estimated: 13 } } };
  const invalid = { ...current, analysis: mismatchedAnalysis };
  assert.throws(() => parsePhotoWorkspace({ ...payload, jobs: [previous, invalid], latest: invalid }, id), /does not match/);
  const noEvidence = { ...current, analysis: previous.analysis };
  assert.throws(() => parsePhotoWorkspace({ ...payload, jobs: [noEvidence], latest: noEvidence }, id), /missing its AI quantity evidence/);
});
test('photo uploads require HTTPS except same-origin loopback test pages', () => {
  const local = { protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:3002' };
  assert.equal(isAllowedPhotoUploadUrl(new URL('https://storage.example.invalid/upload'), { protocol: 'https:', hostname: 'www.example.invalid', origin: 'https://www.example.invalid' }), true);
  assert.equal(isAllowedPhotoUploadUrl(new URL('http://127.0.0.1:3002/__demo/upload/a'), local), true);
  assert.equal(isAllowedPhotoUploadUrl(new URL('http://127.0.0.1:9999/__demo/upload/a'), local), false);
  assert.equal(isAllowedPhotoUploadUrl(new URL('http://storage.example.invalid/upload'), local), false);
  assert.equal(isAllowedPhotoUploadUrl(new URL('http://www.example.invalid/upload'), { protocol: 'http:', hostname: 'www.example.invalid', origin: 'http://www.example.invalid' }), false);
});
