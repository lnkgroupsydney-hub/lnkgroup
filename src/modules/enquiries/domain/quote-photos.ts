export const PHOTO_NOTICE_VERSION = 'quote-photo-notice-v1';
export const PHOTO_PROCESSING_VERSION = 'quote-photo-jpeg-v1';
export const QUOTE_PHOTO_LIMITS = Object.freeze({ maxFiles:8, maxInputBytes:10*1024*1024, maxTotalInputBytes:80*1024*1024, maxPixels:50_000_000, maxDimension:4096, maxStoredBytes:6*1024*1024 });
export type QuotePhotoStatus = 'pending'|'processing'|'attached'|'rejected'|'retryable_error'|'delete_pending'|'deleted';
export type QuotePhotoManifestEntry = {photoId:string;contentHash:string;processingVersion:string};
export type QuotePhoto = {id:string;status:QuotePhotoStatus;inputBytes:number;storedBytes:number|null;mimeType:string|null;width:number|null;height:number|null;contentHash:string|null;processingVersion:string;noticeVersion:string;errorCode:string|null};
export type QuotePhotoList = {photos:QuotePhoto[];draftRevision:number;submitted:boolean};
export type QuotePhotoMutation = {photo:QuotePhoto;draftRevision:number};
export class PhotoError extends Error { status:number; code:string; constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;} }
export const photoUuid = (value:unknown):value is string => typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const photoHash = (value:unknown):value is string => typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function validateQuotePhotoManifest(value:unknown):QuotePhotoManifestEntry[]{
 if(!Array.isArray(value)||value.length>QUOTE_PHOTO_LIMITS.maxFiles)throw new PhotoError(400,'invalid_manifest','Review the current saved photos.');
 const ids=new Set<string>();
 return value.map(item=>{if(!item||typeof item!=='object'||!photoUuid(item.photoId)||!photoHash(item.contentHash)||item.processingVersion!==PHOTO_PROCESSING_VERSION||ids.has(item.photoId))throw new PhotoError(400,'invalid_manifest','Review the current saved photos.');ids.add(item.photoId);return{photoId:item.photoId,contentHash:item.contentHash,processingVersion:item.processingVersion};});
}
export type PhotoReservation = {expectedRevision:number;noticeVersion:string;noticeAccepted:true;fileName:string;mimeType:string;inputBytes:number;sourceHash:string;idempotencyKey:string};
export function validatePhotoReservation(value:unknown):PhotoReservation{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new PhotoError(400,'invalid_request','Choose a photo first.');
 const v=value as Record<string,unknown>;
 if(!Number.isSafeInteger(v.expectedRevision)||(v.expectedRevision as number)<1||(v.expectedRevision as number)>2147483647||v.noticeVersion!==PHOTO_NOTICE_VERSION||v.noticeAccepted!==true||typeof v.idempotencyKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(v.idempotencyKey)||!photoHash(v.sourceHash))throw new PhotoError(400,'invalid_request','Save service details and acknowledge the private photo notice.');
 if(typeof v.fileName!=='string'||v.fileName.length>255||/[\u0000-\u001f\u007f]/.test(v.fileName)||typeof v.mimeType!=='string')throw new PhotoError(400,'invalid_file','Choose a JPEG, PNG or static WebP photo.');
 if(/\.(heic|heif)$/i.test(v.fileName)||/heic|heif/i.test(v.mimeType))throw new PhotoError(415,'unsupported_image','Convert HEIC/HEIF photos to JPEG or PNG before uploading.');
 const extensions:Record<string,RegExp>={'image/jpeg':/\.jpe?g$/i,'image/png':/\.png$/i,'image/webp':/\.webp$/i};
 if(!extensions[v.mimeType]?.test(v.fileName))throw new PhotoError(415,'unsupported_image','Choose a JPEG, PNG or static WebP photo with a matching file extension.');
 if(!Number.isSafeInteger(v.inputBytes)||(v.inputBytes as number)<1||(v.inputBytes as number)>QUOTE_PHOTO_LIMITS.maxInputBytes)throw new PhotoError(413,'input_too_large','Each photo must be no larger than 10 MB.');
 return v as PhotoReservation;
}
