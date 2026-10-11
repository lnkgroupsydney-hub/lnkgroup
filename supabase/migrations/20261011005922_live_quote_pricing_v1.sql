-- Additive pricing version; preserve existing ownership, leases, receipts and grants.
begin;
-- Validate server-computed cents again at the persistence boundary.
create function public.lk_quote_pricing_valid(pricing jsonb, analysis jsonb, service jsonb, version text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; qty jsonb; role text; codes text[]:='{}'; units bigint; quantity bigint; amount bigint; painting bigint:=0; adjustment bigint:=0; repairs bigint:=0; subtotal bigint; tax bigint; total bigint; doors integer; drawers integer; moderate boolean;
begin
 if version='unconfigured' then
  return pricing->>'status' is not distinct from 'awaiting_company_rates' and pricing->>'currency' is not distinct from 'AUD' and pricing->>'pricingVersion' is not distinct from 'unconfigured' and pricing->'subtotal' is not distinct from 'null'::jsonb and pricing->'tax' is not distinct from 'null'::jsonb and pricing->'total' is not distinct from 'null'::jsonb and pricing->'lineItems' is not distinct from '[]'::jsonb;
 end if;
 if version is distinct from 'lk-sydney-cabinet-v1-20261011' or pricing->>'pricingVersion' is distinct from version or jsonb_typeof(pricing) is distinct from 'object' then return false; end if;
 if (select count(*) from jsonb_object_keys(pricing))<>12 or not pricing ?& array['status','currency','pricingVersion','amountUnit','minimumSubtotal','gstRateBps','lineItems','subtotal','tax','total','reviewReasons','notice'] then return false; end if;
 if pricing->>'currency' is distinct from 'AUD' or pricing->>'amountUnit' is distinct from 'cents' or pricing->'minimumSubtotal' is distinct from '150000'::jsonb or pricing->'gstRateBps' is distinct from '1000'::jsonb or jsonb_typeof(pricing->'lineItems') is distinct from 'array' or jsonb_typeof(pricing->'reviewReasons') is distinct from 'array' or jsonb_typeof(pricing->'notice') is distinct from 'string' or length(btrim(pricing->>'notice')) not between 1 and 2000 then return false; end if;
 if jsonb_array_length(pricing->'reviewReasons')>20 or exists(select 1 from jsonb_array_elements(pricing->'reviewReasons') x where jsonb_typeof(x) is distinct from 'string' or length(btrim(x#>>'{}')) not between 1 and 2000) then return false; end if;
 if pricing->>'status'='review_required' then return jsonb_array_length(pricing->'reviewReasons')>0 and pricing->'lineItems'='[]'::jsonb and pricing->'subtotal'='null'::jsonb and pricing->'tax'='null'::jsonb and pricing->'total'='null'::jsonb; end if;
 if pricing->>'status' is distinct from 'estimate_ready' or pricing->'reviewReasons'<>'[]'::jsonb or jsonb_array_length(pricing->'lineItems') not between 1 and 4 then return false; end if;
 if analysis->>'outcome' is distinct from 'analysis_ready' or jsonb_typeof(analysis->'photoQuality') is distinct from 'array' or jsonb_array_length(analysis->'photoQuality')<1 or exists(select 1 from jsonb_array_elements(analysis->'photoQuality') x where x->'usable' is distinct from 'true'::jsonb) then return false; end if;
 if service->>'serviceId' is distinct from 'cabinet-painting' or service->>'intent' not in ('full-repainting','colour-change') or jsonb_typeof(service->'surfaces') is distinct from 'array' or jsonb_array_length(service->'surfaces')<1 or exists(select 1 from jsonb_array_elements_text(service->'surfaces') x where x not in ('doors','drawers','repairs')) then return false; end if;
 if jsonb_typeof(analysis->'coverage') is distinct from 'array' then return false; end if;
 foreach role in array array['overview','lower','side'] loop
  if not exists(select 1 from jsonb_array_elements(analysis->'coverage') x where x->>'role'=role and x->'covered'='true'::jsonb and jsonb_typeof(x->'photoIds')='array' and jsonb_array_length(x->'photoIds')>0) then return false; end if;
 end loop;
 foreach role in array array['doors','drawers'] loop
  qty:=analysis->'quantities'->role;
  if qty->'needsConfirmation' is distinct from 'false'::jsonb or jsonb_typeof(qty->'observed') is distinct from 'number' or coalesce(qty->>'observed','') !~ '^[0-9]{1,3}$' or (qty->>'observed')::integer>500 or qty->'observed' is distinct from qty->'customer' or qty->'observed' is distinct from service->(case when role='doors' then 'doorCount' else 'drawerCount' end) then return false; end if;
 end loop;
 doors:=(service->>'doorCount')::integer; drawers:=(service->>'drawerCount')::integer;
 if (doors>0 and not (service->'surfaces' ? 'doors')) or (drawers>0 and not (service->'surfaces' ? 'drawers')) or not (service->'surfaces' ?| array['doors','drawers']) then return false; end if;
 if doors+drawers=0 or jsonb_typeof(analysis->'observedDamage') is distinct from 'array' then return false; end if;
 if exists(select 1 from jsonb_array_elements(analysis->'observedDamage') x where coalesce(x->>'kind','') not in ('peeling','chipping','cracking') or coalesce(x->>'severity','') not in ('minor','moderate')) then return false; end if;
 moderate:=exists(select 1 from jsonb_array_elements(analysis->'observedDamage') x where x->>'severity'='moderate');
 foreach role in array array['subtotal','tax','total'] loop
  if jsonb_typeof(pricing->role) is distinct from 'number' or coalesce(pricing->>role,'') !~ '^[0-9]{1,8}$' or (pricing->>role)::bigint>20000000 then return false; end if;
 end loop;
 for item in select * from jsonb_array_elements(pricing->'lineItems') loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>5 or not item ?& array['code','label','quantity','unitAmount','amount'] or jsonb_typeof(item->'label') is distinct from 'string' or length(btrim(item->>'label')) not between 1 and 2000 or coalesce(item->>'code','') not in ('doors','drawers','minimum_adjustment','moderate_repairs') or item->>'code'=any(codes) then return false; end if;
  foreach role in array array['quantity','unitAmount','amount'] loop
   if jsonb_typeof(item->role) is distinct from 'number' or coalesce(item->>role,'') !~ '^[0-9]{1,8}$' or (item->>role)::bigint>20000000 then return false; end if;
  end loop;
  quantity:=(item->>'quantity')::bigint; units:=(item->>'unitAmount')::bigint; amount:=(item->>'amount')::bigint;
  if quantity<1 or units<1 or amount<>quantity*units then return false; end if;
  codes:=array_append(codes,item->>'code');
  case item->>'code'
   when 'doors' then if quantity<>doors or units<>15000 then return false; end if; painting:=painting+amount;
   when 'drawers' then if quantity<>drawers or units<>10000 then return false; end if; painting:=painting+amount;
   when 'minimum_adjustment' then if quantity<>1 then return false; end if; adjustment:=amount;
   when 'moderate_repairs' then if quantity<>1 or units<>25000 or not moderate then return false; end if; repairs:=amount;
  end case;
 end loop;
 subtotal:=(pricing->>'subtotal')::bigint; tax:=(pricing->>'tax')::bigint; total:=(pricing->>'total')::bigint;
 return painting=doors*15000+drawers*10000 and adjustment=greatest(0,150000-painting) and repairs=case when moderate then 25000 else 0 end and subtotal=painting+adjustment+repairs and subtotal>=150000 and tax=round(subtotal::numeric*1000/10000)::bigint and total=subtotal+tax;
exception when others then return false;
end;
$$;
revoke all on function public.lk_quote_pricing_valid(jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.lk_quote_pricing_valid(jsonb,jsonb,jsonb,text) to service_role;

create or replace function public.lk_quote_media_command(command text,args jsonb default '{}'::jsonb) returns jsonb
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
    or not public.lk_quote_pricing_valid(args->'pricing',args->'analysis',j.input_snapshot->'service',j.pricing_version)
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
  if args->>'aiConsentVersion' is distinct from 'openai-photo-analysis-v1' or args->>'model' is distinct from 'gpt-6.1-sol' or coalesce(length(args->>'promptVersion'),0) not between 1 and 80 or coalesce(length(args->>'schemaVersion'),0) not between 1 and 80 or coalesce(args->>'pricingVersion','') not in ('unconfigured','lk-sydney-cabinet-v1-20261011') or jsonb_typeof(args->'coverage') is distinct from 'object' or jsonb_typeof(args->'coverage'->'upperNotApplicable') is distinct from 'boolean' or jsonb_typeof(args->'coverage'->'damageNotPresent') is distinct from 'boolean' then raise exception using errcode='LK400',message='Photo analysis consent and supported versions are required.'; end if;
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
commit;
