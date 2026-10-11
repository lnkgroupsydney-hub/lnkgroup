import { createHash, randomUUID } from 'node:crypto'
import type { QuoteRequestStore } from './requests.ts'
import type { InternalAnalysisJob, InternalPhoto, InternalPhotoWorkspace, PhotoWorkspace, PublicPhoto, PublicAnalysisJob } from '../domain/photo-workspace.ts'
import type { PhotoAnalysis, AnalysisUsage, AnalysisCoverage } from '../domain/analysis.ts'
import type { ServiceDetails } from '../domain/contracts.ts'
import { QuoteRequestError } from '../domain/contracts.ts'
import { calculateEstimatePricing, pendingCompanyPricing, validateEstimatePricing, QUOTE_PRICING_VERSION } from '../domain/pricing.ts'

export interface PhotoObjectPort {
  signUpload(photo: InternalPhoto): Promise<{ signedUrl: string; token: string; path: string }>
  normalize(photo: InternalPhoto): Promise<{ contentHash: string; width: number; height: number; storedBytes: number }>
  read(photo: { objectPath: string; contentHash: string }): Promise<Uint8Array>
  discardStaging(photo: InternalPhoto): Promise<void>
}
export interface CabinetPhotoAnalyzer {
  (input: { photos: { id: string; role: InternalPhoto['role']; dataUrl: string }[]; service: ServiceDetails; coverage: AnalysisCoverage }): Promise<{ analysis: PhotoAnalysis; usage: AnalysisUsage | null; providerResponseId: string | null }>
}
export function publicPhoto(photo: InternalPhoto, staff = false): PublicPhoto {
  return { id: photo.id, requestId: photo.requestId, role: photo.role, state: photo.state, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes, storedBytes: photo.storedBytes, contentHash: photo.contentHash, width: photo.width, height: photo.height, createdAt: photo.createdAt, expiresAt: photo.expiresAt,
    contentUrl: photo.state === 'ready' ? staff ? `/api/admin/quote-requests/${photo.requestId}/photos/${photo.id}` : `/api/quote/requests/photos/${photo.id}/content` : null }
}
function publicJob(job: InternalAnalysisJob): PublicAnalysisJob {
  return { id: job.id, requestId: job.requestId, inputRevision: job.inputRevision, status: job.status, stale: job.stale, createdAt: job.createdAt, completedAt: job.completedAt, analysis: job.analysis, pricing: job.pricing ? validateEstimatePricing(job.pricing) : null, usage: job.usage, error: job.error, attempts: job.attempts }
}
export function publicWorkspace(workspace: InternalPhotoWorkspace, staff = false): PhotoWorkspace {
  return { request: workspace.request, photos: workspace.photos.filter(p => p.state !== 'deleted').map(p => publicPhoto(p, staff)), jobs: workspace.jobs.map(publicJob), latest: workspace.latest ? publicJob(workspace.latest) : null }
}
export interface AnalysisFailure { status: 'failed' | 'uncertain'; message: string; providerResponseId?: string; usage?: AnalysisUsage }
export function createAnalysisRunner(deps: { store: QuoteRequestStore; objects: PhotoObjectPort; analyze: CabinetPhotoAnalyzer; classify: (error: unknown) => AnalysisFailure | null }) {
  return async function run(jobId: string) {
    const leaseToken = randomUUID()
    const job = await deps.store.command<InternalAnalysisJob | null>('analysis_claim', { companyId: 'lk-group', jobId, leaseToken })
    if (!job) return
    let result: Awaited<ReturnType<CabinetPhotoAnalyzer>>
    try {
      let timer: ReturnType<typeof setTimeout> | undefined
      const prepare = Promise.all(job.manifest.map(async photo => {
        const bytes = await deps.objects.read(photo)
        // Check immutable bytes again at the AI boundary, including fake storage adapters.
        if (createHash('sha256').update(bytes).digest('hex') !== photo.contentHash) throw new QuoteRequestError(409, 'A saved photo could not be verified. Upload it again before analysis.')
        return { id: photo.id, role: photo.role, dataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}` }
      }))
      const photos = await Promise.race([prepare, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Photo preparation timed out')), 30000) })]).finally(() => clearTimeout(timer))
      result = await deps.analyze({ photos, service: job.inputSnapshot.service, coverage: job.inputSnapshot.coverage })
      if (!result.usage || !result.providerResponseId) {
        await deps.store.command('analysis_fail', { companyId: 'lk-group', jobId, leaseToken, status: 'failed', error: 'The provider result did not include verifiable usage metadata. Request company review or explicitly retry.', usage: result.usage, providerResponseId: result.providerResponseId })
        return
      }
    } catch (error) {
      const known = deps.classify(error)
      await deps.store.command('analysis_fail', { companyId: 'lk-group', jobId, leaseToken, status: known?.status ?? 'failed', error: known?.message ?? 'A saved photo could not be analysed safely. Review the photos and retry.', providerResponseId: known?.providerResponseId ?? null, usage: known?.usage ?? null })
      return
    }
    // A failed database commit must never trigger another paid provider call. Keep
    // the lease until expiry; retry only this exact immutable completion once.
    const completed = { companyId: 'lk-group', jobId, leaseToken, analysis: result.analysis, pricing: job.inputSnapshot && 'pricingVersion' in job.inputSnapshot && job.inputSnapshot.pricingVersion === QUOTE_PRICING_VERSION ? calculateEstimatePricing(result.analysis, job.inputSnapshot.service) : pendingCompanyPricing(), usage: result.usage, providerResponseId: result.providerResponseId }
    try { await deps.store.command('analysis_finish', completed) }
    catch { await deps.store.command('analysis_finish', completed) }
  }
}
