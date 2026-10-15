import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {readFile,readdir,writeFile} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {initializeCompanyFixtureAuth,seedCompanyFixture,companyRpc,companyProof} from '../../../../src/modules/bookings/infrastructure/live-test-fixtures.mts'
import type {LiveCompanyWorkerClaim} from '../../../../src/modules/bookings/domain/live-contracts.ts'
const migrationDir=new URL('../../../../supabase/migrations/',import.meta.url),wrapper=await readFile(new URL('./atomic-rollout.sql',import.meta.url),'utf8'),db=new PGlite()
const tables=['lk_quote_requests','lk_quote_request_audit','lk_live_quote_photos','lk_quote_analysis_jobs','lk_quote_media_receipts','lk_quote_media_audit','lk_live_quote_approvals','lk_live_quote_submissions','lk_live_quote_booking_receipts','lk_live_booking_confirmed_segments','lk_live_company_booking_requests','lk_live_company_proposals','lk_live_company_acceptances','lk_live_company_bookings','lk_live_company_events','lk_live_company_outbox','lk_live_company_command_receipts','lk_live_company_audit','lk_rate_buckets']
const saveArgs=(ownerHash:string)=>({companyId:'lk-group',ownerHash,expiresAt:new Date(Date.now()+23*3600000).toISOString(),expectedRevision:0,idempotencyKey:randomUUID(),storageConsent:true,consentVersion:'quote-storage-review-v1',payload:{contact:{name:'Synthetic existing guest',email:'legacy-guest@example.invalid',phone:'',siteAddress:'Synthetic existing address',suburb:'Synthetic',postcode:'2000',details:'Synthetic only',consent:true},service:null}})
const save=async(ownerHash:string)=>(await db.query<{request:Record<string,unknown>}>("select public.lk_quote_requests_command('save',$1::jsonb) request",[JSON.stringify(saveArgs(ownerHash))])).rows[0].request
try {
 assert.equal(process.version,'v24.14.1')
 await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);')
 const migrations=(await readdir(migrationDir)).filter(n=>n.endsWith('.sql')&&!n.endsWith('_live_quote_no_gst_pricing_v3.sql')).sort()
 for(const name of migrations)await db.exec(await readFile(new URL(name,migrationDir),'utf8'))
 await initializeCompanyFixtureAuth(db);await db.exec('set role service_role');await save('e'.repeat(64))
 const fixture=await seedCompanyFixture(db,{simple:true,email:'historical-signed@example.invalid'})
 const args={...fixture.staffArgs,expectedRevision:0,idempotencyKey:randomUUID(),takeOffEndLocal:'2030-01-01T10:00',installStartLocal:'2030-01-08T09:00',installEndLocal:'2030-01-08T11:00',companyNote:'Synthetic original booking and price preserved.'}
 const prepared=await companyRpc<{hash:string}>(db,'staff_prepare_request',args)
 await companyRpc(db,'staff_confirm_request',{...args,calendarCheck:companyProof(prepared.hash)})
 const leaseToken=randomUUID(),claim=await companyRpc<LiveCompanyWorkerClaim>(db,'worker_claim',{requestId:fixture.requestId,leaseToken})
 for(const event of claim.booking!.events)await companyRpc(db,'record_event',{id:claim.id,leaseToken,...event,payloadHash:'a'.repeat(64),etag:'synthetic'})
 await companyRpc(db,'finish_calendar',{id:claim.id,leaseToken,calendarCheck:companyProof(prepared.hash)})
 await db.exec('reset role')
 const snapshot=async()=>{
  const result:Record<string,unknown>={}
  for(const table of tables)result[table]=(await db.query(`select ${table==='lk_quote_requests'?"to_jsonb(r)-'pricing_version'":'to_jsonb(r)'} row from public.${table} r order by to_jsonb(r)::text`)).rows
  return result
 }
 const before=await snapshot()
 // Prove that a preservation failure aborts both the row mutation and all schema changes.
 const poisoned=wrapper.replace('do $verify$',"update public.lk_quote_requests set payload=jsonb_set(payload,'{contact,details}','\"Synthetic injected mismatch\"') where owner_hash=repeat('e',64);\ndo $verify$")
 await assert.rejects(db.exec(poisoned),(e:unknown)=>e instanceof Error&&e.message.includes('Existing business records changed'))
 await db.exec('rollback');assert.deepEqual(await snapshot(),before)
 assert.equal((await db.query<{exists:boolean}>("select exists(select 1 from pg_attribute where attrelid='public.lk_quote_requests'::regclass and attname='pricing_version' and not attisdropped) exists")).rows[0].exists,false)
 const applied=await db.exec(wrapper),report=applied.at(-1)!.rows[0].rollout_report as Record<string,unknown>
 assert.deepEqual(await snapshot(),before)
 assert.equal((await db.query<{role:string}>('select current_user role')).rows[0].role,'postgres')
 assert.equal((await db.query<{count:number}>("select count(*)::int count from public.lk_quote_requests where pricing_version is not null")).rows[0].count,0)
 assert.equal(report.existing_quotes,2);assert.equal(report.repriced_old_quotes,0);assert.equal(report.existing_signed_submissions,1);assert.equal(report.existing_bookings,1)
 assert.equal((report.preservation as Array<{unchanged:boolean}>).length,18);assert.ok((report.preservation as Array<{unchanged:boolean}>).every(r=>r.unchanged))
 // Simulate a new concurrent request arriving after COMMIT: the frozen old-row count remains zero.
 await db.exec('begin;set local role service_role');assert.equal((await save('f'.repeat(64))).pricingVersion,'lk-sydney-cabinet-v3-20261014')
 const frozen=(await db.query<{report:Record<string,unknown>}>("select current_setting('lk.gst_v3_report')::jsonb report")).rows[0].report;assert.equal(frozen.repriced_old_quotes,0)
 assert.equal((await db.query<{count:number}>("select count(*)::int count from public.lk_quote_requests where pricing_version is not null")).rows[0].count,1)
 await db.exec('rollback');assert.deepEqual(await snapshot(),before)
 const result={node:process.version,wrapperSha256:createHash('sha256').update(wrapper).digest('hex'),preV3Migrations:migrations.length,passed:true,seeded:{oldGuestRequests:1,oldSignedSubmissions:1,oldConfirmedBookings:1,confirmedSegments:2,verifiedCalendarEvents:2},all18TablesUnchanged:true,rateBucketsUnchanged:true,syntheticSmokeNoRowsPersisted:true,roleRestored:'postgres',failedPreservationRollsBackSchemaAndRows:true,postCommitNewRequestDoesNotChangeHistoricalReport:true,rolloutReport:report}
 await writeFile(new URL('./verification-result.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
} finally {await db.close()}
