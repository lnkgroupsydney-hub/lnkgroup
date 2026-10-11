-- Add AI-estimated quantities and provisional painting prices without rewriting history.
begin;
create function public.lk_quote_pricing_v2_valid(pricing jsonb, analysis jsonb, service jsonb, manifest jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare
 scope jsonb; qty jsonb; damage jsonb; item jsonb; role text; photoid text; anchor text;
 known text[]; scopeids text[]; contextids text[]; conflictingids text[]; partitionids text[]; usable text[];
 codes text[]:='{}'; damageids text[]:='{}'; excludedids text[]:='{}'; expectedexcluded text[]:='{}';
 doors integer; drawers integer; quantity bigint; units bigint; amount bigint;
 painting bigint:=0; adjustment bigint:=0; repairs bigint:=0; subtotal bigint; tax bigint; total bigint; moderate boolean:=false; priced_damage boolean;
begin
 if jsonb_typeof(pricing) is distinct from 'object' or jsonb_typeof(analysis) is distinct from 'object' or jsonb_typeof(service) is distinct from 'object' or jsonb_typeof(manifest) is distinct from 'array' then return false; end if;
 if pricing->>'pricingVersion' is distinct from 'lk-sydney-cabinet-v2-20261011' then return false; end if;
 if coalesce(analysis->>'outcome','') not in ('analysis_ready','additional_photos_required','site_review_required') then return false; end if;
 if (select count(*) from jsonb_object_keys(pricing))<>16 or not pricing ?& array['status','currency','pricingVersion','amountUnit','minimumSubtotal','gstRateBps','lineItems','subtotal','tax','total','reviewReasons','notice','amountScope','siteConfirmationRequired','basis','exclusions'] then return false; end if;
 if pricing->>'currency' is distinct from 'AUD' or pricing->>'amountUnit' is distinct from 'cents' or pricing->'minimumSubtotal' is distinct from '150000'::jsonb or pricing->'gstRateBps' is distinct from '1000'::jsonb or pricing->>'amountScope' is distinct from 'painting_only' or pricing->'siteConfirmationRequired' is distinct from 'true'::jsonb then return false; end if;
 if jsonb_typeof(pricing->'notice') is distinct from 'string' or length(btrim(pricing->>'notice')) not between 1 and 2000 or jsonb_typeof(pricing->'lineItems') is distinct from 'array' or jsonb_typeof(pricing->'reviewReasons') is distinct from 'array' or jsonb_typeof(pricing->'exclusions') is distinct from 'array' then return false; end if;
 if jsonb_array_length(pricing->'reviewReasons')>20 or exists(select 1 from jsonb_array_elements(pricing->'reviewReasons') x where jsonb_typeof(x) is distinct from 'string' or length(btrim(x#>>'{}')) not between 1 and 2000) then return false; end if;
 scope:=analysis->'estimateScope';
 if jsonb_typeof(scope) is distinct from 'object' or (select count(*) from jsonb_object_keys(scope))<>8 or not scope ?& array['status','extent','anchorPhotoId','scopePhotoIds','contextPhotoIds','conflictingPhotoIds','description','assumptions'] then return false; end if;
 if coalesce(scope->>'status','') not in ('estimable','insufficient') or coalesce(scope->>'extent','') not in ('whole_project','primary_view') or jsonb_typeof(scope->'description') is distinct from 'string' or length(btrim(scope->>'description')) not between 1 and 2000 or jsonb_typeof(scope->'assumptions') is distinct from 'array' or jsonb_array_length(scope->'assumptions')>20 then return false; end if;
 if exists(select 1 from jsonb_array_elements(scope->'assumptions') x where jsonb_typeof(x) is distinct from 'string' or length(btrim(x#>>'{}')) not between 1 and 2000) then return false; end if;
 if jsonb_typeof(scope->'scopePhotoIds') is distinct from 'array' or jsonb_typeof(scope->'contextPhotoIds') is distinct from 'array' or jsonb_typeof(scope->'conflictingPhotoIds') is distinct from 'array' or jsonb_typeof(analysis->'photoQuality') is distinct from 'array' or jsonb_typeof(analysis->'coverage') is distinct from 'array' then return false; end if;
 select coalesce(array_agg(x->>'id' order by x->>'id'),'{}') into known from jsonb_array_elements(manifest) x;
 if cardinality(known) not between 1 and 8 or exists(select 1 from unnest(known) x where x is null) or (select count(distinct x) from unnest(known) x)<>cardinality(known) then return false; end if;
 select coalesce(array_agg(x#>>'{}'),'{}') into scopeids from jsonb_array_elements(scope->'scopePhotoIds') x;
 select coalesce(array_agg(x#>>'{}'),'{}') into contextids from jsonb_array_elements(scope->'contextPhotoIds') x;
 select coalesce(array_agg(x#>>'{}'),'{}') into conflictingids from jsonb_array_elements(scope->'conflictingPhotoIds') x;
 partitionids:=scopeids||contextids||conflictingids;
 if cardinality(partitionids)<>cardinality(known) or (select count(distinct x) from unnest(partitionids) x)<>cardinality(known) or not partitionids <@ known then return false; end if;
 if scope->>'extent'='whole_project' and cardinality(conflictingids)>0 then return false; end if;
 if jsonb_array_length(analysis->'photoQuality')<>cardinality(known) or (select count(distinct x->>'photoId') from jsonb_array_elements(analysis->'photoQuality') x)<>cardinality(known) or exists(select 1 from jsonb_array_elements(analysis->'photoQuality') x where not (x->>'photoId'=any(known)) or jsonb_typeof(x->'usable') is distinct from 'boolean') then return false; end if;
 select coalesce(array_agg(x->>'photoId'),'{}') into usable from jsonb_array_elements(analysis->'photoQuality') x where x->'usable'='true'::jsonb;
 if jsonb_array_length(analysis->'coverage')<>5 or (select count(distinct x->>'role') from jsonb_array_elements(analysis->'coverage') x)<>5 then return false; end if;
 for item in select * from jsonb_array_elements(analysis->'coverage') loop
  if coalesce(item->>'role','') not in ('overview','upper','lower','side','damage') or jsonb_typeof(item->'covered') is distinct from 'boolean' or jsonb_typeof(item->'photoIds') is distinct from 'array' or jsonb_array_length(item->'photoIds')>8 or (item->'covered'='true'::jsonb and jsonb_array_length(item->'photoIds')=0) then return false; end if;
  if (select count(distinct x#>>'{}') from jsonb_array_elements(item->'photoIds') x)<>jsonb_array_length(item->'photoIds') or exists(select 1 from jsonb_array_elements(item->'photoIds') x where jsonb_typeof(x) is distinct from 'string' or not (x#>>'{}'=any(known)) or (item->'covered'='true'::jsonb and not (x#>>'{}'=any(usable)))) then return false; end if;
 end loop;
 anchor:=scope->>'anchorPhotoId';
 if scope->'anchorPhotoId' is distinct from 'null'::jsonb then
  if jsonb_typeof(scope->'anchorPhotoId') is distinct from 'string' or not anchor=any(scopeids) or not anchor=any(usable) or not exists(select 1 from jsonb_array_elements(analysis->'coverage') x where x->>'role'='overview' and x->'covered'='true'::jsonb and jsonb_typeof(x->'photoIds')='array' and x->'photoIds' ? anchor) then return false; end if;
 end if;
 if scope->>'status'='estimable' and anchor is null then return false; end if;
 if jsonb_typeof(analysis->'quantities') is distinct from 'object' or (select count(*) from jsonb_object_keys(analysis->'quantities'))<>2 then return false; end if;
 foreach role in array array['doors','drawers'] loop
  qty:=analysis->'quantities'->role;
  if jsonb_typeof(qty) is distinct from 'object' or (select count(*) from jsonb_object_keys(qty))<>7 or not qty ?& array['observed','customer','needsConfirmation','estimated','basisPhotoIds','confidence','note'] then return false; end if;
  if qty->'customer' is distinct from service->(case when role='doors' then 'doorCount' else 'drawerCount' end) or jsonb_typeof(qty->'needsConfirmation') is distinct from 'boolean' or coalesce(qty->>'confidence','') not in ('high','medium','low') or jsonb_typeof(qty->'note') is distinct from 'string' or length(btrim(qty->>'note')) not between 1 and 2000 or jsonb_typeof(qty->'basisPhotoIds') is distinct from 'array' then return false; end if;
  foreach photoid in array array['observed','estimated'] loop
   if qty->photoid is distinct from 'null'::jsonb and (jsonb_typeof(qty->photoid) is distinct from 'number' or coalesce(qty->>photoid,'') !~ '^[0-9]{1,3}$' or (qty->>photoid)::integer>500) then return false; end if;
  end loop;
  if (qty->'observed'='null'::jsonb or qty->'customer'='null'::jsonb or qty->'observed' is distinct from qty->'customer') and qty->'needsConfirmation' is distinct from 'true'::jsonb then return false; end if;
  if jsonb_array_length(qty->'basisPhotoIds')>8 or (select count(distinct x#>>'{}') from jsonb_array_elements(qty->'basisPhotoIds') x)<>jsonb_array_length(qty->'basisPhotoIds') or exists(select 1 from jsonb_array_elements(qty->'basisPhotoIds') x where jsonb_typeof(x) is distinct from 'string' or not (x#>>'{}'=any(scopeids)) or not (x#>>'{}'=any(usable))) then return false; end if;
  if qty->'estimated' is distinct from 'null'::jsonb and jsonb_array_length(qty->'basisPhotoIds')=0 then return false; end if;
 end loop;
 if jsonb_typeof(analysis->'observedDamage') is distinct from 'array' or jsonb_array_length(analysis->'observedDamage')>30 then return false; end if;
 for damage in select * from jsonb_array_elements(analysis->'observedDamage') loop
  if jsonb_typeof(damage) is distinct from 'object' or (select count(*) from jsonb_object_keys(damage))<>8 or not damage ?& array['id','kind','location','description','photoIds','severity','estimateScope','surface'] or coalesce(damage->>'surface','') not in ('doors','drawers','frames','panels','unknown') or coalesce(damage->>'id','')='' or damage->>'id'=any(damageids) or coalesce(damage->>'estimateScope','') not in ('included','context_only','unresolved') or coalesce(damage->>'kind','') not in ('peeling','chipping','cracking','swelling','joint_gap','other') or coalesce(damage->>'severity','') not in ('minor','moderate','severe') or jsonb_typeof(damage->'photoIds') is distinct from 'array' or jsonb_array_length(damage->'photoIds') not between 1 and 8 then return false; end if;
  damageids:=array_append(damageids,damage->>'id');
  if exists(select 1 from jsonb_array_elements(damage->'photoIds') x where jsonb_typeof(x) is distinct from 'string' or not (x#>>'{}'=any(known)) or (damage->>'estimateScope'='included' and (not (x#>>'{}'=any(scopeids)) or not (x#>>'{}'=any(usable)))) or (damage->>'estimateScope'='context_only' and not (x#>>'{}'=any(contextids||conflictingids)))) then return false; end if;
  priced_damage:=damage->>'estimateScope'='included' and damage->>'surface' in ('doors','drawers') and (service->'surfaces') ? (damage->>'surface');
  if priced_damage and damage->>'severity'='moderate' and damage->>'kind' in ('peeling','chipping','cracking') then moderate:=true; end if;
 end loop;
 -- Exclusion content and amount calculations follow the versioned server contract.
 if jsonb_array_length(pricing->'exclusions')>4 then return false; end if;
 codes:='{}';
 for item in select * from jsonb_array_elements(pricing->'exclusions') loop
  if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>3 or not item ?& array['code','description','damageIds'] or coalesce(item->>'code','') not in ('structural_or_unclassified_repairs','unverified_damage_scope','additional_surfaces','unseen_cabinetry') or item->>'code'=any(codes) or jsonb_typeof(item->'description') is distinct from 'string' or length(btrim(item->>'description')) not between 1 and 2000 or jsonb_typeof(item->'damageIds') is distinct from 'array' then return false; end if;
  if item->>'description' is distinct from (case item->>'code'
   when 'structural_or_unclassified_repairs' then 'Severe, swollen, structural or unclassified repairs are not priced. The company must assess this work separately on site.'
   when 'unverified_damage_scope' then 'Damage outside the selected door or drawer painting surfaces, outside the estimated scope, or with an unclassified surface is not priced. Confirm its relevance and repair needs on site.'
   when 'additional_surfaces' then 'Frames, end panels and other additional surfaces are not included in this painting amount. Confirm separate work on site.'
   when 'unseen_cabinetry' then 'This amount covers the cabinet fronts estimated from the primary overview and matching views. Unseen cabinetry and other project areas are not included.'
  end) then return false; end if;
  codes:=array_append(codes,item->>'code');
  if (select count(distinct x#>>'{}') from jsonb_array_elements(item->'damageIds') x)<>jsonb_array_length(item->'damageIds') or exists(select 1 from jsonb_array_elements(item->'damageIds') x where jsonb_typeof(x) is distinct from 'string') then return false; end if;
  select coalesce(array_agg(x#>>'{}' order by x#>>'{}'),'{}') into excludedids from jsonb_array_elements(item->'damageIds') x;
  case item->>'code'
   when 'structural_or_unclassified_repairs' then
    select coalesce(array_agg(x->>'id' order by x->>'id'),'{}') into expectedexcluded from jsonb_array_elements(analysis->'observedDamage') x where x->>'estimateScope'='included' and x->>'surface' in ('doors','drawers') and (service->'surfaces') ? (x->>'surface') and (x->>'severity'='severe' or x->>'kind' in ('swelling','joint_gap','other'));
    if cardinality(expectedexcluded)=0 or excludedids<>expectedexcluded then return false; end if;
   when 'unverified_damage_scope' then
    select coalesce(array_agg(x->>'id' order by x->>'id'),'{}') into expectedexcluded from jsonb_array_elements(analysis->'observedDamage') x where not (x->>'estimateScope'='included' and x->>'surface' in ('doors','drawers') and (service->'surfaces') ? (x->>'surface'));
    if cardinality(expectedexcluded)=0 or excludedids<>expectedexcluded then return false; end if;
   when 'additional_surfaces' then
    if cardinality(excludedids)>0 or not exists(select 1 from jsonb_array_elements_text(service->'surfaces') x where x in ('frames','panels','unknown')) then return false; end if;
   when 'unseen_cabinetry' then
    if cardinality(excludedids)>0 or scope->>'extent' is distinct from 'primary_view' then return false; end if;
  end case;
 end loop;
 if exists(select 1 from jsonb_array_elements(analysis->'observedDamage') x where x->>'estimateScope'='included' and x->>'surface' in ('doors','drawers') and (service->'surfaces') ? (x->>'surface') and (x->>'severity'='severe' or x->>'kind' in ('swelling','joint_gap','other'))) is distinct from ('structural_or_unclassified_repairs'=any(codes)) then return false; end if;
 if exists(select 1 from jsonb_array_elements(analysis->'observedDamage') x where not (x->>'estimateScope'='included' and x->>'surface' in ('doors','drawers') and (service->'surfaces') ? (x->>'surface'))) is distinct from ('unverified_damage_scope'=any(codes)) then return false; end if;
 if exists(select 1 from jsonb_array_elements_text(service->'surfaces') x where x in ('frames','panels','unknown')) is distinct from ('additional_surfaces'=any(codes)) then return false; end if;
 if (scope->>'extent'='primary_view') is distinct from ('unseen_cabinetry'=any(codes)) then return false; end if;
 if pricing->>'status'='review_required' then
  return jsonb_array_length(pricing->'reviewReasons')>0 and pricing->'basis'='null'::jsonb and pricing->'lineItems'='[]'::jsonb and pricing->'subtotal'='null'::jsonb and pricing->'tax'='null'::jsonb and pricing->'total'='null'::jsonb;
 end if;
 if pricing->>'status' is distinct from 'provisional_estimate' or jsonb_array_length(pricing->'lineItems') not between 1 and 4 or scope->>'status' is distinct from 'estimable' or anchor is null then return false; end if;
 if service->>'serviceId' is distinct from 'cabinet-painting' or coalesce(service->>'intent','') not in ('full-repainting','colour-change') or jsonb_typeof(service->'surfaces') is distinct from 'array' or not (service->'surfaces' ?| array['doors','drawers']) then return false; end if;
 doors:=case when service->'surfaces' ? 'doors' then (analysis->'quantities'->'doors'->>'estimated')::integer else 0 end;
 drawers:=case when service->'surfaces' ? 'drawers' then (analysis->'quantities'->'drawers'->>'estimated')::integer else 0 end;
 if doors is null or drawers is null or doors+drawers=0 then return false; end if;
 item:=pricing->'basis';
 if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>5 or not item ?& array['type','extent','anchorPhotoId','doors','drawers'] or item->>'type' is distinct from 'ai_estimated_quantities' or item->'extent' is distinct from scope->'extent' or item->>'anchorPhotoId' is distinct from anchor or item->'doors' is distinct from to_jsonb(doors) or item->'drawers' is distinct from to_jsonb(drawers) then return false; end if;
 foreach role in array array['subtotal','tax','total'] loop
  if jsonb_typeof(pricing->role) is distinct from 'number' or coalesce(pricing->>role,'') !~ '^[0-9]{1,8}$' or (pricing->>role)::bigint>20000000 then return false; end if;
 end loop;
 codes:='{}';
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
revoke all on function public.lk_quote_pricing_v2_valid(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_pricing_v2_valid(jsonb,jsonb,jsonb,jsonb) to service_role;

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
    or (case when j.pricing_version='lk-sydney-cabinet-v2-20261011' then
     j.schema_version is distinct from 'cabinet-photo-analysis-v2' or j.prompt_version is distinct from 'cabinet-observations-v3'
     or not public.lk_quote_pricing_v2_valid(args->'pricing',args->'analysis',j.input_snapshot->'service',j.input_snapshot->'photos')
    else not public.lk_quote_pricing_valid(args->'pricing',args->'analysis',j.input_snapshot->'service',j.pricing_version) end)
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
  if args->>'aiConsentVersion' is distinct from 'openai-photo-analysis-v1' or args->>'model' is distinct from 'gpt-6.1-sol' or coalesce(length(args->>'promptVersion'),0) not between 1 and 80 or coalesce(length(args->>'schemaVersion'),0) not between 1 and 80 or coalesce(args->>'pricingVersion','') not in ('unconfigured','lk-sydney-cabinet-v1-20261011','lk-sydney-cabinet-v2-20261011') or (args->>'pricingVersion'='lk-sydney-cabinet-v2-20261011' and (args->>'schemaVersion' is distinct from 'cabinet-photo-analysis-v2' or args->>'promptVersion' is distinct from 'cabinet-observations-v3')) or jsonb_typeof(args->'coverage') is distinct from 'object' or jsonb_typeof(args->'coverage'->'upperNotApplicable') is distinct from 'boolean' or jsonb_typeof(args->'coverage'->'damageNotPresent') is distinct from 'boolean' then raise exception using errcode='LK400',message='Photo analysis consent and supported versions are required.'; end if;
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
