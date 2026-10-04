import {photoContentGet,photoContentPut} from '@/modules/enquiries';
export const runtime='nodejs';
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){return photoContentGet(req,(await params).id);}
export async function PUT(req:Request,{params}:{params:Promise<{id:string}>}){return photoContentPut(req,(await params).id);}
