import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DEMO_PRICE, DEMO_TERMS, DEMO_VERSION, type DemoSnapshot, type DemoSignature, type DemoSubmissionStatus } from '../domain/demo-submission.ts';
import type { QuoteDraft } from '../domain/quote-draft.ts';
import { validateStartDateSubmission } from '../domain/availability.ts';
import { quoteStorageClient, quoteSession, requireQuoteOrigin, QuoteHttpError, quoteJson } from './quote-draft-api.ts';
import { demoAvailability } from './demo-availability.ts';

type ReviewProof = { snapshot: DemoSnapshot; owner: string; calendarId: string; availabilityRevision: string; expires: number };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function demoEnabled(): boolean {
  try { return process.env.QUOTE_DEMO_ENABLED === 'true' && ['127.0.0.1','localhost','[::1]'].includes(new URL(process.env.APP_BASE_URL ?? '').hostname); }
  catch { return false; }
}
export function demoRecipient() {
  const recipient = process.env.QUOTE_DEMO_RECIPIENT_EMAIL?.trim().toLowerCase();
  if (recipient !== 'lnkgroupsydney@gmail.com') throw new QuoteHttpError(503,'The company demo recipient is not configured.');
  return recipient;
}
function requireDemo(req: Request, write = false) {
  if (!demoEnabled()) throw new QuoteHttpError(404,'This demo is not available.');
  if (write) requireQuoteOrigin(req);
  const session = quoteSession(req);
  if (!session) throw new QuoteHttpError(401,'Your private draft session expired. Reopen it before continuing.');
  return session;
}
async function safe(action: () => Promise<Response>) {
  try { return await action(); }
  catch (error) {
    return quoteJson({error:error instanceof QuoteHttpError ? error.message : 'This step is temporarily unavailable. Your saved details are safe; retry shortly.'},error instanceof QuoteHttpError ? error.status : 503);
  }
}
export async function submissionCommand<T>(command: string, args: Record<string,unknown>): Promise<T> {
  const { data,error } = await quoteStorageClient().rpc('lk_quote_submission',{command,args});
  if (error) {
    const statuses: Record<string,number> = {LK409:409,LK403:401,LK400:400,LK429:429};
    const messages: Record<string,string> = {LK409:'These details changed or were already submitted. Reload the saved request before continuing.',LK403:'Your private draft session expired.',LK400:'Check the submitted request.',LK429:'Too many requests. Please retry later.'};
    throw new QuoteHttpError(statuses[error.code] ?? 503,messages[error.code] ?? 'Submission storage is temporarily unavailable. Please retry.');
  }
  return data as T;
}
async function readDraft(owner: string): Promise<QuoteDraft> {
  const {data,error} = await quoteStorageClient().rpc('lk_quote_draft',{command:'read',args:{owner_hash:owner}});
  if (error || !data) throw new QuoteHttpError(409,'Save your contact and service details before continuing.');
  return data as QuoteDraft;
}
async function rateLimit(owner: string, purpose: string, max = 120) {
  const {error} = await quoteStorageClient().rpc('lk_operations_command',{command:'rate_limit',args:{bucket:`quote-demo:${purpose}:${owner}`,max,window:3600000}});
  if (error) throw new QuoteHttpError(error.code === 'LK429' ? 429 : 503,'This step is temporarily unavailable. Please retry later.');
}
async function input(req: Request): Promise<Record<string,unknown>> {
  if (!req.headers.get('content-type')?.startsWith('application/json')) throw new QuoteHttpError(415,'JSON required.');
  const reader = req.body?.getReader();
  if (!reader) throw new QuoteHttpError(400,'Request details are required.');
  const chunks: Uint8Array[] = []; let total=0;
  while (true) { const part=await reader.read(); if(part.done)break; total+=part.value.length;
    if(total>256000){await reader.cancel();throw new QuoteHttpError(413,'The signature is too large. Clear it and sign again.');} chunks.push(part.value); }
  try { const value:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8')); if(record(value))return value; } catch {}
  throw new QuoteHttpError(400,'Invalid request.');
}
function mac(value: string) {
  const key=process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new QuoteHttpError(503,'Private review is not configured.');
  return createHmac('sha256',Buffer.from(key,'hex')).update(`quote-demo-review-v1:${value}`).digest('hex');
}
function reviewKey() { return createHash('sha256').update(`quote-demo-review-encryption-v1:${process.env.GOOGLE_TOKEN_ENCRYPTION_KEY}`).digest(); }
function token(proof: ReviewProof) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',reviewKey(),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(proof),'utf8'),cipher.final()]);
  const value=Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');
  return `${value}.${mac(value)}`;
}
function verifyToken(value: unknown, owner: string): ReviewProof {
  if (typeof value !== 'string' || value.length>32000 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value)) throw new QuoteHttpError(400,'Review the current details before signing.');
  const [payload,signature] = value.split('.');
  if (!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(mac(payload),'hex'))) throw new QuoteHttpError(400,'Review the current details before signing.');
  let proof: ReviewProof;
  try {
    const bytes=Buffer.from(payload,'base64url'),decipher=createDecipheriv('aes-256-gcm',reviewKey(),bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    proof=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
  } catch { throw new QuoteHttpError(400,'Invalid review.'); }
  if(proof.owner!==owner || proof.snapshot?.mode!=='demo' || proof.snapshot.version!==DEMO_VERSION || !Number.isFinite(proof.expires)) throw new QuoteHttpError(403,'This review does not belong to your current draft.');
  return proof;
}
export function validateDemoSignature(value: unknown): DemoSignature {
  if (!record(value) || value.acknowledged !== true || typeof value.name !== 'string' || !value.name.trim() || value.name.length>120 || /[\u0000-\u001f\u007f]/.test(value.name) || !Array.isArray(value.strokes) || value.strokes.length<1 || value.strokes.length>100) throw new QuoteHttpError(400,'Enter your name, draw your signature and acknowledge the demo terms.');
  let count=0,minX=1,maxX=0,minY=1,maxY=0;
  const strokes = value.strokes.map(stroke => {
    if (!Array.isArray(stroke) || !stroke.length) throw new QuoteHttpError(400,'Draw a valid signature.');
    return stroke.map(point => {
      if (!record(point) || typeof point.x!=='number' || typeof point.y!=='number' || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x<0 || point.x>1 || point.y<0 || point.y>1 || ++count>2000) throw new QuoteHttpError(400,'Clear the signature and sign again.');
      minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
      return {x:point.x,y:point.y};
    });
  });
  if (count<4 || Math.max(maxX-minX,maxY-minY)<0.02) throw new QuoteHttpError(400,'Draw a complete signature before submitting.');
  return {name:value.name.trim(),strokes,acknowledged:true};
}
export const demoGet = (req: Request) => safe(async () => {
  if (!demoEnabled()) return quoteJson({enabled:false,recipientEmail:null,submission:null});
  const owner=requireDemo(req);
  return quoteJson({enabled:true,recipientEmail:demoRecipient(),submission:await submissionCommand('read',{owner_hash:owner.hash})});
});
export const availabilityGet = (req: Request) => safe(async () => {
  const owner=requireDemo(req);await rateLimit(owner.hash,'availability',180);
  return quoteJson((await demoAvailability(new URL(req.url).searchParams.get('month'))).public);
});
export const reviewPost = (req: Request) => safe(async () => {
  const owner=requireDemo(req,true);await rateLimit(owner.hash,'review',60);
  const body=await input(req),draft=await readDraft(owner.hash);
  if (draft.revision!==body.expectedRevision || !draft.payload.service) throw new QuoteHttpError(409,'Save and review the latest service details first.');
  if (draft.payload.contact.email.toLowerCase()!==demoRecipient()) throw new QuoteHttpError(400,`For this trial, save ${demoRecipient()} as the contact email. No other recipient will be emailed.`);
  if (typeof body.preferredDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.preferredDate)) throw new QuoteHttpError(400,'Choose a start date.');
  const started=new Date().toISOString(),availability=await demoAvailability(body.preferredDate.slice(0,7));
  const date=validateStartDateSubmission({date:body.preferredDate,selectedSnapshotRevision:String(body.availabilityRevision),freshSnapshot:availability.snapshot,validationStartedAt:started,now:new Date().toISOString()});
  if (!date.selectable) throw new QuoteHttpError(409,'Date availability changed or this date cannot be requested. Refresh the calendar and choose again.');
  const snapshot: DemoSnapshot = {mode:'demo',version:DEMO_VERSION,draftId:draft.id,draftRevision:draft.revision,payload:draft.payload,preferredDate:date.date,price:DEMO_PRICE,terms:DEMO_TERMS};
  return quoteJson({snapshot,reviewToken:token({snapshot,owner:owner.hash,calendarId:availability.calendarId,availabilityRevision:availability.snapshot.revision,expires:Date.now()+600000})});
});
export const submissionGet = (req: Request) => safe(async () => {
  const owner=requireDemo(req);return quoteJson({submission:await submissionCommand('read',{owner_hash:owner.hash})});
});
export const submitPost = (req: Request, schedule: (task:()=>Promise<void>)=>void) => safe(async () => {
  const owner=requireDemo(req,true);await rateLimit(owner.hash,'submit',30);
  const body=await input(req),proof=verifyToken(body.reviewToken,owner.hash),signature=validateDemoSignature(body.signature);
  if (typeof body.idempotencyKey!=='string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.idempotencyKey)) throw new QuoteHttpError(400,'A valid submission key is required.');
  const existing=await submissionCommand<DemoSubmissionStatus|null>('read',{owner_hash:owner.hash});
  if (!existing) {
    if (proof.expires<Date.now()) throw new QuoteHttpError(409,'Your review expired. Review the latest details and sign again.');
    if (proof.snapshot.payload.contact.email.toLowerCase()!==demoRecipient()) throw new QuoteHttpError(400,'The demo recipient changed. Review your details again.');
    const draft=await readDraft(owner.hash);
    if(draft.id!==proof.snapshot.draftId || draft.revision!==proof.snapshot.draftRevision || hash(draft.payload)!==hash(proof.snapshot.payload)) throw new QuoteHttpError(409,'Your saved details changed. Review and sign the current version.');
    const started=new Date().toISOString(),availability=await demoAvailability(proof.snapshot.preferredDate.slice(0,7));
    const date=validateStartDateSubmission({date:proof.snapshot.preferredDate,selectedSnapshotRevision:proof.availabilityRevision,freshSnapshot:availability.snapshot,validationStartedAt:started,now:new Date().toISOString()});
    if (!date.selectable || availability.calendarId!==proof.calendarId) throw new QuoteHttpError(409,'Date availability changed. Refresh the calendar, review and sign again.');
    await rateLimit('global','new-submission',20);
  }
  const id=randomUUID();
  const submission=await submissionCommand<DemoSubmissionStatus>('submit',{owner_hash:owner.hash,expected_revision:proof.snapshot.draftRevision,key:body.idempotencyKey,
    request_hash:hash({reviewToken:body.reviewToken,signature}),snapshot:proof.snapshot,snapshot_hash:hash(proof.snapshot),signature,calendar_id:proof.calendarId,id,reference:`DEMO-${id.slice(0,8).toUpperCase()}`});
  schedule(async () => {
    // The DB queue remains the source of truth if this request/process ends.
    try {
      const {runDemoDelivery}=await import('./demo-email.ts');
      await runDemoDelivery({id:submission.id,limit:1});
      const {syncQuoteCalendar}=await import('../../operations/quote-calendar.ts');
      await syncQuoteCalendar();
    } catch { /* Durable worker retries; never expose provider response data. */ }
  });
  return quoteJson({submission},202);
});
