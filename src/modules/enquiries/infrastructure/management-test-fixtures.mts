import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
export async function currentWorkDb() {
 const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
 for(const f of readdirSync(new URL('../../../../supabase/migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL('../../../../supabase/migrations/'+f,import.meta.url),'utf8'))
 await db.exec('create schema if not exists auth;create table if not exists auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);create table if not exists auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);')
 return db
}
export async function resetCurrentWork(db:PGlite){await db.exec('reset role');const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(r=>'public.'+r.tablename);await db.exec(`truncate ${tables.join(',')},auth.users,auth.sessions`)}
export const workDbFailure=(code:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===code
export async function currentWorkRpc<T=Record<string,unknown>>(db:PGlite,command:string,args:Record<string,unknown>){return(await db.query<{result:T}>('select public.lk_current_work_command($1,$2::jsonb) result',[command,JSON.stringify({companyId:'lk-group',...args})])).rows[0].result}
export async function tableHash(db:PGlite,table:string,where='',params:unknown[]=[]){return(await db.query<{value:string}>(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'[]')) value from public.${table} t ${where}`,params)).rows[0].value}
