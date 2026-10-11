import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { normalizeQuotePhoto, PhotoError } from '../../enquiries/photo-processing.ts'
import type { PhotoObjectPort } from '../application/photo-media.ts'
import type { InternalPhoto } from '../domain/photo-workspace.ts'
import { LIVE_PHOTO_LIMITS } from '../domain/photo-workspace.ts'
import { QuoteRequestError } from '../domain/contracts.ts'
import { privateQuoteClient } from './media-store.ts'
export const LIVE_STAGING_BUCKET = 'live-quote-staging', LIVE_PHOTO_BUCKET = 'live-quote-photos'
async function bucket(name: string) {
  const client = privateQuoteClient(), { data, error } = await client.storage.getBucket(name)
  if (error || !data || data.public) throw new QuoteRequestError(503, 'Private photo storage is not ready. Keep your photos and retry.')
  return client.storage.from(name)
}
function checkPath(path: string, staging = false) {
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
  if (!new RegExp(`^live/${uuid}/${uuid}/${staging ? 'original' : 'normalized\\.jpg'}$`).test(path)) throw new QuoteRequestError(503, 'The saved photo location could not be verified.')
}
async function download(name: string, path: string, max: number) {
  const storage = await bucket(name), { data, error } = await storage.download(path)
  if (error || !data) throw new QuoteRequestError(503, 'The photo upload could not be read. Finish uploading or retry.')
  if (data.size < 1 || data.size > max) throw new QuoteRequestError(413, 'The photo exceeds the permitted size.')
  return new Uint8Array(await data.arrayBuffer())
}
export async function normalizeLivePhoto(bytes: Uint8Array, mimeType: string) {
  try {
    const normalized = await normalizeQuotePhoto(bytes, mimeType)
    const { data, info } = await sharp(normalized.bytes).resize({ width: LIVE_PHOTO_LIMITS.maxDimension, height: LIVE_PHOTO_LIMITS.maxDimension, fit: 'inside', withoutEnlargement: true }).jpeg({quality:85,mozjpeg:true}).toBuffer({resolveWithObject:true})
    if (data.length > LIVE_PHOTO_LIMITS.maxStoredBytes) throw new QuoteRequestError(413, 'The processed photo is too large. Resize it and upload again.')
    return { bytes: data, contentHash: createHash('sha256').update(data).digest('hex'), width: info.width, height: info.height }
  } catch (error) { if (error instanceof PhotoError) throw new QuoteRequestError(error.status, error.message); throw error }
}
export const quotePhotoObjects: PhotoObjectPort = {
  async signUpload(photo: InternalPhoto) {
    checkPath(photo.stagingPath, true)
    const storage = await bucket(LIVE_STAGING_BUCKET), { data, error } = await storage.createSignedUploadUrl(photo.stagingPath, { upsert: false })
    if (error || !data) throw new QuoteRequestError(503, 'Could not open a private photo upload. Retry the same upload.')
    return data
  },
  async normalize(photo) {
    checkPath(photo.stagingPath, true); checkPath(photo.objectPath)
    // Completion response-loss retries use the same immutable normalized bytes,
    // even after the original staging file has been removed.
    if (photo.state === 'ready' && photo.contentHash) {
      const bytes = await this.read({ objectPath: photo.objectPath, contentHash: photo.contentHash })
      return { contentHash: photo.contentHash, width: photo.width!, height: photo.height!, storedBytes: bytes.length }
    }
    const original = await download(LIVE_STAGING_BUCKET, photo.stagingPath, LIVE_PHOTO_LIMITS.maxInputBytes)
    if (original.length !== photo.sizeBytes || createHash('sha256').update(original).digest('hex') !== photo.sourceHash) throw new QuoteRequestError(409, 'The uploaded photo did not match the selected file. Remove it and choose the file again.')
    const image = await normalizeLivePhoto(original, photo.mimeType)
    const storage = await bucket(LIVE_PHOTO_BUCKET), { error } = await storage.upload(photo.objectPath, image.bytes, { contentType: 'image/jpeg', cacheControl: '0', upsert: false })
    if (error) await this.read({ objectPath: photo.objectPath, contentHash: image.contentHash })
    return { contentHash: image.contentHash, width: image.width, height: image.height, storedBytes: image.bytes.length }
  },
  async read(photo) {
    checkPath(photo.objectPath)
    const bytes = await download(LIVE_PHOTO_BUCKET, photo.objectPath, LIVE_PHOTO_LIMITS.maxStoredBytes)
    if (createHash('sha256').update(bytes).digest('hex') !== photo.contentHash) throw new QuoteRequestError(409, 'This saved photo could not be verified. Contact the company for review.')
    return bytes
  },
  async discardStaging(photo) {
    checkPath(photo.stagingPath, true)
    const storage = await bucket(LIVE_STAGING_BUCKET), { error } = await storage.remove([photo.stagingPath])
    if (error) throw new QuoteRequestError(503, 'Photo staging cleanup will be retried.')
  },
}
