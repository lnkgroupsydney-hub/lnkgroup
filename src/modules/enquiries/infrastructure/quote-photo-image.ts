import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {PhotoError,QUOTE_PHOTO_LIMITS} from '../domain/quote-photos.ts';
import type {NormalizedPhoto} from '../application/quote-photos.ts';

export async function normalizeQuotePhoto(bytes:Uint8Array,claimedMime:string):Promise<NormalizedPhoto>{
 if(!bytes.length||bytes.length>QUOTE_PHOTO_LIMITS.maxInputBytes)throw new PhotoError(413,'input_too_large','Each photo must be no larger than 10 MB.');
 const header=Buffer.from(bytes);
 const jpeg=header[0]===0xff&&header[1]===0xd8&&header[2]===0xff;
 const png=header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const webp=header.toString('ascii',0,4)==='RIFF'&&header.toString('ascii',8,12)==='WEBP';
 if(!jpeg&&!png&&!webp)throw new PhotoError(415,'unsupported_image','Choose a JPEG, PNG or static WebP photo.');
 // Some decoders read only the first APNG frame, so reject the animation
 // control chunk before decoding instead of trusting pages alone.
 if(png){for(let offset=8;offset+12<=header.length;){const length=header.readUInt32BE(offset);if(header.toString('ascii',offset+4,offset+8)==='acTL')throw new PhotoError(415,'unsupported_image','Animated photos are not supported. Choose a still image.');if(length>header.length-offset-12)break;offset+=length+12;}}
 try{
  const source=sharp(bytes,{limitInputPixels:QUOTE_PHOTO_LIMITS.maxPixels,failOn:'warning',animated:true}).timeout({seconds:10});
  const metadata=await source.metadata();
  const mime:Record<string,string>={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
  if(!metadata.format||mime[metadata.format]!==claimedMime||(metadata.pages??1)!==1)throw new PhotoError(415,'unsupported_image','Use a JPEG, PNG or static WebP photo; the file must match its stated format.');
  if(!metadata.width||!metadata.height||metadata.width*metadata.height>QUOTE_PHOTO_LIMITS.maxPixels)throw new PhotoError(413,'image_too_large','The photo exceeds the 50 megapixel limit. Resize it and try again.');
  // Sharp removes metadata by default. autoOrient applies EXIF before removing it.
  const {data,info}=await source.autoOrient().resize({width:QUOTE_PHOTO_LIMITS.maxDimension,height:QUOTE_PHOTO_LIMITS.maxDimension,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality:85,mozjpeg:true}).toBuffer({resolveWithObject:true});
  if(data.length>QUOTE_PHOTO_LIMITS.maxStoredBytes)throw new PhotoError(413,'image_too_large','The processed photo is too large. Choose a smaller photo.');
  return{bytes:data,contentHash:createHash('sha256').update(data).digest('hex'),width:info.width,height:info.height};
 }catch(error){
  if(error instanceof PhotoError)throw error;
  throw new PhotoError(422,'invalid_image','This photo could not be read safely. Choose a valid JPEG, PNG or static WebP image.');
 }
}
