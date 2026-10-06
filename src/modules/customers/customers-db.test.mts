import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Customer, CustomerDetail, CustomerPage, UnlinkedRecordPage } from './domain/contracts.ts'
const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role lk_customers_probe;')
for (const name of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(n => n.endsWith('.sql')).sort()) await db.exec(readFileSync(new URL(`../../../supabase/migrations/${name}`, import.meta.url), 'utf8'))
const tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' and tablename like 'lk_%'")).rows.map(r => r.tablename)
beforeEach(async () => { await db.exec(`reset role; truncate ${tables.map(n => `public.${n}`).join(',')}; set role service_role;`) })
after(() => db.close())
const actor = { companyId: 'lk-group', actorUserId: randomUUID(), actorSessionId: randomUUID() }
const code = (expected: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === expected
async function rpc<T = Customer>(command: string, args: Record<string, unknown> = {}): Promise<T> { return (await db.query<{ r: T }>('select public.lk_customers_command($1,$2::jsonb) r', [command, JSON.stringify({ ...actor, ...args })])).rows[0].r }
const create = (args: Record<string, unknown> = {}) => rpc('create', { id: randomUUID(), name: 'Synthetic customer', email: 'same@example.invalid', idempotencyKey: randomUUID(), ...args })
async function enquiry(args: Record<string, unknown> = {}) {
 const id = randomUUID(), payload = { name: 'Synthetic source', email: 'source@example.invalid', siteAddress: 'TEST ONLY', ...args }
 await db.query("insert into public.lk_enquiries(id,reference,source,payload_json,status,revision,calendar_status) values($1,$2,'web',$3,'submitted',1,'pending')", [id, `TEST-${id.slice(0,8)}`, JSON.stringify(payload)])
 return id
}
async function submission(related?: string) {
 const id = randomUUID(), draft = randomUUID(), photo = randomUUID(), h = randomUUID().replaceAll('-','').repeat(2)
 await db.query("insert into public.lk_quote_drafts(id,owner_hash,payload,payload_hash,revision,expires_at) values($1,$2,'{}',$2,1,now()+interval '1 hour')", [draft, h])
 await db.query('insert into public.lk_quote_submissions(id,draft_id,owner_hash,idempotency_key,request_hash,reference,snapshot,snapshot_hash,signature,calendar_id,email_status,email_provider_id,enquiry_id) values($1,$2,$3,$4,$3,$5,$6,$3,$7,$8,$9,$10,$11)', [id,draft,h,randomUUID(),`DEMO-${id.slice(0,8).toUpperCase()}`,JSON.stringify({ mode:'demo',payload:{contact:{name:'Synthetic signed',email:'signed@example.invalid',siteAddress:'TEST ONLY'}},photos:[{photoId:photo}],secret:'NEVER EXPOSE'}),'{}','calendar',related?'provider_accepted':'pending',related?'synthetic':null,related??null])
 return { id, photo }
}
const list = () => rpc<CustomerPage>('list', { q: '', page: 1, pageSize: 20 })
const unlinked = () => rpc<UnlinkedRecordPage>('unlinked', { q: '', page: 1, pageSize: 20 })
const detail = (id: string) => rpc<CustomerDetail>('detail', { id })
const link = (c: Customer, sourceId: string, sourceType = 'enquiry', args: Record<string, unknown> = {}) => rpc('link', { id:c.id,sourceId,sourceType,reason:'Verified synthetic record',expectedRevision:c.revision,idempotencyKey:randomUUID(),...args })

test('same contact customers remain separate and search is literal with stable pages', async () => {
 const a = await create({ name:'Same Person %' }), b = await create({ name:'Other Person' })
 assert.notEqual(a.id,b.id); assert.equal((await list()).total,2)
 assert.equal((await rpc<CustomerPage>('list',{q:'%',page:1,pageSize:1})).total,1)
 const one = await rpc<CustomerPage>('list',{q:'same@example.invalid',page:1,pageSize:1}), two = await rpc<CustomerPage>('list',{q:'same@example.invalid',page:2,pageSize:1})
 assert.equal(one.total,2);assert.notEqual(one.customers[0].id,two.customers[0].id)
 assert.deepEqual((await detail(a.id)).purchases,{status:'unavailable'}); assert.deepEqual((await detail(a.id)).billing,{status:'unavailable'})
})
test('create retries bind business request and current actor/session without duplicate customers', async () => {
 const key = randomUUID(), args={name:'Retry',idempotencyKey:key,email:null}
 const first = await create(args);assert.deepEqual(await create(args),first)
 for(const changed of [{name:'Different'},{actorUserId:randomUUID()},{actorSessionId:randomUUID()}]) await assert.rejects(create({...args,...changed}),code('LK409'))
 assert.equal((await list()).total,1);assert.equal((await detail(first.id)).audit.length,1)
})
test('link/unlink atomically audit revision, reject stale/conflicting links, and replay original result', async () => {
 const a = await create(), b = await create(), e = await enquiry(), key = randomUUID()
 const before = (await db.query('select * from public.lk_enquiries where id=$1',[e])).rows[0]
 const linked = await link(a,e,'enquiry',{idempotencyKey:key});assert.equal(linked.revision,2)
 assert.deepEqual(await link(a,e,'enquiry',{idempotencyKey:key}),linked)
 await assert.rejects(link(a,e),code('LK409'));await assert.rejects(link(b,e),code('LK409'))
 assert.equal((await unlinked()).total,0);assert.equal((await detail(a.id)).records.length,1)
 const unlinkArgs = {id:a.id,sourceType:'enquiry',sourceId:e,reason:'Wrong person; recover record',expectedRevision:2,idempotencyKey:randomUUID(),action:'unlink'}
 const released=await rpc('unlink',unlinkArgs);assert.equal(released.revision,3)
 assert.deepEqual(await rpc('unlink',unlinkArgs),released)
 assert.deepEqual(await link(a,e,'enquiry',{idempotencyKey:key}),linked)
 assert.equal((await unlinked()).total,1);assert.equal((await detail(a.id)).audit.length,3)
 assert.deepEqual((await db.query('select * from public.lk_enquiries where id=$1',[e])).rows[0],before)
 assert.equal((await link(b,e)).revision,2)
})
test('signed submission and enquiry_id relation are one canonical immutable record', async () => {
 const c=await create(), e=await enquiry(), s=await submission(e)
 assert.equal((await unlinked()).total,1);assert.equal((await unlinked()).records[0].sourceType,'submission')
 await assert.rejects(link(c,e),code('LK409'))
 const before=(await db.query('select snapshot,snapshot_hash,signature from public.lk_quote_submissions where id=$1',[s.id])).rows[0]
 await link(c,s.id,'submission')
 const record=(await detail(c.id)).records[0];assert.deepEqual(record.relatedEnquiryIds,[e]);assert.equal(record.photos[0].url,`/api/operations/bookings/${s.id}/photos/${s.photo}`)
 assert.equal(record.links.quotePdf,`/api/operations/bookings/${s.id}/documents/quote`)
 assert.equal(JSON.stringify(record).includes('NEVER EXPOSE'),false)
 assert.deepEqual((await db.query('select snapshot,snapshot_hash,signature from public.lk_quote_submissions where id=$1',[s.id])).rows[0],before)
})
test('payload.demoSubmissionId relation cannot split across customers', async () => {
 const a=await create(), b=await create(), s=await submission(), e=await enquiry({demoSubmissionId:s.id})
 await assert.rejects(link(a,e),code('LK409'))
 await link(a,s.id,'submission');await assert.rejects(link(b,s.id,'submission'),code('LK409'))
 assert.deepEqual((await detail(a.id)).records[0].relatedEnquiryIds,[e]);assert.equal((await unlinked()).total,0)
})
test('legacy preexisting enquiry association is grouped and can be recovered using canonical submission', async () => {
 const a=await create(),b=await create(),e=await enquiry();const linked=await link(a,e);const s=await submission(e)
 assert.equal((await detail(a.id)).records[0].sourceId,s.id);assert.equal((await unlinked()).total,0)
 await assert.rejects(link(b,s.id,'submission'),code('LK409'))
 await rpc('unlink',{id:a.id,sourceType:'submission',sourceId:s.id,reason:'Recover grouped record',expectedRevision:linked.revision,idempotencyKey:randomUUID(),action:'unlink'})
 assert.equal((await unlinked()).total,1);await link(b,s.id,'submission')
})
test('invalid actor/company/source and missing customers fail without audit or revision changes', async () => {
 const a=await create(), e=await enquiry()
 for(const bad of [{companyId:'other'},{actorUserId:null},{actorSessionId:'invalid'}]) await assert.rejects(link(a,e,'enquiry',bad),code('LK403'))
 await assert.rejects(link(a,randomUUID()),code('LK404'));await assert.rejects(link(a,e,'draft'),code('LK400'))
 await assert.rejects(detail(randomUUID()),code('LK404'));assert.equal((await detail(a.id)).customer.revision,1)
 assert.equal((await detail(a.id)).audit.length,1)
})
test('source unique constraint and customer revision serialize competing writes', async () => {
 const a=await create(),b=await create(),e=await enquiry()
 const results=await Promise.allSettled([link(a,e),link(b,e)])
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
 assert.equal(results.filter(r=>r.status==='rejected').length,1)
 const f=await enquiry(),g=await enquiry(),c=await create()
 const same=await Promise.allSettled([link(c,f),link(c,g)])
 assert.equal(same.filter(r=>r.status==='fulfilled').length,1);assert.equal((await detail(c.id)).customer.revision,2)
})
test('all public roles are denied, RLS/invoker/search path is enforced, audit cannot update/delete', async () => {
 const c=await create()
 await assert.rejects(db.query('update public.lk_customer_audit_events set reason=$1 where customer_id=$2',['tamper',c.id]),code('42501'))
 await assert.rejects(db.query('delete from public.lk_customer_audit_events where customer_id=$1',[c.id]),code('42501'))
 for(const role of ['anon','authenticated','lk_customers_probe']) {
  await db.exec(`reset role;set role ${role}`)
  for(const table of ['lk_customers','lk_customer_record_links','lk_customer_audit_events']) await assert.rejects(db.query(`select * from public.${table}`),code('42501'))
  await assert.rejects(list(),code('42501'));await assert.rejects(db.query('select * from public.lk_customer_records()'),code('42501'))
 }
 await db.exec('reset role')
 assert.equal((await db.query<{n:number}>("select count(*)::int n from pg_class where relname in ('lk_customers','lk_customer_record_links','lk_customer_audit_events') and relrowsecurity")).rows[0].n,3)
 for(const fn of (await db.query<{prosecdef:boolean;proconfig:string[]}>("select prosecdef,proconfig from pg_proc where proname like 'lk_customer%'")).rows) {assert.equal(fn.prosecdef,false);assert.ok(fn.proconfig.includes('search_path=""'))}
})

test('HTTP customer flow reaches isolated SQL and rolls back link/revision when audit persistence fails', async () => {
 const { createCustomerApi } = await import('./infrastructure/api.ts')
 const api = createCustomerApi({ authorize: async () => ({ companyId: actor.companyId, userId: actor.actorUserId, sessionId: actor.actorSessionId }), baseUrl: () => 'http://127.0.0.1:3002', store: { command: async<T>(command:string,args:Record<string,unknown>) => rpc<T>(command,args) } })
 const request = (input:unknown) => new Request('http://127.0.0.1:3002/api/admin/customers',{method:'POST',headers:{origin:'http://127.0.0.1:3002','content-type':'application/json'},body:JSON.stringify(input)})
 const created=await api.create(request({name:'HTTP synthetic',idempotencyKey:randomUUID()}));assert.equal(created.status,201)
 const c=(await created.json()).customer as Customer, e=await enquiry()
 const args={action:'link',sourceType:'enquiry',sourceId:e,reason:'Synthetic match verified',expectedRevision:1,idempotencyKey:randomUUID()}
 await db.exec('reset role;revoke insert on public.lk_customer_audit_events from service_role;set role service_role')
 try { assert.equal((await api.link(request(args),c.id)).status,503) } finally { await db.exec('reset role;grant insert on public.lk_customer_audit_events to service_role;set role service_role') }
 assert.equal((await detail(c.id)).customer.revision,1);assert.equal((await detail(c.id)).records.length,0)
 const linked=await api.link(request(args),c.id);assert.equal(linked.status,200)
 assert.equal((await linked.json()).customer.revision,2)
 const loaded=await api.detail(new Request('http://127.0.0.1:3002/api/admin/customers/'+c.id),c.id)
 assert.equal((await loaded.json()).records.length,1)
})

test('customer search includes linked source reference/contact and excludes unlinked or other customer records', async () => {
 const a=await create({name:'Master A',email:null}),b=await create({name:'Master B',email:null})
 const e=await enquiry({name:'Linked origin name',email:'linked@example.invalid'}),other=await enquiry({name:'Unlinked name',email:'unlinked@example.invalid'})
 await link(a,e)
 const reference=(await db.query<{reference:string}>('select reference from public.lk_enquiries where id=$1',[e])).rows[0].reference
 for(const q of [reference,'Linked origin name','linked@example.invalid']) {
  const page=await rpc<CustomerPage>('list',{q,page:1,pageSize:20});assert.equal(page.total,1);assert.equal(page.customers[0].id,a.id)
 }
 assert.equal((await rpc<CustomerPage>('list',{q:'unlinked@example.invalid',page:1,pageSize:20})).total,0)
 assert.equal((await detail(b.id)).records.length,0);assert.ok(other)
})
test('audit stores bound SHA256 request and minimal receipt without copied customer PII',async()=>{
 const c=await create({name:'Private Name',email:'private@example.invalid',phone:'PRIVATE PHONE',address:'PRIVATE ADDRESS'})
 const row=(await db.query<{request_hash:string;result_json:unknown}>('select request_hash,result_json from public.lk_customer_audit_events where customer_id=$1',[c.id])).rows[0]
 assert.match(row.request_hash,/^[a-f0-9]{64}$/)
 assert.deepEqual(Object.keys(row.result_json as object).sort(),['id','revision','updatedAt'])
 const full=JSON.stringify((await db.query('select * from public.lk_customer_audit_events where customer_id=$1',[c.id])).rows[0])
 for(const secret of ['Private Name','private@example.invalid','PRIVATE PHONE','PRIVATE ADDRESS']) assert.equal(full.includes(secret),false)
})
test('corrupt overlapping submission groups fail closed on mutation and detail without source rewrites',async()=>{
 const a=await create(),b=await create(),s=await submission(),e=await enquiry({demoSubmissionId:s.id})
 const second=await submission(e)
 await assert.rejects(link(a,s.id,'submission'),code('LK409'));await assert.rejects(link(b,second.id,'submission'),code('LK409'))
 // Legacy corrupt linkage fixture only: public command cannot create this state.
 await db.query("insert into public.lk_customer_record_links(company_id,customer_id,source_type,source_id,submission_id) values('lk-group',$1,'submission',$2,$2)",[a.id,s.id])
 await assert.rejects(detail(a.id),code('LK409'));assert.equal((await detail(b.id)).records.length,0)
})
