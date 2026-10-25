import { createClient } from '@supabase/supabase-js'
import { QuoteRequestError } from '../../quotes/domain/contracts.ts'
import type { QuoteRequestStore } from '../../quotes/application/requests.ts'
export const liveCompanyBookingStore: QuoteRequestStore = {
 async command<T>(command: string,args: Record<string,unknown>):Promise<T>{
  if(typeof window!=='undefined')throw new Error('Company booking storage is server-only')
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY
  if(process.env.OPERATIONS_STORE!=='supabase'||!url||!key)throw new QuoteRequestError(503,'Private company booking storage is unavailable. Saved records are retained.')
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(20000)})}})
  const {data,error}=await client.rpc('lk_live_company_booking_command',{command,args:{...args,companyId:'lk-group'}})
  if(error){const status=({LK400:400,LK401:401,LK403:403,LK404:404,LK409:409,LK422:422,LK429:429,'23P01':409} as Record<string,number>)[error.code];let code:string|undefined;try{const detail=JSON.parse(error.details??'{}');if(typeof detail.code==='string'&&['revision_awaiting_customer','revision_acceptance_invalid'].includes(detail.code))code=detail.code}catch{};throw Object.assign(new QuoteRequestError(status??503,error.code==='23P01'?'The work period overlaps another booking.':status?error.message:'Private company booking storage is unavailable. Saved records are retained.'),code?{code}:{})}
  return data as T
 }
}
