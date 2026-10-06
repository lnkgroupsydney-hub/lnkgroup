import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Synthetic Auth rows only. The whole migration chain is installed before the
// Auth fixture so legacy isolated suites need no provider schema or network.
const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role lk_untrusted_probe;')
for (const file of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
}
await db.exec(`
  create schema auth;
  create table auth.sessions(id uuid primary key, user_id uuid not null, not_after timestamptz);
  alter table auth.sessions enable row level security;
`)

beforeEach(async () => { await db.exec('reset role; truncate auth.sessions;') })
after(() => db.close())
const permissionDenied = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === '42501'

async function fixture(notAfter: string | null = null) {
  const sessionId = randomUUID(), userId = randomUUID()
  await db.query('insert into auth.sessions(id, user_id, not_after) values($1, $2, $3)', [sessionId, userId, notAfter])
  return { sessionId, userId }
}

async function active(sessionId: string | null, userId: string | null) {
  return (await db.query<{ active: boolean }>('select public.lk_staff_session_active($1::uuid, $2::uuid) active', [sessionId, userId])).rows[0].active
}

test('the server can verify a matching active Auth session without table privileges', async () => {
  const unlimited = await fixture()
  const timeBoxed = await fixture(new Date(Date.now() + 60_000).toISOString())
  await db.exec('set role service_role')
  assert.equal(await active(unlimited.sessionId, unlimited.userId), true)
  assert.equal(await active(timeBoxed.sessionId, timeBoxed.userId), true)
  await assert.rejects(db.query('select * from auth.sessions'), permissionDenied)
})

test('unknown, mismatched or missing session/user IDs never authorize a session', async () => {
  const { sessionId, userId } = await fixture()
  await db.exec('set role service_role')
  assert.equal(await active(randomUUID(), userId), false)
  assert.equal(await active(sessionId, randomUUID()), false)
  assert.equal(await active(null, userId), false)
  assert.equal(await active(sessionId, null), false)
  assert.equal(await active(null, null), false)
})

test('an expired upstream session is denied while its row still exists', async () => {
  const { sessionId, userId } = await fixture(new Date(Date.now() - 60_000).toISOString())
  await db.exec('set role service_role')
  assert.equal(await active(sessionId, userId), false)
})

test('deleting an upstream session immediately revokes the next check', async () => {
  const { sessionId, userId } = await fixture()
  await db.exec('set role service_role')
  assert.equal(await active(sessionId, userId), true)
  await db.exec('reset role')
  await db.query('delete from auth.sessions where id=$1', [sessionId])
  await db.exec('set role service_role')
  assert.equal(await active(sessionId, userId), false)
})

test('anon and authenticated callers cannot run either function or read Auth sessions', async () => {
  const { sessionId, userId } = await fixture()
  for (const role of ['anon', 'authenticated', 'lk_untrusted_probe']) {
    await db.exec(`reset role; set role ${role}`)
    await assert.rejects(active(sessionId, userId), permissionDenied)
    await assert.rejects(db.query('select lk_private.staff_session_active($1::uuid, $2::uuid)', [sessionId, userId]), permissionDenied)
    await assert.rejects(db.query('select * from auth.sessions'), permissionDenied)
  }
})

test('the private helper fails closed for a caller accidentally granted function privileges', async () => {
  const { sessionId, userId } = await fixture()
  await db.exec('begin')
  try {
    await db.exec(`
      grant usage on schema lk_private to lk_untrusted_probe;
      grant execute on function lk_private.staff_session_active(uuid, uuid) to lk_untrusted_probe;
      grant execute on function public.lk_staff_session_active(uuid, uuid) to lk_untrusted_probe;
      set local role lk_untrusted_probe;
    `)
    assert.equal(await active(sessionId, userId), false)
  } finally {
    await db.exec('rollback')
  }
})

test('the migration exposes only an invoker wrapper with pinned search paths and explicit ACLs', async () => {
  const functions = (await db.query<{ schema: string; name: string; definer: boolean; config: string[]; publicExecute: boolean; serviceExecute: boolean }>(`
    select n.nspname as schema, p.proname as name, p.prosecdef as definer, p.proconfig as config,
      exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') as "publicExecute",
      has_function_privilege('service_role', p.oid, 'EXECUTE') as "serviceExecute"
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname='lk_staff_session_active')
       or (n.nspname='lk_private' and p.proname='staff_session_active')
    order by n.nspname
  `)).rows
  assert.deepEqual(functions, [
    { schema: 'lk_private', name: 'staff_session_active', definer: true, config: ['search_path=""'], publicExecute: false, serviceExecute: true },
    { schema: 'public', name: 'lk_staff_session_active', definer: false, config: ['search_path=""'], publicExecute: false, serviceExecute: true },
  ])
  assert.equal((await db.query<{ allowed: boolean }>("select has_schema_privilege('authenticated', 'lk_private', 'USAGE') allowed")).rows[0].allowed, false)
  assert.equal((await db.query<{ allowed: boolean }>("select has_table_privilege('service_role', 'auth.sessions', 'SELECT') allowed")).rows[0].allowed, false)
})
