import test, {after,beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,readdirSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {DEMO_PRICE,DEMO_TERMS,DEMO_VERSION} from './domain/demo-submission.ts'

// Every row and provider identifier is synthetic; this suite never calls a network.
const db=new PGlite()
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
for(const name of readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`,import.meta.url),'utf8'))
}
const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(x=>x.tablename)
beforeEach(async()=>{
  await db.exec('reset role')
  await db.exec(`truncate ${tables.map(x=>`public.${x}`).join(',')}`)
  await db.exec("insert into public.lk_google_connection(id,account_sub,email,access_cipher,expires_at,selected_calendar_id) values(1,'synthetic','company@example.invalid','synthetic',0,'test-calendar')")
  await db.exec('set role service_role')
})
after(async()=>db.close())
type Status={id:string;reference:string;submittedAt:string;preferredDate:string;emailStatus:string;calendarStatus:string;error:string|null}
type Work={id:string;email_status:string;email_payload:unknown;email_first_attempt_at:string|null;email_attempts:number;email_provider_id:string|null;lease_generation:number;lease_until:string;enquiry_id:string|null}
async function rpc<T=Status>(command:string,args:Record<string,unknown>):Promise<T>{return (await db.query<{r:T}>('select public.lk_quote_submission($1,$2::jsonb) r',[command,JSON.stringify(args)])).rows[0].r}
async function draftRpc(args:Record<string,unknown>){return (await db.query<{r:{id:string;revision:number}}> ("select public.lk_quote_draft('save',$1::jsonb) r",[JSON.stringify(args)])).rows[0].r}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const code=(c:string)=>(err:unknown)=>!!err&&typeof err==='object'&&'code'in err&&err.code===c
const holder='synthetic-delivery-worker'
const emailPayload={from:'test@example.invalid',to:['company@example.invalid'],subject:'DEMO only',html:'<p>Synthetic demonstration</p>'}
async function fixture(){
  const owner=hash(randomUUID())
  const payload={contact:{name:'Synthetic Client',email:'client@example.invalid',phone:'',siteAddress:'TEST ONLY',suburb:'Test',postcode:'2000',details:'Test only',consent:true},service:{serviceId:'cabinet-painting',intent:'full-repainting',surfaces:['doors'],doorCount:4,drawerCount:null,material:'',colourPreference:''}}
  const saved=await draftRpc({owner_hash:owner,revision:0,payload,payload_hash:hash(payload),expires_at:new Date(Date.now()+3600000).toISOString()})
  const snapshot={mode:'demo',version:DEMO_VERSION,draftId:saved.id,draftRevision:saved.revision,payload,preferredDate:'2026-11-10',price:DEMO_PRICE,terms:DEMO_TERMS}
  const signature={name:'Synthetic Client',acknowledged:true,strokes:[[{x:0.2,y:0.2},{x:0.6,y:0.6}]]}
  const id=randomUUID()
  const args={owner_hash:owner,expected_revision:1,key:randomUUID(),request_hash:hash({snapshot,signature}),snapshot,snapshot_hash:hash(snapshot),signature,calendar_id:'test-calendar',id,reference:`DEMO-${id.replaceAll('-','').slice(0,12).toUpperCase()}`}
  return {args,owner,payload,saved}
}
async function claim(id?:string,worker=holder){return (await rpc<Work[]>('claim',{holder:worker,...(id?{id}:{})}))[0]}
const lease=(work:Work)=>({id:work.id,holder,generation:work.lease_generation})
async function begin(){const f=await fixture();await rpc('submit',f.args);const work=await claim(f.args.id);const attempt=await rpc<Work>('email_attempt',{...lease(work),payload:emailPayload});return {...f,work,attempt}}
async function counts(){return(await db.query<{submissions:number;enquiries:number;outbox:number}>("select (select count(*)::int from public.lk_quote_submissions) submissions,(select count(*)::int from public.lk_enquiries) enquiries,(select count(*)::int from public.lk_outbox) outbox")).rows[0]}

test('submit saves immutable evidence and safe owner-only status without an enquiry or calendar outbox',async()=>{
  const f=await fixture(),status=await rpc('submit',f.args)
  assert.equal(status.emailStatus,'pending');assert.equal(status.calendarStatus,'blocked');assert.equal(status.error,null)
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
  assert.deepEqual(await rpc('read',{owner_hash:f.owner}),status)
  assert.equal(await rpc('read',{owner_hash:hash('another-session')}),null)
  assert.deepEqual(Object.keys(status).sort(),['id','reference','submittedAt','preferredDate','emailStatus','calendarStatus','error'].sort())
  assert.equal(JSON.stringify(status).includes('client@example.invalid'),false)
})

test('one immutable submission per draft and exact replay returns original even if response was lost',async()=>{
  const f=await fixture(),first=await rpc('submit',f.args)
  assert.deepEqual(await rpc('submit',{...f.args,id:randomUUID(),reference:'DEMO-IGNORED00'}),first)
  for(const changed of [{key:randomUUID()},{request_hash:hash('new')},{snapshot_hash:hash('other')},{signature:{...f.args.signature,name:'Changed'}},{snapshot:{...f.args.snapshot,preferredDate:'2026-11-11'}}])await assert.rejects(rpc('submit',{...f.args,...changed}),code('LK409'))
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
})

test('an exact response-loss retry recovers the original receipt after the draft expires',async()=>{
  const f=await fixture(),first=await rpc('submit',f.args)
  await db.exec('reset role;alter table public.lk_quote_drafts disable trigger lk_quote_draft_submitted')
  await db.query("update public.lk_quote_drafts set expires_at=now()-interval '1 second' where id=$1",[f.saved.id])
  await db.exec('alter table public.lk_quote_drafts enable trigger lk_quote_draft_submitted;set role service_role')
  assert.deepEqual(await rpc('submit',f.args),first)
  assert.deepEqual(await rpc('read',{owner_hash:f.owner}),first)
  await assert.rejects(rpc('submit',{...f.args,key:randomUUID()}),code('LK409'))
})

test('foreign owner, stale revision, forged saved payload, expired draft and wrong calendar cannot submit',async()=>{
  const f=await fixture()
  await assert.rejects(rpc('submit',{...f.args,owner_hash:hash('foreign')}),code('LK403'))
  for(const changed of [{expected_revision:2},{snapshot:{...f.args.snapshot,draftId:randomUUID()}},{snapshot:{...f.args.snapshot,payload:{...f.payload,contact:{...f.payload.contact,name:'Forged'}}}},{calendar_id:'other-calendar'}])await assert.rejects(rpc('submit',{...f.args,...changed}),code('LK409'))
  await db.query('update public.lk_quote_drafts set expires_at=now()-interval \'1 second\' where id=$1',[f.saved.id])
  await assert.rejects(rpc('submit',f.args),code('LK403'))
  assert.deepEqual(await counts(),{submissions:0,enquiries:0,outbox:0})
})

test('demo acknowledgement, service and signature are mandatory',async()=>{
  const f=await fixture()
  for(const changed of [{snapshot:{...f.args.snapshot,mode:'live'}},{signature:{...f.args.signature,acknowledged:false}},{signature:{...f.args.signature,strokes:[]}},{signature:{...f.args.signature,name:''}}])await assert.rejects(rpc('submit',{...f.args,...changed}),code('LK400'))
  assert.equal((await counts()).submissions,0)
})

test('submitted draft, snapshot, signature and email evidence cannot be changed',async()=>{
  const f=await begin()
  await assert.rejects(draftRpc({owner_hash:f.owner,revision:1,payload:{...f.payload,contact:{...f.payload.contact,name:'Changed'}},payload_hash:hash('new')}),code('LK409'))
  assert.equal((await draftRpc({owner_hash:f.owner,revision:1,payload:f.payload,payload_hash:hash(f.payload)})).revision,1)
  await assert.rejects(db.query("update public.lk_quote_submissions set signature='{}'::jsonb where id=$1",[f.args.id]),code('LK409'))
  await assert.rejects(db.query("update public.lk_quote_submissions set email_payload='{}'::jsonb where id=$1",[f.args.id]),code('LK409'))
  await assert.rejects(db.query("update public.lk_quote_submissions set email_first_attempt_at=now()-interval '24 hours' where id=$1",[f.args.id]),code('LK409'))
})

test('claim is exclusive, supports a submission filter and fences expired workers',async()=>{
  const a=await fixture(),b=await fixture();await rpc('submit',a.args);await rpc('submit',b.args)
  const first=await claim(b.args.id)
  assert.equal(first.id,b.args.id)
  assert.deepEqual(await rpc('claim',{holder:'second-synthetic-worker',id:b.args.id}),[])
  await db.query("update public.lk_quote_submissions set lease_until=now()-interval '1 second' where id=$1",[b.args.id])
  const renewed=await claim(b.args.id)
  assert.equal(renewed.lease_generation,first.lease_generation+1)
  await assert.rejects(rpc('email_attempt',{...lease(first),payload:emailPayload}),code('LK409'))
  await assert.rejects(rpc('email_attempt',{...lease(renewed),holder:'wrong-synthetic-worker',payload:emailPayload}),code('LK409'))
  assert.equal((await claim(a.args.id)).id,a.args.id)
})

test('email payload freezes before first send and retries reuse exactly the stored payload',async()=>{
  const f=await begin()
  assert.deepEqual(f.attempt.email_payload,emailPayload);assert.equal(f.attempt.email_attempts,1)
  const again=await rpc<Work>('email_attempt',{...lease(f.work),payload:emailPayload})
  assert.equal(again.email_attempts,2);assert.equal(again.email_first_attempt_at,f.attempt.email_first_attempt_at)
  await assert.rejects(rpc('email_attempt',{...lease(f.work),payload:{...emailPayload,to:['other@example.invalid']}}),code('LK409'))
  await rpc('email_failed',{...lease(f.work),outcome:'retrying',error_code:'email_transient'})
  assert.deepEqual(await rpc('claim',{holder,id:f.args.id}),[])
  await db.query("update public.lk_quote_submissions set retry_after=now()-interval '1 second' where id=$1",[f.args.id])
  const retry=await claim(f.args.id)
  assert.deepEqual(retry.email_payload,emailPayload)
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
})

test('provider acceptance atomically queues one enquiry and one calendar job, preserving demo metadata',async()=>{
  const f=await begin(),status=await rpc('email_accepted',{...lease(f.work),provider_id:'synthetic-provider-id'})
  assert.equal(status.emailStatus,'provider_accepted');assert.equal(status.calendarStatus,'pending')
  assert.deepEqual(await counts(),{submissions:1,enquiries:1,outbox:1})
  const row=(await db.query<{payload_json:Record<string,unknown>;start_at:null;end_at:null;status:string}>('select payload_json,start_at,end_at,status from public.lk_enquiries')).rows[0]
  assert.equal(row.payload_json.demoSubmissionId,f.args.id);assert.equal(row.payload_json.demo,true)
  assert.equal(row.payload_json.preferredDate,'2026-11-10');assert.equal(row.start_at,null);assert.equal(row.end_at,null);assert.equal(row.status,'submitted')
  assert.deepEqual(await rpc('claim',{holder,id:f.args.id}),[])
  await assert.rejects(rpc('email_accepted',{...lease(f.work),provider_id:'synthetic-provider-id'}),code('LK409'))
  assert.deepEqual(await rpc('read',{owner_hash:f.owner}),status)
})

test('email acceptance and enqueue roll back together when a database write fails',async()=>{
  const f=await begin()
  // Simulate a transaction failure at the outbox insert, after provider acceptance.
  await db.exec(`reset role;
    create function public.test_fail_outbox() returns trigger language plpgsql as $$ begin raise exception 'Synthetic failure'; end $$;
    create trigger test_fail_outbox before insert on public.lk_outbox for each row execute function public.test_fail_outbox();
    set role service_role`)
  await assert.rejects(rpc('email_accepted',{...lease(f.work),provider_id:'synthetic-provider-id'}))
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
  assert.equal((await rpc('read',{owner_hash:f.owner})).emailStatus,'sending')
  await db.exec('reset role;drop trigger test_fail_outbox on public.lk_outbox;drop function public.test_fail_outbox();set role service_role')
  await rpc('email_accepted',{...lease(f.work),provider_id:'synthetic-provider-id'})
  assert.deepEqual(await counts(),{submissions:1,enquiries:1,outbox:1})
  await db.query("update public.lk_enquiries set calendar_status='synced' where id=$1",[f.args.id])
  assert.equal((await rpc('read',{owner_hash:f.owner})).calendarStatus,'synced')
})

test('acceptance after a target change is retained without enqueue and recovers without a second email',async()=>{
  const f=await begin()
  await db.exec("update public.lk_google_connection set selected_calendar_id='different-calendar' where id=1")
  const status=await rpc('email_accepted',{...lease(f.work),provider_id:'synthetic-provider-id'})
  assert.equal(status.emailStatus,'provider_accepted');assert.equal(status.calendarStatus,'blocked');assert.equal(status.error,'calendar_target_changed')
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
  await db.exec("update public.lk_google_connection set selected_calendar_id='test-calendar' where id=1;update public.lk_quote_submissions set retry_after=now()-interval '1 second'")
  const work=await claim(f.args.id)
  assert.equal(work.email_provider_id,'synthetic-provider-id')
  await assert.rejects(rpc('email_attempt',{...lease(work),payload:emailPayload}),code('LK409'))
  await rpc('email_accepted',{...lease(work),provider_id:work.email_provider_id})
  assert.deepEqual(await counts(),{submissions:1,enquiries:1,outbox:1})
  assert.equal((await db.query<{email_attempts:number}>('select email_attempts from public.lk_quote_submissions')).rows[0].email_attempts,1)
  await assert.rejects(db.exec("update public.lk_google_connection set selected_calendar_id='wrong-calendar' where id=1"),code('LK409'))
})

test('missing provider acceptance and unrecognized provider errors never queue Calendar or leak raw messages',async()=>{
  const f=await begin()
  await assert.rejects(rpc('email_accepted',{...lease(f.work),provider_id:''}),code('LK409'))
  await assert.rejects(rpc('email_failed',{...lease(f.work),outcome:'failed',error_code:'PRIVATE PROVIDER BODY'}),code('LK400'))
  const status=await rpc('email_failed',{...lease(f.work),outcome:'failed',error_code:'email_rejected'})
  assert.equal(status.emailStatus,'failed');assert.equal(status.error,'email_rejected')
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
  assert.deepEqual(await rpc('claim',{holder,id:f.args.id}),[])
})

test('expired provider deduplication window stops ambiguous retries instead of sending another email',async()=>{
  const f=await begin()
  // Only the isolated DB owner may advance the fixture clock beyond immutable evidence.
  await db.exec('reset role;alter table public.lk_quote_submissions disable trigger lk_quote_submission_immutable')
  await db.query("update public.lk_quote_submissions set email_first_attempt_at=now()-interval '23 hours 1 second',lease_until=now()-interval '1 second' where id=$1",[f.args.id])
  await db.exec('alter table public.lk_quote_submissions enable trigger lk_quote_submission_immutable;set role service_role')
  assert.deepEqual(await rpc('claim',{holder,id:f.args.id}),[])
  const status=await rpc('read',{owner_hash:f.owner})
  assert.equal(status.emailStatus,'outcome_unknown');assert.equal(status.error,'email_outcome_unknown')
  assert.deepEqual(await counts(),{submissions:1,enquiries:0,outbox:0})
})

test('anonymous and authenticated roles cannot read evidence, mutate it, or invoke the submission RPC',async()=>{
  const f=await fixture();await rpc('submit',f.args)
  for(const role of ['anon','authenticated']){
    await db.exec(`reset role;set role ${role}`)
    await assert.rejects(db.query('select * from public.lk_quote_submissions'),code('42501'))
    await assert.rejects(db.query("update public.lk_quote_submissions set email_status='failed'"),code('42501'))
    await assert.rejects(rpc('read',{owner_hash:f.owner}),code('42501'))
  }
  await db.exec('reset role')
  const flags=(await db.query<{relrowsecurity:boolean;prosecdef:boolean;proconfig:string[]}>("select c.relrowsecurity,p.prosecdef,p.proconfig from pg_class c cross join pg_proc p where c.relname='lk_quote_submissions' and p.proname='lk_quote_submission'")).rows[0]
  assert.equal(flags.relrowsecurity,true);assert.equal(flags.prosecdef,false);assert.deepEqual(flags.proconfig,['search_path=""'])
})
