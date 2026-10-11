-- Private photo / AI sidecar. No business prices, old demo writes or paid retries.
begin;
-- The test database has no Storage extension. Production uses private buckets
-- with separate byte and MIME limits for untrusted originals / normalized bytes.
do $buckets$
begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('live-quote-staging','live-quote-staging',false,10485760,array['image/jpeg','image/png','image/webp']),
         ('live-quote-photos','live-quote-photos',false,3145728,array['image/jpeg'])
   on conflict(id) do nothing$q$;
  if exists(select 1 from storage.buckets where id in ('live-quote-staging','live-quote-photos') and public) then
   raise exception 'Live quote buckets must be private';
  end if;
 end if;
end;
$buckets$;
create table public.lk_live_quote_photos (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), request_id uuid not null,
 role text not null check(role in ('overview','upper','lower','side','damage')),
 state text not null default 'uploading' check(state in ('uploading','ready','deleted')),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 size_bytes integer not null check(size_bytes between 1 and 10485760), stored_bytes integer check(stored_bytes between 1 and 3145728),
 staging_path text not null unique, object_path text not null unique, content_hash text check(content_hash ~ '^[a-f0-9]{64}$'),
 width integer, height integer, created_at timestamptz not null default now(), upload_expires_at timestamptz not null default now()+interval '1 hour', staging_cleaned_at timestamptz, ready_at timestamptz, deleted_at timestamptz,
 unique(company_id,request_id,id), foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id),
 check(state<>'ready' or (content_hash is not null and stored_bytes is not null and width is not null and height is not null and width>0 and height>0 and width::bigint*height<=40000000 and ready_at is not null))
);
create unique index lk_live_quote_photos_active_hash on public.lk_live_quote_photos(company_id,request_id,content_hash) where state='ready';
create index lk_live_quote_photos_request on public.lk_live_quote_photos(company_id,request_id,created_at,id);
create table public.lk_quote_analysis_jobs (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), request_id uuid not null,
 input_revision integer not null check(input_revision>0), input_key text not null check(input_key ~ '^[a-f0-9]{64}$'),
 input_snapshot jsonb not null check(jsonb_typeof(input_snapshot)='object' and not (input_snapshot ? 'contact')),
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed','uncertain')),
 model text not null check(model='gpt-6.1-sol'), prompt_version text not null, schema_version text not null, pricing_version text not null,
 consent_version text not null check(consent_version='openai-photo-analysis-v1'), consented_at timestamptz not null default now(),
 attempts integer not null check(attempts between 1 and 3), retry_of uuid references public.lk_quote_analysis_jobs(id),
 lease_token uuid, lease_expires_at timestamptz, analysis jsonb, pricing jsonb, usage jsonb, provider_response_id text, error text,
 completion_hash text, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
 unique(company_id,request_id,input_key,attempts), foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id),
 check(status<>'succeeded' or (jsonb_typeof(analysis) is not distinct from 'object' and jsonb_typeof(pricing) is not distinct from 'object' and jsonb_typeof(usage) is not distinct from 'object' and completed_at is not null))
);
create index lk_quote_analysis_jobs_retry on public.lk_quote_analysis_jobs(retry_of) where retry_of is not null;
create index lk_quote_analysis_jobs_request on public.lk_quote_analysis_jobs(company_id,request_id,created_at desc,id);
create index lk_quote_analysis_jobs_queue on public.lk_quote_analysis_jobs(company_id,created_at,id) where status='queued';
create table public.lk_quote_media_receipts (
 company_id text not null check(company_id='lk-group'), request_id uuid not null, owner_hash text not null,
 idempotency_key uuid not null, command_hash text not null, result_json jsonb not null, created_at timestamptz not null default now(),
 primary key(company_id,owner_hash,idempotency_key), foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id)
);
create table public.lk_quote_media_audit (
 id uuid primary key default gen_random_uuid(), company_id text not null check(company_id='lk-group'), request_id uuid not null,
 action text not null check(action in ('photo_begin','photo_finalize','photo_remove','reopen','analysis_start','analysis_claim','analysis_finish','analysis_fail','analysis_expired')),
 actor_type text not null check(actor_type in ('guest','worker')), revision integer not null, photo_id uuid, job_id uuid,
 created_at timestamptz not null default now(), foreign key(company_id,request_id) references public.lk_quote_requests(company_id,id)
);
create index lk_quote_media_audit_request on public.lk_quote_media_audit(company_id,request_id,created_at desc);
alter table public.lk_live_quote_photos enable row level security;
alter table public.lk_quote_analysis_jobs enable row level security;
alter table public.lk_quote_media_receipts enable row level security;
alter table public.lk_quote_media_audit enable row level security;
revoke all on public.lk_live_quote_photos,public.lk_quote_analysis_jobs,public.lk_quote_media_receipts,public.lk_quote_media_audit from public,anon,authenticated,service_role;
grant select,insert,update on public.lk_live_quote_photos,public.lk_quote_analysis_jobs to service_role;
grant select,insert on public.lk_quote_media_receipts,public.lk_quote_media_audit to service_role;

create function public.lk_live_quote_photo_json(p public.lk_live_quote_photos) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'requestId',p.request_id,'role',p.role,'state',p.state,'mimeType',p.mime_type,'sizeBytes',p.size_bytes,'sourceHash',p.source_hash,'storedBytes',p.stored_bytes,'stagingPath',p.staging_path,'objectPath',p.object_path,'contentHash',p.content_hash,'width',p.width,'height',p.height,'createdAt',p.created_at,'expiresAt',p.upload_expires_at);
$$;
create function public.lk_quote_analysis_json(j public.lk_quote_analysis_jobs,r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',j.id,'requestId',j.request_id,'inputRevision',j.input_revision,'inputKey',j.input_key,'inputSnapshot',j.input_snapshot,'manifest',j.input_snapshot->'photos','status',j.status,'stale',j.input_revision<>r.revision,'createdAt',j.created_at,'completedAt',j.completed_at,'analysis',j.analysis,'pricing',j.pricing,'usage',j.usage,'error',j.error,'attempts',j.attempts,'leaseToken',j.lease_token,'leaseExpiresAt',j.lease_expires_at,'model',j.model,'promptVersion',j.prompt_version,'schemaVersion',j.schema_version,'pricingVersion',j.pricing_version,'providerResponseId',j.provider_response_id);
$$;
create function public.lk_quote_workspace_json(r public.lk_quote_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('request',public.lk_quote_request_json(r),
 'photos',coalesce((select jsonb_agg(public.lk_live_quote_photo_json(p) order by p.created_at,p.id) from public.lk_live_quote_photos p where p.company_id=r.company_id and p.request_id=r.id and p.state<>'deleted'),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(x.item order by x.created_at desc,x.id desc) from (select public.lk_quote_analysis_json(j,r) item,j.created_at,j.id from public.lk_quote_analysis_jobs j where j.company_id=r.company_id and j.request_id=r.id order by j.created_at desc,j.id desc limit 20) x),'[]'::jsonb),
 'latest',(select public.lk_quote_analysis_json(j,r) from public.lk_quote_analysis_jobs j where j.company_id=r.company_id and j.request_id=r.id order by j.created_at desc,j.id desc limit 1));
$$;

create function public.lk_quote_media_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 r public.lk_quote_requests; p public.lk_live_quote_photos; j public.lk_quote_analysis_jobs; receipt public.lk_quote_media_receipts;
 owner text; company text; key uuid; expected integer; fingerprint text; result jsonb; photoid uuid; jobid uuid; lease uuid;
 manifest jsonb; snapshot jsonb; inputkey text; attempt integer; previous public.lk_quote_analysis_jobs; completion text;
 auditaction text; isworker boolean; isstaff boolean;
begin
 company:=args->>'companyId';
 if company is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company access denied.'; end if;
 isworker:=command in ('analysis_claim','analysis_finish','analysis_fail','analysis_get','queued_jobs','staging_cleanup','staging_cleaned');
 isstaff:=command in ('staff_workspace','staff_photo');
 if isworker then
  if current_user<>'service_role' then raise exception using errcode='LK403',message='Internal worker access required.'; end if;
  if command='staging_cleanup' then
   return coalesce((select jsonb_agg(public.lk_live_quote_photo_json(x)) from (select * from public.lk_live_quote_photos where company_id=company and staging_cleaned_at is null and upload_expires_at<now()-interval '2 hours' order by created_at,id limit 25) x),'[]'::jsonb);
  end if;
  if command='staging_cleaned' then
   if coalesce(args->>'photoId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid photo identifier.'; end if;
   update public.lk_live_quote_photos set staging_cleaned_at=now() where company_id=company and id=(args->>'photoId')::uuid and upload_expires_at<now()-interval '2 hours';
   return 'true'::jsonb;
  end if;
  if command='queued_jobs' then
   if coalesce(args->>'limit','5') !~ '^[1-5]$' then raise exception using errcode='LK400',message='Invalid queue limit.'; end if;
   -- A runner restart recovers interrupted calls as uncertain, never requeues.
   for r in select a.* from public.lk_quote_requests a where a.company_id=company and exists(
    select 1 from public.lk_quote_analysis_jobs q where q.company_id=company and q.request_id=a.id and q.status='running' and q.lease_expires_at<=now()
   ) order by a.id for update loop
    with expired as (
     update public.lk_quote_analysis_jobs set status='uncertain',error='Analysis interrupted. Confirm an explicit retry before another paid request.',completed_at=now()
     where company_id=company and request_id=r.id and status='running' and lease_expires_at<=now() returning id
    ) insert into public.lk_quote_media_audit(company_id,request_id,action,actor_type,revision,job_id)
     select company,r.id,'analysis_expired','worker',r.revision,id from expired;
   end loop;
   return coalesce((select jsonb_agg(x.item) from (select public.lk_quote_analysis_json(q,a) item from public.lk_quote_analysis_jobs q join public.lk_quote_requests a on a.company_id=q.company_id and a.id=q.request_id where q.company_id=company and q.status='queued' order by q.created_at,q.id limit coalesce((args->>'limit')::integer,5)) x),'[]'::jsonb);
  end if;
  if coalesce(args->>'jobId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid analysis identifier.'; end if;
  jobid:=(args->>'jobId')::uuid;
  -- Request row first: same ordering as customer writes, avoids job/request deadlock.
  select a.* into r from public.lk_quote_requests a join public.lk_quote_analysis_jobs q on q.request_id=a.id and q.company_id=a.company_id where q.id=jobid and q.company_id=company for update of a;
  if not found then raise exception using errcode='LK404',message='Analysis not found.'; end if;
  select * into j from public.lk_quote_analysis_jobs where id=jobid and company_id=company for update;
  if j.status='running' and j.lease_expires_at<=now() then
   update public.lk_quote_analysis_jobs set status='uncertain',error='Analysis interrupted. Confirm an explicit retry before another paid request.',completed_at=now() where id=j.id returning * into j;
   insert into public.lk_quote_media_audit(company_id,request_id,action,actor_type,revision,job_id) values(company,r.id,'analysis_expired','worker',r.revision,j.id);
  end if;
  if command='analysis_get' then return public.lk_quote_analysis_json(j,r); end if;
  if coalesce(args->>'leaseToken','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid worker lease.'; end if;
  lease:=(args->>'leaseToken')::uuid;
  if command='analysis_claim' then
   if j.status<>'queued' then return null; end if;
   update public.lk_quote_analysis_jobs set status='running',lease_token=lease,lease_expires_at=now()+interval '240 seconds',started_at=now() where id=j.id returning * into j;
   insert into public.lk_quote_media_audit(company_id,request_id,action,actor_type,revision,job_id) values(company,r.id,command,'worker',r.revision,j.id);
   return public.lk_quote_analysis_json(j,r);
  end if;
  completion:=encode(sha256(convert_to(jsonb_build_object('command',command,'analysis',args->'analysis','pricing',args->'pricing','usage',args->'usage','providerResponseId',args->'providerResponseId','status',args->'status','error',args->'error')::text,'UTF8')),'hex');
  if j.status in ('succeeded','failed','uncertain') and j.lease_token=lease and j.completion_hash=completion then return public.lk_quote_workspace_json(r); end if;
  if j.status<>'running' or j.lease_token is distinct from lease then
   -- Return committed timeout transition; raising would roll it back.
   if j.status='uncertain' and j.completion_hash is null then return public.lk_quote_workspace_json(r); end if;
   raise exception using errcode='LK409',message='Analysis lease changed or completed.';
  end if;
  if command='analysis_finish' then
   if jsonb_typeof(args->'analysis') is distinct from 'object' or jsonb_typeof(args->'pricing') is distinct from 'object' or jsonb_typeof(args->'usage') is distinct from 'object'
    or length((args->'analysis')::text)>100000 or length((args->'pricing')::text)>20000 or length((args->'usage')::text)>8000
    or args->'pricing'->>'status' is distinct from 'awaiting_company_rates' or args->'pricing'->>'currency' is distinct from 'AUD' or args->'pricing'->>'pricingVersion' is distinct from 'unconfigured' or args->'pricing'->'subtotal' is distinct from 'null'::jsonb or args->'pricing'->'tax' is distinct from 'null'::jsonb or args->'pricing'->'total' is distinct from 'null'::jsonb or args->'pricing'->'lineItems' is distinct from '[]'::jsonb
    or coalesce(length(args->>'providerResponseId'),0) not between 1 and 200 then raise exception using errcode='LK400',message='Invalid validated analysis result.'; end if;
   update public.lk_quote_analysis_jobs set status='succeeded',analysis=args->'analysis',pricing=args->'pricing',usage=args->'usage',provider_response_id=args->>'providerResponseId',completed_at=now(),completion_hash=completion where id=j.id returning * into j;
  else
   if args->>'status' is null or args->>'status' not in ('failed','uncertain') or coalesce(length(args->>'error'),0) not between 1 and 300 or coalesce(jsonb_typeof(args->'usage'),'null') not in ('object','null') or coalesce(length((args->'usage')::text),0)>8000 or coalesce(length(args->>'providerResponseId'),0)>200 then raise exception using errcode='LK400',message='Invalid safe analysis failure.'; end if;
   update public.lk_quote_analysis_jobs set status=args->>'status',error=args->>'error',usage=case when jsonb_typeof(args->'usage')='object' then args->'usage' else null end,provider_response_id=args->>'providerResponseId',completed_at=now(),completion_hash=completion where id=j.id returning * into j;
  end if;
  insert into public.lk_quote_media_audit(company_id,request_id,action,actor_type,revision,job_id) values(company,r.id,command,'worker',r.revision,j.id);
  return public.lk_quote_workspace_json(r);
 end if;
 if isstaff then
  if coalesce(args->>'actorUserId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or coalesce(args->>'actorSessionId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK403',message='Verified staff actor required.'; end if;
  if coalesce(args->>'id','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid request identifier.'; end if;
  select * into r from public.lk_quote_requests where company_id=company and id=(args->>'id')::uuid for update;
 else
  if command not in ('workspace','photo_lookup','photo_begin','photo_finalize','photo_remove','reopen','analysis_start') then raise exception using errcode='LK400',message='Invalid photo analysis command.'; end if;
  owner:=args->>'ownerHash';
  if owner is null or owner !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK401',message='Private request access required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('live-request:'||company||':'||owner,0));
  select * into r from public.lk_quote_requests where company_id=company and owner_hash=owner for update;
  if r.owner_expires_at<=now() then raise exception using errcode='LK401',message='Private request access expired.'; end if;
 end if;
 if r.id is null then raise exception using errcode='LK404',message='Save contact and service details first.'; end if;
 -- Recovery changes internal job status only. It never queues another paid call.
 if command in ('workspace','staff_workspace','analysis_start') then
  with expired as (
   update public.lk_quote_analysis_jobs set status='uncertain',error='Analysis interrupted. Confirm an explicit retry before another paid request.',completed_at=now()
   where company_id=company and request_id=r.id and status='running' and lease_expires_at<=now() returning id
  ) insert into public.lk_quote_media_audit(company_id,request_id,action,actor_type,revision,job_id)
   select company,r.id,'analysis_expired','worker',r.revision,id from expired;
 end if;
 if command in ('workspace','staff_workspace') then return public.lk_quote_workspace_json(r); end if;
 if command in ('photo_lookup','staff_photo') then
  if coalesce(args->>'photoId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid photo identifier.'; end if;
  select * into p from public.lk_live_quote_photos where company_id=company and request_id=r.id and id=(args->>'photoId')::uuid and (isstaff or state<>'deleted');
  if not found then raise exception using errcode='LK404',message='Photo not found.'; end if;
  return public.lk_live_quote_photo_json(p);
 end if;
 if coalesce(args->>'expectedRevision','') !~ '^\d{1,10}$' or (args->>'expectedRevision')::bigint>2147483646 or coalesce(args->>'idempotencyKey','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid saved revision or retry key.'; end if;
 expected:=(args->>'expectedRevision')::integer; key:=(args->>'idempotencyKey')::uuid;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('command',command,'args',args-'ownerHash'-'expiresAt'-'companyId')::text,'UTF8')),'hex');
 select * into receipt from public.lk_quote_media_receipts where company_id=company and owner_hash=owner and idempotency_key=key;
 if found then
  if receipt.command_hash<>fingerprint then raise exception using errcode='LK409',message='This retry key belongs to a different photo or analysis request.'; end if;
  return receipt.result_json;
 end if;
 if r.revision<>expected then raise exception using errcode='LK409',message='Saved details changed. Reload before continuing.'; end if;
 if command='reopen' then
  if r.status<>'review_requested' then raise exception using errcode='LK409',message='Only a request sent for review can be reopened.'; end if;
  update public.lk_quote_requests set status='draft',review_requested_at=null,revision=revision+1,saved_at=now() where id=r.id returning * into r;
  result:=public.lk_quote_workspace_json(r);
 elsif r.status<>'draft' then raise exception using errcode='LK409',message='Reopen the request explicitly before changing photos or requesting analysis.';
 elsif command='photo_begin' then
  if args->>'role' is null or args->>'role' not in ('overview','upper','lower','side','damage') or args->>'mimeType' is null or args->>'mimeType' not in ('image/jpeg','image/png','image/webp') or coalesce(args->>'sourceHash','') !~ '^[a-f0-9]{64}$' or coalesce(args->>'sizeBytes','') !~ '^\d{1,8}$' or (args->>'sizeBytes')::integer not between 1 and 10485760 then raise exception using errcode='LK400',message='Invalid photo upload.'; end if;
  if jsonb_typeof(r.payload->'service') is distinct from 'object' then raise exception using errcode='LK400',message='Save service details before uploading photos.'; end if;
  if (select count(*) from public.lk_live_quote_photos where company_id=company and request_id=r.id and state<>'deleted')>=8 then raise exception using errcode='LK409',message='A maximum of eight photos can be uploaded.'; end if;
  photoid:=gen_random_uuid();
  insert into public.lk_live_quote_photos(id,company_id,request_id,role,mime_type,size_bytes,source_hash,staging_path,object_path) values(photoid,company,r.id,args->>'role',args->>'mimeType',(args->>'sizeBytes')::integer,args->>'sourceHash','live/'||r.id::text||'/'||photoid::text||'/original','live/'||r.id::text||'/'||photoid::text||'/normalized.jpg') returning * into p;
  result:=public.lk_live_quote_photo_json(p);
 elsif command in ('photo_finalize','photo_remove') then
  if coalesce(args->>'photoId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid photo identifier.'; end if;
  select * into p from public.lk_live_quote_photos where company_id=company and request_id=r.id and id=(args->>'photoId')::uuid for update;
  if not found then raise exception using errcode='LK404',message='Photo not found.'; end if;
  if p.state='deleted' then raise exception using errcode='LK409',message='Photo already removed.'; end if;
  if command='photo_finalize' then
   if p.state<>'uploading' or p.upload_expires_at<=now() then raise exception using errcode='LK409',message='Photo upload expired or was already saved.'; end if;
   if coalesce(args->>'contentHash','') !~ '^[a-f0-9]{64}$' or coalesce(args->>'width','') !~ '^\d{1,8}$' or coalesce(args->>'height','') !~ '^\d{1,8}$' or coalesce(args->>'storedBytes','') !~ '^\d{1,8}$' or (args->>'width')::bigint*(args->>'height')::bigint not between 1 and 40000000 or (args->>'storedBytes')::integer not between 1 and 3145728 then raise exception using errcode='LK400',message='Invalid validated photo.'; end if;
   if exists(select 1 from public.lk_live_quote_photos where company_id=company and request_id=r.id and state='ready' and content_hash=args->>'contentHash') then raise exception using errcode='LK409',message='This photo is already uploaded.'; end if;
   update public.lk_live_quote_photos set state='ready',content_hash=args->>'contentHash',width=(args->>'width')::integer,height=(args->>'height')::integer,stored_bytes=(args->>'storedBytes')::integer,ready_at=now() where id=p.id returning * into p;
  else
   update public.lk_live_quote_photos set state='deleted',deleted_at=now() where id=p.id returning * into p;
  end if;
  update public.lk_quote_requests set revision=revision+1,saved_at=now() where id=r.id returning * into r;
  result:=public.lk_quote_workspace_json(r);
 elsif command='analysis_start' then
  if args->>'aiConsentVersion' is distinct from 'openai-photo-analysis-v1' or args->>'model' is distinct from 'gpt-6.1-sol' or coalesce(length(args->>'promptVersion'),0) not between 1 and 80 or coalesce(length(args->>'schemaVersion'),0) not between 1 and 80 or args->>'pricingVersion' is distinct from 'unconfigured' or jsonb_typeof(args->'coverage') is distinct from 'object' or jsonb_typeof(args->'coverage'->'upperNotApplicable') is distinct from 'boolean' or jsonb_typeof(args->'coverage'->'damageNotPresent') is distinct from 'boolean' then raise exception using errcode='LK400',message='Photo analysis consent and supported versions are required.'; end if;
  if jsonb_typeof(r.payload->'service') is distinct from 'object' then raise exception using errcode='LK400',message='Save service details before requesting analysis.'; end if;
  if exists(select 1 from public.lk_live_quote_photos where company_id=company and request_id=r.id and state='uploading') then raise exception using errcode='LK409',message='Finish or remove pending photo uploads first.'; end if;
  select jsonb_agg(jsonb_build_object('id',a.id,'role',a.role,'contentHash',a.content_hash,'objectPath',a.object_path,'width',a.width,'height',a.height,'storedBytes',a.stored_bytes) order by a.id) into manifest from public.lk_live_quote_photos a where company_id=company and request_id=r.id and state='ready';
  if manifest is null then raise exception using errcode='LK400',message='Upload at least one photo before analysis.'; end if;
  snapshot:=jsonb_build_object('service',r.payload->'service','photos',manifest,'coverage',jsonb_build_object('upperNotApplicable',args->'coverage'->'upperNotApplicable','damageNotPresent',args->'coverage'->'damageNotPresent'),'model',args->>'model','promptVersion',args->>'promptVersion','schemaVersion',args->>'schemaVersion','pricingVersion',args->>'pricingVersion');
  inputkey:=encode(sha256(convert_to(jsonb_build_object('requestId',r.id,'revision',r.revision,'snapshot',snapshot)::text,'UTF8')),'hex');
  select * into previous from public.lk_quote_analysis_jobs where company_id=company and request_id=r.id and input_key=inputkey order by attempts desc limit 1;
  if previous.id is not null and (previous.status in ('queued','running','succeeded') or args->>'retryOf' is null) then
   result:=public.lk_quote_workspace_json(r);
  else
   attempt:=1;
   if previous.id is not null then
    if args->>'retryOf' is distinct from previous.id::text or previous.status not in ('failed','uncertain') then raise exception using errcode='LK409',message='Explicit retry must refer to the latest failed analysis.'; end if;
    attempt:=previous.attempts+1;
    if attempt>3 then raise exception using errcode='LK429',message='Analysis retry limit reached.'; end if;
   elsif args->>'retryOf' is not null then raise exception using errcode='LK409',message='Retry input changed. Request a new analysis instead.';
   end if;
   perform pg_advisory_xact_lock(hashtextextended('live-analysis:start:global',0));
   perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','live-analysis:start:global','max',20,'window',3600000));
   perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','live-analysis:start:'||owner,'max',3,'window',3600000));
   insert into public.lk_quote_analysis_jobs(company_id,request_id,input_revision,input_key,input_snapshot,model,prompt_version,schema_version,pricing_version,consent_version,attempts,retry_of) values(company,r.id,r.revision,inputkey,snapshot,args->>'model',args->>'promptVersion',args->>'schemaVersion',args->>'pricingVersion',args->>'aiConsentVersion',attempt,previous.id) returning * into j;
   jobid:=j.id;
   result:=public.lk_quote_workspace_json(r);
  end if;
 end if;
 perform public.lk_operations_command('rate_limit',jsonb_build_object('bucket','live-quote-requests:write:'||owner,'max',60,'window',3600000));
 insert into public.lk_quote_media_receipts(company_id,request_id,owner_hash,idempotency_key,command_hash,result_json) values(company,r.id,owner,key,fingerprint,result);
 insert into public.lk_quote_media_audit(company_id,request_id,action,actor_type,revision,photo_id,job_id) values(company,r.id,command,'guest',r.revision,p.id,jobid);
 return result;
end;
$$;
revoke all on function public.lk_live_quote_photo_json(public.lk_live_quote_photos),public.lk_quote_analysis_json(public.lk_quote_analysis_jobs,public.lk_quote_requests),public.lk_quote_workspace_json(public.lk_quote_requests),public.lk_quote_media_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_live_quote_photo_json(public.lk_live_quote_photos),public.lk_quote_analysis_json(public.lk_quote_analysis_jobs,public.lk_quote_requests),public.lk_quote_workspace_json(public.lk_quote_requests),public.lk_quote_media_command(text,jsonb) to service_role;
commit;
