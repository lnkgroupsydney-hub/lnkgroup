import { LEGACY_PHOTO_ANALYSIS_SCHEMA_VERSION, PHOTO_ANALYSIS_SCHEMA_VERSION, validatePhotoAnalysis } from '../domain/analysis.ts';
import { validateEstimatePricing } from '../domain/pricing.ts';
import { isRecord, parseLiveRequest } from './request-client.ts';
import type { PhotoWorkspace, PublicPhoto, PublicAnalysisJob, LivePhotoRole } from '../domain/photo-workspace.ts';

export const photoRoleLabels: Record<LivePhotoRole, string> = {
  overview: 'Whole cabinet front', upper: 'Upper cabinet fronts', lower: 'Lower cabinets and drawers', side: 'Side or end panels', damage: 'Worst damage or representative surface',
};
const UUID = /^[a-f0-9-]{36}$/;
function validTime(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function parsePhoto(value: unknown, requestId: string): PublicPhoto {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id) || value.requestId !== requestId
    || !Object.hasOwn(photoRoleLabels, String(value.role)) || !['uploading', 'ready', 'deleted'].includes(String(value.state))
    || typeof value.mimeType !== 'string' || !Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) < 1
    || !validTime(value.createdAt) || !validTime(value.expiresAt)
    || (value.contentUrl !== null && (typeof value.contentUrl !== 'string' || !value.contentUrl.startsWith('/api/')))) throw new Error('Saved photos could not be verified. Reload the saved request.');
  const permitted = [`/api/quote/requests/photos/${value.id}/content`, `/api/admin/quote-requests/${requestId}/photos/${value.id}`];
  if (value.contentUrl !== null && !permitted.includes(value.contentUrl as string)) throw new Error('The private photo link did not match this request.');
  return value as unknown as PublicPhoto;
}
function parseJob(value: unknown, requestId: string): PublicAnalysisJob {
  if (!isRecord(value) || typeof value.id !== 'string' || !UUID.test(value.id) || value.requestId !== requestId
    || !Number.isSafeInteger(value.inputRevision) || Number(value.inputRevision) < 1 || typeof value.stale !== 'boolean'
    || !['queued', 'running', 'succeeded', 'failed', 'uncertain'].includes(String(value.status))
    || !validTime(value.createdAt) || (value.completedAt !== null && !validTime(value.completedAt))
    || !Number.isSafeInteger(value.attempts) || Number(value.attempts) < 0
    || (value.error !== null && typeof value.error !== 'string')
    || (value.status === 'succeeded' && (!isRecord(value.analysis) || !isRecord(value.pricing)))) throw new Error('The saved analysis could not be verified. Reload the saved result.');
  if (value.status === 'succeeded') {
    const analysis = value.analysis as Record<string, unknown>;
    if (!Array.isArray(analysis.photoQuality) || !isRecord(analysis.quantities) || !isRecord(analysis.quantities.doors) || !isRecord(analysis.quantities.drawers)) throw new Error('The saved analysis details could not be verified.');
    for (const quantity of [analysis.quantities.doors.customer, analysis.quantities.drawers.customer]) if (quantity !== null && (!Number.isSafeInteger(quantity) || Number(quantity) < 0 || Number(quantity) > 500)) throw new Error('The saved analysis quantities could not be verified.');
    const verified = validatePhotoAnalysis(analysis, { photoIds: analysis.photoQuality.map(photo => isRecord(photo) && typeof photo.photoId === 'string' ? photo.photoId : ''), doorCount: analysis.quantities.doors.customer as number | null, drawerCount: analysis.quantities.drawers.customer as number | null, coverage: { upperNotApplicable: true, damageNotPresent: true }, schemaVersion: Object.hasOwn(analysis, 'estimateScope') ? PHOTO_ANALYSIS_SCHEMA_VERSION : LEGACY_PHOTO_ANALYSIS_SCHEMA_VERSION });
    const pricing = validateEstimatePricing(value.pricing);
    if ('amountScope' in pricing && !('estimateScope' in verified)) throw new Error('The saved estimate is missing its AI quantity evidence.');
    if (pricing.status === 'provisional_estimate' && 'estimateScope' in verified) {
      const basis = pricing.basis;
      if (!basis || basis.anchorPhotoId !== verified.estimateScope.anchorPhotoId || basis.extent !== verified.estimateScope.extent
        || (basis.doors !== 0 && basis.doors !== verified.quantities.doors.estimated)
        || (basis.drawers !== 0 && basis.drawers !== verified.quantities.drawers.estimated)) throw new Error('The saved price does not match its AI-estimated quantities and scope.');
    }
    return { ...value, pricing, analysis: { ...verified, outcome: analysis.outcome } } as unknown as PublicAnalysisJob;
  }
  return value as unknown as PublicAnalysisJob;
}
export function parsePhotoWorkspace(value: unknown, expectedId: string): PhotoWorkspace {
  if (!isRecord(value) || !Array.isArray(value.photos) || !Array.isArray(value.jobs)) throw new Error('The photo workspace could not be loaded.');
  const request = parseLiveRequest(value.request);
  if (request.id !== expectedId) throw new Error('The saved photo workspace did not match this request.');
  const photos = value.photos.map(item => parsePhoto(item, expectedId)), jobs = value.jobs.map(item => parseJob(item, expectedId));
  const latest = value.latest === null ? null : parseJob(value.latest, expectedId);
  if (latest && !jobs.some(job => job.id === latest.id)) throw new Error('The latest analysis did not match the saved history.');
  return { request, photos, jobs, latest: latest ? jobs.find(job => job.id === latest.id)! : null };
}
export function validatePhotoFile(file: Pick<File, 'type' | 'size'>): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size < 1 || file.size > 10 * 1024 * 1024) throw new Error('Each photo must be between 1 byte and 10 MB.');
}
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
// Signed uploads must use HTTPS. A local test page served over plain HTTP may
// upload only to its own loopback origin; production pages are always HTTPS.
export function isAllowedPhotoUploadUrl(url: URL, page: Pick<Location, 'protocol' | 'hostname' | 'origin'>): boolean {
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && page.protocol === 'http:' && LOOPBACK_HOSTS.has(page.hostname) && url.origin === page.origin;
}
export function canRequestPhotoAnalysis(workspace: PhotoWorkspace): boolean {
  return workspace.request.status === 'draft' && Boolean(workspace.request.payload.service)
    && workspace.photos.some(photo => photo.state === 'ready') && !workspace.photos.some(photo => photo.state === 'uploading')
    && !workspace.jobs.some(job => !job.stale && ['queued', 'running'].includes(job.status));
}
export function photoAnalysisRequestBody(workspace: PhotoWorkspace, consent: boolean, coverage: { upperNotApplicable: boolean; damageNotPresent: boolean }, idempotencyKey: string): string {
  if (!consent) throw new Error('Agree to OpenAI photo analysis before requesting an assessment.');
  if (!canRequestPhotoAnalysis(workspace)) throw new Error('Save your service details and finish photo uploads before requesting an assessment.');
  return JSON.stringify({ expectedRevision: workspace.request.revision, idempotencyKey, aiConsent: true, aiConsentVersion: 'openai-photo-analysis-v1', coverage,
    ...(workspace.latest && ['failed', 'uncertain'].includes(workspace.latest.status) && !workspace.latest.stale ? { retryOf: workspace.latest.id } : {}) });
}
