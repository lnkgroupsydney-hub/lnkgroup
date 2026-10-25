import test,{after,beforeEach} from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {currentWorkDb,resetCurrentWork,currentWorkRpc,workDbFailure as fail,tableHash} from '../enquiries/infrastructure/management-test-fixtures.mts'
import {seedCompanyFixture} from '../bookings/infrastructure/live-test-fixtures.mts'
import {validateStaffQuotePayload,type StaffQuoteDraftDetail} from './domain/staff-draft.ts'
const db=await currentWorkDb();beforeEach(()=>resetCurrentWork(db));after(()=>db.close())
const rpc=<T=StaffQuoteDraftDetail>(cmd:string,args:Record<string,unknown>)=>currentWorkRpc<T>(db,cmd,args)
async function setup(){const f=await seedCompanyFixture(db,{simple:true});const contact={...f.snapshot.payload.contact};Reflect.deleteProperty(contact,'consent');return{...f,payload:{contact,service:f.snapshot.payload.service,internalNotes:'Private staff copy'},args:{id:f.requestId,actorUserId:f.staffId,actorSessionId:f.staffSessionId}}}
const mutation=(f:Awaited<ReturnType<typeof setup>>,rev=0)=>({...f.args,expectedRevision:rev,idempotencyKey:randomUUID(),reason:'Staff work copy',payload:f.payload})
test('separate staff work copy saves against its own revision while signed original, pricing, access, photos and source remain byte-identical',async()=>{const f=await setup(),tables=['lk_quote_requests','lk_live_quote_submissions','lk_live_quote_approvals','lk_quote_analysis_jobs','lk_quote_request_access','lk_quote_photos'],before=await Promise.all(tables.map(t=>tableHash(db,t)));const args=mutation(f),one=await rpc('quote_save',args);assert.equal((await rpc('quote_detail',f.args)).draft!.revision,1);await rpc('quote_save',{...mutation(f,1),payload:{...f.payload,contact:{...f.payload.contact,name:'Edited staff contact'}}});await assert.rejects(rpc('quote_save',mutation(f,1)),fail('LK409'));assert.deepEqual(await rpc('quote_save',args),one);assert.deepEqual(await Promise.all(tables.map(t=>tableHash(db,t))),before);const detail=await rpc('quote_detail',f.args);assert.equal(detail.draft!.sourceRevisionAtCreation,1);assert.equal('consent'in detail.draft!.payload.contact,false);assert.equal(detail.source.payload.contact.name,f.snapshot.payload.contact.name);assert.equal(detail.audit.length,2)})
test('DB rejects forbidden original fields, invalid service counts, consent and customer ownership fields',async()=>{const f=await setup();for(const payload of [{...f.payload,pricing:{total:1}},{...f.payload,contact:{...f.payload.contact,consent:true}},{...f.payload,customerId:randomUUID()},{...f.payload,service:{...f.payload.service,doorCount:501}},{...f.payload,service:{...f.payload.service,intent:'other'}},{...f.payload,contact:{...f.payload.contact,phone:'not-a-phone'}}])await assert.rejects(rpc('quote_save',{...mutation(f),payload}),fail('LK422'));assert.equal((await rpc('quote_detail',f.args)).draft,null)})
test('source status and saved/none draft filters apply inside DB count and pagination',async()=>{const a=await setup(),b=await setup();await db.exec('reset role');await db.query("update public.lk_quote_requests set status='review_requested',review_requested_at=now() where id=$1",[b.requestId]);await db.exec('set role service_role');await rpc('quote_save',mutation(b));const list=(status:string,staffDraft:string,page=1)=>rpc<{requests:unknown[];total:number}>('quote_list',{...a.args,status,staffDraft,q:'',page,pageSize:1});assert.equal((await list('all','all')).total,2);assert.equal((await list('draft','none')).total,1);assert.equal((await list('review_requested','saved')).total,1);assert.equal((await list('draft','saved')).total,0);assert.equal((await list('all','saved',2)).requests.length,0);await assert.rejects(list('signed','all'),fail('LK422'))})
test('current staff session and verified current email bind read, mutation and immutable receipt replay',async()=>{const f=await setup(),args=mutation(f);await rpc('quote_save',args);for(const change of ["update auth.users set email='changed@example.invalid' where id=$1","update public.lk_sessions set expires_at=0 where account_sub=$1::text","update public.lk_staff_email_checks set verified_until=0 where user_id=$1"]){await db.exec('reset role');await db.query(change,[f.staffId]);await db.exec('set role service_role');for(const cmd of ['quote_detail','quote_save','quote_receipt'])await assert.rejects(rpc(cmd,args),fail('LK403'))}})
test('D1 DB reads original source for unchanged legacy fields; direct DML and forged source cannot relax changed fields',async()=>{
 const f=await setup(),contact={...f.payload.contact,name:'123',email:'a..b@example.invalid',phone:'legacy invalid phone',siteAddress:'<b>Legacy address</b>',details:'<p>Legacy</p>'},service={...f.payload.service,material:'<b>legacy</b>'}
 await db.exec('reset role');await db.query('update public.lk_quote_requests set payload=jsonb_set(jsonb_set(payload,\'{contact}\',$2::jsonb),\'{service}\',$3::jsonb) where id=$1',[f.requestId,JSON.stringify({...contact,consent:true}),JSON.stringify(service)]);await db.exec('set role service_role')
 const hash=await tableHash(db,'lk_quote_requests'),payload={...f.payload,contact:{...contact,email:' A..B@EXAMPLE.INVALID ',phone:' legacy invalid phone '},service}
 await rpc('quote_save',{...mutation(f),payload});assert.equal((await rpc('quote_detail',f.args)).draft!.revision,1)
 for(const [field,value]of [['name','456'],['email','c..d@example.invalid'],['phone','different invalid phone'],['siteAddress','<i>new</i>'],['details','<p>new</p>']])await assert.rejects(rpc('quote_save',{...mutation(f,1),payload:{...payload,contact:{...payload.contact,[field]:value}}}),fail('LK422'))
 await assert.rejects(rpc('quote_save',{...mutation(f,1),payload,source:{contact}}),fail('LK422'))
 await db.exec('reset role');await assert.rejects(db.query('update public.lk_staff_quote_drafts set payload=jsonb_set(payload,\'{contact,phone}\',\'"changed invalid"\'::jsonb) where request_id=$1',[f.requestId]),fail('LK422'))
 await db.exec('set role service_role');await rpc('quote_save',{...mutation(f,1),payload:{...payload,contact:{...payload.contact,name:'Valid changed name'}}});assert.equal(await tableHash(db,'lk_quote_requests'),hash)
 await db.exec('reset role');const strict=await db.query<{valid:boolean}>('select lk_private.staff_quote_payload_strict_valid($1::jsonb) valid',[JSON.stringify(payload)]);assert.equal(strict.rows[0].valid,false)
})

test('D1 SQL follows ECMAScript trim for tabs, newlines, NBSP and Unicode whitespace in normalized stored contact and service fields',async()=>{
 const f=await setup(),contact={...f.payload.contact,name:'\u00a0123\u00a0',email:'\tA..B@EXAMPLE.INVALID\n',phone:'\tlegacy-bad\n',siteAddress:'\u00a0<b>Legacy address</b>\u00a0',details:'\t<p>Legacy</p>\n'},service={...f.payload.service,material:'\t<b>Legacy material</b>\u00a0',colourPreference:'\u00a0<b>Legacy colour</b>\n'},source={contact:{...contact,consent:true},service}
 await db.exec('reset role');await db.query('update public.lk_quote_requests set payload=$2::jsonb where id=$1',[f.requestId,JSON.stringify(source)]);await db.exec('set role service_role')
 const sourceHash=await tableHash(db,'lk_quote_requests'),payload=validateStaffQuotePayload({...f.payload,contact,service},source)
 assert.equal(payload.contact.phone,'legacy-bad');assert.equal(payload.contact.email,'a..b@example.invalid');assert.equal(payload.service!.material,'<b>Legacy material</b>')
 await rpc('quote_save',{...mutation(f),payload})
 assert.deepEqual((await rpc('quote_detail',f.args)).draft!.payload,payload)
 for(const change of [{contact:{...payload.contact,phone:'different-bad'}},{service:{...payload.service,material:'<b>Different material</b>'}}])await assert.rejects(rpc('quote_save',{...mutation(f,1),payload:{...payload,...change}}),fail('LK422'))
 assert.equal(await tableHash(db,'lk_quote_requests'),sourceHash)
 const whitespace='\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
 await db.exec('reset role');assert.equal((await db.query<{value:string}>('select lk_private.staff_quote_trim($1) value',[whitespace+'core'+whitespace])).rows[0].value,(whitespace+'core'+whitespace).trim())
})


test('all private staff quote helpers deny direct browser and service-role execution while definer saves work',async()=>{
 await db.exec('reset role')
 const helpers=(await db.query<{signature:string}>("select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lk_private' and p.proname like 'staff_quote_%'")).rows
 assert.ok(helpers.length>=6)
 for(const role of ['anon','authenticated','service_role'])for(const helper of helpers)assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege($1,$2,'execute') allowed",[role,helper.signature])).rows[0].allowed,false,role+' '+helper.signature)
 const f=await setup();await rpc('quote_save',mutation(f));assert.equal((await rpc('quote_detail',f.args)).draft!.revision,1)
})
