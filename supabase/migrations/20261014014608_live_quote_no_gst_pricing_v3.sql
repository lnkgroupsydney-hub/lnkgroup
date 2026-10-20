-- Preserve existing requests and immutable price/signed snapshots; policy is fixed at first INSERT.
begin;
alter table public.lk_quote_requests add column pricing_version text check (pricing_version in ('lk-sydney-cabinet-v2-20261011','lk-sydney-cabinet-v3-20261014'));
alter table public.lk_quote_requests alter column pricing_version set default 'lk-sydney-cabinet-v3-20261014';
create function public.lk_quote_request_pricing_guard() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.pricing_version is distinct from old.pricing_version then raise exception using errcode='LK409',message='The original quote pricing policy cannot be changed.';end if;
 return new;
end;$$;
create trigger lk_quote_request_pricing_immutable before update on public.lk_quote_requests for each row execute function public.lk_quote_request_pricing_guard();
revoke all on function public.lk_quote_request_pricing_guard() from public,anon,authenticated;
create or replace function public.lk_quote_request_json(r public.lk_quote_requests) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',r.id,'reference',r.reference,'mode','live','companyId',r.company_id,
 'pricingVersion',coalesce(r.pricing_version,'lk-sydney-cabinet-v2-20261011'),'revision',r.revision,'status',r.status,'payload',r.payload,'consentVersion',r.consent_version,
 'savedAt',r.saved_at,'createdAt',r.created_at,'reviewRequestedAt',r.review_requested_at,'customerId',r.customer_id);
$$;
create function public.lk_quote_pricing_v3_valid(pricing jsonb, analysis jsonb, service jsonb, manifest jsonb) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare
 scope jsonb; qty jsonb; damage jsonb; item jsonb; role text; photoid text; anchor text;
 known text[]; scopeids text[]; contextids text[]; conflictingids text[]; partitionids text[]; usable text[];
 codes text[]:='{}'; damageids text[]:='{}'; excludedids text[]:='{}'; expectedexcluded text[]:='{}';
 doors integer; drawers integer; quantity bigint; units bigint; amount bigint;
 painting bigint:=0; adjustment bigint:=0; repairs bigint:=0; subtotal bigint; tax bigint; total bigint; moderate boolean:=false; priced_damage boolean;
begin
 if jsonb_typeof(pricing) is distinct from 'object' or jsonb_typeof(analysis) is distinct from 'object' or jsonb_typeof(service) is distinct from 'object' or jsonb_typeof(manifest) is distinct from 'array' then return false; end if;
 if pricing->>'pricingVersion' is distinct from 'lk-sydney-cabinet-v3-20261014' then return false; end if;
 if coalesce(analysis->>'outcome','') not in ('analysis_ready','additional_photos_required','site_review_required') then return false; end if;
 if (select count(*) from jsonb_object_keys(pricing))<>16 or not pricing ?& array['status','currency','pricingVersion','amountUnit','minimumSubtotal','gstRateBps','lineItems','subtotal','tax','total','reviewReasons','notice','amountScope','siteConfirmationRequired','basis','exclusions'] then return false; end if;
 if pricing->>'currency' is distinct from 'AUD' or pricing->>'amountUnit' is distinct from 'cents' or pricing->'minimumSubtotal' is distinct from '145000'::jsonb or pricing->'gstRateBps' is distinct from '0'::jsonb or pricing->>'amountScope' is distinct from 'painting_only' or pricing->'siteConfirmationRequired' is distinct from 'true'::jsonb then return false; end if;
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
 return painting=doors*15000+drawers*10000 and adjustment=greatest(0,145000-painting) and repairs=case when moderate then 25000 else 0 end and subtotal=painting+adjustment+repairs and subtotal>=145000 and tax=0 and total=subtotal+tax;
exception when others then return false;
end;
$$;
revoke all on function public.lk_quote_pricing_v3_valid(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_pricing_v3_valid(jsonb,jsonb,jsonb,jsonb) to service_role;


create function public.lk_quote_provisional_pricing_valid(pricing jsonb, analysis jsonb, service jsonb, manifest jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select case pricing->>'pricingVersion' when 'lk-sydney-cabinet-v3-20261014' then public.lk_quote_pricing_v3_valid(pricing,analysis,service,manifest) when 'lk-sydney-cabinet-v2-20261011' then public.lk_quote_pricing_v2_valid(pricing,analysis,service,manifest) else false end;
$$;
revoke all on function public.lk_quote_provisional_pricing_valid(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_provisional_pricing_valid(jsonb,jsonb,jsonb,jsonb) to service_role;
create or replace function public.lk_quote_media_guest_command(command text,args jsonb default '{}'::jsonb) returns jsonb
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
    or (case when j.pricing_version in ('lk-sydney-cabinet-v2-20261011','lk-sydney-cabinet-v3-20261014') then
     j.schema_version is distinct from 'cabinet-photo-analysis-v2' or j.prompt_version is distinct from 'cabinet-observations-v3'
     or args->'pricing'->>'pricingVersion' is distinct from j.pricing_version
     or not public.lk_quote_provisional_pricing_valid(args->'pricing',args->'analysis',j.input_snapshot->'service',j.input_snapshot->'photos')
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
  if args->>'pricingVersion' is distinct from coalesce(r.pricing_version,'lk-sydney-cabinet-v2-20261011') then raise exception using errcode='LK409',message='Use the original request pricing policy.';end if;
  if args->>'aiConsentVersion' is distinct from 'openai-photo-analysis-v1' or args->>'model' is distinct from 'gpt-6.1-sol' or coalesce(length(args->>'promptVersion'),0) not between 1 and 80 or coalesce(length(args->>'schemaVersion'),0) not between 1 and 80 or coalesce(args->>'pricingVersion','') not in ('unconfigured','lk-sydney-cabinet-v1-20261011','lk-sydney-cabinet-v2-20261011','lk-sydney-cabinet-v3-20261014') or (args->>'pricingVersion' in ('lk-sydney-cabinet-v2-20261011','lk-sydney-cabinet-v3-20261014') and (args->>'schemaVersion' is distinct from 'cabinet-photo-analysis-v2' or args->>'promptVersion' is distinct from 'cabinet-observations-v3')) or jsonb_typeof(args->'coverage') is distinct from 'object' or jsonb_typeof(args->'coverage'->'upperNotApplicable') is distinct from 'boolean' or jsonb_typeof(args->'coverage'->'damageNotPresent') is distinct from 'boolean' then raise exception using errcode='LK400',message='Photo analysis consent and supported versions are required.'; end if;
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
create or replace function public.lk_live_quote_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare company text:=args->>'companyId';owner text:=args->>'ownerHash';resolved jsonb;r public.lk_quote_requests;a public.lk_live_quote_approvals;s public.lk_live_quote_submissions;j public.lk_quote_analysis_jobs;
 receipt public.lk_live_quote_booking_receipts;target jsonb;manifest jsonb;snapshot jsonb;result jsonb;fingerprint text;key uuid;uid uuid;sid uuid;datevalue date;signature jsonb;versionvalue integer;pdf bytea;claimskipped integer:=0; ack jsonb; timevalue text;
begin
 if company is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company access denied.';end if;
 if command='occupancy' then
  if coalesce(args->>'accountSub','')='' or coalesce(args->>'calendarId','')='' then raise exception using errcode='LK400',message='Calendar target required.';end if;
  return jsonb_build_object('segments',(select coalesce(jsonb_agg(jsonb_build_object('startDate',x.start_date,'endDate',x.end_date) order by x.start_date),'[]'::jsonb) from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=args->>'accountSub' and x.calendar_id=args->>'calendarId'));
 end if;
 if command like 'delivery_%' then
  if command='delivery_claim' then
   if coalesce(args->>'leaseToken','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Delivery lease required.';end if;
   loop
   select * into s from public.lk_live_quote_submissions x where x.company_id=company and (args->>'id' is null or x.id=(args->>'id')::uuid)
   and x.next_attempt_at<=now() and (x.lease_expires_at is null or x.lease_expires_at<=now()) and
   (x.email_status in ('pending','sending','retrying','outcome_unknown') or x.email_status='provider_accepted' and (x.calendar_status in ('pending','syncing','retrying') or x.calendar_status='not_required' and x.lease_token is not null)) order by x.next_attempt_at,x.submitted_at for update skip locked limit 1;
   if not found then return 'null'::jsonb;end if;
   if s.email_status<>'provider_accepted' and s.email_first_attempt_at<=now()-interval '24 hours' then
    update public.lk_live_quote_submissions set email_status='manual_review',error='The original email attempt requires provider review before another send.',lease_token=null,lease_expires_at=null where id=s.id;
    claimskipped:=claimskipped+1;
    if claimskipped>=10 then return 'null'::jsonb;end if;
    continue;
   end if;
   exit;
   end loop;
   update public.lk_live_quote_submissions set lease_token=(args->>'leaseToken')::uuid,lease_expires_at=now()+interval '4 minutes',attempts=attempts+1,
    email_status=case when email_status='provider_accepted' then email_status else 'sending' end,
    calendar_status=case when email_status='provider_accepted' and calendar_status<>'not_required' then 'syncing' else calendar_status end,error=null where id=s.id returning * into s;
   return public.lk_live_booking_claim_json(s);
  end if;
  select * into s from public.lk_live_quote_submissions x where x.company_id=company and x.id=(args->>'id')::uuid for update;
  if not found then raise exception using errcode='LK404',message='Booking request not found.';end if;
  if s.lease_token is distinct from (args->>'leaseToken')::uuid or s.lease_expires_at<=now() or s.lease_token is null then raise exception using errcode='LK409',message='Delivery lease expired or changed.';end if;
  if command='delivery_freeze' then
   if jsonb_typeof(args->'payload') is distinct from 'object' or octet_length((args->'payload')::text)>1500000 or coalesce(args->>'pdfBase64','')='' or length(args->>'pdfBase64')>1000000 then raise exception using errcode='LK400',message='Invalid private receipt.';end if;
   if args->'payload'->>'to' is distinct from s.verified_email and args->'payload'->'to' is distinct from jsonb_build_array(s.verified_email) then raise exception using errcode='LK403',message='Receipt recipient must be the verified customer email.';end if;
   pdf:=decode(args->>'pdfBase64','base64');
   if octet_length(pdf)>750000 or octet_length(pdf)<5 or convert_from(substring(pdf from 1 for 5),'UTF8')<>'%PDF-' or encode(sha256(pdf),'hex') is distinct from args->>'pdfHash' then raise exception using errcode='LK400',message='Invalid private receipt bytes or hash.';end if;
   if s.pdf_base64 is not null then
    if s.pdf_base64 is distinct from args->>'pdfBase64' or s.pdf_hash is distinct from args->>'pdfHash' or s.send_payload is distinct from args->'payload' then raise exception using errcode='LK409',message='Receipt and outgoing email are already frozen.';end if;
   else
    update public.lk_live_quote_submissions set pdf_base64=args->>'pdfBase64',pdf_hash=args->>'pdfHash',send_payload=args->'payload',receipt_frozen_at=now() where id=s.id returning * into s;
   end if;
   return public.lk_live_booking_claim_json(s);
  elsif command='delivery_email_attempt' then
   if s.pdf_base64 is null or s.email_status='provider_accepted' then raise exception using errcode='LK409',message='A frozen receipt and pending email are required.';end if;
   if s.email_first_attempt_at<=now()-interval '24 hours' then raise exception using errcode='LK409',message='Email acceptance requires manual provider review.';end if;
   update public.lk_live_quote_submissions set email_first_attempt_at=coalesce(email_first_attempt_at,now()) where id=s.id returning * into s;
   return public.lk_live_booking_claim_json(s);
  elsif command='delivery_email_accepted' then
   if s.pdf_base64 is null or s.email_first_attempt_at is null or coalesce(length(args->>'providerMessageId'),0) not between 1 and 200 then raise exception using errcode='LK409',message='A recorded frozen email attempt is required.';end if;
   if s.email_status='provider_accepted' and s.provider_message_id is distinct from args->>'providerMessageId' then raise exception using errcode='LK409',message='Provider acceptance already recorded.';end if;
   update public.lk_live_quote_submissions set email_status='provider_accepted',provider_message_id=args->>'providerMessageId',calendar_status=case when calendar_status='blocked' then 'pending' else calendar_status end,error=null where id=s.id returning * into s;
  elsif command='delivery_request_complete' then
   if s.snapshot->>'version'<>'live-booking-request-ack-v2' or s.calendar_status<>'not_required' or s.email_status<>'provider_accepted' or s.pdf_base64 is null then raise exception using errcode='LK409',message='A recorded v2 request email is required.';end if;
   update public.lk_live_quote_submissions set lease_token=null,lease_expires_at=null,error=null where id=s.id returning * into s;
  elsif command='delivery_calendar_synced' then
   if s.calendar_status='not_required' then raise exception using errcode='LK409',message='This request requires EMS confirmation before Calendar storage.';end if;
   if s.email_status<>'provider_accepted' or coalesce(length(args->>'eventId'),0) not between 1 and 200 or coalesce(length(args->>'eventEtag'),0) not between 1 and 300 then raise exception using errcode='LK409',message='Email provider acceptance and verified calendar readback are required.';end if;
   update public.lk_live_quote_submissions set calendar_status='synced',calendar_event_id=args->>'eventId',calendar_event_etag=args->>'eventEtag',error=null,lease_token=null,lease_expires_at=null where id=s.id returning * into s;
  elsif command='delivery_failed' then
   if coalesce(args->>'stage','') not in ('email','calendar') or coalesce(args->>'outcome','') not in ('retrying','outcome_unknown','manual_review','conflict','failed') or coalesce(length(args->>'error'),0) not between 1 and 300 then raise exception using errcode='LK400',message='Invalid safe delivery failure.';end if;
   if args->>'stage'='email' then
    if s.email_status='provider_accepted' or args->>'outcome'='conflict' then raise exception using errcode='LK409',message='Accepted email cannot be retried.';end if;
    update public.lk_live_quote_submissions set email_status=args->>'outcome',error=args->>'error',next_attempt_at=now()+interval '1 minute',lease_token=null,lease_expires_at=null where id=s.id returning * into s;
   else
    if s.email_status<>'provider_accepted' or args->>'outcome' not in ('retrying','manual_review','conflict') or s.calendar_status in ('synced','not_required') then raise exception using errcode='LK409',message='Calendar failure requires an accepted email and incomplete sync.';end if;
    update public.lk_live_quote_submissions set calendar_status=args->>'outcome',error=args->>'error',next_attempt_at=now()+interval '1 minute',lease_token=null,lease_expires_at=null where id=s.id returning * into s;
   end if;
  else raise exception using errcode='LK400',message='Invalid delivery command.';
  end if;
  return public.lk_live_booking_submission_json(s);
 end if;
 if command='staff_state' then
  if coalesce(args->>'actorUserId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' or coalesce(args->>'actorSessionId','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK403',message='Verified staff actor required.';end if;
  select * into r from public.lk_quote_requests where company_id=company and id=(args->>'id')::uuid;
  if not found then raise exception using errcode='LK404',message='Booking request not found.';end if;
  return public.lk_live_booking_state(r);
 end if;
 if command not in ('state','approve','date','review','submit','retry','receipt','replay') then raise exception using errcode='LK400',message='Invalid booking command.';end if;
 if jsonb_typeof(args->'customerAccess') is distinct from 'object' or owner is null or owner !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403',message='Verify your customer email before approving a booking request.';end if;
 perform pg_advisory_xact_lock(hashtextextended('live-request:'||company||':'||owner,0));
 resolved:=public.lk_quote_customer_command('resolve',args->'customerAccess');
 if resolved->>'hash' is distinct from owner or args->'customerAccess'->>'companyId' is distinct from company or args->'customerAccess'->>'requestId' is distinct from args->>'expectedRequestId' then raise exception using errcode='LK403',message='Saved quote access changed.';end if;
 uid:=(args->'customerAccess'->>'authUserId')::uuid;
 select * into r from public.lk_quote_requests where company_id=company and owner_hash=owner and id=(args->>'expectedRequestId')::uuid for update;
 if not found then raise exception using errcode='LK404',message='Saved quote not found.';end if;
 select * into s from public.lk_live_quote_submissions where company_id=company and request_id=r.id for update;
 if command='state' then return public.lk_live_booking_state(r);end if;
 if command='receipt' then
  if s.id is null or s.pdf_base64 is null then raise exception using errcode='LK409',message='Your private receipt is being prepared. Retry shortly.';end if;
  return jsonb_build_object('submission',public.lk_live_booking_submission_json(s),'pdfBase64',s.pdf_base64,'pdfHash',s.pdf_hash,'payload',s.send_payload);
 end if;
 if command='retry' then
  if s.id is null then raise exception using errcode='LK409',message='Submit your signed booking request first.';end if;
  if s.email_status='manual_review' or s.calendar_status in ('manual_review','conflict') then raise exception using errcode='LK409',message='The company must review this delivery before retrying.';end if;
  if s.email_status<>'provider_accepted' and s.email_first_attempt_at<=now()-interval '24 hours' then
   update public.lk_live_quote_submissions set email_status='manual_review',error='The original email attempt requires provider review before another send.' where id=s.id;
  elsif s.calendar_status<>'synced' then
   update public.lk_live_quote_submissions set email_status=case when email_status='failed' then 'retrying' else email_status end,next_attempt_at=now() where id=s.id;
  end if;
  return public.lk_live_booking_state(r);
 end if;
 if command='replay' then
  if args->>'operation' not in ('approve','date') then raise exception using errcode='LK400',message='Invalid replay operation.';end if;
  fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',args->>'operation','args',args-array['operation','companyId','ownerHash','expiresAt','expectedRequestId','customerAccess','dateCheck','calendarTarget','reviewExpiresAt']));
  select * into receipt from public.lk_live_quote_booking_receipts where company_id=company and request_id=r.id and auth_user_id=uid and idempotency_key=(args->>'idempotencyKey')::uuid;
  if not found then return 'null'::jsonb;end if;
  if receipt.command_hash<>fingerprint then raise exception using errcode='LK409',message='This retry key belongs to different booking request details.';end if;
  return public.lk_live_booking_state(r);
 end if;
 if command in ('approve','date','submit') then
  if coalesce(args->>'idempotencyKey','') !~ '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK400',message='Invalid booking retry key.';end if;
  key:=(args->>'idempotencyKey')::uuid;
  fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',command,'args',args-array['companyId','ownerHash','expiresAt','expectedRequestId','customerAccess','dateCheck','calendarTarget','reviewExpiresAt']));
  select * into receipt from public.lk_live_quote_booking_receipts where company_id=company and request_id=r.id and auth_user_id=uid and idempotency_key=key;
  if found then
   if receipt.command_hash<>fingerprint then raise exception using errcode='LK409',message='This retry key belongs to different booking request details.';end if;
   return public.lk_live_booking_state(r);
  end if;
 end if;
 if command='submit' and s.id is not null then
  if s.approval_id::text is distinct from args->>'approvalId' or s.selection_revision is distinct from (args->>'selectionRevision')::integer or s.snapshot_hash is distinct from args->>'snapshotHash' or s.signature is distinct from args->'signature' then raise exception using errcode='LK409',message='This booking request already has an immutable signed submission.';end if;
  result:=public.lk_live_booking_state(r);
  insert into public.lk_live_quote_booking_receipts values(company,r.id,uid,key,fingerprint,result,now());
  return result;
 end if;
 if s.id is not null then raise exception using errcode='LK409',message='Your signed request is saved. Contact the company to change it.';end if;
 if command='approve' then
  ack:=case coalesce(args->>'acknowledgmentVersion','live-booking-request-ack-v2') when 'live-booking-request-ack-v1' then public.lk_live_booking_ack() when 'live-booking-request-ack-v2' then public.lk_live_booking_simple_ack() else null end;
  if ack is null then raise exception using errcode='LK400',message='Invalid booking acknowledgment version.';end if;
  if r.revision is distinct from (args->>'expectedRevision')::integer then raise exception using errcode='LK409',message='Saved details changed. Reload before approving.';end if;
  select * into j from public.lk_quote_analysis_jobs where company_id=company and request_id=r.id order by created_at desc,id desc limit 1;
  manifest:=public.lk_live_booking_manifest(r);
  if j.id is null or j.id::text is distinct from args->>'analysisId' or j.status<>'succeeded' or not public.lk_quote_analysis_source_current(j,r) then raise exception using errcode='LK409',message='Use the latest completed estimate for your current saved details and photos.';end if;
  if j.pricing->>'status' is distinct from 'provisional_estimate' or jsonb_typeof(j.pricing->'total') is distinct from 'number' or not public.lk_quote_provisional_pricing_valid(j.pricing,j.analysis,j.input_snapshot->'service',manifest) then raise exception using errcode='LK409',message='A validated numeric provisional estimate is required.';end if;
  target:=args->'calendarTarget';
  perform 1 from public.lk_google_connection c where c.id=1 and c.account_sub=target->>'accountSub' for share;
  if not found or coalesce(target->>'calendarId','')='' then raise exception using errcode='LK409',message='The company calendar connection changed. Reload before approving.';end if;
  select coalesce(max(version),0)+1 into versionvalue from public.lk_live_quote_approvals where company_id=company and request_id=r.id;
  snapshot:=jsonb_build_object('mode','live','kind','nonbinding_booking_request','version',ack->>'version','requestId',r.id,'reference',r.reference,'inputRevision',r.revision,'analysisId',j.id,'payload',r.payload,'verifiedEmail',args->'customerAccess'->>'email','analysis',j.analysis,'inputSnapshot',j.input_snapshot,'pricing',j.pricing,'photos',manifest,'acknowledgment',ack,'calendarTarget',target);
  insert into public.lk_live_quote_approvals(company_id,request_id,auth_user_id,verified_email,version,analysis_id,input_revision,source_snapshot,snapshot_hash)
  values(company,r.id,uid,args->'customerAccess'->>'email',versionvalue,j.id,r.revision,snapshot,public.lk_live_booking_hash(snapshot)) returning * into a;
 else
  select * into a from public.lk_live_quote_approvals where company_id=company and request_id=r.id and id=(args->>'approvalId')::uuid for update;
  if not found or a.id is distinct from (select x.id from public.lk_live_quote_approvals x where x.company_id=company and x.request_id=r.id order by x.version desc limit 1) or a.auth_user_id<>uid or not public.lk_live_booking_source_current(r,a) then raise exception using errcode='LK409',message='The approved estimate changed. Review and approve the current estimate again.';end if;
  target:=a.source_snapshot->'calendarTarget';
  perform 1 from public.lk_google_connection c where c.id=1 and c.account_sub=target->>'accountSub' for share;
  if not found then raise exception using errcode='LK409',message='The company calendar connection changed.';end if;
  if command='date' then
   datevalue:=(args->>'preferredDate')::date;
   timevalue:=args->>'preferredTime';
   if a.source_snapshot->>'version'='live-booking-request-ack-v2' then
    if a.source_snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or timevalue is null or timevalue !~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode='LK400',message='Choose a valid Sydney take-off time.';end if;
    if public.lk_live_booking_sydney_instant(datevalue::text||'T'||timevalue)<=clock_timestamp() then raise exception using errcode='LK409',message='Choose a future Sydney take-off date and time.';end if;
   elsif timevalue is not null then raise exception using errcode='LK400',message='Existing acknowledgment only supports a preferred date.';end if;
   if jsonb_typeof(args->'dateCheck') is distinct from 'object' or jsonb_typeof(args->'dateCheck'->'checkedAt') is distinct from 'string' or jsonb_typeof(args->'dateCheck'->'expiresAt') is distinct from 'string' or (args->'dateCheck'->>'checkedAt')::timestamptz>now()+interval '30 seconds' or args->'dateCheck'->>'accountSub' is distinct from target->>'accountSub' or args->'dateCheck'->>'calendarId' is distinct from target->>'calendarId' or args->'dateCheck'->>'revision' is distinct from args->>'availabilityRevision' or (args->'dateCheck'->>'expiresAt')::timestamptz<=now() or (args->'dateCheck'->>'checkedAt')::timestamptz<now()-interval '2 minutes' or datevalue<timezone('Australia/Sydney',now())::date or datevalue>timezone('Australia/Sydney',now())::date+366 then raise exception using errcode='LK409',message='Calendar availability changed. Refresh and choose the date again.';end if;
   perform pg_advisory_xact_lock(hashtextextended('live-booking-date:'||company||':'||(target->>'calendarId')||':'||datevalue::text,0));
   if exists(select 1 from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=target->>'accountSub' and x.calendar_id=target->>'calendarId' and x.start_date<=datevalue and x.end_date>datevalue) then raise exception using errcode='LK409',message='This date has a confirmed booking.';end if;
   update public.lk_live_quote_approvals set preferred_date=datevalue,preferred_time=timevalue,selection_revision=selection_revision+1,availability_revision=args->>'availabilityRevision',availability_checked_at=(args->'dateCheck'->>'checkedAt')::timestamptz where id=a.id returning * into a;
  else
   if a.preferred_date is null or a.selection_revision is distinct from (args->>'selectionRevision')::integer then raise exception using errcode='LK409',message='The preferred date changed. Review the current request again.';end if;
   snapshot:=a.source_snapshot||jsonb_build_object('preferredDate',a.preferred_date);
   if a.source_snapshot->>'version'='live-booking-request-ack-v2' then
    if a.preferred_time is null or a.source_snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or public.lk_live_booking_sydney_instant(a.preferred_date::text||'T'||a.preferred_time)<=clock_timestamp() then raise exception using errcode='LK409',message='Choose a future Sydney take-off date and time.';end if;
    snapshot:=snapshot||jsonb_build_object('preferredTime',a.preferred_time);
   end if;
   if command='review' then return jsonb_build_object('snapshot',snapshot,'snapshotHash',public.lk_live_booking_hash(snapshot),'approvalId',a.id,'selectionRevision',a.selection_revision);end if;
   if jsonb_typeof(args->'reviewExpiresAt') is distinct from 'string' or args->>'snapshotHash' is distinct from public.lk_live_booking_hash(snapshot) or (args->>'reviewExpiresAt')::timestamptz<=now() then raise exception using errcode='LK409',message='Your reviewed summary changed or expired. Review it again before signing.';end if;
   if jsonb_typeof(args->'dateCheck') is distinct from 'object' or jsonb_typeof(args->'dateCheck'->'checkedAt') is distinct from 'string' or jsonb_typeof(args->'dateCheck'->'expiresAt') is distinct from 'string' or (args->'dateCheck'->>'checkedAt')::timestamptz>now()+interval '30 seconds' or args->'dateCheck'->>'accountSub' is distinct from target->>'accountSub' or args->'dateCheck'->>'calendarId' is distinct from target->>'calendarId' or (args->'dateCheck'->>'expiresAt')::timestamptz<=now() or (args->'dateCheck'->>'checkedAt')::timestamptz<now()-interval '2 minutes' or a.preferred_date<timezone('Australia/Sydney',now())::date then raise exception using errcode='LK409',message='Calendar availability changed. Review the preferred date again.';end if;
   perform pg_advisory_xact_lock(hashtextextended('live-booking-date:'||company||':'||(target->>'calendarId')||':'||a.preferred_date::text,0));
   if exists(select 1 from public.lk_live_booking_confirmed_segments x where x.company_id=company and x.account_sub=target->>'accountSub' and x.calendar_id=target->>'calendarId' and x.start_date<=a.preferred_date and x.end_date>a.preferred_date) then raise exception using errcode='LK409',message='This date has a confirmed booking.';end if;
   signature:=args->'signature';if not public.lk_live_booking_signature_valid(signature) then raise exception using errcode='LK400',message='A valid name, signature and acknowledgment are required.';end if;
   sid:=gen_random_uuid();
   insert into public.lk_live_quote_submissions(id,company_id,request_id,approval_id,reference,auth_user_id,verified_email,preferred_date,preferred_time,calendar_status,selection_revision,snapshot,snapshot_hash,signature,signed_content_hash,email_idempotency_key)
   values(sid,company,r.id,a.id,'REQUEST-'||upper(left(replace(sid::text,'-',''),12)),uid,a.verified_email,a.preferred_date,a.preferred_time,case when snapshot->>'version'='live-booking-request-ack-v2' then 'not_required' else 'blocked' end,a.selection_revision,snapshot,public.lk_live_booking_hash(snapshot),signature,public.lk_live_booking_hash(jsonb_build_object('snapshot',snapshot,'signature',signature)),'live-booking-email:'||sid::text||':v1') returning * into s;
  end if;
 end if;
 result:=public.lk_live_booking_state(r);
 insert into public.lk_live_quote_booking_receipts values(company,r.id,uid,key,fingerprint,result,now());
 return result;
end;
$$;
create or replace function public.lk_live_company_simple_snapshot(s public.lk_live_quote_submissions,args jsonb,target jsonb) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare firstat timestamptz;takeend timestamptz;installstart timestamptz;installend timestamptz;segments jsonb;pricing jsonb:=s.snapshot->'pricing';amount bigint;gst bigint;total bigint;note text:=btrim(args->>'companyNote');
begin
 if s.snapshot->>'version' is distinct from 'live-booking-request-ack-v2' or s.snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or s.preferred_time is null or s.snapshot->>'preferredTime' is distinct from s.preferred_time or s.snapshot->>'preferredDate' is distinct from s.preferred_date::text or public.lk_live_booking_hash(s.snapshot)<>s.snapshot_hash or public.lk_live_booking_hash(jsonb_build_object('snapshot',s.snapshot,'signature',s.signature))<>s.signed_content_hash or not public.lk_live_booking_signature_valid(s.signature) then raise exception using errcode='LK409',message='This signed request requires the original separate company proposal workflow.';end if;
 if jsonb_typeof(args->'companyNote') is distinct from 'string' or length(note) not between 1 and 3000 or note ~ '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception using errcode='LK400',message='Enter a valid company damage and installation note.';end if;
 if pricing->>'status' is distinct from 'provisional_estimate' or jsonb_typeof(pricing->'subtotal') is distinct from 'number' or jsonb_typeof(pricing->'tax') is distinct from 'number' or jsonb_typeof(pricing->'total') is distinct from 'number' or pricing->>'currency' is distinct from 'AUD' then raise exception using errcode='LK409',message='The original numeric photo estimate is required.';end if;
 amount:=(pricing->>'subtotal')::bigint;gst:=(pricing->>'tax')::bigint;total:=(pricing->>'total')::bigint;
 if amount<1 or amount>100000000 or (pricing->>'subtotal')::numeric<>amount or (pricing->>'tax')::numeric<>gst or (pricing->>'total')::numeric<>total or coalesce(pricing->>'pricingVersion','lk-sydney-cabinet-v2-20261011') not in ('lk-sydney-cabinet-v1-20261011','lk-sydney-cabinet-v2-20261011','lk-sydney-cabinet-v3-20261014') or gst<>(case when pricing->>'pricingVersion'='lk-sydney-cabinet-v3-20261014' then 0 else round(amount*0.1) end) or total<>amount+gst then raise exception using errcode='LK409',message='The original estimate arithmetic changed.';end if;
 firstat:=public.lk_live_booking_sydney_instant(s.preferred_date::text||'T'||s.preferred_time);
 takeend:=public.lk_live_booking_sydney_instant(args->>'takeOffEndLocal');installstart:=public.lk_live_booking_sydney_instant(args->>'installStartLocal');installend:=public.lk_live_booking_sydney_instant(args->>'installEndLocal');
 if firstat<=clock_timestamp() or takeend<=firstat or takeend-firstat>interval '90 days' or installstart<takeend or installend<=installstart or installend-installstart>interval '90 days' then raise exception using errcode='LK400',message='Choose future take-off and installation periods, with installation after take-off and an end after each start.';end if;
 select jsonb_agg(jsonb_build_object('kind','timed','purpose',x.purpose,'startAt',to_char(x.a at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endAt',to_char(x.b at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'startLocal',x.alocal,'endLocal',x.blocal,'startDate',(x.a at time zone 'Australia/Sydney')::date,'endDate',((x.b-interval '1 microsecond') at time zone 'Australia/Sydney')::date+1) order by x.idx) into segments from (values(0,'take_off',firstat,takeend,s.preferred_date::text||'T'||s.preferred_time,args->>'takeOffEndLocal'),(1,'install',installstart,installend,args->>'installStartLocal',args->>'installEndLocal')) x(idx,purpose,a,b,alocal,blocal);
 return jsonb_build_object('confirmationBasis','signed_request','signedSubmissionId',s.id,'originalSnapshotHash',s.snapshot_hash,'originalSignedContentHash',s.signed_content_hash,'companyNote',note,'amountExGst',amount,'gst',gst,'total',total,'currency','AUD','pricing',pricing,'priceKind','photo_estimate','scope',left('Photo-based cabinet painting estimate. '||coalesce(s.snapshot->'analysis'->>'summary',''),5000),'adjustmentReason','Original photo estimate retained. Additional site damage and costs require discussion before proceeding.','segments',segments,'calendarTarget',target);
end;$$;

commit;
