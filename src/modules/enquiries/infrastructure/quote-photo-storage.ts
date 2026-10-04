import {createHash} from 'node:crypto';
import {quoteStorageClient} from './quote-draft-api.ts';
import {PhotoError,QUOTE_PHOTO_LIMITS} from '../domain/quote-photos.ts';
export const QUOTE_PHOTO_BUCKET='quote-photos';
async function bucket(){
 const client=quoteStorageClient();
 const {data,error}=await client.storage.getBucket(QUOTE_PHOTO_BUCKET);
 if(error||!data||data.public)throw new PhotoError(503,'storage_unavailable','Private photo storage is not ready. Keep the file and retry later.');
 return client.storage.from(QUOTE_PHOTO_BUCKET);
}
export async function readPhotoObject(path:string):Promise<Uint8Array|null>{
 const storage=await bucket();const{data,error}=await storage.download(path);
 if(error){if(('statusCode'in error&&['404','NoSuchKey'].includes(String(error.statusCode)))||('code'in error&&error.code==='NoSuchKey'))return null;throw new PhotoError(503,'storage_unavailable','Private photo storage is temporarily unavailable.');}
 if(!data)return null;
 if(data.size>QUOTE_PHOTO_LIMITS.maxStoredBytes)throw new PhotoError(503,'content_conflict','The stored photo could not be verified.');
 return new Uint8Array(await data.arrayBuffer());
}
export async function uploadPhotoObject(path:string,bytes:Uint8Array,expectedHash:string){
 const storage=await bucket();
 const{error}=await storage.upload(path,bytes,{contentType:'image/jpeg',cacheControl:'0',upsert:false});
 if(!error)return;
 // A response-loss retry may encounter the original immutable object. Verify
 // bytes instead of overwriting it, including ambiguous timeout outcomes.
 const existing=await readPhotoObject(path);
 if(existing&&existing.length===bytes.length&&createHash('sha256').update(existing).digest('hex')===expectedHash)return;
 if(existing)throw new PhotoError(409,'content_conflict','This saved photo differs from the upload. Remove it and start again.');
 throw new PhotoError(503,'storage_unavailable','The photo upload could not be confirmed. Refresh its status shortly.');
}
export async function removePhotoObject(path:string){
 const storage=await bucket();const{error}=await storage.remove([path]);
 if(error)throw new PhotoError(503,'storage_unavailable','Photo deletion will be retried.');
}
