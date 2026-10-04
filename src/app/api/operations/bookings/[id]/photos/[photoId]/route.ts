import {adminPhotoGet} from '@/modules/enquiries';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{id:string;photoId:string}>}){const p=await params;return adminPhotoGet(req,p.id,p.photoId);}
