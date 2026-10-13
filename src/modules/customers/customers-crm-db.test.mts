import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Customer, CustomerDetail, CustomerProperty, ResolveCustomerResult } from './domain/contracts.ts'
import { initializeCustomerFixtureAuth, seedCustomerFixtureStaff } from './infrastructure/customer-test-fixtures.mts'
const db = new PGlite()
await initializeCustomerFixtureAuth(db)
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;')
for(const name of readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL('../../../supabase/migrations/'+name,import.meta.url),'utf8'))
const tables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(r=>r.tablename)
beforeEach(async()=>{await db.exec(`reset role;truncate ${tables.map(n=>'public.'+n).join(',')};set role service_role;`);await seedCustomerFixtureStaff(db,actor)})
after(()=>db.close())
const actor={companyId:'lk-group',actorUserId:randomUUID(),actorSessionId:randomUUID()}
const key=()=>randomUUID()
async function rpc<T=Customer>(command:string,args:Record<string,unknown>={}):Promise<T>{return (await db.query<{r:T}>('select public.lk_customers_command($1,$2::jsonb) r',[command,JSON.stringify({...actor,...args})])).rows[0].r}
const create=(args:Record<string,unknown>={})=>rpc('create',{id:randomUUID(),name:key(),email:key()+'@example.invalid',idempotencyKey:key(),...args})
const detail=(id:string)=>rpc<CustomerDetail>('detail',{id})
const metadata=(revision:number)=>({expectedRevision:revision,reason:'Reviewed synthetic CRM change',idempotencyKey:key()})
const property=(unit:string|null=null)=>({label:'Synthetic home',address:{line1:'10 Test Street',unit,suburb:'Sydney',state:'NSW',postcode:'2000',country:'AU'},contactName:null,notes:null})
async function quote(email='quote@example.invalid',name='Quote Client',verified=true){
 const id=key(),hash=id.replaceAll('-','').repeat(2)
 await db.query("insert into public.lk_quote_requests(id,company_id,reference,owner_hash,owner_expires_at,payload,status,revision,consent_version) values($1,'lk-group',$2,$3,now()+interval '1 day',$4,'draft',1,'quote-storage-review-v1')",[id,'RQ-'+id.replaceAll('-','').toUpperCase(),hash,JSON.stringify({contact:{name,email,siteAddress:'10 Test Street'}})])
 if(verified) await db.query("insert into public.lk_quote_request_access(company_id,request_id,auth_user_id,verified_email,verified_at) values('lk-group',$1,$2,$3,now())",[id,key(),email])
 return id
}
const code=(expected:string)=>(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code===expected
const reviewed=(c:Customer)=>({kind:'different_person',reason:'Verified separate person with shared contact',reviewedCandidates:[{id:c.id,revision:c.revision}]})

test('contact variants and exact name produce candidates without merge; aliases and ambiguous phones remain distinct',async()=>{
 const c=await create({name:'Same Name',email:'Person+work@example.invalid',phone:'0412 345 678'})
 const candidates=await rpc<{candidates:{customer:Customer;matchedBy:string[]}[]}>('candidates',{name:'Other',email:' PERSON+WORK@EXAMPLE.INVALID ',phone:'+61 412 345 678'})
 assert.equal(candidates.candidates[0].customer.id,c.id);assert.deepEqual(candidates.candidates[0].matchedBy,['email','phone'])
 const blocked=await create({name:'Same Name',email:'other@example.invalid'}) as unknown as {outcome:string}
 assert.equal(blocked.outcome,'needs_review');assert.equal((await rpc<{total:number}>('list',{q:'',page:1,pageSize:20})).total,1)
 assert.equal((await rpc<{candidates:unknown[]}>('candidates',{name:'Alias Other',email:'Person@example.invalid',phone:'61 412 345 678 ext 2'})).candidates.length,0)
 const shared=await create({name:'Different',email:c.email,decision:reviewed(c)});assert.notEqual(shared.id,c.id)
 await assert.rejects(create({name:'Third',email:c.email,decision:reviewed(c)}),code('LK409'))
})
test('email and phone pointing at different people require review of the full set, including archived customers',async()=>{
 const a=await create({name:'A',email:'a@example.invalid'}),b=await create({name:'B',phone:'0412 345 678'})
 await rpc('archive',{id:a.id,...metadata(1)})
 const result=await rpc<{outcome:string;candidates:unknown[]}>('resolve',{name:'C',email:'a@example.invalid',phone:'+61412345678',idempotencyKey:key()})
 assert.equal(result.outcome,'needs_review');assert.equal(result.candidates.length,2)
 assert.equal((await rpc<{total:number}>('list',{q:'',page:1,pageSize:20})).total,1)
 assert.equal((await rpc<{total:number}>('list',{q:'',page:1,pageSize:20,status:'all'})).total,2);assert.ok(b.id)
})
test('property reuse is unit-sensitive; property edits/archive/restore use CAS and customer archive preserves all children',async()=>{
 const c=await create();const p1=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('1'),...metadata(1)})
 const reuse=await rpc<{customer:Customer;property:CustomerProperty;propertyOutcome:string}>('property_create',{id:c.id,...property('1'),address:{...property('1').address,line1:'  10 TEST   St.  '},...metadata(2)})
 assert.equal(reuse.property.id,p1.property.id);assert.equal(reuse.propertyOutcome,'property_reused')
 const p2=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('2'),...metadata(reuse.customer.revision)});assert.notEqual(p2.property.id,p1.property.id)
 await assert.rejects(rpc('property_update',{id:c.id,propertyId:p2.property.id,...property('1'),...metadata(1)}),code('LK409'))
 const archived=await rpc<{customer:Customer;property:CustomerProperty}>('property_archive',{id:c.id,propertyId:p1.property.id,...metadata(1)})
 assert.equal(archived.property.status,'archived');await assert.rejects(rpc('property_restore',{id:c.id,propertyId:p1.property.id,...metadata(1)}),code('LK409'))
 const restored=await rpc<{customer:Customer;property:CustomerProperty}>('property_restore',{id:c.id,propertyId:p1.property.id,...metadata(2)})
 assert.equal(restored.property.status,'active')
 const ca=await rpc('archive',{id:c.id,...metadata(restored.customer.revision)})
 assert.equal((await detail(c.id)).properties.length,2);await assert.rejects(rpc('property_create',{id:c.id,...property('3'),...metadata(ca.revision)}),code('LK409'))
 const cr=await rpc('restore',{id:c.id,...metadata(ca.revision)});assert.equal(cr.status,'active')
})
test('edit conflict, candidate review and immutable original receipt survive later edits and actor changes',async()=>{
 const createArgs={id:randomUUID(),name:'Original',email:'original@example.invalid',idempotencyKey:key()};const c=await rpc('create',createArgs)
 const edited=await rpc('update',{id:c.id,name:'Edited',email:c.email,...metadata(1)})
 assert.equal(edited.revision,2);assert.deepEqual(await rpc('create',{...createArgs,id:key()}),c)
 const otherSession=key();await seedCustomerFixtureStaff(db,{...actor,actorSessionId:otherSession});await assert.rejects(rpc('create',{...createArgs,actorSessionId:otherSession}),code('LK409'))
 await assert.rejects(rpc('update',{id:c.id,name:'Lost update',...metadata(1)}),code('LK409'))
 const other=await create({name:'Other',email:'other@example.invalid'})
 const conflict=await rpc<{outcome:string}>('update',{id:c.id,name:'Edited',email:other.email,...metadata(2)})
 assert.equal(conflict.outcome,'needs_review');assert.equal((await detail(c.id)).customer.email,c.email)
 const distinct=await rpc('update',{id:c.id,name:'Edited',email:other.email,decision:reviewed(other),...metadata(2)});assert.equal(distinct.email,other.email)
})
test('atomic quote resolution links one customer and property; source-only retries cannot mutate original content or increase revisions',async()=>{
 const id=await quote();const before=(await db.query('select * from public.lk_quote_requests where id=$1',[id])).rows[0]
 const accessBefore=(await db.query('select * from public.lk_quote_request_access where request_id=$1',[id])).rows
 const args={name:'Quote Client',email:'quote@example.invalid',property:property('1'),source:{type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}
 const resolved=await rpc<ResolveCustomerResult>('resolve',args);assert.equal(resolved.outcome,'client_created');assert.equal(resolved.crmRevision,1)
 const second=await rpc<ResolveCustomerResult>('resolve',{...args,idempotencyKey:key()});assert.equal(second.customer.id,resolved.customer.id);assert.equal(second.property?.id,resolved.property?.id);assert.equal(second.customer.revision,resolved.customer.revision)
 assert.deepEqual(await rpc('resolve',args),resolved)
 const after=(await db.query<Record<string,unknown>>('select * from public.lk_quote_requests where id=$1',[id])).rows[0]
 for(const column of Object.keys(before)) if(!['customer_id','property_id','crm_revision'].includes(column)) assert.deepEqual(after[column],before[column],column)
 assert.deepEqual((await db.query('select * from public.lk_quote_request_access where request_id=$1',[id])).rows,accessBefore)
 assert.equal((await detail(resolved.customer.id)).records[0].sourceType,'quote_request')
 assert.equal((await db.query<{n:number}>('select count(*)::int n from public.lk_customer_record_links')).rows[0].n,0)
 const other=await create();await assert.rejects(rpc('resolve',{...args,idempotencyKey:key(),decision:{kind:'existing',customerId:other.id,expectedRevision:1,reason:'Reviewed'}}),code('LK409'))
})
test('first source link requires matching active verified email and current content revision; CRM relation read is staff scoped',async()=>{
 const id=await quote('pending@example.invalid','Pending',false),args={name:'Pending',email:'pending@example.invalid',source:{type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}
 await assert.rejects(rpc('resolve',args),code('LK409'))
 await db.query("insert into public.lk_quote_request_access(company_id,request_id,auth_user_id,verified_email,verified_at) values('lk-group',$1,$2,'wrong@example.invalid',now())",[id,key()])
 await assert.rejects(rpc('resolve',args),code('LK409'))
 const id2=await quote();await assert.rejects(rpc('resolve',{name:'Quote Client',email:'quote@example.invalid',source:{type:'quote_request',id:id2,expectedSourceRevision:2,expectedCrmRevision:0},idempotencyKey:key()}),code('LK409'))
 await assert.rejects(rpc('resolve',{name:'Stale contact',email:'quote@example.invalid',source:{type:'quote_request',id:id2,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}),code('LK409'))
 const relation=await rpc<{customer:null;crmRevision:number}>('quote_relation',{id:id2});assert.equal(relation.customer,null);assert.equal(relation.crmRevision,0)
})
test('quote property linkage rejects cross-customer choice, stale CRM and preserves source on rollback',async()=>{
 const a=await create(),b=await create(),id=await quote(),p=await rpc<{property:CustomerProperty}>('property_create',{id:b.id,...property(),...metadata(1)})
 const args={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:a.id,expectedRevision:1,reason:'Reviewed existing'},source:{type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}
 await assert.rejects(rpc('resolve',{...args,propertyId:p.property.id}),code('LK404'))
 assert.equal((await db.query('select customer_id from public.lk_quote_requests where id=$1',[id])).rows[0].customer_id,null)
 await assert.rejects(rpc('resolve',{...args,property:property(),source:{...args.source,expectedCrmRevision:4}}),code('LK409'))
 assert.equal((await detail(a.id)).properties.length,0)
 await assert.rejects(db.query('update public.lk_quote_requests set customer_id=$1,property_id=$2 where id=$3',[a.id,p.property.id,id]),code('23503'))
})
test('audit insert failure rolls customer/property/quote writes back and successful same-key retry creates once',async()=>{
 const id=await quote(),args={name:'Quote Client',email:'quote@example.invalid',property:property(),source:{type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}
 await db.exec('reset role;revoke insert on public.lk_customer_activity from service_role;set role service_role')
 try{await assert.rejects(rpc('resolve',args),code('42501'))}finally{await db.exec('reset role;grant insert on public.lk_customer_activity to service_role;set role service_role')}
 assert.equal((await db.query<{n:number}>('select count(*)::int n from public.lk_customers')).rows[0].n,0)
 assert.equal((await db.query('select crm_revision from public.lk_quote_requests where id=$1',[id])).rows[0].crm_revision,0)
 const c=await rpc<ResolveCustomerResult>('resolve',args);assert.deepEqual(await rpc('resolve',args),c)
})
test('new tables and functions stay private; receipts/activity cannot be changed or deleted; legacy RPC is outside exposed schema',async()=>{
 await create()
 for(const table of ['lk_customer_commands','lk_customer_activity']) for(const mutation of ['update','delete']) await assert.rejects(db.exec(`${mutation==='update'?'update public.'+table+' set company_id=company_id':'delete from public.'+table}`),code('42501'))
 for(const role of ['anon','authenticated']) {
  await db.exec('reset role;set role '+role)
  for(const table of ['lk_customer_properties','lk_customer_commands','lk_customer_activity']) await assert.rejects(db.exec('select * from public.'+table),code('42501'))
  await assert.rejects(rpc('candidates',{name:'Person'}),code('42501'))
  await assert.rejects(db.query('select lk_crm_internal.lk_customers_legacy_command($1,$2::jsonb)',['create',JSON.stringify(actor)]),code('42501'))
 }
 await db.exec('reset role')
 assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_proc p join pg_namespace n on p.pronamespace=n.oid where p.proname='lk_customers_legacy_command' and n.nspname='public'")).rows[0].n,0)
})

test('restore shared contacts requires fresh candidate review and preserves property audit state',async()=>{
 const a=await create({name:'A',email:'shared@example.invalid'}),b=await create({name:'B',email:a.email,decision:reviewed(a)})
 const archived=await rpc('archive',{id:a.id,...metadata(1)}),blocked=await rpc<{outcome:string}>('restore',{id:a.id,...metadata(archived.revision)})
 assert.equal(blocked.outcome,'needs_review');assert.equal((await detail(a.id)).customer.status,'archived')
 const restored=await rpc('restore',{id:a.id,decision:reviewed(b),...metadata(archived.revision)});assert.equal(restored.status,'active')
 const added=await rpc<{property:CustomerProperty}>('property_create',{id:a.id,...property(),...metadata(restored.revision)})
 await rpc('property_archive',{id:a.id,propertyId:added.property.id,...metadata(1)})
 const audit=(await db.query<{previous_state:string;new_state:string}>("select previous_state,new_state from public.lk_customer_activity where action='property_archive'")).rows[0]
 assert.deepEqual(audit,{previous_state:'active',new_state:'archived'})
})
test('fresh DB membership, upstream session and email proof are checked before receipt replay or private reads',async()=>{
 const args={id:key(),name:'Staff guard',idempotencyKey:key()},created=await rpc('create',args)
 await db.exec('reset role');await db.query("update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{lk_staff,status}','\"revoked\"') where id=$1",[actor.actorUserId]);await db.exec('set role service_role')
 await assert.rejects(rpc('create',args),code('LK403'));await assert.rejects(detail(created.id),code('LK403'))
})

test('signed source hashes, ready photo manifest, auth and real source-current survive CRM/property edits and archive',async()=>{
 const {seedCompanyFixture}=await import('../bookings/infrastructure/live-test-fixtures.mts')
 const fixture=await seedCompanyFixture(db,{email:'signed@example.invalid',simple:true})
 const photo=key(),hash='a'.repeat(64)
 await db.query("insert into public.lk_live_quote_photos(id,company_id,request_id,role,state,mime_type,source_hash,size_bytes,stored_bytes,staging_path,object_path,content_hash,width,height,ready_at) values($1,'lk-group',$2,'overview','ready','image/jpeg',$3,10,10,$4,$5,$3,1,1,now())",[photo,fixture.requestId,hash,'PRIVATE-STAGING/'+photo,'PRIVATE-OBJECT/'+photo])
 // Construct a coherent succeeded estimate and sign its real photo manifest
 // before the baseline. Reinsert fixture rows, preserving immutable guards.
 const manifest=(await db.query<{manifest:unknown}>('select public.lk_live_booking_manifest(r) manifest from public.lk_quote_requests r where id=$1',[fixture.requestId])).rows[0].manifest
 const inputSnapshot={service:fixture.snapshot.payload.service,photos:manifest,coverage:{upperNotApplicable:false,damageNotPresent:true},model:'gpt-6.1-sol',promptVersion:'synthetic',schemaVersion:'synthetic',pricingVersion:'synthetic'}
 await db.query("update public.lk_quote_analysis_jobs set status='succeeded',input_snapshot=$2,analysis=$3,pricing=$4,usage='{}',completed_at=now() where id=$1",[fixture.snapshot.analysisId,inputSnapshot,fixture.snapshot.analysis,fixture.snapshot.pricing])
 const approval=(await db.query<Record<string,unknown>>('select * from public.lk_live_quote_approvals where id=$1',[fixture.approvalId])).rows[0]
 const submission=(await db.query<Record<string,unknown>>('select * from public.lk_live_quote_submissions where id=$1',[fixture.submissionId])).rows[0]
 const signedSnapshot={...fixture.snapshot,inputSnapshot,photos:manifest}
 const signedContentHash=(await db.query<{hash:string}>("select public.lk_live_booking_hash(jsonb_build_object('snapshot',$1::jsonb,'signature',$2::jsonb)) hash",[JSON.stringify(signedSnapshot),JSON.stringify(fixture.signature)])).rows[0].hash
 const snapshotHash=(await db.query<{hash:string}>('select public.lk_live_booking_hash($1::jsonb) hash',[JSON.stringify(signedSnapshot)])).rows[0].hash
 await db.exec('reset role')
 await db.query('delete from public.lk_live_quote_submissions where id=$1',[fixture.submissionId]);await db.query('delete from public.lk_live_quote_approvals where id=$1',[fixture.approvalId])
 await db.query('insert into public.lk_live_quote_approvals select (jsonb_populate_record(null::public.lk_live_quote_approvals,$1::jsonb)).*',[JSON.stringify({...approval,source_snapshot:signedSnapshot,snapshot_hash:snapshotHash})])
 await db.query('insert into public.lk_live_quote_submissions select (jsonb_populate_record(null::public.lk_live_quote_submissions,$1::jsonb)).*',[JSON.stringify({...submission,snapshot:signedSnapshot,snapshot_hash:snapshotHash,signed_content_hash:signedContentHash})])
 await db.exec('set role service_role')
 const current=async()=> (await db.query<{current:boolean}>('select public.lk_live_booking_source_current(r,a) as current from public.lk_live_quote_approvals a join public.lk_quote_requests r on r.id=a.request_id where r.id=$1',[fixture.requestId])).rows[0].current
 assert.equal(await current(),true)
 const sourceTables=(await db.query<{tablename:string}>("select tablename from pg_tables where schemaname='public' and (tablename like 'lk_live_%' or tablename like 'lk_quote_%') and tablename<>'lk_quote_requests' order by tablename")).rows.map(r=>r.tablename)
 async function sources(){const result:Record<string,unknown>={};for(const table of sourceTables) result[table]=(await db.query(`select to_jsonb(t) value from public.${table} t order by to_jsonb(t)::text`)).rows;return result}
 const before=await sources()
 const sourceArgs={type:'quote_request',id:fixture.requestId,expectedSourceRevision:1,expectedCrmRevision:0}
 const resolved=await rpc<ResolveCustomerResult>('resolve',{name:'Synthetic customer',email:fixture.email,phone:'',source:sourceArgs,property:property('1'),idempotencyKey:key()})
 const record=(await detail(resolved.customer.id)).records[0]
 assert.equal(record.photos[0].url,`/api/admin/quote-requests/${fixture.requestId}/photos/${photo}`)
 assert.equal(JSON.stringify(record).includes('PRIVATE-OBJECT'),false)
 const edited=await rpc<{customer:Customer;property:CustomerProperty}>('property_update',{id:resolved.customer.id,propertyId:resolved.property!.id,...property('1'),label:'Future site label',...metadata(1)})
 await rpc('archive',{id:resolved.customer.id,...metadata(edited.customer.revision)})
 assert.deepEqual(await sources(),before)
 assert.equal(await current(),true)
})
