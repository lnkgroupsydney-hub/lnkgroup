import type { LiveQuoteRequest, ServiceDetails } from './contracts.ts'
import type { PhotoAnalysis, AnalysisUsage } from './analysis.ts'
import type { EstimatePricing } from './pricing.ts'
export const LIVE_PHOTO_ROLES = ['overview', 'upper', 'lower', 'side', 'damage'] as const
export type LivePhotoRole = typeof LIVE_PHOTO_ROLES[number]
export const LIVE_PHOTO_LIMITS = { maxFiles: 8, maxInputBytes: 10 * 1024 * 1024, maxStoredBytes: 3 * 1024 * 1024, maxDimension: 2048 } as const
export interface PublicPhoto {
  id: string; requestId: string; role: LivePhotoRole; state: 'uploading' | 'ready' | 'deleted'
  mimeType: string; sizeBytes: number; storedBytes: number | null; contentHash: string | null
  width: number | null; height: number | null; createdAt: string; expiresAt: string; contentUrl: string | null
}
export interface InternalPhoto extends Omit<PublicPhoto, 'contentUrl'> { stagingPath: string; objectPath: string; sourceHash: string }
export interface AnalysisCoverage { upperNotApplicable: boolean; damageNotPresent: boolean }
export interface PublicAnalysisJob {
  id: string; requestId: string; inputRevision: number; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'uncertain'
  stale: boolean; createdAt: string; completedAt: string | null; analysis: PhotoAnalysis | null; pricing: EstimatePricing | null
  usage: AnalysisUsage | null; error: string | null; attempts: number
}
export interface InternalAnalysisJob extends PublicAnalysisJob {
  inputSnapshot: { service: ServiceDetails; coverage: AnalysisCoverage }
  manifest: Array<{ id: string; role: LivePhotoRole; contentHash: string; objectPath: string }>
  leaseToken: string | null; providerResponseId: string | null
}
export interface PhotoWorkspace { request: LiveQuoteRequest; photos: PublicPhoto[]; jobs: PublicAnalysisJob[]; latest: PublicAnalysisJob | null }
export interface InternalPhotoWorkspace { request: LiveQuoteRequest; photos: InternalPhoto[]; jobs: InternalAnalysisJob[]; latest: InternalAnalysisJob | null }
