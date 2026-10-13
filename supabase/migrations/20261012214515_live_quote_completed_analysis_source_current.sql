-- Completed AI inputs do not include request review status or customer contact.
-- Prove the immutable service/photo/coverage/execution snapshot instead of treating
-- every request revision as an AI input change. Approval revisions remain exact.
begin;
create function public.lk_quote_analysis_source_current(j public.lk_quote_analysis_jobs,r public.lk_quote_requests)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(j.company_id=r.company_id and j.request_id=r.id and j.input_revision<=r.revision
 and case when j.status<>'succeeded' then j.input_revision=r.revision else
  j.input_snapshot->'service'=r.payload->'service'
  and j.input_snapshot->'photos'=public.lk_live_booking_manifest(r)
  and jsonb_typeof(j.input_snapshot->'coverage')='object'
  and jsonb_typeof(j.input_snapshot->'coverage'->'upperNotApplicable')='boolean'
  and jsonb_typeof(j.input_snapshot->'coverage'->'damageNotPresent')='boolean'
  and j.input_snapshot->>'model'=j.model
  and j.input_snapshot->>'promptVersion'=j.prompt_version
  and j.input_snapshot->>'schemaVersion'=j.schema_version
  and j.input_snapshot->>'pricingVersion'=j.pricing_version
  and j.consent_version='openai-photo-analysis-v1'
  and not exists(select 1 from public.lk_live_quote_photos p where p.company_id=r.company_id and p.request_id=r.id and p.state='uploading')
 end,false);
$$;
revoke all on function public.lk_quote_analysis_source_current(public.lk_quote_analysis_jobs,public.lk_quote_requests) from public,anon,authenticated;
grant execute on function public.lk_quote_analysis_source_current(public.lk_quote_analysis_jobs,public.lk_quote_requests) to service_role;
create or replace function public.lk_quote_analysis_json(j public.lk_quote_analysis_jobs,r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'requestId',j.request_id,'inputRevision',j.input_revision,'inputKey',j.input_key,'inputSnapshot',j.input_snapshot,'manifest',j.input_snapshot->'photos','status',j.status,'stale',not public.lk_quote_analysis_source_current(j,r),'createdAt',j.created_at,'completedAt',j.completed_at,'analysis',j.analysis,'pricing',j.pricing,'usage',j.usage,'error',j.error,'attempts',j.attempts,'leaseToken',j.lease_token,'leaseExpiresAt',j.lease_expires_at,'model',j.model,'promptVersion',j.prompt_version,'schemaVersion',j.schema_version,'pricingVersion',j.pricing_version,'providerResponseId',j.provider_response_id);
$$;
create or replace function public.lk_live_booking_source_current(r public.lk_quote_requests,a public.lk_live_quote_approvals) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.lk_quote_analysis_jobs j where j.company_id=r.company_id and j.request_id=r.id and j.id=a.analysis_id
 and j.id=(select latest.id from public.lk_quote_analysis_jobs latest where latest.company_id=r.company_id and latest.request_id=r.id order by latest.created_at desc,latest.id desc limit 1)
 and j.status='succeeded' and public.lk_quote_analysis_source_current(j,r) and a.input_revision=r.revision
 and a.source_snapshot->'payload'=r.payload and j.input_snapshot->'service'=r.payload->'service'
 and j.input_snapshot->'photos'=public.lk_live_booking_manifest(r)
 and a.source_snapshot->'inputSnapshot'=j.input_snapshot and a.source_snapshot->'analysis'=j.analysis and a.source_snapshot->'pricing'=j.pricing
 and not exists(select 1 from public.lk_live_quote_photos p where p.company_id=r.company_id and p.request_id=r.id and p.state='uploading'));
$$;
-- Change only the approval source predicate in the existing private command.
-- Fail closed if its audited definition differs; retain all session, revision,
-- pricing, idempotency, submission-lock and delivery protections verbatim.
do $migration$
declare definition text; previous text := $predicate$j.input_revision<>r.revision or j.input_snapshot->'photos' is distinct from manifest or j.input_snapshot->'service' is distinct from r.payload->'service' or exists(select 1 from public.lk_live_quote_photos p where p.company_id=company and p.request_id=r.id and p.state='uploading')$predicate$;
begin
 definition:=pg_get_functiondef('public.lk_live_quote_booking_command(text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,previous,'')))/length(previous)<>1 then
  raise exception 'Unexpected live booking approval definition; migration requires review';
 end if;
 execute replace(definition,previous,'not public.lk_quote_analysis_source_current(j,r)');
end;
$migration$;
commit;
