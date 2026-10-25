import { createClient } from '@supabase/supabase-js'
import { WorkError, type WorkStore } from '../../enquiries/management.ts'
export const companyRevisionStore:WorkStore={async command<T>(command:string,args:Record<string,unknown>):Promise<T>{
 if(typeof window!=='undefined')throw new Error('Company revision storage is server-only.')
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY
 if(process.env.OPERATIONS_STORE!=='supabase'||!url||!key)throw new WorkError(503,'unavailable','Private company revisions are unavailable.')
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,cache:'no-store',signal:AbortSignal.timeout(20000)})}})
 const {data,error}=await client.rpc('lk_quote_company_revision_command',{command,args})
 if(error){const status=({LK400:400,LK401:401,LK403:403,LK404:404,LK409:409,LK422:422,LK429:429} as Record<string,number>)[error.code];let detail:Record<string,unknown>={};try{detail=JSON.parse(error.details??'{}')}catch{};throw new WorkError(status??503,typeof detail.code==='string'&&['revision_not_eligible','booking_confirmed','cancellation_started','revision_not_published','revision_snapshot_changed','idempotency_conflict','revision_conflict','revision_published','review_proof_expired','revision_acceptance_invalid','revision_awaiting_customer','worker_lease_changed'].includes(detail.code)?detail.code:({400:'malformed_request',401:'unauthorized',403:'forbidden',404:'not_found',409:'state_conflict',422:'validation',429:'rate_limit'} as Record<number,string>)[status]??'outcome_unknown',status===422?'Review the company revision fields.':status?error.message:'Private company revisions are unavailable.',status?'not_applied':'unknown',Number.isSafeInteger(detail.currentRevision)?Number(detail.currentRevision):undefined)}
 return data as T
}}
