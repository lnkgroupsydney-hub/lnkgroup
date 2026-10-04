import {createHash,randomUUID} from 'node:crypto';
import {quotePhotos,type PhotoRecord} from '../application/quote-photos.ts';
import {PhotoError,QUOTE_PHOTO_LIMITS,photoUuid,validatePhotoReservation,type QuotePhotoList,type QuotePhotoManifestEntry,type QuotePhotoMutation} from '../domain/quote-photos.ts';
import {quoteSession,quoteStorageClient,requireQuoteOrigin,quoteJson,QuoteHttpError} from './quote-draft-api.ts';
import {requireSession,AppError} from '../../operations/access.ts';
import {normalizeQuotePhoto} from './quote-photo-image.ts';
import {uploadPhotoObject,readPhotoObject,removePhotoObject} from './quote-photo-storage.ts';

export async function photoCommand<T>(command:string,args:Record<string,unknown>):Promise<T>{
 const{data,error}=await quoteStorageClient().rpc('lk_quote_photo',{command,args});
 if(error){
  const status:Record<string,number>={LK400:400,LK403:401,LK404:404,LK409:409,LK413:413,LK429:429};
  const message:Record<string,string>={LK400:'Check the selected photo and private photo notice.',LK403:'Your private draft session expired. Reopen your saved draft.',LK404:'Photo unavailable.',LK409:'Photo or draft details changed or are still processing. Reload saved photos and retry.',LK413:'Use up to 8 photos, 10 MB each and 80 MB in total.',LK429:'Photo processing is busy. Please retry shortly.'};
  throw new PhotoError(status[error.code]??503,'photo_storage',message[error.code]??'Private photo storage is temporarily unavailable. Keep the file and retry.');
 }
 return data as T;
}
const photos=quotePhotos({command:photoCommand,normalize:normalizeQuotePhoto,upload:uploadPhotoObject,read:readPhotoObject,remove:removePhotoObject,hash:bytes=>createHash('sha256').update(bytes).digest('hex'),workerId:randomUUID});
export async function readQuotePhotoManifest(ownerHash:string){try{return await photoCommand<{photos:QuotePhotoManifestEntry[];draftRevision:number}>('manifest',{owner_hash:ownerHash});}catch(error){if(error instanceof PhotoError)throw new QuoteHttpError(error.status,error.message);throw error;}}
export const recoverQuotePhotos=()=>photos.recover();
function owner(req:Request,write=false){if(write)requireQuoteOrigin(req);const session=quoteSession(req);if(!session)throw new QuoteHttpError(401,'Your private draft session expired. Reopen your saved draft.');return session.hash;}
function id(value:string){if(!photoUuid(value))throw new PhotoError(404,'photo_unavailable','Photo unavailable.');return value;}
async function safe(action:()=>Promise<Response>){try{return await action();}catch(error){if(error instanceof PhotoError||error instanceof QuoteHttpError||error instanceof AppError)return quoteJson({error:error.message,...(error instanceof PhotoError?{code:error.code}:{})},error.status);return quoteJson({error:'Private photo processing is temporarily unavailable. Refresh saved photos before retrying.'},503);}}
export async function receivePhotoBytes(req:Request,maxBytes:number):Promise<Uint8Array>{
 const length=req.headers.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw new PhotoError(413,'input_too_large','The photo exceeds the upload limit.');
 const reader=req.body?.getReader();if(!reader)throw new PhotoError(400,'invalid_image','Choose a photo first.');
 const chunks:Uint8Array[]=[];let total=0;let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  return await Promise.race([
   (async()=>{while(true){const next=await reader.read();if(next.done)break;total+=next.value.length;if(total>maxBytes){void reader.cancel().catch(()=>{});throw new PhotoError(413,'input_too_large','The photo exceeds the upload limit.');}chunks.push(next.value);}return new Uint8Array(Buffer.concat(chunks,total));})(),
   new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new PhotoError(408,'upload_interrupted','The upload took too long. Refresh its status and retry.'));},20_000);}),
  ]);
 }finally{if(timer)clearTimeout(timer);}
}
async function input(req:Request){if(!req.headers.get('content-type')?.startsWith('application/json'))throw new PhotoError(415,'invalid_request','JSON required.');try{return JSON.parse(Buffer.from(await receivePhotoBytes(req,4096)).toString('utf8')) as unknown;}catch(error){if(error instanceof PhotoError)throw error;throw new PhotoError(400,'invalid_request','Invalid photo request.');}}
async function rateLimit(ownerHash:string,purpose:string,max=100){const{error}=await quoteStorageClient().rpc('lk_operations_command',{command:'rate_limit',args:{bucket:`quote-photos:${purpose}:${ownerHash}`,max,window:3600000}});if(error)throw new PhotoError(error.code==='LK429'?429:503,'photo_rate_limit','Please retry the photo step later.');}
export const photosGet=(req:Request)=>safe(async()=>{const h=owner(req);await rateLimit(h,'read',240);return quoteJson(await photoCommand<QuotePhotoList>('list',{owner_hash:h}));});
export const photosPost=(req:Request)=>safe(async()=>{
 const h=owner(req,true);await rateLimit(h,'reserve',80);const body=validatePhotoReservation(await input(req));
 const result=await photoCommand<QuotePhotoMutation>('reserve',{owner_hash:h,id:randomUUID(),key:body.idempotencyKey,source_hash:body.sourceHash,input_bytes:body.inputBytes,source_mime:body.mimeType,notice_version:body.noticeVersion,notice_accepted:body.noticeAccepted,expected_revision:body.expectedRevision});
 return quoteJson(result,201);
});
let activeUploads=0;
export const photoContentPut=(req:Request,photoId:string)=>safe(async()=>{
 const h=owner(req,true);photoId=id(photoId);await rateLimit(h,'upload',80);
 if(activeUploads>=2)throw new PhotoError(429,'photo_busy','Photo processing is busy. Please retry shortly.');
 activeUploads++;
 try{return quoteJson(await photos.upload(h,photoId,()=>receivePhotoBytes(req,QUOTE_PHOTO_LIMITS.maxInputBytes)));}finally{activeUploads--;}
});
export const photoDelete=(req:Request,photoId:string)=>safe(async()=>{
 const h=owner(req,true);photoId=id(photoId);await rateLimit(h,'delete',80);const body=await input(req);
 if(!body||typeof body!=='object'||!('expectedRevision'in body)||!Number.isSafeInteger(body.expectedRevision)||(body.expectedRevision as number)<1)throw new PhotoError(400,'invalid_request','Reload the latest saved photos before deleting.');
 const result=await photoCommand<QuotePhotoMutation>('delete',{owner_hash:h,id:photoId,expected_revision:body.expectedRevision});
 // The database records removal before touching Storage. If it fails, worker
 // retries keep it inaccessible and prevent an unfinished state being signed.
 if(result.photo.status==='delete_pending'){await photos.recover([photoId]);const list=await photoCommand<QuotePhotoList>('list',{owner_hash:h});const current=list.photos.find(photo=>photo.id===photoId);return quoteJson({photo:current??{...result.photo,status:'deleted'},draftRevision:list.draftRevision},current?202:200);}
 return quoteJson(result);
});
async function imageResponse(record:PhotoRecord){const bytes=await photos.content(record);return new Response(new Uint8Array(bytes),{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','vary':'Cookie','x-content-type-options':'nosniff','content-disposition':'inline; filename="private-project-photo.jpg"'}});}
export const photoContentGet=(req:Request,photoId:string)=>safe(async()=>{const h=owner(req);await rateLimit(h,'preview',240);return imageResponse(await photoCommand<PhotoRecord>('content',{owner_hash:h,id:id(photoId)}));});
export const adminPhotoGet=(req:Request,submissionId:string,photoId:string)=>safe(async()=>{const session=await requireSession(req);await rateLimit(session.token_hash,'admin-preview',240);return imageResponse(await photoCommand<PhotoRecord>('admin_content',{submission_id:id(submissionId),id:id(photoId)}));});
