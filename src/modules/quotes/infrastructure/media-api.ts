import { AdminAccessError } from '../../admin-access/index.ts'
import { QuoteRequestError, type QuoteRequestActor, type QuoteRequestOwner } from '../domain/contracts.ts'
import { requestId, validateReviewRequest } from '../domain/validation.ts'
import { LIVE_PHOTO_LIMITS, LIVE_PHOTO_ROLES, type InternalPhoto, type InternalPhotoWorkspace } from '../domain/photo-workspace.ts'
import { AI_CONSENT_VERSION, PHOTO_ANALYSIS_MODEL, PHOTO_ANALYSIS_PROMPT_VERSION, PHOTO_ANALYSIS_SCHEMA_VERSION } from '../domain/analysis.ts'
import { QUOTE_PRICING_VERSION } from '../domain/pricing.ts'
import type { QuoteRequestStore } from '../application/requests.ts'
import { publicPhoto, publicWorkspace, type PhotoObjectPort } from '../application/photo-media.ts'
import { quoteRequestAccess } from './api.ts'
import { quoteMediaStore } from './media-store.ts'
import { quotePhotoObjects } from './photo-objects.ts'
import { runQuoteAnalysis } from './analysis-runner.ts'
interface Access {
  readOwner(req: Request): QuoteRequestOwner | Promise<QuoteRequestOwner>
  writeOwner(req: Request): QuoteRequestOwner | Promise<QuoteRequestOwner>
  staff(req: Request): Promise<QuoteRequestActor>
  input(req: Request): Promise<unknown>
}
function json(value: unknown, status = 200) { return Response.json(value, {status,headers:{'cache-control':'private, no-store',vary:'Cookie','x-content-type-options':'nosniff'}}) }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QuoteRequestError(400, 'Photo details are required.')
  return value as Record<string, unknown>
}
export function createQuoteMediaApi(deps: { access: Access; store: QuoteRequestStore; objects: PhotoObjectPort; run(jobId: string): Promise<void>; aiReady(): boolean }) {
  const ownerArgs = (owner: QuoteRequestOwner) => ({ companyId:'lk-group', ownerHash:owner.hash, expiresAt:owner.expiresAt, ...(owner.expectedRequestId ? { expectedRequestId: owner.expectedRequestId } : {}), ...(owner.customer ? { customerAccess: owner.customer } : {}) })
  const safe = (handler: (req: Request, id?: string, photoId?: string) => Promise<Response>) => async (req: Request, id?: string, photoId?: string) => {
    try { return await handler(req, id, photoId) }
    catch (error) {
      if (error instanceof QuoteRequestError || error instanceof AdminAccessError) return json({ error:error.message }, error.status)
      return json({error:'The photo request could not be confirmed. Your saved information is retained; refresh or retry.'},503)
    }
  }
  async function workspace(args: Record<string, unknown>, staff = false) {
    return publicWorkspace(await deps.store.command<InternalPhotoWorkspace>(staff?'staff_workspace':'workspace',args),staff)
  }
  async function staffArgs(req: Request, id: unknown) {
    const actor = await deps.access.staff(req)
    if (actor.companyId !== 'lk-group') throw new QuoteRequestError(403,'Company access denied.')
    return {companyId:actor.companyId,actorUserId:actor.userId,actorSessionId:actor.sessionId,id:requestId(id)}
  }
  async function content(photo: InternalPhoto) {
    if (photo.state !== 'ready' || !photo.contentHash) throw new QuoteRequestError(404,'This photo is not available.')
    const bytes = await deps.objects.read({objectPath:photo.objectPath,contentHash:photo.contentHash})
    return new Response(new Uint8Array(bytes),{headers:{'content-type':'image/jpeg','content-length':String(bytes.length),'cache-control':'private, no-store',vary:'Cookie','x-content-type-options':'nosniff','content-disposition':'inline; filename="cabinet-photo.jpg"'}})
  }
  return {
    workspace: safe(async req => json(await workspace(ownerArgs(await deps.access.readOwner(req))))),
    begin: safe(async req => {
      const owner = await deps.access.writeOwner(req), input=record(await deps.access.input(req)), command=validateReviewRequest(input)
      if (!LIVE_PHOTO_ROLES.includes(input.role as typeof LIVE_PHOTO_ROLES[number]) || !['image/jpeg','image/png','image/webp'].includes(String(input.mimeType))) throw new QuoteRequestError(400,'Choose a photo role and a JPEG, PNG or static WebP image.')
      if (!Number.isSafeInteger(input.sizeBytes) || Number(input.sizeBytes)<1 || Number(input.sizeBytes)>LIVE_PHOTO_LIMITS.maxInputBytes) throw new QuoteRequestError(413,'Each photo must be no larger than 10 MB.')
      if (typeof input.sourceHash!=='string' || !/^[a-f0-9]{64}$/.test(input.sourceHash)) throw new QuoteRequestError(400,'Choose the original file again.')
      const photo=await deps.store.command<InternalPhoto>('photo_begin',{...ownerArgs(owner),...command,role:input.role,mimeType:input.mimeType,sizeBytes:input.sizeBytes,sourceHash:input.sourceHash})
      const upload=await deps.objects.signUpload(photo)
      return json({photo:publicPhoto(photo),upload})
    }),
    finalize: safe(async (req,id) => {
      const args=ownerArgs(await deps.access.writeOwner(req)),command=validateReviewRequest(await deps.access.input(req)),photoId=requestId(id)
      const photo=await deps.store.command<InternalPhoto>('photo_lookup',{...args,photoId})
      if (photo.state==='deleted') throw new QuoteRequestError(409,'This photo has been removed.')
      const info=await deps.objects.normalize(photo)
      const result=await deps.store.command<InternalPhotoWorkspace>('photo_finalize',{...args,...command,photoId,...info})
      // Staging is also swept after signed-upload tokens expire by the durable runner.
      await deps.objects.discardStaging(photo).catch(()=>undefined)
      return json(publicWorkspace(result))
    }),
    remove: safe(async (req,id) => {
      const args=ownerArgs(await deps.access.writeOwner(req)),command=validateReviewRequest(await deps.access.input(req))
      return json(publicWorkspace(await deps.store.command<InternalPhotoWorkspace>('photo_remove',{...args,...command,photoId:requestId(id)})))
    }),
    reopen: safe(async req => {
      const args=ownerArgs(await deps.access.writeOwner(req)),command=validateReviewRequest(await deps.access.input(req))
      return json(publicWorkspace(await deps.store.command<InternalPhotoWorkspace>('reopen',{...args,...command})))
    }),
    start: safe(async req => {
      const args=ownerArgs(await deps.access.writeOwner(req)), input=record(await deps.access.input(req)),command=validateReviewRequest(input)
      if (!deps.aiReady()) throw new QuoteRequestError(503,'Photo AI analysis is not configured yet. Your photos remain saved.')
      if (input.aiConsentVersion!==AI_CONSENT_VERSION || input.aiConsent!==true) throw new QuoteRequestError(400,'Confirm permission to send your photos to OpenAI for cabinet analysis.')
      const coverage=record(input.coverage)
      if (typeof coverage.upperNotApplicable!=='boolean' || typeof coverage.damageNotPresent!=='boolean') throw new QuoteRequestError(400,'Confirm which cabinet areas apply.')
      let retryOf=input.retryOf==null ? null : requestId(input.retryOf)
      if (retryOf) {
        const current=await deps.store.command<InternalPhotoWorkspace>('workspace',args)
        // Inspect the referenced historical job, not latest: an exact response-loss
        // replay still refers to the old failed job after the new job was created.
        const previous=current.jobs.find(job=>job.id===retryOf)
        if (!previous) throw new QuoteRequestError(404,'Analysis request not found.')
        if (previous.stale || previous.inputRevision!==current.request.revision || previous.inputRevision!==command.expectedRevision) throw new QuoteRequestError(409,'The saved details or photos changed. Request a new analysis instead.')
        if (!['failed','uncertain'].includes(previous.status)) throw new QuoteRequestError(409,'Only a failed or uncertain analysis can be explicitly retried.')
        const versions=record(previous.inputSnapshot)
        // An explicit retry after an execution-contract update starts a new job;
        // historical results and exact response-loss receipts stay immutable.
        if (versions.model!==PHOTO_ANALYSIS_MODEL || versions.promptVersion!==PHOTO_ANALYSIS_PROMPT_VERSION || versions.schemaVersion!==PHOTO_ANALYSIS_SCHEMA_VERSION || versions.pricingVersion!==QUOTE_PRICING_VERSION) retryOf=null
      }
      const result=await deps.store.command<InternalPhotoWorkspace>('analysis_start',{...args,...command,aiConsentVersion:AI_CONSENT_VERSION,model:PHOTO_ANALYSIS_MODEL,promptVersion:PHOTO_ANALYSIS_PROMPT_VERSION,schemaVersion:PHOTO_ANALYSIS_SCHEMA_VERSION,pricingVersion:QUOTE_PRICING_VERSION,coverage:{upperNotApplicable:coverage.upperNotApplicable,damageNotPresent:coverage.damageNotPresent},retryOf})
      return json(publicWorkspace(result))
    }),
    process: safe(async (req,id) => {
      const args=ownerArgs(await deps.access.writeOwner(req)),jobId=requestId(id)
      const before=await deps.store.command<InternalPhotoWorkspace>('workspace',args)
      if (!before.jobs.some(job=>job.id===jobId)) throw new QuoteRequestError(404,'Analysis request not found.')
      // Await the durable leased job; never detach a promise after returning HTTP.
      await deps.run(jobId)
      return json(await workspace(args))
    }),
    content: safe(async (req,id) => content(await deps.store.command<InternalPhoto>('photo_lookup',{...ownerArgs(await deps.access.readOwner(req)),photoId:requestId(id)}))),
    staffWorkspace: safe(async (req,id) => json(await workspace(await staffArgs(req,id),true))),
    staffContent: safe(async (req,id,photoId) => content(await deps.store.command<InternalPhoto>('staff_photo',{...await staffArgs(req,id),photoId:requestId(photoId)}))),
  }
}
const api=createQuoteMediaApi({access:quoteRequestAccess,store:quoteMediaStore,objects:quotePhotoObjects,run:runQuoteAnalysis,aiReady:()=>Boolean(process.env.OPENAI_API_KEY?.trim() || process.env.OPEN_AI_API_KEY?.trim())})
export const livePhotoWorkspaceGet=api.workspace,livePhotoBeginPost=api.begin,livePhotoFinalizePost=api.finalize,livePhotoDelete=api.remove,livePhotoContentGet=api.content,liveAnalysisPost=api.start,liveAnalysisProcessPost=api.process,liveRequestReopenPost=api.reopen,adminAnalysisGet=api.staffWorkspace,adminLivePhotoGet=api.staffContent
