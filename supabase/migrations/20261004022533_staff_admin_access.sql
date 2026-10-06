-- Check revocation against the upstream Auth session on every staff request.
-- No Auth tables or customer records are exposed to browser roles by this API.
begin;

create schema lk_private;
revoke all on schema lk_private from public, anon, authenticated;
grant usage on schema lk_private to service_role;

-- Auth's schema remains provider-owned. A narrow private helper avoids granting
-- service_role broad SELECT access to auth.sessions or exposing a definer RPC.
-- This is a server-only check: there is no caller auth.uid() for a service key.
-- The application supplies IDs only after verifying the user JWT and fetching
-- the current user; live membership/MFA authorization is a separate check.
create function lk_private.staff_session_active(input_session_id uuid, input_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- current_user is the function owner here; the active role setting retains
  -- the PostgREST caller role. Fail closed even after an accidental extra grant.
  if pg_catalog.current_setting('role', true) is distinct from 'service_role'
      or input_session_id is null or input_user_id is null then
    return false;
  end if;

  return exists (
    select 1 from auth.sessions s
    where s.id = input_session_id
      and s.user_id = input_user_id
      and (s.not_after is null or s.not_after > pg_catalog.statement_timestamp())
  );
end;
$$;

revoke all on function lk_private.staff_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function lk_private.staff_session_active(uuid, uuid) to service_role;

-- The exposed entry point preserves the caller's privileges. PL/pgSQL also
-- lets isolated business-schema tests install migrations without Auth tables.
create function public.lk_staff_session_active(input_session_id uuid, input_user_id uuid)
returns boolean
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  return lk_private.staff_session_active(input_session_id, input_user_id);
end;
$$;

revoke all on function public.lk_staff_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lk_staff_session_active(uuid, uuid) to service_role;

commit;
