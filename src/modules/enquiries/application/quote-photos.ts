import {PhotoError,PHOTO_PROCESSING_VERSION,type QuotePhotoMutation,type QuotePhotoStatus} from '../domain/quote-photos.ts';

export type PhotoRecord={id:string;draft_id:string;status:QuotePhotoStatus;source_hash:string;input_bytes:number;source_mime:string;object_path:string;content_hash:string|null;stored_bytes:number|null;mime_type:string|null;width:number|null;height:number|null;processing_version:string;lease_holder:string|null;lease_generation:number};
export type NormalizedPhoto={bytes:Uint8Array;contentHash:string;width:number;height:number};
export type PhotoPorts={
 command:<T>(command:string,args:Record<string,unknown>)=>Promise<T>;
 normalize:(bytes:Uint8Array,mime:string)=>Promise<NormalizedPhoto>;
 upload:(path:string,bytes:Uint8Array,hash:string)=>Promise<void>;
 read:(path:string)=>Promise<Uint8Array|null>;
 remove:(path:string)=>Promise<void>;
 hash:(bytes:Uint8Array)=>string;
 workerId:()=>string;
};
type Claim={record:PhotoRecord;draftRevision:number;photo?:QuotePhotoMutation['photo']};
const lease=(p:PhotoRecord)=>({id:p.id,holder:p.lease_holder,generation:p.lease_generation});
const verified=(p:PhotoRecord,bytes:Uint8Array,hash:PhotoPorts['hash'])=>p.processing_version===PHOTO_PROCESSING_VERSION&&bytes.length===p.stored_bytes&&hash(bytes)===p.content_hash;
export function quotePhotos(ports:PhotoPorts){
 return {
  async upload(owner:string,id:string,receive:()=>Promise<Uint8Array>):Promise<QuotePhotoMutation>{
   const claim=await ports.command<Claim>('claim_upload',{owner_hash:owner,id,holder:ports.workerId()});
   const p=claim.record;
   try{
    const bytes=await receive();
    if(bytes.length!==p.input_bytes||ports.hash(bytes)!==p.source_hash)throw new PhotoError(409,'source_mismatch','The selected file differs from this upload. Remove it and choose the photo again.');
    if(p.status==='attached')return{photo:claim.photo!,draftRevision:claim.draftRevision};
    const normalized=await ports.normalize(bytes,p.source_mime);
    await ports.command('prepare',{...lease(p),content_hash:normalized.contentHash,stored_bytes:normalized.bytes.length,width:normalized.width,height:normalized.height});
    await ports.upload(p.object_path,normalized.bytes,normalized.contentHash);
    return await ports.command<QuotePhotoMutation>('attach',lease(p));
   }catch(error){
    // Unknown Storage/DB outcomes retain a durable processing lease. The worker
    // verifies any object written before attaching, or returns it to retryable.
    if(p.status!=='attached'&&error instanceof PhotoError&&error.status>=400&&error.status<500){
     const rejected=['source_mismatch','invalid_image','unsupported_image','input_too_large','image_too_large','content_conflict'].includes(error.code);
     if(rejected)try{await ports.command('fail',{...lease(p),status:'rejected',error_code:error.code});}catch{/* An expired lease can never overwrite newer state. */}
    }
    throw error;
   }
  },
  async content(p:PhotoRecord):Promise<Uint8Array>{
   if(p.status!=='attached')throw new PhotoError(404,'photo_unavailable','Photo unavailable.');
   const bytes=await ports.read(p.object_path);
   if(!bytes||!verified(p,bytes,ports.hash))throw new PhotoError(503,'content_conflict','The stored photo could not be verified. Please retry later.');
   return bytes;
  },
  async recover(ids?:string[]):Promise<{recovered:number;deferred:number}>{
   const work=ids??await ports.command<string[]>('recovery_list',{});let recovered=0,deferred=0;
   for(const id of work.slice(0,10)){
    let p:PhotoRecord|undefined;
    try{
     p=(await ports.command<Claim>('claim_recovery',{id,holder:ports.workerId()})).record;
     if(p.status==='retryable_error'){recovered++;continue;}
     if(p.status==='delete_pending'||p.status==='deleted'){
      try{await ports.remove(p.object_path);await ports.command('delete_done',lease(p));}
      catch{await ports.command('delete_failed',lease(p));deferred++;continue;}
     }else if(p.status==='processing'){
      const bytes=p.content_hash?await ports.read(p.object_path):null;
      if(bytes&&verified(p,bytes,ports.hash))await ports.command('attach',lease(p));
      else await ports.command('fail',{...lease(p),status:bytes?'rejected':'retryable_error',error_code:bytes?'content_conflict':'upload_interrupted'});
     }
     recovered++;
    }catch{deferred++;}
   }
   return{recovered,deferred};
  },
 };
}
