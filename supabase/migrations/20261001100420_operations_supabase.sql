-- L&K private operations. Only the trusted application server may use this API.
begin;
create table public.lk_enquiries (
  id uuid primary key, reference text not null unique, source text not null check(source in ('web','gmail')),
  idempotency_key text unique, payload_hash text, payload_json jsonb not null,
  status text not null check(status in ('submitted','provisional')), revision integer not null check(revision>0),
  created_at timestamptz not null default now(), start_at timestamptz, end_at timestamptz, schedule_notes text,
  calendar_status text not null check(calendar_status in ('pending','synced','conflict','retrying')), calendar_error text,
  sender_review_required integer not null default 0, attachment_count integer not null default 0,
  event_generation integer not null default 0,
  check ((start_at is null and end_at is null) or (start_at is not null and end_at is not null and end_at>start_at))
);
create table public.lk_sessions(token_hash text primary key,mode text not null,account_sub text,expires_at bigint not null);
create table public.lk_oauth_states(state_hash text primary key,nonce_hash text not null,verifier text not null,session_hash text,expires_at bigint not null);
create table public.lk_google_connection(
  id integer primary key check(id=1),account_sub text not null,email text not null,
  access_cipher text not null,refresh_cipher text,expires_at bigint not null,
  selected_calendar_id text,calendar_sync_token text,calendar_last_synced_at timestamptz,calendar_error text,
  selected_gmail_label_id text,gmail_last_synced_at timestamptz,gmail_error text,gmail_page_token text
);
create table public.lk_calendar_links(
  enquiry_id uuid primary key references public.lk_enquiries(id),event_id text not null unique,etag text,
  synced_revision integer not null default 0,last_start_at timestamptz,last_end_at timestamptz,last_preferred_date text
);
create table public.lk_outbox(enquiry_id uuid primary key references public.lk_enquiries(id),revision integer not null,updated_at timestamptz not null);
create table public.lk_change_requests(
  id uuid primary key,enquiry_id uuid not null references public.lk_enquiries(id),kind text not null check(kind in ('move','delete','invalid')),
  proposed_start_at timestamptz,proposed_end_at timestamptz,proposed_preferred_date text,provider_etag text not null,
  enquiry_revision integer not null,status text not null,revision integer not null,created_at timestamptz not null,
  unique(enquiry_id,provider_etag,enquiry_revision)
);
create table public.lk_gmail_seen(account_sub text not null,message_id text not null,enquiry_id uuid not null references public.lk_enquiries(id),primary key(account_sub,message_id));
create table public.lk_gmail_threads(account_sub text not null,thread_id text not null,enquiry_id uuid not null references public.lk_enquiries(id),primary key(account_sub,thread_id));
create table public.lk_gmail_quarantine(account_sub text not null,message_id text not null,reason text not null,first_seen_at timestamptz not null,last_seen_at timestamptz not null,primary key(account_sub,message_id));
create table public.lk_sync_lease(id integer primary key check(id=1),holder text not null,expires_at bigint not null);
create table public.lk_rate_buckets(bucket text primary key,count integer not null,reset_at bigint not null);
create index lk_enquiries_created on public.lk_enquiries(created_at desc);
create index lk_changes_pending on public.lk_change_requests(created_at desc) where status='pending';
create index lk_changes_enquiry on public.lk_change_requests(enquiry_id);
create index lk_gmail_seen_enquiry on public.lk_gmail_seen(enquiry_id);
create index lk_gmail_threads_enquiry on public.lk_gmail_threads(enquiry_id);
create index lk_outbox_updated on public.lk_outbox(updated_at);

-- No anonymous/customer policy: private mail and provider tokens never go to browsers.
do $$ declare t text; begin
  foreach t in array array['lk_enquiries','lk_sessions','lk_oauth_states','lk_google_connection','lk_calendar_links','lk_outbox','lk_change_requests','lk_gmail_seen','lk_gmail_threads','lk_gmail_quarantine','lk_sync_lease','lk_rate_buckets'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end $$;

create function public.lk_operations_command(command text,args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  e public.lk_enquiries; c public.lk_change_requests; conn public.lk_google_connection;
  l public.lk_calendar_links; r jsonb; ms bigint;
  n integer; old_reset bigint; eid uuid; msg jsonb; messages jsonb; total integer; next_revision integer;
begin
  -- Small DB transactions only; Google network requests happen outside this lock.
  perform pg_advisory_xact_lock(76001001);
  ms := floor(extract(epoch from clock_timestamp())*1000);
  if command in ('gmail_import','gmail_quarantine','gmail_cursor') and not exists(select 1 from public.lk_sync_lease where holder=args->>'holder' and expires_at>ms) then raise exception using errcode='LK409',message='Sync lease expired'; end if;
  if command='health' then return jsonb_build_object('ready',true,'schemaVersion',1);
  elsif command='session_get' then
    select to_jsonb(s) into r from public.lk_sessions s where token_hash=args->>'token_hash' and expires_at>ms; return r;
  elsif command='session_put' then
    delete from public.lk_sessions where expires_at<=ms;
    insert into public.lk_sessions values(args->>'token_hash',args->>'mode',args->>'account_sub',(args->>'expires_at')::bigint); return 'true';
  elsif command='session_delete' then delete from public.lk_sessions where token_hash=args->>'token_hash'; return 'true';
  elsif command='oauth_put' then
    delete from public.lk_oauth_states where expires_at<=ms;
    insert into public.lk_oauth_states values(args->>'state_hash',args->>'nonce_hash',args->>'verifier',args->>'session_hash',(args->>'expires_at')::bigint); return 'true';
  elsif command='oauth_take' then
    delete from public.lk_oauth_states where state_hash=args->>'state_hash' returning to_jsonb(lk_oauth_states) into r; return r;
  elsif command='connection_get' then select to_jsonb(g) into r from public.lk_google_connection g where id=1; return r;
  elsif command='connection_save' then
    if exists(select 1 from public.lk_sync_lease where expires_at>ms) then raise exception using errcode='LK409',message='Sync in progress; reconnect after it finishes'; end if;
    insert into public.lk_google_connection(id,account_sub,email,access_cipher,refresh_cipher,expires_at)
    values(1,args->>'account_sub',args->>'email',args->>'access_cipher',args->>'refresh_cipher',(args->>'expires_at')::bigint)
    on conflict(id) do update set account_sub=excluded.account_sub,email=excluded.email,access_cipher=excluded.access_cipher,refresh_cipher=excluded.refresh_cipher,expires_at=excluded.expires_at,
    selected_calendar_id=case when lk_google_connection.account_sub=excluded.account_sub then lk_google_connection.selected_calendar_id end,
    selected_gmail_label_id=case when lk_google_connection.account_sub=excluded.account_sub then lk_google_connection.selected_gmail_label_id end,calendar_sync_token=null;
    return 'true';
  elsif command='connection_refresh' then
    update public.lk_google_connection set access_cipher=args->>'access_cipher',refresh_cipher=args->>'refresh_cipher',expires_at=(args->>'expires_at')::bigint
    where id=1 and account_sub=args->>'account_sub' and access_cipher=args->>'expected_access_cipher' and refresh_cipher is not distinct from args->>'expected_refresh_cipher';
    get diagnostics n=row_count; return to_jsonb(n=1);
  elsif command='connection_select' then
    if exists(select 1 from public.lk_sync_lease where expires_at>ms) then raise exception using errcode='LK409',message='Sync in progress; retry selection'; end if;
    select * into conn from public.lk_google_connection where id=1;
    if not found then raise exception using errcode='LK409',message='Google account is not connected'; end if;
    if args->>'kind'='calendar' then
      if conn.selected_calendar_id is not null and conn.selected_calendar_id<>args->>'id' and exists(select 1 from public.lk_calendar_links) then raise exception using errcode='LK409',message='Calendar has linked events; migration needs review'; end if;
      update public.lk_google_connection set selected_calendar_id=args->>'id',calendar_sync_token=null,calendar_last_synced_at=null,calendar_error=null where id=1;
    else update public.lk_google_connection set selected_gmail_label_id=args->>'id',gmail_page_token=null,gmail_last_synced_at=null,gmail_error=null where id=1; end if;
    return 'true';
  elsif command='rate_limit' then
    select count,reset_at into n,old_reset from public.lk_rate_buckets where bucket=args->>'bucket';
    n:=case when old_reset>ms then n+1 else 1 end;
    if n>(args->>'max')::integer then raise exception using errcode='LK429',message='Please try again later'; end if;
    insert into public.lk_rate_buckets values(args->>'bucket',n,case when old_reset>ms then old_reset else ms+(args->>'window')::bigint end)
    on conflict(bucket) do update set count=excluded.count,reset_at=excluded.reset_at; return 'true';
  elsif command='enquiry_find_key' then select to_jsonb(q) into r from public.lk_enquiries q where idempotency_key=args->>'key'; return r;
  elsif command='enquiry_get' then select to_jsonb(q) into r from public.lk_enquiries q where id=(args->>'id')::uuid; return r;
  elsif command='enquiry_create' then
    select * into e from public.lk_enquiries where idempotency_key=args->>'key';
    if found then
      if e.payload_hash<>args->>'hash' then raise exception using errcode='LK409',message='Idempotency key was used for another enquiry'; end if;
      return to_jsonb(e);
    end if;
    eid:=(args->>'id')::uuid;
    insert into public.lk_enquiries(id,reference,source,idempotency_key,payload_hash,payload_json,status,revision,calendar_status)
    values(eid,args->>'reference','web',args->>'key',args->>'hash',args->'payload','submitted',1,'pending') returning * into e;
    insert into public.lk_outbox values(eid,1,now()); return to_jsonb(e);
  elsif command='dashboard' then
    return jsonb_build_object('enquiries',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select * from public.lk_enquiries order by created_at desc limit 500) q),
    'changes',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select cr.*,en.reference from public.lk_change_requests cr join public.lk_enquiries en on en.id=cr.enquiry_id where cr.status='pending' order by cr.created_at desc limit 500) q),
    'quarantine',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select message_id,reason,last_seen_at from public.lk_gmail_quarantine order by last_seen_at desc limit 100) q));
  elsif command='schedule' then
    select * into e from public.lk_enquiries where id=(args->>'id')::uuid;
    if not found then raise exception using errcode='LK404',message='Enquiry not found'; end if;
    if e.revision<>(args->>'revision')::integer then raise exception using errcode='LK409',message='Enquiry changed; reload before saving'; end if;
    update public.lk_enquiries set start_at=(args->>'start')::timestamptz,end_at=(args->>'end')::timestamptz,schedule_notes=args->>'notes',status='provisional',revision=revision+1,calendar_status='pending',calendar_error=null where id=e.id returning * into e;
    insert into public.lk_outbox values(e.id,e.revision,now()) on conflict(enquiry_id) do update set revision=excluded.revision,updated_at=excluded.updated_at;
    update public.lk_change_requests set status='rejected',revision=revision+1 where enquiry_id=e.id and status='pending'; return to_jsonb(e);
  elsif command='gmail_seen' then return to_jsonb(exists(select 1 from public.lk_gmail_seen where account_sub=args->>'account' and message_id=args->>'message'));
  elsif command='gmail_import' then
    select enquiry_id into eid from public.lk_gmail_seen where account_sub=args->>'account' and message_id=args->>'message';
    if found then select * into e from public.lk_enquiries where id=eid; return to_jsonb(e); end if;
    select enquiry_id into eid from public.lk_gmail_threads where account_sub=args->>'account' and thread_id=args->>'thread';
    msg:=args->'entry';
    if found then
      select * into e from public.lk_enquiries where id=eid;
      select count(*) into total from jsonb_array_elements(coalesce(e.payload_json->'gmail'->'messages','[]')||jsonb_build_array(msg));
      select jsonb_agg(v order by coalesce(v->>'receivedAt',''),v->>'messageId') into messages from
        (select v from jsonb_array_elements(coalesce(e.payload_json->'gmail'->'messages','[]')||jsonb_build_array(msg)) v order by coalesce(v->>'receivedAt','') desc,v->>'messageId' desc limit 30) q;
      update public.lk_enquiries set payload_json=jsonb_set(payload_json,'{gmail}',jsonb_build_object('threadId',args->>'thread','messages',messages,'historyTruncated',coalesce((e.payload_json->'gmail'->>'historyTruncated')::boolean,false) or total>30)),revision=revision+1,attachment_count=attachment_count+(args->>'attachments')::integer where id=eid;
      update public.lk_outbox set revision=revision+1 where enquiry_id=eid;
      update public.lk_change_requests set enquiry_revision=enquiry_revision+1,revision=revision+1 where enquiry_id=eid and status='pending';
    else
      eid:=(args->>'id')::uuid;
      insert into public.lk_enquiries(id,reference,source,payload_json,status,revision,created_at,calendar_status,sender_review_required,attachment_count)
      values(eid,args->>'reference','gmail',args->'payload','submitted',1,coalesce((args->>'received')::timestamptz,now()),'pending',1,(args->>'attachments')::integer);
      insert into public.lk_gmail_threads values(args->>'account',args->>'thread',eid);
    end if;
    insert into public.lk_gmail_seen values(args->>'account',args->>'message',eid);
    delete from public.lk_gmail_quarantine where account_sub=args->>'account' and message_id=args->>'message';
    select * into e from public.lk_enquiries where id=eid; return to_jsonb(e);
  elsif command='gmail_quarantine' then
    insert into public.lk_gmail_quarantine values(args->>'account',args->>'message',args->>'reason',now(),now()) on conflict(account_sub,message_id) do update set reason=excluded.reason,last_seen_at=excluded.last_seen_at; return 'true';
  elsif command='gmail_cursor' then
    update public.lk_google_connection set gmail_page_token=args->>'token',gmail_last_synced_at=case when args->>'token' is null then now() end,gmail_error=null where id=1 and account_sub=args->>'account' and selected_gmail_label_id=args->>'label'; return 'true';
  elsif command='sync_acquire' then
    if exists(select 1 from public.lk_sync_lease where id=1 and expires_at>ms and holder<>args->>'holder') then return 'false'; end if;
    insert into public.lk_sync_lease values(1,args->>'holder',ms+600000) on conflict(id) do update set holder=excluded.holder,expires_at=excluded.expires_at; return 'true';
  elsif command='sync_renew' then
    update public.lk_sync_lease set expires_at=ms+600000 where id=1 and holder=args->>'holder' and expires_at>ms; get diagnostics n=row_count; return to_jsonb(n=1);
  elsif command='sync_release' then delete from public.lk_sync_lease where holder=args->>'holder'; return 'true';
  elsif command='sync_error' then
    if not exists(select 1 from public.lk_sync_lease where holder=args->>'holder' and expires_at>ms) then raise exception using errcode='LK409',message='Sync lease expired'; end if;
    if args->>'kind'='gmail' then update public.lk_google_connection set gmail_error='Gmail sync failed; retry available' where id=1;
    else update public.lk_google_connection set calendar_error='Calendar sync failed; retry available' where id=1; end if; return 'true';
  elsif command='calendar_pending' then
    return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from (select en.* from public.lk_outbox o join public.lk_enquiries en on en.id=o.enquiry_id where en.calendar_status<>'conflict' and en.revision=o.revision and (en.start_at is not null or en.payload_json->>'preferredDate' is not null) order by o.updated_at limit 200) q);
  elsif command='calendar_links' then return (select coalesce(jsonb_agg(to_jsonb(q)),'[]') from public.lk_calendar_links q);
  elsif command='calendar_link' then select to_jsonb(q) into r from public.lk_calendar_links q where enquiry_id=(args->>'id')::uuid; return r;
  elsif command='change_get' then select to_jsonb(q) into r from public.lk_change_requests q where id=(args->>'id')::uuid; return r;
  end if;

  -- Network completion writes are fenced by the distributed sync lease.
  if command in ('calendar_success','calendar_failure','calendar_conflict','calendar_etag','calendar_cursor') then
    if not exists(select 1 from public.lk_sync_lease where holder=args->>'holder' and expires_at>ms) then raise exception using errcode='LK409',message='Sync lease expired'; end if;
  end if;
  if command='calendar_success' then
    select * into e from public.lk_enquiries where id=(args->>'id')::uuid;
    select * into l from public.lk_calendar_links where enquiry_id=e.id;
    if e.id is null or e.event_generation is distinct from (args->>'generation')::integer or l.event_id is distinct from args->>'expected_event' then return 'false'; end if;
    insert into public.lk_calendar_links values(e.id,args->>'event',args->>'etag',(args->>'revision')::integer,(args->>'start')::timestamptz,(args->>'end')::timestamptz,args->>'preferred')
    on conflict(enquiry_id) do update set event_id=excluded.event_id,etag=excluded.etag,synced_revision=excluded.synced_revision,last_start_at=excluded.last_start_at,last_end_at=excluded.last_end_at,last_preferred_date=excluded.last_preferred_date;
    delete from public.lk_outbox where enquiry_id=e.id and revision=(args->>'revision')::integer;
    update public.lk_enquiries set calendar_status='synced',calendar_error=null where id=e.id and revision=(args->>'revision')::integer; return 'true';
  elsif command='calendar_failure' then
    update public.lk_enquiries set calendar_status='retrying',calendar_error='Calendar sync failed; retry available' where id=(args->>'id')::uuid and revision=(args->>'revision')::integer; return 'true';
  elsif command='calendar_conflict' then
    select * into e from public.lk_enquiries where id=(args->>'id')::uuid;
    select * into l from public.lk_calendar_links where enquiry_id=e.id;
    if e.id is null or e.revision is distinct from (args->>'revision')::integer or l.event_id is distinct from args->>'expected_event' then return 'false'; end if;
    if args->>'event' is not null then insert into public.lk_calendar_links(enquiry_id,event_id,etag,synced_revision) values(e.id,args->>'event',args->>'etag',0) on conflict(enquiry_id) do nothing; end if;
    update public.lk_change_requests set status='superseded',revision=revision+1 where enquiry_id=e.id and status='pending' and (provider_etag<>args->>'etag' or enquiry_revision<>e.revision);
    insert into public.lk_change_requests values((args->>'change')::uuid,e.id,args->>'kind',(args->>'start')::timestamptz,(args->>'end')::timestamptz,args->>'preferred',args->>'etag',e.revision,'pending',1,now()) on conflict(enquiry_id,provider_etag,enquiry_revision) do nothing;
    update public.lk_enquiries set calendar_status='conflict',calendar_error='Google Calendar change needs review' where id=e.id; return 'true';
  elsif command='calendar_etag' then
    update public.lk_calendar_links set etag=args->>'etag' where enquiry_id=(args->>'id')::uuid and event_id=args->>'event'; return 'true';
  elsif command='calendar_cursor' then
    update public.lk_google_connection set calendar_sync_token=args->>'token',calendar_last_synced_at=case when args->>'token' is not null then now() else calendar_last_synced_at end,calendar_error=null where id=1 and selected_calendar_id=args->>'calendar'; return 'true';
  elsif command='change_decide' then
    select * into c from public.lk_change_requests where id=(args->>'id')::uuid;
    if not found or c.status<>'pending' then raise exception using errcode='LK404',message='Change request not found'; end if;
    select * into e from public.lk_enquiries where id=c.enquiry_id;
    select * into l from public.lk_calendar_links where enquiry_id=e.id;
    select * into conn from public.lk_google_connection where id=1;
    if c.revision<>(args->>'revision')::integer or c.enquiry_revision<>e.revision or l.event_id is distinct from args->>'event' or conn.selected_calendar_id is distinct from args->>'calendar' or c.provider_etag is distinct from args->>'etag' then raise exception using errcode='LK409',message='Enquiry or calendar changed; reload'; end if;
    if args->>'action'='approve' then
      if c.kind='invalid' then raise exception using errcode='LK400',message='Invalid Google change cannot be approved'; end if;
      if c.kind='move' then
        if c.proposed_preferred_date is not null then update public.lk_enquiries set payload_json=jsonb_set(payload_json,'{preferredDate}',to_jsonb(c.proposed_preferred_date)),start_at=null,end_at=null,status='submitted',revision=revision+1,calendar_status='pending',calendar_error=null where id=e.id;
        else update public.lk_enquiries set start_at=c.proposed_start_at,end_at=c.proposed_end_at,status='provisional',revision=revision+1,calendar_status='pending',calendar_error=null where id=e.id; end if;
      else
        update public.lk_enquiries set payload_json=jsonb_set(payload_json,'{preferredDate}','null'),start_at=null,end_at=null,status='submitted',revision=revision+1,event_generation=event_generation+1,calendar_status='synced',calendar_error=null where id=e.id;
        delete from public.lk_calendar_links where enquiry_id=e.id; delete from public.lk_outbox where enquiry_id=e.id;
      end if;
    else update public.lk_enquiries set calendar_status='pending',calendar_error=null where id=e.id; end if;
    if not(args->>'action'='approve' and c.kind='delete') then
      if args->>'action'='reject' and c.kind='delete' then update public.lk_calendar_links set event_id=args->>'restored_event',etag=null where enquiry_id=e.id;
      else update public.lk_calendar_links set etag=args->>'etag' where enquiry_id=e.id; end if;
      select revision into next_revision from public.lk_enquiries where id=e.id;
      insert into public.lk_outbox values(e.id,next_revision,now()) on conflict(enquiry_id) do update set revision=excluded.revision,updated_at=excluded.updated_at;
    end if;
    update public.lk_change_requests set status=case when args->>'action'='approve' then 'approved' else 'rejected' end,revision=revision+1 where id=c.id;
    update public.lk_change_requests set status='superseded',revision=revision+1 where enquiry_id=e.id and id<>c.id and status='pending';
    select * into e from public.lk_enquiries where id=e.id; return to_jsonb(e);
  end if;
  raise exception using errcode='LK400',message='Unknown operations command';
end $$;
revoke all on function public.lk_operations_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.lk_operations_command(text,jsonb) to service_role;
commit;
