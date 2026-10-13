import { createHash, randomUUID } from 'node:crypto'
export interface CustomerFixtureDb {exec(sql:string):Promise<unknown>;query<T>(sql:string,params?:unknown[]):Promise<{rows:T[]}>}
export async function initializeCustomerFixtureAuth(db:CustomerFixtureDb){await db.exec('create schema if not exists auth;create table if not exists auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);create table if not exists auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);')}
/** Synthetic upstream staff+session+fresh email proof; never touches connected Auth. */
export async function seedCustomerFixtureStaff(db:CustomerFixtureDb,actor:{actorUserId:string;actorSessionId:string}){
 await db.exec('reset role')
 const hash=(value:string)=>createHash('sha256').update(value).digest('hex'),email='synthetic-staff@example.invalid',token=hash('staff:'+actor.actorSessionId),now=Date.now(),expires=now+3600000
 await db.query('insert into auth.users(id,email,raw_app_meta_data) values($1,$2,$3) on conflict(id) do update set email=excluded.email,raw_app_meta_data=excluded.raw_app_meta_data',[actor.actorUserId,email,{lk_staff:{company_id:'lk-group',role:'admin',status:'active'},lk_staff_password_change_required:false}])
 await db.query('insert into auth.sessions(id,user_id,not_after) values($1,$2,now()+interval \'1 hour\') on conflict(id) do update set user_id=excluded.user_id,not_after=excluded.not_after',[actor.actorSessionId,actor.actorUserId])
 await db.query("insert into public.lk_sessions(token_hash,mode,account_sub,expires_at) values($1,'staff',$2,$3)",[token,actor.actorUserId,expires])
 await db.query("insert into public.lk_staff_email_checks(token_hash,user_id,email_hash,challenge_id,status,sent_at,expires_at,retry_at,verified_until) values($1,$2,$3,$4,'verified',$5,$6,$5,$6)",[token,actor.actorUserId,hash(email),randomUUID(),now,expires])
 await db.exec('set role service_role')
}
