import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const migrationUrl=new URL('../../../../supabase/migrations/20261014014608_live_quote_no_gst_pricing_v3.sql',import.meta.url)
const source=await readFile(migrationUrl,'utf8')
const body=source.replace(/^--[^\n]*\nbegin;\n/,'').replace(/\ncommit;\s*$/,'')
if(body===source||!body.startsWith('alter table'))throw new Error('Unexpected migration transaction envelope')
const tables=['lk_quote_requests','lk_quote_request_audit','lk_live_quote_photos','lk_quote_analysis_jobs','lk_quote_media_receipts','lk_quote_media_audit','lk_live_quote_approvals','lk_live_quote_submissions','lk_live_quote_booking_receipts','lk_live_booking_confirmed_segments','lk_live_company_booking_requests','lk_live_company_proposals','lk_live_company_acceptances','lk_live_company_bookings','lk_live_company_events','lk_live_company_outbox','lk_live_company_command_receipts','lk_live_company_audit']
const hashQuery="execute format('select count(*), encode(sha256(convert_to(coalesce(string_agg((to_jsonb(r)-%L)::text,E''\\n'' order by (to_jsonb(r)-%L)::text),''''),''UTF8'')),''hex'') from public.%I r',case when t='lk_quote_requests' then 'pricing_version' else '__no_such_column__' end,case when t='lk_quote_requests' then 'pricing_version' else '__no_such_column__' end,t) into c,h;"
const wrapper=`-- Applies the tested v3 migration unchanged and verifies existing business records atomically.
-- Counts in the final result are captured while locks are held, before concurrent new v3 requests can arrive.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table ${tables.map(t=>'public.'+t).join(', ')} in share mode;
create temp table lk_gst_before(table_name text primary key,row_count bigint,row_hash text) on commit drop;
do $before$ declare t text;c bigint;h text;begin
 foreach t in array array[${tables.map(t=>"'"+t+"'").join(',')}] loop
  ${hashQuery}
  insert into lk_gst_before values(t,c,h);
 end loop;
end $before$;

${body}

do $verify$ declare t text;c bigint;h text;b record;report jsonb:='[]'::jsonb;begin
 for b in select * from lk_gst_before order by table_name loop
  t:=b.table_name;
  ${hashQuery}
  if c<>b.row_count or h<>b.row_hash then raise exception 'Existing business records changed: %',t;end if;
  report:=report||jsonb_build_array(jsonb_build_object('table',t,'rows',c,'sha256',h,'unchanged',true));
 end loop;
 if exists(select 1 from public.lk_quote_requests where pricing_version is not null) then raise exception 'Historical pricing policy was rewritten';end if;
 if has_function_privilege('anon','public.lk_quote_pricing_v3_valid(jsonb,jsonb,jsonb,jsonb)','execute') or has_function_privilege('authenticated','public.lk_quote_pricing_v3_valid(jsonb,jsonb,jsonb,jsonb)','execute') or not has_function_privilege('service_role','public.lk_quote_pricing_v3_valid(jsonb,jsonb,jsonb,jsonb)','execute') then raise exception 'Unexpected new pricing execution permissions';end if;
 perform set_config('lk.gst_v3_report',jsonb_build_object('result','GST v3 migration applied','existing_quotes',(select count(*) from public.lk_quote_requests),'repriced_old_quotes',(select count(*) from public.lk_quote_requests where pricing_version is not null),'existing_signed_submissions',(select count(*) from public.lk_live_quote_submissions),'existing_bookings',(select count(*) from public.lk_live_company_bookings),'preservation',report)::text,false);
end $verify$;
-- The caught subtransaction rolls back the temporary request, audit and rate-limit writes.
do $smoke$ declare r jsonb;passed boolean:=false;prior_role text:=current_user;begin
 begin
  execute 'set local role service_role';
  r:=public.lk_quote_requests_command('save',jsonb_build_object('companyId','lk-group','ownerHash',encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),'expiresAt',now()+interval '23 hours','expectedRevision',0,'idempotencyKey',gen_random_uuid(),'storageConsent',true,'consentVersion','quote-storage-review-v1','payload',jsonb_build_object('contact',jsonb_build_object('name','Synthetic GST rollout check','email','gst-rollout@example.invalid','phone','','siteAddress','Synthetic verification only','suburb','Synthetic','postcode','2000','details','Temporary transaction check; no customer request retained.','consent',true),'service',null)));
  if r->>'pricingVersion' is distinct from 'lk-sydney-cabinet-v3-20261014' then raise exception 'New request policy check failed';end if;
  raise exception using errcode='LKTST',message='Rollback temporary request';
 exception when sqlstate 'LKTST' then passed:=true;
 end;
 if not passed or current_user<>prior_role then raise exception 'New policy smoke or role restoration failed';end if;
 perform set_config('lk.gst_v3_smoke','passed; synthetic request rolled back; role restored',false);
end $smoke$;
commit;
select current_setting('lk.gst_v3_report')::jsonb||jsonb_build_object('new_request_check',current_setting('lk.gst_v3_smoke')) as rollout_report;
`
await writeFile(new URL('./atomic-rollout.sql',import.meta.url),wrapper)
console.log(JSON.stringify({migrationSha256:createHash('sha256').update(source).digest('hex'),migrationBodyUnchanged:true,wrapperSha256:createHash('sha256').update(wrapper).digest('hex'),wrapperBytes:Buffer.byteLength(wrapper)},null,2))
