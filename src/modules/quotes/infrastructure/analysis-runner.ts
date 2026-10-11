import { createAnalysisRunner } from '../application/photo-media.ts'
import { analyzeCabinetPhotos, PhotoAnalysisError } from './openai-photo-analyzer.ts'
import { quoteMediaStore } from './media-store.ts'
import { quotePhotoObjects } from './photo-objects.ts'
import type { InternalAnalysisJob, InternalPhoto } from '../domain/photo-workspace.ts'
export const runQuoteAnalysis=createAnalysisRunner({store:quoteMediaStore,objects:quotePhotoObjects,analyze:analyzeCabinetPhotos,classify:error=>error instanceof PhotoAnalysisError?{status:error.status,message:error.message,providerResponseId:error.providerResponseId??undefined,usage:error.usage??undefined}:null})
export async function runPendingQuoteAnalyses() {
  const jobs=await quoteMediaStore.command<InternalAnalysisJob[]>('queued_jobs',{companyId:'lk-group',limit:2})
  for (const job of jobs) await runQuoteAnalysis(job.id)
  const photos=await quoteMediaStore.command<InternalPhoto[]>('staging_cleanup',{companyId:'lk-group',limit:25})
  for (const photo of photos) {
    await quotePhotoObjects.discardStaging(photo)
    await quoteMediaStore.command('staging_cleaned',{companyId:'lk-group',photoId:photo.id})
  }
  return { examined:jobs.length,stagingCleaned:photos.length }
}
