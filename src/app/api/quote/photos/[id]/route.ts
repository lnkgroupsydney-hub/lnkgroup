import {photoDelete} from '@/modules/enquiries';
export const runtime='nodejs';
export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){return photoDelete(req,(await params).id);}
