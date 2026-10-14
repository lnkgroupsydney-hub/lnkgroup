import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transpileModule, JsxEmit, ModuleKind } from 'typescript';
import { PHOTO_ROLES, type PhotoAnalysis, type ProvisionalPhotoAnalysis } from '../domain/analysis.ts';
import { calculatePreviousEstimatePricing as calculateEstimatePricing, calculateEstimatePricing as calculateNoGstPricing, calculateLegacyEstimatePricing, pendingCompanyPricing } from '../domain/pricing.ts';
import type { PublicAnalysisJob } from '../domain/photo-workspace.ts';
import type { ServiceDetails } from '../domain/contracts.ts';

// Node strips TypeScript but does not parse JSX. Transform only the real shared
// result component, then render it with React; no browser or network is used.
const componentUrl = new URL('./saved-photo-analysis.tsx', import.meta.url);
const jsxHook = registerHooks({ load(url, context, nextLoad) {
  if (url !== componentUrl.href) return nextLoad(url, context);
  return { format: 'module', shortCircuit: true, source: transpileModule(readFileSync(componentUrl, 'utf8'), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
} });
const { SavedPhotoAnalysis } = await import(componentUrl.href);
jsxHook.deregister();
const photoId = '205f3d74-69e5-4cbe-b4b4-31d4a382cfad';
const service: ServiceDetails = { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors', 'drawers'], doorCount: 5, drawerCount: 2, material: '', colourPreference: '' };
const analysis: PhotoAnalysis = { summary: 'Cabinet fronts are visible.', outcome: 'analysis_ready', photoQuality: [{ photoId, usable: true, issues: [], retakeInstruction: null }], coverage: PHOTO_ROLES.map(role => ({ role, covered: true, photoIds: [photoId], note: 'Visible in photo.' })), quantities: { doors: { customer: 5, observed: 5, needsConfirmation: false }, drawers: { customer: 2, observed: 2, needsConfirmation: false } }, observedDamage: [], proposedWork: [], unknowns: [], siteChecks: [] };
const job: PublicAnalysisJob = { id: '7332878e-3cb6-4986-a579-865b0244bce7', requestId: 'b65b5359-f90d-45be-b4b9-c249aa7f6daf', inputRevision: 2, status: 'succeeded', stale: false, createdAt: '2026-10-11T00:00:00Z', completedAt: '2026-10-11T00:00:00Z', attempts: 1, error: null, usage: null, analysis, pricing: calculateLegacyEstimatePricing(analysis, service) };
const render = (saved: PublicAnalysisJob) => renderToStaticMarkup(createElement(SavedPhotoAnalysis, { job: saved }));

test('shared customer and EMS result renders the inclusive total prominently with an accessible breakdown', () => {
  const html = render(job);
  assert.match(html, /class="lq-estimate-total"><strong>A\$1,650 incl GST<\/strong>/);
  assert.match(html, /<caption>Work and price breakdown \(AUD\)<\/caption>/);
  assert.match(html, /<th scope="col">Quantity<\/th>/);
  assert.match(html, /Subtotal \(ex GST\)<\/th><td>A\$1,500<\/td>/);
  assert.match(html, /GST \(10%\)<\/th><td>A\$150<\/td>/);
  assert.match(html, /Estimated total \(incl GST\)<\/th><td><strong>A\$1,650<\/strong>/);
  assert.match(html, /on-site inspection/); assert.match(html, /does not confirm a contract or booking/);
  assert.doesNotMatch(html, /pricing setup was pending/);
});
test('insufficient photos render only a starting price, missing evidence and no partial-total table', () => {
  const incomplete: PhotoAnalysis = { ...analysis, outcome: 'additional_photos_required', coverage: analysis.coverage.map(item => ({ ...item, covered: false, photoIds: [] })), unknowns: ['Add a whole-front photo and exposed side photo.'] };
  const pricing = calculateLegacyEstimatePricing(incomplete, service);
  const html = render({ ...job, analysis: incomplete, pricing });
  assert.match(html, /Additional photos needed/);
  assert.match(html, /<strong>From A\$1,650 incl GST<\/strong>/);
  assert.match(html, /\(A\$1,500 \+ GST\) · Starting price only/);
  assert.match(html, /Your estimate total is not available yet/);
  assert.match(html, /overall cabinets, lower fronts and sides/);
  assert.match(html, /Add a whole-front photo and exposed side photo/);
  assert.doesNotMatch(html, /<table>|Estimated total for the saved scope/);
});

function aiEstimatedAnalysis(): ProvisionalPhotoAnalysis {
  return { ...analysis, outcome: 'site_review_required', observedDamage: [],
    quantities: {
      doors: { observed: 10, customer: null, estimated: 12, needsConfirmation: true, basisPhotoIds: [photoId], confidence: 'medium', note: 'Twelve door fronts are estimated from the visible cabinet runs; edges require a site check.' },
      drawers: { observed: 4, customer: null, estimated: 4, needsConfirmation: true, basisPhotoIds: [photoId], confidence: 'high', note: 'Four drawer fronts appear in the main view.' },
    },
    estimateScope: { status: 'estimable', extent: 'whole_project', anchorPhotoId: photoId, scopePhotoIds: [photoId], contextPhotoIds: [], conflictingPhotoIds: [], description: 'Paint the cabinet fronts shown in the overview.', assumptions: ['The exact door inventory will be checked on site.'] },
  };
}
test('AI quantity estimates show a provisional painting price with absent customer counts and site confirmation', () => {
  const estimated = aiEstimatedAnalysis();
  const pricing = calculateEstimatePricing(estimated, { ...service, doorCount: null, drawerCount: null });
  const html = render({ ...job, analysis: estimated, pricing });
  assert.match(html, /<strong>A\$2,420 incl GST<\/strong>/);
  assert.match(html, /AI estimate: approx\. 12/);
  assert.match(html, /Your input: not supplied/);
  assert.match(html, /Provisional painting estimate/);
  assert.match(html, /<th scope="col">Estimated quantity<\/th>/);
  assert.match(html, /Approx\. 12<\/td>/);
  assert.match(html, /check the exact quantities, condition and work scope on site/);
  assert.doesNotMatch(html, /Your estimate total is not available yet|Please confirm this quantity in service details/);
});
test('new estimates show A$1,450 without GST and retain higher scope prices without adding tax', () => {
  const estimated = aiEstimatedAnalysis();
  estimated.quantities.doors.estimated = 8; estimated.quantities.drawers.estimated = 0;
  const pricing = calculateNoGstPricing(estimated, { ...service, doorCount: null, drawerCount: null });
  const html = render({ ...job, analysis: estimated, pricing });
  assert.match(html, /<strong>A\$1,450 no GST charged<\/strong>/);
  assert.match(html, /GST<\/th><td>Not charged<\/td>/);
  assert.match(html, /The supplier is not registered for GST/);
  assert.doesNotMatch(html, /incl GST|ex GST|GST \(10%\)|excluding GST/);
  const higher = aiEstimatedAnalysis();
  assert.match(render({ ...job, analysis: higher, pricing: calculateNoGstPricing(higher, { ...service, doorCount: null, drawerCount: null }) }), /<strong>A\$2,200 no GST charged<\/strong>/);
  estimated.estimateScope.status = 'not_estimable'; estimated.estimateScope.anchorPhotoId = null;
  const incomplete = render({ ...job, analysis: estimated, pricing: calculateNoGstPricing(estimated, service) });
  assert.match(incomplete, /From A\$1,450 no GST charged/);
  assert.doesNotMatch(incomplete, /<table>|incl GST|ex GST|excluding GST/);
});
test('mixed views show only primary scope painting with severe repair costs explicitly excluded', () => {
  const estimated = aiEstimatedAnalysis();
  const otherId = 'c20dca0d-6942-47e7-b9f4-a8b161ac613f';
  estimated.photoQuality.push({ photoId: otherId, usable: true, issues: [], retakeInstruction: null });
  estimated.estimateScope = { ...estimated.estimateScope, extent: 'primary_view', conflictingPhotoIds: [otherId] };
  estimated.observedDamage = [{ id: 'repair-other', kind: 'swelling', location: 'Panel in a separate view', description: 'The exposed panel appears deformed; the cause is unconfirmed.', severity: 'severe', photoIds: [otherId], estimateScope: 'context_only', surface: 'panels' }];
  const pricing = calculateEstimatePricing(estimated, { ...service, doorCount: null, drawerCount: null });
  const html = render({ ...job, analysis: estimated, pricing });
  assert.match(html, /A\$2,420 incl GST/);
  assert.match(html, /Primary-photo scope only/);
  assert.match(html, /not an estimate for unseen cabinets or a combined total/);
  assert.match(html, /Not priced in this estimate/);
  assert.match(html, /Their quantities have not been added/);
  assert.doesNotMatch(html, /Moderate coating repairs/);
});
test('earlier pending-rate results remain historical and stale estimates remain visibly labelled', () => {
  const legacy = render({ ...job, stale: true, pricing: pendingCompanyPricing() });
  assert.match(legacy, /Earlier analysis: pricing setup was pending/);
  assert.match(legacy, /earlier result has no estimate amount/);
  assert.match(legacy, /earlier version of your details or photos/);
  assert.doesNotMatch(legacy, /<table>|A\$1,650/);
  const stale = render({ ...job, stale: true });
  assert.ok(stale.indexOf('earlier version of your details or photos') < stale.indexOf('A$1,650 incl GST'));
});
