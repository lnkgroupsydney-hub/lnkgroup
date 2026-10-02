import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { quoteDrafts, type QuoteDraftRepository } from '../application/quote-drafts.ts';
import { DraftValidationError, type QuoteDraft } from '../domain/quote-draft.ts';

const COOKIE = 'lk_quote_draft';
const TTL = 24 * 60 * 60;
class DraftHttpError extends Error { status: number; constructor(status: number, message: string) {super(message);this.status=status;} }
const json = (value: unknown, status=200) => Response.json(value,{status,headers:{'cache-control':'private, no-store','vary':'Cookie'}});
function client() {
  if (process.env.OPERATIONS_STORE !== 'supabase' || !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new DraftHttpError(503,'Private draft storage is not available yet. Your entries have not been saved.');
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,cache:'no-store',signal:AbortSignal.timeout(20000)})}});
}
function signature(value: string) {
  const key=process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new DraftHttpError(503,'Private draft sessions are not configured.');
  return createHmac('sha256',Buffer.from(key,'hex')).update(`quote-draft-session-v1:${value}`).digest('hex');
}
function session(req: Request) {
  const value=req.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  if (!value || !/^\d{10}\.[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) return null;
  const [expiry,nonce,mac]=value.split('.');
  if (Number(expiry)<=Date.now()/1000 || Number(expiry)>Date.now()/1000+TTL+60) return null;
  if (!timingSafeEqual(Buffer.from(mac,'hex'),Buffer.from(signature(`${expiry}.${nonce}`),'hex'))) return null;
  return {hash:createHash('sha256').update(value).digest('hex'), expiresAt:new Date(Number(expiry)*1000).toISOString()};
}
function requireOrigin(req: Request) {
  const base=process.env.APP_BASE_URL;
  if (!base || req.headers.get('origin')!==new URL(base).origin || req.headers.get('sec-fetch-site')==='cross-site') throw new DraftHttpError(403,'Same-origin request required.');
}
async function rpc<T>(command: string,args: Record<string,unknown>): Promise<T> {
  const {data,error}=await client().rpc('lk_quote_draft',{command,args});
  if(error) {
    if(error.code==='LK409') throw new DraftHttpError(409,'This draft changed in another tab. Reload saved details before editing again.');
    if(error.code==='LK403') throw new DraftHttpError(401,'Your private draft session expired. Start a new draft.');
    if(error.code==='LK429') throw new DraftHttpError(429,'Too many draft requests. Keep your entries and retry later.');
    if(error.code==='LK400') throw new DraftHttpError(400,'Invalid draft request.');
    throw new DraftHttpError(503,'Private draft storage is not ready. Your entries have not been saved. Please retry later.');
  }
  return data as T;
}
const repository: QuoteDraftRepository = {
  read: ownerHash=>rpc<QuoteDraft|null>('read',{owner_hash:ownerHash}),
  save: (ownerHash,expiresAt,revision,payload)=>rpc<QuoteDraft>('save',{owner_hash:ownerHash,expires_at:expiresAt,revision,payload,payload_hash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')}),
};
const drafts=quoteDrafts(repository);
// Shared only by this module's server handlers; never exported to client components.
export { client as quoteStorageClient, session as quoteSession, requireOrigin as requireQuoteOrigin, DraftHttpError as QuoteHttpError, json as quoteJson };
async function guard(action:()=>Promise<Response>) {
  try {return await action();} catch(error) {
    if(error instanceof DraftValidationError) return json({error:error.message},400);
    if(error instanceof DraftHttpError) return json({error:error.message},error.status);
    return json({error:'Draft storage is temporarily unavailable. Keep this page open and retry.'},503);
  }
}
export const draftSessionPost = (req: Request) => guard(async()=>{
  requireOrigin(req);
  if(session(req)) return json({ready:true});
  const response=json({ready:true});
  const value=`${Math.floor(Date.now()/1000)+TTL}.${randomBytes(32).toString('hex')}`;
  response.headers.set('set-cookie',`${COOKIE}=${value}.${signature(value)}; Path=/api/quote; HttpOnly; SameSite=Lax; Max-Age=${TTL}${new URL(process.env.APP_BASE_URL!).protocol==='https:'?'; Secure':''}`);
  return response;
});
export const draftGet = (req: Request) => guard(async()=>{
  const owner=session(req);
  if(!owner) return json({draft:null});
  return json({draft:await drafts.read(owner.hash)});
});
export const draftPut = (req: Request) => guard(async()=>{
  requireOrigin(req);
  const owner=session(req);
  if(!owner) throw new DraftHttpError(401,'Your draft session expired. Reload to start a new draft.');
  if(!req.headers.get('content-type')?.startsWith('application/json')) throw new DraftHttpError(415,'JSON required.');
  if(Number(req.headers.get('content-length')||0)>16000) throw new DraftHttpError(413,'Draft is too large.');
  const reader=req.body?.getReader(); if(!reader) throw new DraftHttpError(400,'Draft details required.');
  const chunks:Uint8Array[]=[]; let total=0;
  while(true) {const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>16000){await reader.cancel();throw new DraftHttpError(413,'Draft is too large.');}chunks.push(part.value);}
  let input:Record<string,unknown>;
  try {input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new DraftHttpError(400,'Invalid draft request.');}
  if(!input || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number)<0 || (input.expectedRevision as number)>2147483647) throw new DraftHttpError(400,'Invalid draft revision.');
  const limit=await client().rpc('lk_operations_command',{command:'rate_limit',args:{bucket:`draft:${owner.hash}`,max:120,window:3600000}});
  if(limit.error) throw new DraftHttpError(limit.error.code==='LK429'?429:503,'Draft saving is temporarily unavailable. Please retry later.');
  return json({draft:await drafts.save(owner.hash,owner.expiresAt,input.expectedRevision as number,input.payload)});
});
