import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transpileModule, JsxEmit, ModuleKind } from 'typescript';
import type { PublicAnalysisJob } from '../domain/photo-workspace.ts';

const componentUrl = new URL('./photo-analysis-progress.tsx', import.meta.url);
const cssUrl = new URL('./live-photo-workspace.module.css', import.meta.url);
const hook = registerHooks({ load(url, context, nextLoad) {
  if (url === cssUrl.href) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => key });' };
  if (url !== componentUrl.href) return nextLoad(url, context);
  return { format: 'module', shortCircuit: true, source: transpileModule(readFileSync(componentUrl, 'utf8'), { compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext } }).outputText };
} });
const { PhotoAnalysisProgress } = await import(componentUrl.href);
hook.deregister();
const job: PublicAnalysisJob = { id: '7332878e-3cb6-4986-a579-865b0244bce7', requestId: 'b65b5359-f90d-45be-b4b9-c249aa7f6daf', inputRevision: 2, status: 'queued', stale: false, createdAt: '2026-10-13T00:00:00Z', completedAt: null, attempts: 0, error: null, usage: null, analysis: null, pricing: null };
const render = (saved: PublicAnalysisJob | null, preparing = false) => renderToStaticMarkup(createElement(PhotoAnalysisProgress, { job: saved, preparing }));

test('photo progress announces saved queued and running states without claiming an estimate or percentage', () => {
  const queued = render(job);
  assert.match(queued, /Your analysis is queued/);
  assert.match(queued, /Waiting for the analysis to start/);
  assert.match(queued, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(queued, /AI is reviewing|progressbar|aria-valuenow|\d+%/);
  const running = render({ ...job, status: 'running', attempts: 1 });
  assert.match(running, /AI is reviewing your cabinets/);
  assert.match(running, /Checking visible quantities, surfaces and condition/);
  assert.match(running, /aria-hidden="true"/);
  assert.doesNotMatch(running, /estimate is ready|progressbar|aria-valuenow|\d+%/);
});
test('completed, failed, uncertain and stale jobs stop the loading display', () => {
  for (const status of ['succeeded', 'failed', 'uncertain'] as const) assert.equal(render({ ...job, status }), '');
  assert.equal(render({ ...job, stale: true }), '');
  assert.equal(render({ ...job, status: 'running', stale: true }), '');
  assert.equal(render(null), '');
});
test('a real new request shows preparation instead of reusing a stale running job', () => {
  const html = render({ ...job, status: 'running', stale: true }, true);
  assert.match(html, /Preparing your photo analysis/);
  assert.match(html, /Saving your request before the review begins/);
  assert.doesNotMatch(html, /AI is reviewing|Your analysis is queued|saved progress will return/);
});
