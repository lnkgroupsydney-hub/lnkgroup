import test, { beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Customer, CustomerDetail, CustomerProperty, ResolveCustomerResult } from './domain/contracts.ts'
import { initializeCustomerFixtureAuth, seedCustomerFixtureStaff } from './infrastructure/customer-test-fixtures.mts'
import { createCustomerApi } from './infrastructure/api.ts'
import { CustomerError } from './domain/validation.ts'
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

test('quote property review API is write-free; same-key existing selection preserves source and replays the immutable receipt',async()=>{
 const c=await create(),first=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('1'),...metadata(1)})
 const second=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('2'),...metadata(first.customer.revision)})
 const id=await quote(),args={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:second.customer.revision,reason:'Reviewed existing client'},property:property(),source:{type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}
 const api=createCustomerApi({authorize:async()=>({companyId:actor.companyId,userId:actor.actorUserId,sessionId:actor.actorSessionId}),baseUrl:()=> 'http://localhost',store:{command:async<T>(command:string,input:Record<string,unknown>):Promise<T>=>{
  try{return(await db.query<{r:T}>('select public.lk_customers_command($1,$2::jsonb) r',[command,JSON.stringify(input)])).rows[0].r}
  catch(error){if(code('LK409')(error))throw new CustomerError(409,'Conflict.');if(code('LK400')(error))throw new CustomerError(400,'Invalid request.');throw error}
 }}})
 const request=(value:unknown)=>new Request('http://localhost/api/admin/customers/resolve',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(value)})
 const snapshot=async()=>Promise.all(['lk_customers','lk_customer_properties','lk_customer_commands','lk_customer_activity','lk_quote_requests','lk_quote_request_access'].map(async table=>(await db.query(`select to_jsonb(t) row from public.${table} t order by to_jsonb(t)::text`)).rows))
 const before=await snapshot(),quoteBefore=(await db.query<Record<string,unknown>>('select * from public.lk_quote_requests where id=$1',[id])).rows[0]
 const review=await api.resolve(request(args));assert.equal(review.status,409)
 const body=await review.json();assert.equal(body.code,'needs_property_review');assert.deepEqual(new Set(body.properties.map((p:CustomerProperty)=>p.id)),new Set([first.property.id,second.property.id]));assert.equal(body.properties.length,2)
 assert.deepEqual(await snapshot(),before,'candidate review or cancel without another POST writes nothing')
 const confirmed={...args,property:undefined,propertyId:first.property.id,expectedPropertyRevision:first.property.revision},response=await api.resolve(request(confirmed));assert.equal(response.status,200)
 const saved=await response.json() as ResolveCustomerResult;assert.equal(saved.property?.id,first.property.id);assert.equal(saved.propertyOutcome,'property_reused');assert.equal(saved.crmRevision,1)
 assert.equal((await detail(c.id)).properties.length,2)
 const quoteAfter=(await db.query<Record<string,unknown>>('select * from public.lk_quote_requests where id=$1',[id])).rows[0]
 for(const column of Object.keys(quoteBefore))if(!['customer_id','property_id','crm_revision'].includes(column))assert.deepEqual(quoteAfter[column],quoteBefore[column],column)
 assert.deepEqual((await snapshot())[5],before[5],'CRM linkage cannot grant or change customer access')
 await rpc('property_update',{id:c.id,propertyId:first.property.id,...property('1'),label:'Changed later',...metadata(first.property.revision)})
 const replay=await api.resolve(request(confirmed));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),saved)
 const changed=await api.resolve(request({...confirmed,propertyId:second.property.id}));assert.equal(changed.status,409,'same key cannot select another property after commit')
})

test('quote different-property review validates reason, full candidate revisions and frozen source before same-key creation',async()=>{
 const c=await create(),first=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('1'),...metadata(1)})
 const second=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('2'),...metadata(first.customer.revision)})
 const id=await quote(),args={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:second.customer.revision,reason:'Reviewed existing client'},property:property(),source:{type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}
 const api=createCustomerApi({authorize:async()=>({companyId:actor.companyId,userId:actor.actorUserId,sessionId:actor.actorSessionId}),baseUrl:()=> 'http://localhost',store:{command:async<T>(command:string,input:Record<string,unknown>):Promise<T>=>{
  try{return(await db.query<{r:T}>('select public.lk_customers_command($1,$2::jsonb) r',[command,JSON.stringify(input)])).rows[0].r}
  catch(error){if(code('LK409')(error))throw new CustomerError(409,'Conflict.');if(code('LK400')(error))throw new CustomerError(400,'Invalid request.');throw error}
 }}})
 const request=(value:unknown)=>new Request('http://localhost/api/admin/customers/resolve',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(value)})
 const before=(await db.query<Record<string,unknown>>('select * from public.lk_quote_requests where id=$1',[id])).rows[0],clientBefore=await detail(c.id)
 const review=await api.resolve(request(args));assert.equal(review.status,409)
 const body=await review.json(),decision={kind:'different_property',reason:'Reviewed all addresses and verified a separate property',reviewedProperties:body.properties.map((p:CustomerProperty)=>({id:p.id,revision:p.revision}))}
 assert.deepEqual(new Set(decision.reviewedProperties.map((p:{id:string})=>p.id)),new Set([first.property.id,second.property.id]))
 for(const reason of ['', ' ', 'x'.repeat(501),'bad\u0000reason'])assert.equal((await api.resolve(request({...args,propertyDecision:{...decision,reason}}))).status,400)
 for(const reviewedProperties of [decision.reviewedProperties.slice(1),decision.reviewedProperties.map((p:{id:string;revision:number})=>({...p,revision:p.revision+1}))]){
  const stale=await api.resolve(request({...args,propertyDecision:{...decision,reviewedProperties}}));assert.equal(stale.status,409);assert.equal((await stale.json()).code,'needs_property_review')
 }
 assert.equal((await api.resolve(request({...args,source:{...args.source,expectedSourceRevision:2},propertyDecision:decision}))).status,409)
 assert.equal((await api.resolve(request({...args,source:{...args.source,expectedCrmRevision:1},propertyDecision:decision}))).status,409)
 assert.deepEqual(await detail(c.id),clientBefore)
 assert.deepEqual((await db.query('select * from public.lk_quote_requests where id=$1',[id])).rows[0],before)
 assert.equal((await db.query<{n:number}>('select count(*)::int n from public.lk_customer_commands where idempotency_key=$1',[args.idempotencyKey])).rows[0].n,0)
 const confirmed={...args,propertyDecision:decision},response=await api.resolve(request(confirmed));assert.equal(response.status,200)
 const saved=await response.json() as ResolveCustomerResult;assert.equal(saved.propertyOutcome,'property_created');assert.equal(saved.crmRevision,1);assert.ok(![first.property.id,second.property.id].includes(saved.property!.id))
 assert.equal((await detail(c.id)).properties.length,3)
 const after=(await db.query<Record<string,unknown>>('select * from public.lk_quote_requests where id=$1',[id])).rows[0]
 for(const column of Object.keys(before))if(!['customer_id','property_id','crm_revision'].includes(column))assert.deepEqual(after[column],before[column],column)
 const replay=await api.resolve(request(confirmed));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),saved)
 assert.equal((await detail(c.id)).properties.length,3)
})

test('linked quote review rejects a concurrently edited property with original client and property revisions and no writes',async()=>{
 const c=await create(),site=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('1'),...metadata(1)})
 const id=await quote(),source={type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0}
 const linked=await rpc<ResolveCustomerResult>('resolve',{name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:site.customer.revision,reason:'Reviewed existing client'},source,idempotencyKey:key()})
 const input={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:linked.customer.revision,reason:'Reviewed existing client'},property:property(),source:{...source,expectedCrmRevision:linked.crmRevision},idempotencyKey:key()}
 const review=await rpc<{outcome:string;properties:CustomerProperty[]}>('resolve',input);assert.equal(review.outcome,'needs_property_review');assert.equal(review.properties[0].id,site.property.id)
 await rpc('property_update',{id:c.id,propertyId:site.property.id,...property('2'),label:'Changed during review',...metadata(site.property.revision)})
 const before=await detail(c.id),quoteBefore=(await db.query('select * from public.lk_quote_requests where id=$1',[id])).rows[0]
 assert.equal(before.properties.find(p=>p.id===site.property.id)?.address.unit,'2')
 const confirmed={...input,property:undefined,propertyId:site.property.id,expectedPropertyRevision:site.property.revision}
 await assert.rejects(rpc('resolve',confirmed),code('LK409'))
 assert.deepEqual(await detail(c.id),before);assert.deepEqual((await db.query('select * from public.lk_quote_requests where id=$1',[id])).rows[0],quoteBefore)
 assert.equal((await db.query<{n:number}>('select count(*)::int n from public.lk_customer_commands where idempotency_key=$1',[input.idempotencyKey])).rows[0].n,0)
})

test('existing customer revision guards apply equally to linked and unlinked quotes before any new property or receipt',async()=>{
 const c=await create(),id=await quote(),source={type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0}
 const args={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:c.revision,reason:'Reviewed existing client'},source,idempotencyKey:key()}
 const linked=await rpc<ResolveCustomerResult>('resolve',args)
 for(const target of [id,await quote()]){
  for(const expectedRevision of [c.revision,2147483648,Number.MAX_SAFE_INTEGER]){
   const stale={...args,decision:{...args.decision,expectedRevision},idempotencyKey:key(),property:property('3'),source:{...source,id:target,expectedCrmRevision:target===id?linked.crmRevision:0}}
   const before=await detail(c.id),quoteBefore=(await db.query('select * from public.lk_quote_requests where id=$1',[target])).rows[0]
   await assert.rejects(rpc('resolve',stale),code('LK409'))
   assert.deepEqual(await detail(c.id),before);assert.deepEqual((await db.query('select * from public.lk_quote_requests where id=$1',[target])).rows[0],quoteBefore)
   assert.equal((await db.query<{n:number}>('select count(*)::int n from public.lk_customer_commands where idempotency_key=$1',[stale.idempotencyKey])).rows[0].n,0)
  }
 }
})

test('selected-property revision is independently required with a fresh customer revision or auto reuse',async()=>{
 const c=await create(),site=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('1'),...metadata(1)})
 const id=await quote(),source={type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0}
 const linked=await rpc<ResolveCustomerResult>('resolve',{name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:site.customer.revision,reason:'Reviewed existing client'},source,idempotencyKey:key()})
 const edited=await rpc<{customer:Customer;property:CustomerProperty}>('property_update',{id:c.id,propertyId:site.property.id,...property('1'),label:'Edited before selection',...metadata(1)})
 const original=(await db.query('select * from public.lk_quote_requests where id=$1',[id])).rows[0]
 for(const decision of [{kind:'existing',customerId:c.id,expectedRevision:edited.customer.revision,reason:'Reviewed latest client'},{kind:'auto'}]){
  for(const expectedPropertyRevision of [undefined,site.property.revision,2147483648,Number.MAX_SAFE_INTEGER]){
   const input={name:'Quote Client',email:'quote@example.invalid',decision,propertyId:site.property.id,...(expectedPropertyRevision!==undefined?{expectedPropertyRevision}:{}),source:{...source,expectedCrmRevision:linked.crmRevision},idempotencyKey:key()}
   await assert.rejects(rpc('resolve',input),code('LK409'))
   assert.deepEqual((await db.query('select * from public.lk_quote_requests where id=$1',[id])).rows[0],original)
   assert.equal((await db.query<{n:number}>('select count(*)::int n from public.lk_customer_commands where idempotency_key=$1',[input.idempotencyKey])).rows[0].n,0)
  }
 }
 const api=createCustomerApi({authorize:async()=>({companyId:actor.companyId,userId:actor.actorUserId,sessionId:actor.actorSessionId}),baseUrl:()=> 'http://localhost',store:{command:async<T>(command:string,input:Record<string,unknown>):Promise<T>=>{
  try{return(await db.query<{r:T}>('select public.lk_customers_command($1,$2::jsonb) r',[command,JSON.stringify(input)])).rows[0].r}
  catch(error){if(code('LK409')(error))throw new CustomerError(409,'Conflict.');throw error}
 }}})
 for(const expectedPropertyRevision of [2147483648,Number.MAX_SAFE_INTEGER]){
  const input={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'auto'},propertyId:site.property.id,expectedPropertyRevision,source:{...source,expectedCrmRevision:linked.crmRevision},idempotencyKey:key()}
  const response=await api.resolve(new Request('http://localhost/api/admin/customers/resolve',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(input)}))
  assert.equal(response.status,409);assert.equal((await response.json()).code,'conflict')
  assert.deepEqual((await db.query('select * from public.lk_quote_requests where id=$1',[id])).rows[0],original)
  assert.equal((await db.query<{n:number}>('select count(*)::int n from public.lk_customer_commands where idempotency_key=$1',[input.idempotencyKey])).rows[0].n,0)
 }
 const confirmed={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:edited.customer.revision,reason:'Reviewed latest client'},propertyId:site.property.id,expectedPropertyRevision:edited.property.revision,source:{...source,expectedCrmRevision:linked.crmRevision},idempotencyKey:key()}
 const saved=await rpc<ResolveCustomerResult>('resolve',confirmed);assert.equal(saved.property?.id,site.property.id);assert.equal(saved.property?.revision,edited.property.revision)
 await rpc('property_update',{id:c.id,propertyId:site.property.id,...property('1'),label:'Edited after save',...metadata(edited.property.revision)})
 assert.deepEqual(await rpc('resolve',confirmed),saved)
 await assert.rejects(rpc('resolve',{...confirmed,expectedPropertyRevision:edited.property.revision+1}),code('LK409'))
})

test('pre-guard selected-property receipts replay unchanged through the API after the migration without synthesizing a revision',async()=>{
 const original=readFileSync(new URL('../../../supabase/migrations/20261013032527_ems_customer_properties_crm.sql',import.meta.url),'utf8')
 const start=original.indexOf('create function public.lk_customers_command('),end=original.indexOf('end;$$;',start)+'end;$$;'.length
 const legacy=original.slice(start,end).replace('create function public.lk_customers_command(','create or replace function public.lk_customers_command(')
 const guardName=readdirSync(new URL('../../../supabase/migrations/',import.meta.url)).find(name=>name.endsWith('_ems_customer_resolve_revision_guard.sql'));assert.ok(guardName)
 const guard=readFileSync(new URL('../../../supabase/migrations/'+guardName,import.meta.url),'utf8')
 let guarded=false,captured:Record<string,unknown>={}
 try{
  await db.exec('reset role;'+legacy+';set role service_role;')
  const c=await create(),site=await rpc<{customer:Customer;property:CustomerProperty}>('property_create',{id:c.id,...property('1'),...metadata(1)})
  const id=await quote(),input={name:'Quote Client',email:'quote@example.invalid',decision:{kind:'existing',customerId:c.id,expectedRevision:site.customer.revision,reason:'Reviewed existing client'},propertyId:site.property.id,source:{type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},idempotencyKey:key()}
  const api=createCustomerApi({authorize:async()=>({companyId:actor.companyId,userId:actor.actorUserId,sessionId:actor.actorSessionId}),baseUrl:()=> 'http://localhost',store:{command:async<T>(command:string,args:Record<string,unknown>):Promise<T>=>{
   captured=args
   try{return(await db.query<{r:T}>('select public.lk_customers_command($1,$2::jsonb) r',[command,JSON.stringify(args)])).rows[0].r}
   catch(error){if(code('LK409')(error))throw new CustomerError(409,'Conflict.');throw error}
  }}})
  const request=(value:unknown)=>new Request('http://localhost/api/admin/customers/resolve',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(value)})
  const created=await api.resolve(request(input));assert.equal(created.status,200);const receipt=await created.json()
  assert.equal('expectedPropertyRevision' in captured,false)
  const before=(await db.query('select * from public.lk_customer_commands where idempotency_key=$1',[input.idempotencyKey])).rows[0]
  await db.exec('reset role;'+guard+'set role service_role;');guarded=true
  const replay=await api.resolve(request(input));assert.equal(replay.status,200);assert.deepEqual(await replay.json(),receipt);assert.equal('expectedPropertyRevision' in captured,false)
  assert.deepEqual((await db.query('select * from public.lk_customer_commands where idempotency_key=$1',[input.idempotencyKey])).rows[0],before)
  const fresh={...input,decision:{...input.decision,expectedRevision:receipt.customer.revision},source:{...input.source,expectedCrmRevision:receipt.crmRevision},idempotencyKey:key()}
  assert.equal((await api.resolve(request(fresh))).status,409,'only an existing matching receipt may omit the property revision')
  const security=(await db.query<{prosecdef:boolean;proconfig:string[];public_access:boolean;anon_access:boolean;authenticated_access:boolean;service_access:boolean}>("select p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon_access,has_function_privilege('authenticated',p.oid,'execute') authenticated_access,has_function_privilege('service_role',p.oid,'execute') service_access from pg_proc p where p.oid='public.lk_customers_command(text,jsonb)'::regprocedure")).rows[0]
  assert.equal(security.prosecdef,false);assert.deepEqual(security.proconfig,['search_path=""']);assert.equal(security.anon_access,false);assert.equal(security.authenticated_access,false);assert.equal(security.service_access,true)
 }finally{if(!guarded)await db.exec('reset role;'+guard+'set role service_role;')}
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
test('API explicit legacy-contact reuse preserves client fields and rejects missing clients, stale source and unverified email without creating clients',async()=>{
 const c=await create({name:'Current client',email:'current@example.invalid',phone:'0412 345 678',address:'10 Test Street'}),id=await quote('a..b@example.invalid','12345')
 const api=createCustomerApi({authorize:async()=>({companyId:actor.companyId,userId:actor.actorUserId,sessionId:actor.actorSessionId}),baseUrl:()=> 'http://localhost',store:{command:async<T>(command:string,args:Record<string,unknown>):Promise<T> => {
  try { return (await db.query<{r:T}>('select public.lk_customers_command($1,$2::jsonb) r',[command,JSON.stringify(args)])).rows[0].r }
  catch(error) { if(code('LK404')(error)) throw new CustomerError(404,'Customer not found.');if(code('LK409')(error)) throw new CustomerError(409,'Conflict.');throw error }
 }}})
 const source={type:'quote_request',id,expectedSourceRevision:1,expectedCrmRevision:0},decision={kind:'existing',customerId:c.id,expectedRevision:1,reason:'Reviewed stored contact'},input={name:'<b>Legacy client</b>',email:'a..b@example.invalid',phone:'call me later',address:'12345',decision,source,idempotencyKey:key()}
 const request=(value:unknown)=>new Request('http://localhost/api/admin/customers/resolve',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify(value)})
 for(const [changed,status] of [[{decision:{...decision,customerId:key()}},404],[{decision:{...decision,expectedRevision:2}},409],[{source:{...source,expectedSourceRevision:2}},409],[{source:{...source,expectedCrmRevision:1}},409],[{source:{...source,id:await quote('unverified@example.invalid','12345',false)}},409]] as const) {
  assert.equal((await api.resolve(request({...input,...changed,idempotencyKey:key()}))).status,status)
  assert.deepEqual((await detail(c.id)).customer,c)
  assert.equal((await rpc<{total:number}>('list',{q:'',page:1,pageSize:20})).total,1)
 }
 const before=(await db.query<{payload:unknown}>('select payload from public.lk_quote_requests where id=$1',[id])).rows[0].payload
 const response=await api.resolve(request(input));assert.equal(response.status,200)
 const result=await response.json() as ResolveCustomerResult
 assert.equal(result.outcome,'client_reused');assert.equal(result.customer.id,c.id);assert.equal(result.crmRevision,1)
 for(const field of ['name','email','phone','address'] as const) assert.equal(result.customer[field],c[field])
 assert.deepEqual((await db.query<{payload:unknown}>('select payload from public.lk_quote_requests where id=$1',[id])).rows[0].payload,before)
 const retry=await api.resolve(request(input));assert.equal(retry.status,200);assert.deepEqual(await retry.json(),result)
 assert.equal((await rpc<{total:number}>('list',{q:'',page:1,pageSize:20})).total,1)
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
