import { customerPropertyCommand } from '@/modules/customers/server'
export const runtime='nodejs'
export async function PATCH(req:Request,context:{params:Promise<{id:string;propertyId?:string}>}) {const p=await context.params;return customerPropertyCommand(req,p.id,p.propertyId,'property_update')}
