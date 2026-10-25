-- R3b company revisions are new evidence; original requests/submissions and their mail never change.
begin;
create table public.lk_quote_company_revisions (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),request_id uuid not null references public.lk_quote_requests(id),
 version_no integer not null check(version_no>0),revision integer not null check(revision>0),base_submission_id uuid not null references public.lk_live_quote_submissions(id),
 base_snapshot_hash text not null,base_signed_content_hash text not null,based_on_revision_id uuid references public.lk_quote_company_revisions(id),
 status text not null check(status in ('draft','published','accepted','superseded','withdrawn')),payload jsonb not null,pricing jsonb not null,total_cents bigint not null check(total_cents>0),comparison jsonb not null,
 snapshot jsonb,snapshot_hash text,acknowledgment jsonb not null,terms_version text,
 created_by uuid not null,updated_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),published_at timestamptz,published_by uuid,accepted_at timestamptz,withdrawn_at timestamptz,withdrawn_by uuid,
 unique(request_id,version_no),check((snapshot is null and snapshot_hash is null and status='draft') or (snapshot is not null and snapshot_hash~'^[a-f0-9]{64}$' and status<>'draft'))
);
create unique index lk_quote_company_revision_active on public.lk_quote_company_revisions(request_id) where status in ('draft','published');
create table public.lk_quote_company_revision_acceptances (
 id uuid primary key default gen_random_uuid(),company_id text not null check(company_id='lk-group'),request_id uuid not null references public.lk_quote_requests(id),revision_id uuid not null unique references public.lk_quote_company_revisions(id),
 auth_user_id uuid not null,verified_email text not null,snapshot_hash text not null,signature jsonb not null,acknowledgment jsonb not null,signed_content_hash text not null check(signed_content_hash~'^[a-f0-9]{64}$'),accepted_at timestamptz not null default now()
);
create table public.lk_quote_company_revision_outbox (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.lk_quote_requests(id),revision_id uuid not null references public.lk_quote_company_revisions(id),kind text not null check(kind in ('revision_notice','revision_acceptance_receipt')),
 email_status text not null default 'pending' check(email_status in ('pending','sending','provider_accepted','retrying','failed','manual_review','cancelled')),provider_message_id text,email_idempotency_key text not null unique,email_first_attempt_at timestamptz,
 pdf_base64 text not null,pdf_hash text not null check(pdf_hash~'^[a-f0-9]{64}$'),payload jsonb not null,lease_token uuid,lease_expires_at timestamptz,next_attempt_at timestamptz not null default now(),error_code text,created_at timestamptz not null default now(),unique(revision_id,kind),check(email_status<>'provider_accepted' or provider_message_id is not null)
);
create table public.lk_quote_company_revision_receipts (
 request_id uuid not null references public.lk_quote_requests(id),idempotency_key uuid not null,command text not null,command_hash text not null,actor_id uuid not null,actor_session_id uuid not null,response jsonb not null,created_at timestamptz not null default now(),primary key(request_id,idempotency_key)
);
create table public.lk_quote_company_revision_audit (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.lk_quote_requests(id),revision_id uuid not null references public.lk_quote_company_revisions(id),action text not null,actor_id uuid not null,actor_session_id uuid not null,reason text not null,prior_revision integer not null,new_revision integer not null,details jsonb not null,created_at timestamptz not null default now()
);
create function lk_private.company_revision_ack() returns jsonb language sql immutable set search_path='' as $$select jsonb_build_object('version','company-quote-revision-ack-v1','text','I accept this revised quote for my booking request and confirm the changes shown here. This is not a contract, work authorisation or payment obligation. Final contractual terms require separate acceptance.');$$;
create function lk_private.company_revision_error(code text,rev integer default null) returns void language plpgsql set search_path='' as $$begin raise exception using errcode='LK409',message='The company revision cannot be changed.',detail=jsonb_strip_nulls(jsonb_build_object('code',code,'currentRevision',rev))::text;end;$$;
create function lk_private.company_revision_pricing(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare q jsonb:=value->'quantities';extra jsonb;k text;doors integer;drawers integer;painting bigint;amount bigint;items jsonb:='[]';
 -- Technical typo guard only; this is not a business price or an approved extra-item rate.
 MAX_EXTRA_ITEM_CENTS_TECHNICAL constant bigint:=10000000;
begin
 if not lk_private.current_work_keys(value,array['contact','quantities','extraItems','customerNote']) or not lk_private.current_work_keys(q,array['doorCount','drawerCount','moderateRepair']) then raise exception using errcode='LK422',message='Invalid company revision fields.';end if;
 foreach k in array array['doorCount','drawerCount'] loop if jsonb_typeof(q->k) is distinct from 'number' or coalesce(q->>k,'')!~'^[0-9]{1,3}$' or (q->>k)::integer>500 then raise exception using errcode='LK422',message='Invalid quantities.';end if;end loop;
 doors:=(q->>'doorCount')::integer;drawers:=(q->>'drawerCount')::integer;
 if doors+drawers=0 or jsonb_typeof(q->'moderateRepair') is distinct from 'boolean' or jsonb_typeof(value->'extraItems') is distinct from 'array' or jsonb_array_length(value->'extraItems')>30 or jsonb_typeof(value->'customerNote') is distinct from 'string' or length(value->>'customerNote')>3000 or value->>'customerNote'~'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]' or value->>'customerNote'~*'<(!--|/?[a-z][^>]*(>|$))' then raise exception using errcode='LK422',message='Invalid company revision fields.';end if;
 if doors>0 then items:=items||jsonb_build_array(jsonb_build_object('code','doors','label','Cabinet door preparation and painting','quantity',doors,'unitAmount',15000,'amount',doors*15000));end if;
 if drawers>0 then items:=items||jsonb_build_array(jsonb_build_object('code','drawers','label','Drawer front preparation and painting','quantity',drawers,'unitAmount',10000,'amount',drawers*10000));end if;
 painting:=doors*15000+drawers*10000;
 if painting<145000 then items:=items||jsonb_build_array(jsonb_build_object('code','minimum_adjustment','label','Minimum painting charge adjustment','quantity',1,'unitAmount',145000-painting,'amount',145000-painting));end if;
 amount:=greatest(painting,145000);
 if (q->>'moderateRepair')::boolean then items:=items||jsonb_build_array(jsonb_build_object('code','moderate_repairs','label','Moderate coating repairs (once per project)','quantity',1,'unitAmount',25000,'amount',25000));amount:=amount+25000;end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(value->'extraItems') x)<>jsonb_array_length(value->'extraItems') then raise exception using errcode='LK422',message='Duplicate extra item.';end if;
 for extra in select x from jsonb_array_elements(value->'extraItems') x loop
  if not lk_private.current_work_keys(extra,array['id','description','amountCents','reason']) or coalesce(extra->>'id','')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' or jsonb_typeof(extra->'amountCents') is distinct from 'number' or coalesce(extra->>'amountCents','')!~'^[0-9]{1,8}$' or (extra->>'amountCents')::bigint not between 1 and MAX_EXTRA_ITEM_CENTS_TECHNICAL then raise exception using errcode='LK422',message='Invalid extra item amount.';end if;
  foreach k in array array['description','reason'] loop if jsonb_typeof(extra->k) is distinct from 'string' or length(btrim(extra->>k)) not between 1 and 500 or extra->>k~'[\x00-\x1f\x7f]' or extra->>k~*'<(!--|/?[a-z][^>]*(>|$))' then raise exception using errcode='LK422',message='An extra item description and reason are required.';end if;end loop;
  amount:=amount+(extra->>'amountCents')::bigint;items:=items||jsonb_build_array(jsonb_build_object('code','extra:'||(extra->>'id'),'label',extra->>'description','quantity',1,'unitAmount',(extra->>'amountCents')::bigint,'amount',(extra->>'amountCents')::bigint));
 end loop;
 return jsonb_build_object('pricingVersion','lk-sydney-cabinet-v3-20261014','currency','AUD','amountUnit','cents','minimumSubtotal',145000,'gstRateBps',0,'lineItems',items,'subtotal',amount,'tax',0,'total',amount);
end;$$;
-- Preserve the signed monetary evidence; never infer a historical tax rate or line-item subtotal.
create function lk_private.company_revision_original_pricing(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare k text;n numeric;subtotal numeric;tax numeric;gst numeric;total numeric;items jsonb:=coalesce(nullif(value->'lineItems','null'::jsonb),'[]'::jsonb);version jsonb:=coalesce(value->'pricingVersion','null'::jsonb);
begin
 if jsonb_typeof(value) is distinct from 'object' or jsonb_typeof(items)<>'array' or jsonb_typeof(version) not in ('string','null') then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
 foreach k in array array['subtotal','tax','gst','total'] loop
  if value->k is not null and value->k<>'null'::jsonb then
   if jsonb_typeof(value->k)<>'number' then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
   n:=(value->>k)::numeric;
   if n<0 or n>9007199254740991 or trunc(n)<>n then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
   case k when 'subtotal' then subtotal:=n;when 'tax' then tax:=n;when 'gst' then gst:=n;when 'total' then total:=n;end case;
  end if;
 end loop;
 if total is null or (tax is not null and gst is not null and tax<>gst) then raise exception using errcode='LK422',message='Invalid original signed pricing.';end if;
 tax:=coalesce(tax,gst);
 if subtotal is null and tax is null then raise exception using errcode='LK422',message='Missing original signed subtotal or tax.';end if;
 subtotal:=coalesce(subtotal,total-tax);tax:=coalesce(tax,total-subtotal);
 if subtotal<0 or tax<0 or subtotal+tax<>total then raise exception using errcode='LK422',message='Original signed pricing does not balance.';end if;
 return jsonb_build_object('lineItems',items,'subtotalCents',subtotal,'taxCents',tax,'totalCents',total,'pricingVersion',version);
end;$$;
create function lk_private.company_revision_original_quantities(snapshot jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('doorCount',coalesce((select (x->>'quantity')::integer from jsonb_array_elements(coalesce(nullif(snapshot->'pricing'->'lineItems','null'::jsonb),'[]'::jsonb)) x where x->>'code'='doors'),(snapshot->'payload'->'service'->>'doorCount')::integer,0),'drawerCount',coalesce((select (x->>'quantity')::integer from jsonb_array_elements(coalesce(nullif(snapshot->'pricing'->'lineItems','null'::jsonb),'[]'::jsonb)) x where x->>'code'='drawers'),(snapshot->'payload'->'service'->>'drawerCount')::integer,0),'moderateRepair',exists(select 1 from jsonb_array_elements(coalesce(nullif(snapshot->'pricing'->'lineItems','null'::jsonb),'[]'::jsonb)) x where x->>'code'='moderate_repairs'));
$$;
create function lk_private.company_revision_comparison(s public.lk_live_quote_submissions,value jsonb,pricing jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare original jsonb;company jsonb;quantities jsonb;changes jsonb:='[]';k text;
begin
 quantities:=lk_private.company_revision_original_quantities(s.snapshot);
 original:=lk_private.company_revision_original_pricing(s.snapshot->'pricing')||jsonb_build_object('quantities',quantities);company:=jsonb_build_object('quantities',value->'quantities','lineItems',pricing->'lineItems','totalCents',pricing->'total');
 foreach k in array array['doorCount','drawerCount','moderateRepair'] loop if quantities->k is distinct from value->'quantities'->k then changes:=changes||jsonb_build_array(jsonb_build_object('field','quantities.'||k,'before',quantities->k,'after',value->'quantities'->k));end if;end loop;
 foreach k in array array['name','email','phone','siteAddress','suburb','postcode','details'] loop if s.snapshot->'payload'->'contact'->k is distinct from value->'contact'->k then changes:=changes||jsonb_build_array(jsonb_build_object('field','contact.'||k,'before',s.snapshot->'payload'->'contact'->k,'after',value->'contact'->k));end if;end loop;
 if value->'extraItems'<>'[]'::jsonb then changes:=changes||jsonb_build_array(jsonb_build_object('field','extraItems','before','[]'::jsonb,'after',value->'extraItems'));end if;
 if value->>'customerNote'<>'' then changes:=changes||jsonb_build_array(jsonb_build_object('field','customerNote','before','','after',value->>'customerNote'));end if;
 return jsonb_build_object('original',original,'company',company,'deltaCents',(pricing->>'total')::bigint-(s.snapshot->'pricing'->>'total')::bigint,'changes',changes);
end;$$;
create function lk_private.company_revision_snapshot(r public.lk_quote_company_revisions) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('schemaVersion','company-quote-revision-v1','companyId',r.company_id,'requestId',r.request_id,'revisionId',r.id,'versionNo',r.version_no,'baseSubmissionId',r.base_submission_id,'baseSnapshotHash',r.base_snapshot_hash,'baseSignedContentHash',r.base_signed_content_hash,'basedOnRevisionId',r.based_on_revision_id,'contact',r.payload->'contact','quantities',r.payload->'quantities','extraItems',r.payload->'extraItems','customerNote',r.payload->'customerNote','pricing',r.pricing,'comparison',r.comparison,'acknowledgment',r.acknowledgment,'termsVersion',r.terms_version);$$;
create function lk_private.company_revision_eligibility(rid uuid) returns text language plpgsql stable set search_path='' as $$
declare s public.lk_live_quote_submissions;
begin
 if exists(select 1 from public.lk_live_company_cancellations where request_id=rid) then return 'cancellation_started';end if;
 if exists(select 1 from public.lk_live_company_bookings where request_id=rid) then return 'booking_confirmed';end if;
 select * into s from public.lk_live_quote_submissions where request_id=rid and company_id='lk-group';
 if s.id is null or s.snapshot->>'mode' is distinct from 'live' or s.snapshot->>'version' is distinct from 'live-booking-request-ack-v2' or s.snapshot->'acknowledgment' is distinct from public.lk_live_booking_simple_ack() or s.snapshot_hash is distinct from public.lk_live_booking_hash(s.snapshot) or s.signed_content_hash is distinct from public.lk_live_booking_hash(jsonb_build_object('snapshot',s.snapshot,'signature',s.signature)) or not public.lk_live_booking_signature_valid(s.signature) then return 'revision_not_eligible';end if;
 return null;
end;$$;
create function lk_private.company_revision_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception using errcode='LK409',message='Company revision evidence cannot be deleted.';end if;
 if tg_table_name='lk_quote_company_revisions' then
  if tg_op='UPDATE' and old.status<>'draft' and (new.payload,new.pricing,new.total_cents,new.comparison,new.snapshot,new.snapshot_hash,new.acknowledgment,new.terms_version,new.base_submission_id,new.base_snapshot_hash,new.base_signed_content_hash,new.based_on_revision_id,new.request_id,new.company_id,new.version_no,new.published_at,new.published_by) is distinct from (old.payload,old.pricing,old.total_cents,old.comparison,old.snapshot,old.snapshot_hash,old.acknowledgment,old.terms_version,old.base_submission_id,old.base_snapshot_hash,old.base_signed_content_hash,old.based_on_revision_id,old.request_id,old.company_id,old.version_no,old.published_at,old.published_by) then raise exception using errcode='LK409',message='Published company revision evidence is immutable.';end if;
  if new.pricing is distinct from lk_private.company_revision_pricing(new.payload) or new.total_cents is distinct from (new.pricing->>'total')::bigint then raise exception using errcode='LK422',message='Company revision arithmetic changed.';end if;
  if new.snapshot is not null and (new.snapshot is distinct from lk_private.company_revision_snapshot(new) or new.snapshot_hash is distinct from public.lk_live_booking_hash(new.snapshot)) then raise exception using errcode='LK422',message='Company revision snapshot changed.';end if;
 elsif tg_table_name='lk_quote_company_revision_acceptances' and tg_op='INSERT' then
  if not public.lk_live_booking_signature_valid(new.signature) or new.acknowledgment is distinct from lk_private.company_revision_ack() or not exists(select 1 from public.lk_quote_company_revisions r where r.id=new.revision_id and r.request_id=new.request_id and r.company_id=new.company_id and r.status='published' and r.snapshot_hash=new.snapshot_hash and new.signed_content_hash=public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',new.signature,'ack',new.acknowledgment))) then raise exception using errcode='LK422',message='Revision acceptance evidence changed.';end if;
 elsif tg_table_name='lk_quote_company_revision_outbox' then
  if tg_op='UPDATE' and (new.request_id,new.revision_id,new.kind,new.email_idempotency_key,new.pdf_base64,new.pdf_hash,new.payload) is distinct from (old.request_id,old.revision_id,old.kind,old.email_idempotency_key,old.pdf_base64,old.pdf_hash,old.payload) then raise exception using errcode='LK409',message='Frozen revision mail is immutable.';end if;
  if tg_op='UPDATE' and old.email_status='provider_accepted' and new is distinct from old then raise exception using errcode='LK409',message='Provider acceptance is immutable.';end if;
 elsif tg_op='UPDATE' then raise exception using errcode='LK409',message='Company revision evidence is immutable.';
 end if;return new;
end;$$;
do $$declare t text;begin foreach t in array array['lk_quote_company_revisions','lk_quote_company_revision_acceptances','lk_quote_company_revision_outbox','lk_quote_company_revision_receipts','lk_quote_company_revision_audit'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);execute format('grant select on public.%I to service_role',t);
 execute format('create trigger company_revision_immutable before %s on public.%I for each row execute function lk_private.company_revision_guard()',case when t in ('lk_quote_company_revisions','lk_quote_company_revision_acceptances') then 'insert or update or delete' else 'update or delete' end,t);end loop;end;$$;
create function lk_private.company_revision_json(r public.lk_quote_company_revisions) returns jsonb language sql stable set search_path='' as $$
 select case when r.id is null then null else jsonb_build_object('id',r.id,'requestId',r.request_id,'versionNo',r.version_no,'revision',r.revision,'status',r.status,'baseSubmissionId',r.base_submission_id,'baseSnapshotHash',r.base_snapshot_hash,'baseSignedContentHash',r.base_signed_content_hash,'basedOnRevisionId',r.based_on_revision_id,'payload',r.payload,'pricing',r.pricing,'totalCents',r.total_cents,'comparison',r.comparison,'snapshot',r.snapshot,'snapshotHash',r.snapshot_hash,'publishedAt',r.published_at,'acceptedAt',r.accepted_at,'withdrawnAt',r.withdrawn_at,'acceptance',(select jsonb_build_object('id',a.id,'revisionId',a.revision_id,'snapshotHash',a.snapshot_hash,'signature',a.signature,'acknowledgment',a.acknowledgment,'signedContentHash',a.signed_content_hash,'acceptedAt',a.accepted_at) from public.lk_quote_company_revision_acceptances a where a.revision_id=r.id),'emailStatus',(select o.email_status from public.lk_quote_company_revision_outbox o where o.revision_id=r.id order by o.created_at desc limit 1),'receiptReady',exists(select 1 from public.lk_quote_company_revision_outbox o where o.revision_id=r.id)) end;
$$;
-- Audit links immutable evidence by identity/hash without duplicating contact data, free text or signatures.
create function lk_private.company_revision_audit_summary(r public.lk_quote_company_revisions) returns jsonb language sql stable set search_path='' as $$
 select case when r.id is null then null else jsonb_build_object('revisionId',r.id,'versionNo',r.version_no,'revision',r.revision,'status',r.status,'quantities',r.payload->'quantities','totalCents',r.total_cents,'pricingVersion',r.pricing->>'pricingVersion','baseSubmissionId',r.base_submission_id,'baseSnapshotHash',r.base_snapshot_hash,'baseSignedContentHash',r.base_signed_content_hash,'basedOnRevisionId',r.based_on_revision_id,'snapshotHash',r.snapshot_hash,'payloadHash',public.lk_live_booking_hash(r.payload),'acceptanceId',(select a.id from public.lk_quote_company_revision_acceptances a where a.revision_id=r.id),'signedContentHash',(select a.signed_content_hash from public.lk_quote_company_revision_acceptances a where a.revision_id=r.id)) end;
$$;
create function lk_private.company_revision_state(rid uuid,customer boolean default false) returns jsonb language plpgsql stable set search_path='' as $$
declare s public.lk_live_quote_submissions;q public.lk_quote_requests;effective public.lk_quote_company_revisions;initial jsonb;result jsonb;eligibility text:=lk_private.company_revision_eligibility(rid);
begin
 select * into s from public.lk_live_quote_submissions where request_id=rid;select * into q from public.lk_quote_requests where id=rid;
 select * into effective from public.lk_quote_company_revisions where request_id=rid and status='accepted' order by version_no desc limit 1;
 result:=jsonb_build_object('requestId',rid,'revision',coalesce((select max(revision) from public.lk_quote_company_revisions where request_id=rid),0),'current',(select lk_private.company_revision_json(r) from public.lk_quote_company_revisions r where r.request_id=rid and (not customer or r.status<>'draft') order by r.version_no desc limit 1),'effectiveAccepted',lk_private.company_revision_json(effective),'acknowledgment',lk_private.company_revision_ack());
 if customer then return result;end if;
 initial:=coalesce(effective.payload,jsonb_build_object('contact',coalesce((select d.payload->'contact' from public.lk_staff_quote_drafts d where d.request_id=rid),q.payload->'contact')- 'consent','quantities',lk_private.company_revision_original_quantities(coalesce(s.snapshot,jsonb_build_object('payload',q.payload))),'extraItems','[]'::jsonb,'customerNote',''));
 return result||jsonb_build_object('eligible',eligibility is null,'eligibilityCode',eligibility,'sourceIssues','[]'::jsonb,'initialPayload',initial,'revisions',(select coalesce(jsonb_agg(lk_private.company_revision_json(r) order by r.version_no desc),'[]'::jsonb) from public.lk_quote_company_revisions r where r.request_id=rid),'audit',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'actorUserId',a.actor_id,'actorSessionId',a.actor_session_id,'reason',a.reason,'priorRevision',a.prior_revision,'newRevision',a.new_revision,'details',a.details,'createdAt',a.created_at) order by a.created_at,a.id),'[]'::jsonb) from public.lk_quote_company_revision_audit a where a.request_id=rid),'canWrite',eligibility is null);
end;$$;
create function lk_private.company_revision_mail_valid(mail jsonb,email text) returns boolean language plpgsql immutable set search_path='' as $$
begin
 return coalesce(jsonb_typeof(mail)='object' and length(mail->>'pdfBase64') between 8 and 14000000 and mail->>'pdfHash'=encode(sha256(decode(mail->>'pdfBase64','base64')),'hex') and mail->'payload'->'to'=jsonb_build_array(email) and jsonb_typeof(mail->'payload'->'subject')='string' and length(mail->'payload'->>'subject')>0 and jsonb_typeof(mail->'payload'->'attachments')='array' and jsonb_array_length(mail->'payload'->'attachments')=1 and mail->'payload'->'attachments'->0->>'content'=mail->>'pdfBase64',false);
exception when others then return false;end;$$;
create function lk_private.company_revision_claim_json(o public.lk_quote_company_revision_outbox) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('id',o.id,'requestId',o.request_id,'revisionId',o.revision_id,'kind',o.kind,'leaseToken',o.lease_token,'leaseExpiresAt',o.lease_expires_at,'emailFirstAttemptAt',o.email_first_attempt_at,'emailIdempotencyKey',o.email_idempotency_key,'emailStatus',o.email_status,'frozenMail',jsonb_build_object('pdfBase64',o.pdf_base64,'pdfHash',o.pdf_hash,'payload',o.payload),'revisionSnapshotHash',(select snapshot_hash from public.lk_quote_company_revisions where id=o.revision_id),'acceptanceSignedContentHash',case when o.kind='revision_acceptance_receipt' then (select signed_content_hash from public.lk_quote_company_revision_acceptances where revision_id=o.revision_id) else null end);$$;
create function lk_private.company_revision_worker(command text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.lk_quote_company_revision_outbox;token uuid;rid uuid;nowat timestamptz:=clock_timestamp();
begin
 if command='worker_claim' then
  token:=(args->>'leaseToken')::uuid;if token is null then raise exception using errcode='LK422',message='Worker lease required.';end if;
  select * into o from public.lk_quote_company_revision_outbox x where (args->>'requestId' is null or x.request_id=(args->>'requestId')::uuid) and (x.kind<>'revision_notice' or exists(select 1 from public.lk_quote_company_revisions r where r.id=x.revision_id and r.status='published')) and x.email_status in ('pending','sending','retrying') and x.next_attempt_at<=nowat and (x.lease_expires_at is null or x.lease_expires_at<=nowat) order by x.created_at,x.id for update skip locked limit 1;
  if o.id is null then return null;end if;
  if o.email_first_attempt_at is not null and o.email_first_attempt_at<=nowat-interval '23 hours' then update public.lk_quote_company_revision_outbox set email_status='manual_review',error_code='email_retry_window_expired',lease_token=null,lease_expires_at=null where id=o.id;return null;end if;
  update public.lk_quote_company_revision_outbox set lease_token=token,lease_expires_at=nowat+interval '2 minutes' where id=o.id returning * into o;
  return lk_private.company_revision_claim_json(o);
 end if;
 -- Match staff mutation lock order: request before outbox. This serializes withdrawal with send authorization.
 if command='worker_email_attempt' then
  select request_id into rid from public.lk_quote_company_revision_outbox where id=(args->>'id')::uuid;
  perform 1 from public.lk_quote_requests where id=rid for update;
 end if;
 select * into o from public.lk_quote_company_revision_outbox where id=(args->>'id')::uuid for update;
 if o.id is null or o.lease_token is null or o.lease_expires_at is null or o.lease_token is distinct from (args->>'leaseToken')::uuid or o.lease_expires_at<=nowat or o.email_status in ('provider_accepted','cancelled') then perform lk_private.company_revision_error('worker_lease_changed');end if;
 if command='worker_email_attempt' then
  if o.kind='revision_notice' and not exists(select 1 from public.lk_quote_company_revisions r where r.id=o.revision_id and r.status='published') then perform lk_private.company_revision_error('revision_not_published');end if;
  if o.email_first_attempt_at is not null and o.email_first_attempt_at<=nowat-interval '23 hours' then update public.lk_quote_company_revision_outbox set email_status='manual_review',error_code='email_retry_window_expired',lease_token=null,lease_expires_at=null where id=o.id;return null;end if;
  update public.lk_quote_company_revision_outbox set email_status='sending',email_first_attempt_at=coalesce(email_first_attempt_at,nowat) where id=o.id returning * into o;return lk_private.company_revision_claim_json(o);
 elsif command='worker_email_accepted' then
  if o.email_first_attempt_at is null or length(coalesce(args->>'providerMessageId','')) not between 1 and 500 then raise exception using errcode='LK422',message='Provider acceptance evidence required.';end if;
  update public.lk_quote_company_revision_outbox set email_status='provider_accepted',provider_message_id=args->>'providerMessageId',lease_token=null,lease_expires_at=null,error_code=null where id=o.id;
 elsif command='worker_error' then
  if coalesce(args->>'outcome','') not in ('retrying','manual_review','failed') or length(coalesce(args->>'errorCode','')) not between 1 and 120 then raise exception using errcode='LK422',message='Invalid worker result.';end if;
  update public.lk_quote_company_revision_outbox set email_status=args->>'outcome',error_code=args->>'errorCode',next_attempt_at=nowat+interval '1 minute',lease_token=null,lease_expires_at=null where id=o.id;
 else raise exception using errcode='LK422',message='Unknown revision worker command.';end if;
 select * into o from public.lk_quote_company_revision_outbox where id=o.id;return lk_private.company_revision_claim_json(o);
end;$$;
create function public.lk_quote_company_revision_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;uid uuid;sid uuid;customer boolean:=false;resolved jsonb;q public.lk_quote_requests;s public.lk_live_quote_submissions;r public.lk_quote_company_revisions;effective public.lk_quote_company_revisions;prior public.lk_quote_company_revision_receipts;a public.lk_quote_company_revision_acceptances;
 rev integer;versionno integer;key uuid;fingerprint text;eligibility text;payload jsonb;pricing jsonb;snapshot jsonb;result jsonb;receipt jsonb;oldstate jsonb;mail jsonb;ack jsonb:=lk_private.company_revision_ack();kind text;reason text;allowed text[];
begin
 if command='revision_prepare_publish' then command:='revision_publish';elsif command='customer_prepare_accept' then command:='customer_accept';end if;
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company revision access denied.';end if;
 if command like 'worker_%' then return lk_private.company_revision_worker(command,args);end if;
 if command like 'customer_%' then
  customer:=true;resolved:=public.lk_quote_customer_command('resolve',args->'customerAccess');
  if resolved->>'hash' is distinct from args->>'ownerHash' or args->'customerAccess'->>'companyId' is distinct from 'lk-group' or args->'customerAccess'->>'requestId' is distinct from args->>'expectedRequestId' then raise exception using errcode='LK403',message='Saved quote access changed.';end if;
  rid:=(args->>'expectedRequestId')::uuid;uid:=(args->'customerAccess'->>'authUserId')::uuid;sid:=(args->'customerAccess'->>'sessionId')::uuid;
  if not exists(select 1 from public.lk_quote_customer_sessions c where c.id=sid and public.lk_quote_customer_auth_session_active(c.auth_session_id,uid)) then raise exception using errcode='LK401',message='Verify your customer email again.';end if;
 else
  uid:=(args->>'actorUserId')::uuid;sid:=(args->>'actorSessionId')::uuid;rid:=(args->>'requestId')::uuid;
  if uid is null or sid is null or not lk_private.company_booking_staff_allowed(uid,sid) then raise exception using errcode='LK403',message='Current company staff required.';end if;
 end if;
 select * into q from public.lk_quote_requests where id=rid and company_id='lk-group' for update;
 if not found then raise exception using errcode='LK404',message='Saved quote not found.';end if;
 select * into s from public.lk_live_quote_submissions where request_id=rid and company_id='lk-group';
 select coalesce(max(revision),0) into rev from public.lk_quote_company_revisions where request_id=rid;
 if command in ('revision_detail','revision_history') then return lk_private.company_revision_state(rid);end if;
 if command='customer_state' then return lk_private.company_revision_state(rid,true);end if;
 if command='revision_source' and not customer then return q.payload;end if;
 if command in ('revision_receipt','customer_receipt') then
  select * into prior from public.lk_quote_company_revision_receipts where request_id=rid and idempotency_key=(args->>'idempotencyKey')::uuid;
  if prior.request_id is null or prior.actor_id<>uid or prior.actor_session_id<>sid then raise exception using errcode='LK404',message='Command not found.';end if;return prior.response;
 end if;
 if command in ('customer_document','revision_document') then
  return (select jsonb_build_object('pdfBase64',o.pdf_base64,'pdfHash',o.pdf_hash) from public.lk_quote_company_revision_outbox o where o.revision_id=(args->>'revisionId')::uuid and o.request_id=rid and o.kind=case args->>'kind' when 'acceptance' then 'revision_acceptance_receipt' else 'revision_notice' end);
 end if;
 if command='customer_review' then
  select * into r from public.lk_quote_company_revisions where request_id=rid and id=(args->>'revisionId')::uuid;
  if r.id is null or r.status<>'published' then perform lk_private.company_revision_error('revision_not_published',rev);end if;
  if r.snapshot_hash is distinct from args->>'snapshotHash' then perform lk_private.company_revision_error('revision_snapshot_changed',rev);end if;
  return jsonb_build_object('state',lk_private.company_revision_state(rid,true),'revision',lk_private.company_revision_json(r),'snapshot',r.snapshot,'snapshotHash',r.snapshot_hash);
 end if;
 if command not in ('revision_save','revision_publish','revision_withdraw','customer_accept') then raise exception using errcode='LK422',message='Unknown company revision command.';end if;
 allowed:=case when customer then array['companyId','ownerHash','expectedRequestId','customerAccess','revisionId','expectedRevision','idempotencyKey','acknowledgmentVersion','acknowledged','signature','snapshotHash','proofExpiresAt','frozenMail'] else array['companyId','actorUserId','actorSessionId','requestId','revisionId','expectedRevision','idempotencyKey','reason','payload','snapshotHash','frozenMail'] end;
 if exists(select 1 from jsonb_object_keys(args) k where k<>all(allowed)) then raise exception using errcode='LK422',message='Unexpected company revision fields.';end if;
 if jsonb_typeof(args->'expectedRevision') is distinct from 'number' or coalesce(args->>'expectedRevision','')!~'^[0-9]{1,9}$' or coalesce(args->>'idempotencyKey','')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89aAbB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$' then raise exception using errcode='LK422',message='A current revision and retry key are required.';end if;
 key:=(args->>'idempotencyKey')::uuid;
 fingerprint:=public.lk_live_booking_hash(jsonb_build_object('command',command,'args',args-array['companyId','actorUserId','actorSessionId','ownerHash','customerAccess','frozenMail','proofExpiresAt']-case when customer then array[]::text[] else array['snapshotHash'] end));
 select * into prior from public.lk_quote_company_revision_receipts where request_id=rid and idempotency_key=key;
 if prior.request_id is not null then
  if prior.command<>command or prior.command_hash<>fingerprint or prior.actor_id<>uid or prior.actor_session_id<>sid then perform lk_private.company_revision_error('idempotency_conflict',rev);end if;return prior.response;
 end if;
 eligibility:=lk_private.company_revision_eligibility(rid);if eligibility is not null then perform lk_private.company_revision_error(eligibility,rev);end if;
 if (args->>'expectedRevision')::integer<>rev then perform lk_private.company_revision_error('revision_conflict',rev);end if;
 reason:=case when customer then 'Customer explicitly accepted revised booking-request quote.' else btrim(args->>'reason') end;
 if reason is null or length(reason) not between 1 and 1000 or reason~'[\x00-\x1f\x7f]' then raise exception using errcode='LK422',message='A command reason is required.';end if;
 select * into effective from public.lk_quote_company_revisions where request_id=rid and status='accepted' order by version_no desc limit 1;
 if command='revision_save' then
  select * into r from public.lk_quote_company_revisions where request_id=rid and status in ('draft','published') for update;
  if r.status='published' then perform lk_private.company_revision_error('revision_published',rev);end if;
  payload:=args->'payload';pricing:=lk_private.company_revision_pricing(payload);
  if not lk_private.staff_quote_payload_against_source_valid(jsonb_build_object('contact',payload->'contact','service',null,'internalNotes',''),q.payload) then raise exception using errcode='LK422',message='Correct changed contact fields.';end if;
  oldstate:=lk_private.company_revision_audit_summary(r);
  if r.id is null then
   select coalesce(max(version_no),0)+1 into versionno from public.lk_quote_company_revisions where request_id=rid;
   insert into public.lk_quote_company_revisions(company_id,request_id,version_no,revision,base_submission_id,base_snapshot_hash,base_signed_content_hash,based_on_revision_id,status,payload,pricing,total_cents,comparison,acknowledgment,created_by,updated_by) values('lk-group',rid,versionno,rev+1,s.id,s.snapshot_hash,s.signed_content_hash,effective.id,'draft',payload,pricing,(pricing->>'total')::bigint,lk_private.company_revision_comparison(s,payload,pricing),ack,uid,uid) returning * into r;
  else
   update public.lk_quote_company_revisions x set payload=args->'payload',pricing=lk_private.company_revision_pricing(args->'payload'),total_cents=(lk_private.company_revision_pricing(args->'payload')->>'total')::bigint,comparison=lk_private.company_revision_comparison(s,args->'payload',lk_private.company_revision_pricing(args->'payload')),revision=rev+1,updated_by=uid,updated_at=clock_timestamp() where x.id=r.id returning * into r;
  end if;
 else
  select * into r from public.lk_quote_company_revisions where request_id=rid and id=(args->>'revisionId')::uuid for update;
  if r.id is null then raise exception using errcode='LK404',message='Company revision not found.';end if;
  oldstate:=lk_private.company_revision_audit_summary(r);
  if command='revision_publish' then
   if r.status<>'draft' then perform lk_private.company_revision_error('revision_published',rev);end if;
   if not lk_private.staff_quote_payload_strict_valid(jsonb_build_object('contact',r.payload->'contact','service',null,'internalNotes','')) then raise exception using errcode='LK422',message='Correct all contact fields before publication.';end if;
   snapshot:=lk_private.company_revision_snapshot(r);
   if args->'frozenMail' is not null and args->>'snapshotHash' is distinct from public.lk_live_booking_hash(snapshot) then perform lk_private.company_revision_error('revision_snapshot_changed',rev);end if;
   if args->'frozenMail' is null then return jsonb_build_object('prepared',true,'revision',lk_private.company_revision_json(r),'snapshot',snapshot,'snapshotHash',public.lk_live_booking_hash(snapshot),'recipientEmail',s.verified_email,'reference',s.reference);end if;
   mail:=args->'frozenMail';kind:='revision_notice';
   if not lk_private.company_revision_mail_valid(mail,s.verified_email) then raise exception using errcode='LK422',message='Frozen revision notice is invalid.';end if;
   update public.lk_quote_company_revisions set status='published',snapshot=lk_private.company_revision_snapshot(r),snapshot_hash=public.lk_live_booking_hash(lk_private.company_revision_snapshot(r)),revision=rev+1,published_at=clock_timestamp(),published_by=uid,updated_at=clock_timestamp(),updated_by=uid where id=r.id returning * into r;
  elsif command='revision_withdraw' then
   if r.status<>'published' then perform lk_private.company_revision_error('revision_not_published',rev);end if;
   update public.lk_quote_company_revisions set status='withdrawn',revision=rev+1,withdrawn_at=clock_timestamp(),withdrawn_by=uid,updated_at=clock_timestamp(),updated_by=uid where id=r.id returning * into r;
   update public.lk_quote_company_revision_outbox set email_status='cancelled',error_code='revision_withdrawn',lease_token=null,lease_expires_at=null where lk_quote_company_revision_outbox.revision_id=r.id and lk_quote_company_revision_outbox.kind='revision_notice' and email_first_attempt_at is null and email_status<>'provider_accepted';
  else
   if r.status<>'published' then perform lk_private.company_revision_error('revision_not_published',rev);end if;
   if args->>'snapshotHash' is distinct from r.snapshot_hash then perform lk_private.company_revision_error('revision_snapshot_changed',rev);end if;
   if args->>'proofExpiresAt' is null or (args->>'proofExpiresAt')::timestamptz<=clock_timestamp() or (args->>'proofExpiresAt')::timestamptz>clock_timestamp()+interval '15 minutes 5 seconds' then perform lk_private.company_revision_error('review_proof_expired',rev);end if;
   if args->>'acknowledgmentVersion' is distinct from ack->>'version' or args->'acknowledged' is distinct from 'true'::jsonb or not public.lk_live_booking_signature_valid(args->'signature') then raise exception using errcode='LK422',message='A new signature and explicit revision acknowledgment are required.';end if;
   if args->'frozenMail' is null then return jsonb_build_object('prepared',true,'revision',lk_private.company_revision_json(r),'snapshot',r.snapshot,'snapshotHash',r.snapshot_hash,'recipientEmail',s.verified_email,'reference',s.reference,'signedContentHash',public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',args->'signature','ack',ack)));end if;
   mail:=args->'frozenMail';kind:='revision_acceptance_receipt';
   if not lk_private.company_revision_mail_valid(mail,s.verified_email) then raise exception using errcode='LK422',message='Frozen revision acceptance receipt is invalid.';end if;
   insert into public.lk_quote_company_revision_acceptances(company_id,request_id,revision_id,auth_user_id,verified_email,snapshot_hash,signature,acknowledgment,signed_content_hash) values('lk-group',rid,r.id,uid,args->'customerAccess'->>'email',r.snapshot_hash,args->'signature',ack,public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',args->'signature','ack',ack))) returning * into a;
   update public.lk_quote_company_revisions set status='superseded' where request_id=rid and status='accepted';
   update public.lk_quote_company_revisions set status='accepted',revision=rev+1,accepted_at=a.accepted_at,updated_at=clock_timestamp(),updated_by=uid where id=r.id returning * into r;
  end if;
 end if;
 if kind is not null then insert into public.lk_quote_company_revision_outbox(request_id,revision_id,kind,email_idempotency_key,pdf_base64,pdf_hash,payload) values(rid,r.id,kind,'company-revision:'||r.id::text||':'||kind||':v1',mail->>'pdfBase64',mail->>'pdfHash',mail->'payload');end if;
 receipt:=jsonb_build_object('idempotencyKey',key,'entityType','company_revision','entityId',rid,'childId',r.id,'action',command,'revision',rev+1,'committedAt',clock_timestamp());
 insert into public.lk_quote_company_revision_audit(request_id,revision_id,action,actor_id,actor_session_id,reason,prior_revision,new_revision,details) values(rid,r.id,command,uid,sid,reason,rev,rev+1,jsonb_build_object('prior',oldstate,'new',lk_private.company_revision_audit_summary(r)));
 result:=jsonb_build_object(case when customer then 'state' else 'detail' end,lk_private.company_revision_state(rid,customer),'receipt',receipt);
 insert into public.lk_quote_company_revision_receipts(request_id,idempotency_key,command,command_hash,actor_id,actor_session_id,response) values(rid,key,command,fingerprint,uid,sid,result);return result;
end;$$;
-- Keep the established calendar/occupancy transaction; replace only its immutable price evidence.
alter function public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb) rename to company_revision_original_simple_snapshot;
alter function public.company_revision_original_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb) set schema lk_private;
create function public.lk_live_company_simple_snapshot(s public.lk_live_quote_submissions,args jsonb,target jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;r public.lk_quote_company_revisions;a public.lk_quote_company_revision_acceptances;
begin
 result:=lk_private.company_revision_original_simple_snapshot(s,args,target);
 select * into r from public.lk_quote_company_revisions where request_id=s.request_id and status='accepted' order by version_no desc limit 1;
 if r.id is null then return result;end if;
 select * into a from public.lk_quote_company_revision_acceptances where revision_id=r.id;
 if a.id is null or a.snapshot_hash<>r.snapshot_hash or a.signed_content_hash<>public.lk_live_booking_hash(jsonb_build_object('revisionSnapshot',r.snapshot,'signature',a.signature,'ack',a.acknowledgment)) then perform lk_private.company_revision_error('revision_acceptance_invalid');end if;
 return result||jsonb_build_object('confirmationBasis','accepted_revision','companyRevisionId',r.id,'companyRevisionSnapshotHash',r.snapshot_hash,'companyRevisionAcceptanceId',a.id,'companyRevisionSignedContentHash',a.signed_content_hash,'companyRevisionSignature',a.signature,'companyRevisionAcknowledgment',a.acknowledgment,'contact',r.payload->'contact','quantities',r.payload->'quantities','extraItems',r.payload->'extraItems','customerNote',r.payload->'customerNote','pricing',r.pricing,'amountExGst',r.total_cents,'gst',0,'total',r.total_cents,'priceKind','accepted_company_revision','scope',(r.payload->'quantities'->>'doorCount')||' cabinet doors, '||(r.payload->'quantities'->>'drawerCount')||' drawer fronts'||case when lk_private.staff_quote_trim(coalesce(r.payload->>'customerNote',''))<>'' then E'\n'||lk_private.staff_quote_trim(r.payload->>'customerNote') else '' end,'adjustmentReason','Explicitly accepted company revision; original signed booking request retained.');
end;$$;
alter table public.lk_live_company_bookings drop constraint lk_live_company_bookings_confirmation_basis_check,drop constraint lk_live_company_confirmation_evidence;
alter table public.lk_live_company_bookings add column company_revision_id uuid references public.lk_quote_company_revisions(id),add column company_revision_acceptance_id uuid references public.lk_quote_company_revision_acceptances(id),add column company_revision_snapshot_hash text,add column company_revision_signed_content_hash text;
alter table public.lk_live_company_bookings add constraint lk_live_company_bookings_confirmation_basis_check check(confirmation_basis in ('customer_proposal','signed_request','accepted_revision')),
 add constraint lk_live_company_confirmation_evidence check((confirmation_basis='customer_proposal' and acceptance_id is not null and signed_submission_id is null and company_revision_id is null and company_revision_acceptance_id is null and company_revision_snapshot_hash is null and company_revision_signed_content_hash is null) or (confirmation_basis='signed_request' and acceptance_id is null and signed_submission_id is not null and company_revision_id is null and company_revision_acceptance_id is null and company_revision_snapshot_hash is null and company_revision_signed_content_hash is null) or (confirmation_basis='accepted_revision' and acceptance_id is null and signed_submission_id is not null and company_revision_id is not null and company_revision_acceptance_id is not null and company_revision_snapshot_hash~'^[a-f0-9]{64}$' and company_revision_signed_content_hash~'^[a-f0-9]{64}$'));
create function lk_private.company_revision_booking_evidence() returns trigger language plpgsql set search_path='' as $$
declare p public.lk_live_company_proposals;r public.lk_quote_company_revisions;a public.lk_quote_company_revision_acceptances;
begin
 if tg_op='UPDATE' then
  if (new.company_revision_id,new.company_revision_acceptance_id,new.company_revision_snapshot_hash,new.company_revision_signed_content_hash,new.confirmation_basis,new.signed_submission_id) is distinct from (old.company_revision_id,old.company_revision_acceptance_id,old.company_revision_snapshot_hash,old.company_revision_signed_content_hash,old.confirmation_basis,old.signed_submission_id) then raise exception using errcode='LK409',message='Booking confirmation evidence is immutable.';end if;return new;
 end if;
 select * into p from public.lk_live_company_proposals where id=new.proposal_id;
 if p.snapshot->>'confirmationBasis'='accepted_revision' then
  select * into r from public.lk_quote_company_revisions where id=(p.snapshot->>'companyRevisionId')::uuid and request_id=new.request_id and status='accepted';
  select * into a from public.lk_quote_company_revision_acceptances where revision_id=r.id;
  if r.id is null or a.id is null or p.snapshot->>'companyRevisionAcceptanceId' is distinct from a.id::text or p.snapshot->>'companyRevisionSnapshotHash' is distinct from r.snapshot_hash or p.snapshot->>'companyRevisionSignedContentHash' is distinct from a.signed_content_hash or (p.snapshot->>'total')::bigint<>r.total_cents or p.snapshot->'pricing' is distinct from r.pricing then perform lk_private.company_revision_error('revision_acceptance_invalid');end if;
  new.confirmation_basis:='accepted_revision';new.company_revision_id:=r.id;new.company_revision_acceptance_id:=a.id;new.company_revision_snapshot_hash:=r.snapshot_hash;new.company_revision_signed_content_hash:=a.signed_content_hash;
 elsif new.confirmation_basis='accepted_revision' then perform lk_private.company_revision_error('revision_acceptance_invalid');
 end if;return new;
end;$$;
create trigger company_revision_booking_evidence before insert or update on public.lk_live_company_bookings for each row execute function lk_private.company_revision_booking_evidence();
alter function public.lk_live_company_booking_json(public.lk_live_company_bookings) rename to company_revision_original_booking_json;
alter function public.company_revision_original_booking_json(public.lk_live_company_bookings) set schema lk_private;
create function public.lk_live_company_booking_json(b public.lk_live_company_bookings) returns jsonb language sql stable set search_path='' as $$select lk_private.company_revision_original_booking_json(b)||jsonb_build_object('companyRevisionId',b.company_revision_id,'companyRevisionAcceptanceId',b.company_revision_acceptance_id,'companyRevisionSnapshotHash',b.company_revision_snapshot_hash,'companyRevisionSignedContentHash',b.company_revision_signed_content_hash);$$;
alter function public.lk_live_company_booking_command(text,jsonb) rename to company_revision_original_booking_command;
alter function public.company_revision_original_booking_command(text,jsonb) set schema lk_private;
create function public.lk_live_company_booking_command(command text,args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if pg_catalog.current_setting('role',true) is distinct from 'service_role' or args->>'companyId' is distinct from 'lk-group' then raise exception using errcode='LK403',message='Company booking access denied.';end if;
 if command in ('staff_prepare_request','staff_confirm_request') then
  if not lk_private.company_booking_staff_allowed((args->>'actorUserId')::uuid,(args->>'actorSessionId')::uuid) then raise exception using errcode='LK403',message='Current company staff required.';end if;
  rid:=(args->>'requestId')::uuid;perform 1 from public.lk_quote_requests where id=rid and company_id='lk-group' for update;
  -- A committed confirmation replay is already fixed and may bypass only this new-publication gate.
  if not exists(select 1 from public.lk_live_company_command_receipts where request_id=rid and idempotency_key=(args->>'idempotencyKey')::uuid) and exists(select 1 from public.lk_quote_company_revisions where request_id=rid and status='published') then perform lk_private.company_revision_error('revision_awaiting_customer');end if;
 end if;
 return lk_private.company_revision_original_booking_command(command,args);
end;$$;
-- Capture the actual INSERT RETURNING booking evidence; immutable audit rows are never repaired later.
do $$declare definition text;needle text:='jsonb_build_object(''proposalId'',p.id,''proposalHash'',p.snapshot_hash,''signedSubmissionId'',s.id,''signedContentHash'',s.signed_content_hash,''confirmationBasis'',''signed_request'')';replacement text:='jsonb_build_object(''proposalId'',p.id,''proposalHash'',p.snapshot_hash,''signedSubmissionId'',s.id,''signedContentHash'',coalesce(b.company_revision_signed_content_hash,s.signed_content_hash),''originalSignedContentHash'',s.signed_content_hash,''originalSnapshotHash'',s.snapshot_hash,''confirmationBasis'',b.confirmation_basis,''companyRevisionId'',b.company_revision_id,''companyRevisionSnapshotHash'',b.company_revision_snapshot_hash,''companyRevisionAcceptanceId'',b.company_revision_acceptance_id,''companyRevisionSignedContentHash'',b.company_revision_signed_content_hash)';begin
 select pg_get_functiondef('lk_private.lk_live_company_booking_command_r3a_base(text,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'R3b expected exactly one signed-request confirmation audit insertion';end if;
 execute replace(definition,needle,replacement);
end;$$;
-- R3a cancellation keeps its complete target/manifest/lease predicates. Only the new evidence basis joins the same allowed workflow.
do $$declare definition text;needle text:='b.confirmation_basis<>''signed_request''';begin
 select pg_get_functiondef('public.lk_current_work_command(text,jsonb)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'R3b expected exactly one cancellation basis predicate';end if;
 execute replace(definition,needle,'b.confirmation_basis not in (''signed_request'',''accepted_revision'')');
end;$$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='lk_private' and (p.proname like 'company_revision_%') loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
end;$$;
revoke all on function public.lk_quote_company_revision_command(text,jsonb),public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb),public.lk_live_company_booking_json(public.lk_live_company_bookings),public.lk_live_company_booking_command(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lk_quote_company_revision_command(text,jsonb),public.lk_live_company_simple_snapshot(public.lk_live_quote_submissions,jsonb,jsonb),public.lk_live_company_booking_json(public.lk_live_company_bookings),public.lk_live_company_booking_command(text,jsonb) to service_role;
commit;
