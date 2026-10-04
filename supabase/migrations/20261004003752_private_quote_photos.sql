-- Private photo metadata and durable upload/deletion leases. The private bucket
-- is provisioned through the Storage API, not by writing storage's internal tables.
begin;
create table public.lk_quote_photos (
 id uuid primary key,
 draft_id uuid not null references public.lk_quote_drafts(id),
 service_id text not null check(service_id='cabinet-painting'),
 idempotency_key text not null check(length(idempotency_key) between 16 and 100),
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 input_bytes integer not null check(input_bytes between 1 and 10485760),
 source_mime text not null check(source_mime in ('image/jpeg','image/png','image/webp')),
 object_path text not null unique,
 status text not null default 'pending' check(status in ('pending','processing','attached','rejected','retryable_error','delete_pending','deleted')),
 stored_bytes integer check(stored_bytes between 1 and 6291456),
 mime_type text check(mime_type='image/jpeg'),
 width integer check(width between 1 and 4096), height integer check(height between 1 and 4096),
 content_hash text check(content_hash ~ '^[a-f0-9]{64}$'),
 processing_version text not null check(processing_version='quote-photo-jpeg-v1'),
 notice_version text not null check(notice_version='quote-photo-notice-v1'),
 notice_accepted_at timestamptz not null default now(),
 error_code text check(error_code in ('upload_interrupted','storage_unavailable','invalid_image','source_mismatch','unsupported_image','input_too_large','image_too_large','content_conflict','delete_failed')),
 lease_holder text, lease_generation integer not null default 0, lease_until timestamptz,
 retry_after timestamptz not null default now(),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(draft_id,idempotency_key),
 check(object_path=draft_id::text||'/'||id::text||'.jpg'),
 check(status<>'attached' or (stored_bytes is not null and mime_type is not null and width is not null and height is not null and content_hash is not null))
);
create index lk_quote_photos_draft on public.lk_quote_photos(draft_id,created_at,id);
create index lk_quote_photos_recovery on public.lk_quote_photos(retry_after,lease_until) where status in ('pending','processing','delete_pending','deleted');
alter table public.lk_quote_photos enable row level security;
revoke all on public.lk_quote_photos from public,anon,authenticated;
grant select,insert,update,delete on public.lk_quote_photos to service_role;
alter table public.lk_quote_drafts add column photo_manifest_hash text not null default md5('[]');

create function public.lk_quote_photo_public(p public.lk_quote_photos) returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('id',p.id,'status',p.status,'inputBytes',p.input_bytes,'storedBytes',p.stored_bytes,'mimeType',p.mime_type,'width',p.width,'height',p.height,'contentHash',p.content_hash,'processingVersion',p.processing_version,'noticeVersion',p.notice_version,'errorCode',p.error_code)
$$;
create function public.lk_quote_photo_manifest(draft uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('photoId',id,'contentHash',content_hash,'processingVersion',processing_version) order by id),'[]'::jsonb) from public.lk_quote_photos where draft_id=draft and status='attached'
$$;
create function public.lk_guard_quote_photo() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.lk_quote_submissions qs where qs.snapshot->'photos' @> jsonb_build_array(jsonb_build_object('photoId',old.id))) then
   raise exception using errcode='LK409',message='Submitted photos are immutable';
 end if;
 if exists(select 1 from public.lk_quote_submissions where draft_id=old.draft_id) then
   -- An unreferenced tombstone may receive only cleanup lease/status metadata.
   -- Its photo bytes/identity never become mutable, even after final submission.
   if tg_op='DELETE' or old.status<>'deleted' or new.status<>'deleted'
     or (to_jsonb(new)-array['lease_holder','lease_generation','lease_until','retry_after','error_code','updated_at']) is distinct from
        (to_jsonb(old)-array['lease_holder','lease_generation','lease_until','retry_after','error_code','updated_at']) then
     raise exception using errcode='LK409',message='Submitted photos are immutable';
   end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 if row(new.id,new.draft_id,new.service_id,new.idempotency_key,new.source_hash,new.input_bytes,new.source_mime,new.object_path,new.processing_version,new.notice_version,new.notice_accepted_at)
   is distinct from row(old.id,old.draft_id,old.service_id,old.idempotency_key,old.source_hash,old.input_bytes,old.source_mime,old.object_path,old.processing_version,old.notice_version,old.notice_accepted_at)
   or (old.content_hash is not null and row(new.content_hash,new.stored_bytes,new.mime_type,new.width,new.height) is distinct from row(old.content_hash,old.stored_bytes,old.mime_type,old.width,old.height)) then
   raise exception using errcode='LK409',message='Photo evidence cannot be replaced';
 end if;
 return new;
end;
$$;
create trigger lk_quote_photo_immutable before update or delete on public.lk_quote_photos for each row execute function public.lk_guard_quote_photo();

create function public.lk_quote_photo(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 d public.lk_quote_drafts; p public.lk_quote_photos; h text:=args->>'owner_hash'; r jsonb; submitted boolean; next_status text;
 count_files integer; total_bytes bigint; holder text:=args->>'holder';
begin
 -- Only server-role callers can use worker/admin commands. No anonymous RPC access.
 if command='recovery_list' then
   select coalesce(jsonb_agg(id),'[]'::jsonb) into r from (
     select qp.id from public.lk_quote_photos qp join public.lk_quote_drafts qd on qd.id=qp.draft_id
     where (qp.status='deleted' or not exists(select 1 from public.lk_quote_submissions s where s.draft_id=qd.id))
       and not exists(select 1 from public.lk_quote_submissions qs where qs.snapshot->'photos' @> jsonb_build_array(jsonb_build_object('photoId',qp.id)))
       and (qp.lease_until is null or qp.lease_until<=now()) and qp.retry_after<=now()
       and (qp.status in ('processing','delete_pending','deleted') or (qp.status='pending' and qp.created_at<now()-interval '15 minutes')
         or (qp.status in ('attached','rejected','retryable_error') and qd.expires_at<now()-interval '24 hours'))
     order by qp.updated_at limit 10
   ) candidates;
   return r;
 end if;
 if command='admin_content' then
   select qp.* into p from public.lk_quote_photos qp join public.lk_quote_submissions s on s.draft_id=qp.draft_id
   where s.id=(args->>'submission_id')::uuid and qp.id=(args->>'id')::uuid and qp.status='attached'
     and s.snapshot->'photos' @> jsonb_build_array(jsonb_build_object('photoId',qp.id,'contentHash',qp.content_hash,'processingVersion',qp.processing_version));
   if not found then raise exception using errcode='LK404',message='Photo unavailable'; end if;
   return to_jsonb(p);
 end if;
 if command in ('claim_recovery','prepare','attach','fail','delete_done','delete_failed') then
   select qd.owner_hash into h from public.lk_quote_drafts qd join public.lk_quote_photos qp on qp.draft_id=qd.id where qp.id=(args->>'id')::uuid;
 end if;
 if h is null or h !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403',message='Private draft session required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('quote-draft:'||h,0));
 select * into d from public.lk_quote_drafts where owner_hash=h for update;
 if d.id is null then raise exception using errcode='LK403',message='Private draft session expired'; end if;
 select exists(select 1 from public.lk_quote_submissions where draft_id=d.id) into submitted;
 if command not in ('claim_recovery','prepare','attach','fail','delete_done','delete_failed') and d.expires_at<=now() then raise exception using errcode='LK403',message='Private draft session expired'; end if;
 if command in ('list','manifest') then
   if command='manifest' then
     if exists(select 1 from public.lk_quote_photos where draft_id=d.id and status not in ('attached','deleted')) then raise exception using errcode='LK409',message='Finish or remove unsaved photos before reviewing'; end if;
     return jsonb_build_object('photos',public.lk_quote_photo_manifest(d.id),'draftRevision',d.revision);
   end if;
   select coalesce(jsonb_agg(public.lk_quote_photo_public(qp) order by qp.created_at,qp.id),'[]'::jsonb) into r from public.lk_quote_photos qp where draft_id=d.id and status<>'deleted';
   return jsonb_build_object('photos',r,'draftRevision',d.revision,'submitted',submitted);
 end if;
 if command='reserve' then
   if submitted then raise exception using errcode='LK409',message='Submitted photos are immutable'; end if;
   if d.payload->'service'->>'serviceId' is distinct from 'cabinet-painting' then raise exception using errcode='LK409',message='Save service details first'; end if;
   select * into p from public.lk_quote_photos where draft_id=d.id and idempotency_key=args->>'key';
   if found then
     if p.source_hash is distinct from args->>'source_hash' or p.input_bytes is distinct from (args->>'input_bytes')::integer or p.source_mime is distinct from args->>'source_mime' or p.notice_version is distinct from args->>'notice_version' or p.status in ('deleted','delete_pending') then raise exception using errcode='LK409',message='Upload key does not match this photo'; end if;
   else
     if d.revision is distinct from (args->>'expected_revision')::integer then raise exception using errcode='LK409',message='Draft changed; reload saved photos'; end if;
     if args->>'notice_version' is distinct from 'quote-photo-notice-v1' or args->>'notice_accepted' is distinct from 'true' then raise exception using errcode='LK400',message='Acknowledge the private photo notice'; end if;
     select count(*),coalesce(sum(input_bytes),0) into count_files,total_bytes from public.lk_quote_photos where draft_id=d.id and status<>'deleted';
     if count_files>=8 or total_bytes+(args->>'input_bytes')::bigint>83886080 then raise exception using errcode='LK413',message='Photo count or total size limit reached'; end if;
     insert into public.lk_quote_photos(id,draft_id,service_id,idempotency_key,source_hash,input_bytes,source_mime,object_path,processing_version,notice_version)
       values((args->>'id')::uuid,d.id,'cabinet-painting',args->>'key',args->>'source_hash',(args->>'input_bytes')::integer,args->>'source_mime',d.id::text||'/'||(args->>'id')||'.jpg','quote-photo-jpeg-v1',args->>'notice_version') returning * into p;
     update public.lk_quote_drafts set revision=revision+1,updated_at=now() where id=d.id returning * into d;
   end if;
   return jsonb_build_object('photo',public.lk_quote_photo_public(p),'draftRevision',d.revision);
 end if;
 select * into p from public.lk_quote_photos where id=(args->>'id')::uuid and draft_id=d.id for update;
 if p.id is null then raise exception using errcode='LK404',message='Photo unavailable'; end if;
 if command='content' then
   if p.status<>'attached' then raise exception using errcode='LK404',message='Photo unavailable'; end if;
   return to_jsonb(p);
 end if;
 if submitted and not (
   command in ('claim_recovery','delete_done','delete_failed') and p.status='deleted'
   and not exists(select 1 from public.lk_quote_submissions qs where qs.snapshot->'photos' @> jsonb_build_array(jsonb_build_object('photoId',p.id)))
 ) then raise exception using errcode='LK409',message='Submitted photos are immutable'; end if;
 if command='claim_upload' then
   if p.status='attached' then return jsonb_build_object('photo',public.lk_quote_photo_public(p),'draftRevision',d.revision,'record',to_jsonb(p)); end if;
   if p.status not in ('pending','retryable_error') or (p.lease_until is not null and p.lease_until>now()) then raise exception using errcode='LK409',message='Photo processing is already active; refresh shortly'; end if;
   if length(coalesce(holder,'')) not between 16 and 100 then raise exception using errcode='LK400',message='Invalid worker'; end if;
   perform pg_advisory_xact_lock(76001004);
   if exists(select 1 from public.lk_quote_photos where draft_id=d.id and status='processing' and lease_until>now()) or (select count(*) from public.lk_quote_photos where status='processing' and lease_until>now())>=2 then raise exception using errcode='LK429',message='Photo processing is busy'; end if;
   update public.lk_quote_photos set status='processing',error_code=null,lease_holder=holder,lease_generation=lease_generation+1,lease_until=now()+interval '2 minutes',updated_at=now() where id=p.id returning * into p;
   return jsonb_build_object('record',to_jsonb(p),'draftRevision',d.revision);
 elsif command='delete' then
   if p.status in ('deleted','delete_pending') then return jsonb_build_object('photo',public.lk_quote_photo_public(p),'draftRevision',d.revision); end if;
   if d.revision is distinct from (args->>'expected_revision')::integer then raise exception using errcode='LK409',message='Draft changed; reload saved photos'; end if;
   if p.lease_until>now() then raise exception using errcode='LK409',message='Photo is processing; wait and retry'; end if;
   update public.lk_quote_photos set status='delete_pending',lease_holder=null,lease_until=null,error_code=null,retry_after=case when p.status='processing' then now()+interval '2 minutes' else now() end,updated_at=now() where id=p.id returning * into p;
   update public.lk_quote_drafts set revision=revision+1,photo_manifest_hash=md5(public.lk_quote_photo_manifest(d.id)::text),updated_at=now() where id=d.id returning * into d;
 elsif command='claim_recovery' then
   if p.lease_until>now() or p.retry_after>now() then raise exception using errcode='LK409',message='Photo recovery already active'; end if;
   if length(coalesce(holder,'')) not between 16 and 100 then raise exception using errcode='LK400',message='Invalid worker'; end if;
   if d.expires_at<now()-interval '24 hours' and p.status not in ('deleted','delete_pending') then
     update public.lk_quote_photos set status='delete_pending',updated_at=now() where id=p.id returning * into p;
     update public.lk_quote_drafts set revision=revision+1,photo_manifest_hash=md5(public.lk_quote_photo_manifest(d.id)::text),updated_at=now() where id=d.id returning * into d;
   end if;
   if p.status='pending' and p.created_at<now()-interval '15 minutes' then
     update public.lk_quote_photos set status='retryable_error',error_code='upload_interrupted',updated_at=now() where id=p.id returning * into p;
     return jsonb_build_object('record',to_jsonb(p),'draftRevision',d.revision);
   end if;
   if p.status not in ('processing','delete_pending','deleted')
     or exists(select 1 from public.lk_quote_submissions qs where qs.snapshot->'photos' @> jsonb_build_array(jsonb_build_object('photoId',p.id))) then raise exception using errcode='LK409',message='Photo has no recovery work'; end if;
   update public.lk_quote_photos set lease_holder=holder,lease_generation=lease_generation+1,lease_until=now()+interval '2 minutes',updated_at=now() where id=p.id returning * into p;
   return jsonb_build_object('record',to_jsonb(p),'draftRevision',d.revision);
 elsif command in ('prepare','attach','fail','delete_done','delete_failed') then
   if p.lease_holder is distinct from holder or p.lease_generation is distinct from (args->>'generation')::integer or p.lease_until is null or p.lease_until<=now() then raise exception using errcode='LK409',message='Photo processing lease expired'; end if;
   if command in ('prepare','attach','fail') and p.status<>'processing' then raise exception using errcode='LK409',message='Photo is no longer processing'; end if;
   if command in ('delete_done','delete_failed') and p.status not in ('delete_pending','deleted') then raise exception using errcode='LK409',message='Photo is not awaiting deletion'; end if;
   if command='prepare' then
     update public.lk_quote_photos set content_hash=args->>'content_hash',stored_bytes=(args->>'stored_bytes')::integer,mime_type='image/jpeg',width=(args->>'width')::integer,height=(args->>'height')::integer,updated_at=now() where id=p.id returning * into p;
   elsif command='attach' then
     if p.content_hash is null then raise exception using errcode='LK409',message='Photo validation missing'; end if;
     update public.lk_quote_photos set status='attached',lease_holder=null,lease_until=null,error_code=null,updated_at=now() where id=p.id returning * into p;
     update public.lk_quote_drafts set revision=revision+1,photo_manifest_hash=md5(public.lk_quote_photo_manifest(d.id)::text),updated_at=now() where id=d.id returning * into d;
   elsif command='fail' then
     next_status:=args->>'status';
     if next_status not in ('rejected','retryable_error') or next_status is null then raise exception using errcode='LK400',message='Invalid photo outcome'; end if;
     update public.lk_quote_photos set status=next_status,error_code=args->>'error_code',lease_holder=null,lease_until=null,retry_after=now()+interval '60 seconds',updated_at=now() where id=p.id returning * into p;
   elsif command='delete_done' then
     update public.lk_quote_photos set status='deleted',lease_holder=null,lease_until=null,error_code=null,retry_after=now()+interval '24 hours',updated_at=now() where id=p.id returning * into p;
   else
     update public.lk_quote_photos set error_code='delete_failed',lease_holder=null,lease_until=null,retry_after=now()+case when p.status='deleted' then interval '24 hours' else interval '60 seconds' end,updated_at=now() where id=p.id returning * into p;
   end if;
 else raise exception using errcode='LK400',message='Unknown photo operation';
 end if;
 return jsonb_build_object('photo',public.lk_quote_photo_public(p),'draftRevision',d.revision);
end;
$$;
revoke all on function public.lk_quote_photo_public(public.lk_quote_photos),public.lk_quote_photo_manifest(uuid),public.lk_guard_quote_photo(),public.lk_quote_photo(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_photo_public(public.lk_quote_photos),public.lk_quote_photo_manifest(uuid),public.lk_guard_quote_photo(),public.lk_quote_photo(text,jsonb) to service_role;

-- Preserve existing delivery operations; extend only the initial snapshot check.
create or replace function public.lk_quote_submission(command text,args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  s public.lk_quote_submissions; d public.lk_quote_drafts; e public.lk_enquiries;
  h text:=args->>'owner_hash'; r jsonb; payload jsonb; contact jsonb; service jsonb;
  current_calendar text; batch integer; next_status text; next_error text;
begin
  if command in ('read','submit') then
    if h is null or h !~ '^[a-f0-9]{64}$' then raise exception using errcode='LK403',message='Invalid draft session'; end if;
    -- Match the existing draft-save lock before checking revision and freezing it.
    if command='submit' then perform pg_advisory_xact_lock(hashtextextended('quote-draft:'||h,0)); end if;
    select * into s from public.lk_quote_submissions where owner_hash=h;
    select * into d from public.lk_quote_drafts where owner_hash=h;
    if s.id is null and (d.id is null or d.expires_at<=now()) then
      if command='read' then return 'null'; end if;
      raise exception using errcode='LK403',message='Draft session expired';
    end if;
    if command='submit' then
      if s.id is not null then
        if s.idempotency_key is distinct from args->>'key' or s.request_hash is distinct from args->>'request_hash'
          or s.snapshot is distinct from args->'snapshot' or s.snapshot_hash is distinct from args->>'snapshot_hash'
          or s.signature is distinct from args->'signature' then
          raise exception using errcode='LK409',message='This draft was already submitted';
        end if;
      else
        if args->>'expected_revision' is null or args->>'expected_revision' !~ '^[1-9][0-9]{0,8}$'
          or d.revision<>(args->>'expected_revision')::integer
          or args->'snapshot'->>'draftId' is distinct from d.id::text
          or args->'snapshot'->>'draftRevision' is distinct from d.revision::text
          or args->'snapshot'->'payload' is distinct from d.payload then
          raise exception using errcode='LK409',message='Saved details changed; review again';
        end if;
        if d.payload->'service' is null or d.payload->'service'='null'::jsonb
          or args->'snapshot'->>'mode' is distinct from 'demo'
          or coalesce(args->'snapshot'->>'version','') not in ('kcp-demo-v1','kcp-demo-v2')
          or coalesce(args->'snapshot'->>'preferredDate','') !~ '^\d{4}-\d{2}-\d{2}$'
          or args->'signature'->>'acknowledged' is distinct from 'true'
          or length(trim(coalesce(args->'signature'->>'name',''))) not between 1 and 120
          or jsonb_typeof(args->'signature'->'strokes') is distinct from 'array'
          or jsonb_array_length(args->'signature'->'strokes')<1 then
          raise exception using errcode='LK400',message='Complete the demo review and signature';
        end if;
        -- The owner lock also serializes reserve/attach/delete and draft saves.
        -- Exact historical retries above bypass new validation without changing evidence.
        if exists(select 1 from public.lk_quote_photos where draft_id=d.id and status not in ('attached','deleted')) then
          raise exception using errcode='LK409',message='Finish or remove unsaved photos before signing';
        end if;
        if args->'snapshot'->>'version'='kcp-demo-v2' then
          if args->'snapshot'->'photos' is distinct from public.lk_quote_photo_manifest(d.id) then
            raise exception using errcode='LK409',message='Saved photos changed; review again';
          end if;
        elsif exists(select 1 from public.lk_quote_photos where draft_id=d.id and status<>'deleted') then
          raise exception using errcode='LK409',message='Photo review version required';
        end if;
        perform pg_advisory_xact_lock(76001001);
        select selected_calendar_id into current_calendar from public.lk_google_connection where id=1;
        if current_calendar is null or current_calendar is distinct from args->>'calendar_id' then
          raise exception using errcode='LK409',message='Calendar target changed; review again';
        end if;
        insert into public.lk_quote_submissions(id,draft_id,owner_hash,idempotency_key,request_hash,reference,snapshot,snapshot_hash,signature,calendar_id)
          values((args->>'id')::uuid,d.id,h,args->>'key',args->>'request_hash',args->>'reference',args->'snapshot',args->>'snapshot_hash',args->'signature',current_calendar)
          returning * into s;
      end if;
    elsif s.id is null then return 'null'; end if;
  elsif command='claim' then
    if length(coalesce(args->>'holder','')) not between 16 and 160 then raise exception using errcode='LK400',message='Invalid delivery worker'; end if;
    batch:=least(10,greatest(1,coalesce((args->>'limit')::integer,1)));
    perform pg_advisory_xact_lock(76001001);
    -- Resend retains idempotency keys for 24h; stop automatic replay after 23h.
    update public.lk_quote_submissions set email_status='outcome_unknown',error_code='email_outcome_unknown',lease_holder=null,lease_until=null
      where email_status in ('pending','sending','retrying') and email_first_attempt_at<=now()-interval '23 hours'
        and (lease_until is null or lease_until<=now());
    with candidates as (
      select id from public.lk_quote_submissions
      where (email_status in ('pending','sending','retrying') or (email_status='provider_accepted' and enquiry_id is null))
        and retry_after<=now() and (lease_until is null or lease_until<=now())
        and (args->>'id' is null or id=(args->>'id')::uuid)
      order by retry_after,submitted_at limit batch for update skip locked
    ), claimed as (
      update public.lk_quote_submissions q set lease_holder=args->>'holder',lease_generation=lease_generation+1,lease_until=now()+interval '2 minutes'
      from candidates c where q.id=c.id returning q.*
    ) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into r from claimed;
    return r;
  elsif command in ('email_attempt','email_accepted','email_failed') then
    perform pg_advisory_xact_lock(76001001);
    select * into s from public.lk_quote_submissions where id=(args->>'id')::uuid for update;
    if s.id is null or s.lease_holder is distinct from args->>'holder' or s.lease_generation is distinct from (args->>'generation')::integer
      or s.lease_until is null or s.lease_until<=now() then raise exception using errcode='LK409',message='Delivery lease expired'; end if;
    if command='email_attempt' then
      if s.email_status not in ('pending','sending','retrying') then raise exception using errcode='LK409',message='Email is not awaiting delivery'; end if;
      if s.email_first_attempt_at is not null and s.email_first_attempt_at<=now()-interval '23 hours' then
        update public.lk_quote_submissions set email_status='outcome_unknown',error_code='email_outcome_unknown',lease_holder=null,lease_until=null where id=s.id returning * into s;
        return to_jsonb(s);
      end if;
      if jsonb_typeof(args->'payload') is distinct from 'object' or octet_length((args->'payload')::text)>2000000 then
        raise exception using errcode='LK400',message='Invalid email payload';
      end if;
      if s.email_payload is not null and s.email_payload is distinct from args->'payload' then
        raise exception using errcode='LK409',message='Email payload changed after first attempt';
      end if;
      update public.lk_quote_submissions set email_payload=args->'payload',email_attempts=email_attempts+1,
        email_first_attempt_at=coalesce(email_first_attempt_at,now()),email_status='sending',error_code=null where id=s.id returning * into s;
      return to_jsonb(s);
    elsif command='email_failed' then
      if s.email_status='provider_accepted' then raise exception using errcode='LK409',message='Email was already accepted'; end if;
      next_status:=args->>'outcome'; next_error:=args->>'error_code';
      if next_status not in ('retrying','failed','outcome_unknown') or next_status is null
        or next_error not in ('email_transient','email_configuration','email_rejected','email_outcome_unknown','email_payload_conflict','email_retry_window_expired','email_document_invalid') or next_error is null then
        raise exception using errcode='LK400',message='Invalid delivery outcome';
      end if;
      update public.lk_quote_submissions set email_status=next_status,error_code=next_error,retry_after=now()+interval '60 seconds',lease_holder=null,lease_until=null where id=s.id returning * into s;
    else
      if length(coalesce(args->>'provider_id','')) not between 1 and 200 or s.email_payload is null or s.email_first_attempt_at is null
        or (s.email_provider_id is not null and s.email_provider_id is distinct from args->>'provider_id') then
        raise exception using errcode='LK409',message='Email acceptance does not match delivery';
      end if;
      update public.lk_quote_submissions set email_status='provider_accepted',email_provider_id=args->>'provider_id',email_accepted_at=coalesce(email_accepted_at,now())
        where id=s.id returning * into s;
      select selected_calendar_id into current_calendar from public.lk_google_connection where id=1;
      if s.enquiry_id is null and current_calendar is not distinct from s.calendar_id then
        contact:=s.snapshot->'payload'->'contact'; service:=s.snapshot->'payload'->'service';
        payload:=jsonb_build_object('serviceId',service->>'serviceId','projectIntent',service->>'intent','targetSurfaces',service->'surfaces',
          'doorCount',service->'doorCount','drawerCount',service->'drawerCount','material',service->>'material','colourPreference',service->>'colourPreference',
          'name',contact->>'name','email',contact->>'email','phone',contact->>'phone','siteAddress',contact->>'siteAddress','suburb',contact->>'suburb',
          'postcode',contact->>'postcode','notes',contact->>'details','preferredDate',s.snapshot->>'preferredDate','acknowledgement',true,
          'demo',true,'demoSubmissionId',s.id,'submissionSnapshotHash',s.snapshot_hash);
        insert into public.lk_enquiries(id,reference,source,idempotency_key,payload_hash,payload_json,status,revision,calendar_status)
          values(s.id,s.reference,'web','demo-submission:'||s.id,s.snapshot_hash,payload,'submitted',1,'pending');
        insert into public.lk_outbox values(s.id,1,now());
        update public.lk_quote_submissions set enquiry_id=id where id=s.id returning * into s;
      end if;
      update public.lk_quote_submissions set email_status='provider_accepted',email_provider_id=args->>'provider_id',email_accepted_at=coalesce(email_accepted_at,now()),
        error_code=case when enquiry_id is null then 'calendar_target_changed' end,retry_after=now()+interval '60 seconds',lease_holder=null,lease_until=null
        where id=s.id returning * into s;
    end if;
  else raise exception using errcode='LK400',message='Unknown submission operation';
  end if;
  if s.enquiry_id is not null then select * into e from public.lk_enquiries where id=s.enquiry_id; end if;
  return jsonb_build_object('id',s.id,'reference',s.reference,'submittedAt',s.submitted_at,'preferredDate',s.snapshot->>'preferredDate',
    'emailStatus',s.email_status,'calendarStatus',coalesce(e.calendar_status,'blocked'),
    'error',coalesce(s.error_code,case when e.calendar_error is not null then 'calendar_needs_attention' end));
end;
$$;
revoke all on function public.lk_quote_submission(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_quote_submission(text,jsonb) to service_role;
commit;
