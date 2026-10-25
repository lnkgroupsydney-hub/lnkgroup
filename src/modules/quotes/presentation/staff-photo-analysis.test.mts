import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transpileModule, JsxEmit, ModuleKind } from 'typescript';
import { PHOTO_ROLES, type ProvisionalPhotoAnalysis } from '../domain/analysis.ts';
import { calculateEstimatePricing, calculatePreviousEstimatePricing, pendingCompanyPricing } from '../domain/pricing.ts';
import type { ServiceDetails } from '../domain/contracts.ts';
import type { PublicAnalysisJob } from '../domain/photo-workspace.ts';

const component = new URL('./staff-photo-analysis.tsx', import.meta.url);
const shared = new URL('./saved-photo-analysis.tsx', import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === component.href && ['./saved-photo-analysis', './request-client'].includes(specifier)) return { url: new URL(`${specifier}${specifier.endsWith('analysis') ? '.tsx' : '.ts'}`, component).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (![component.href, shared.href].includes(url)) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
  },
});
const { StaffPhotoAnalysis } = await import(component.href);
hook.deregister();
const photoId = '205f3d74-69e5-4cbe-b4b4-31d4a382cfad';
const analysis: ProvisionalPhotoAnalysis = {
  summary: 'Main cabinet fronts visible.', outcome: 'site_review_required',
  photoQuality: [{ photoId, usable: true, issues: [], retakeInstruction: null }],
  coverage: PHOTO_ROLES.map(role => ({ role, covered: true, photoIds: [photoId], note: 'Visible.' })),
  quantities: {
    doors: { customer: null, observed: 12, estimated: 12, needsConfirmation: true, basisPhotoIds: [photoId], confidence: 'low', note: 'Confirm exact count.' },
    drawers: { customer: null, observed: 4, estimated: 4, needsConfirmation: true, basisPhotoIds: [photoId], confidence: 'high', note: 'Four visible fronts.' },
  },
  estimateScope: { status: 'estimable', extent: 'primary_view', anchorPhotoId: photoId, scopePhotoIds: [photoId], contextPhotoIds: [], conflictingPhotoIds: ['other-view'], description: 'Main photographed fronts only.', assumptions: [] },
  observedDamage: [], proposedWork: [], unknowns: [], siteChecks: [],
};
const service: ServiceDetails = { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors', 'drawers', 'panels'], doorCount: null, drawerCount: null, material: '', colourPreference: '' };
const job: PublicAnalysisJob = { id: '7332878e-3cb6-4986-a579-865b0244bce7', requestId: 'b65b5359-f90d-45be-b4b9-c249aa7f6daf', inputRevision: 2, status: 'succeeded', stale: false, createdAt: '2026-10-11T00:00:00Z', completedAt: '2026-10-11T00:00:00Z', attempts: 1, error: null, usage: null, analysis, pricing: calculateEstimatePricing(analysis, service) };
const render = (value: PublicAnalysisJob, compact = false) => renderToStaticMarkup(createElement(StaffPhotoAnalysis, { job: value, compact }));

test('administrator collapsed assessment keeps the no-GST amount and material exclusions visible', () => {
  const html = render(job), visible = html.split('<details>')[0];
  assert.match(visible, /\$2,200\.00 no GST charged/);
  assert.doesNotMatch(visible, /incl GST/);
  assert.match(visible, /not included in this painting amount/);
  assert.match(visible, /Unseen cabinetry and other project areas are not included/);
  assert.match(visible, /low confidence/);
  assert.match(visible, /Their quantities were not combined/);
  assert.match(visible, /does not confirm a contract or booking/);
  assert.match(html, /<details><summary>Full assessment/);
  assert.match(html, /<caption>Work and price breakdown/);
});

test('compact administrator summary shows stale warning before historical money and no full assessment', () => {
  const html = render({ ...job, stale: true, pricing: calculatePreviousEstimatePricing(analysis, service) }, true);
  assert.ok(html.indexOf('This earlier assessment is not current') < html.indexOf('$2,420.00 incl GST'));
  assert.doesNotMatch(html, /<details>|<table>/);
  assert.match(html, /Unseen cabinetry and other project areas are not included/);
});

test('pending or failed assessments cannot advertise a calculated current amount', () => {
  const pending = render({ ...job, pricing: pendingCompanyPricing() }, true);
  assert.match(pending, /Estimate amount pending/);
  assert.doesNotMatch(pending, /\$2,(?:200|420)/);
  const failed = render({ ...job, status: 'failed', error: 'Analysis failed.' }, true);
  assert.match(failed, /Estimate amount pending/);
  assert.match(failed, /role="alert"/);
  assert.doesNotMatch(failed, /\$2,(?:200|420)/);
});
