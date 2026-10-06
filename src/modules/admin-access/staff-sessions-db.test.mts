import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role lk_untrusted_probe;')
for (const file of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
}
beforeEach(async () => { await db.exec('reset role; truncate public.lk_sessions cascade;') })
after(() => db.close())
const permissionDenied = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === '42501'
const sessionRequired = (error: unknown) => !!error && typeof error === 'object' && 'message' in error && error.message === 'STAFF_SESSION_REQUIRED'
async function session(owner: string, mode = 'staff', expiry = Date.now() + 600_000) {
  const hash = randomUUID()
  await db.query('insert into public.lk_sessions(token_hash,mode,account_sub,expires_at) values($1,$2,$3,$4)', [hash, mode, owner, expiry])
  return hash
}
async function command(action: string, hash: string | null, owner: string | null) {
  return (await db.query<{ result: { current: { expiresAt: number }; otherSessionCount: number; otherSessions: { expiresAt: number }[]; truncated: boolean; removedSessionCount: number } }>(
    'select public.lk_staff_sessions_command($1, $2, $3::uuid) result', [action, hash, owner])).rows[0].result
}

async function emailProof(hash: string, owner: string) {
  await db.query(`insert into public.lk_staff_email_checks(token_hash,user_id,email_hash,challenge_id,code_hash,expires_at,retry_at,attempts,status,sent_at,verified_until)
    values($1,$2::uuid,$3,$4::uuid,null,$5,$5,0,'verified',$5,$5)`, [hash, owner, 'a'.repeat(64), randomUUID(), Date.now() + 600_000])
}

test('list returns only current/other staff expiry times for the verified owner and excludes expired/legacy rows', async () => {
  const owner = randomUUID(), foreign = randomUUID(), expiry = Date.now() + 600_000
  const current = await session(owner, 'staff', expiry), other = await session(owner, 'staff', expiry + 100)
  await session(foreign); await session(owner, 'google'); await session(owner, 'local'); await session(owner, 'staff', Date.now() - 1)
  await db.exec('set role service_role')
  const result = await command('list', current, owner)
  assert.deepEqual(result, { current: { expiresAt: expiry }, otherSessionCount: 1, otherSessions: [{ expiresAt: expiry + 100 }], truncated: false })
  assert.ok(!JSON.stringify(result).includes(other)); assert.ok(!JSON.stringify(result).includes(owner))
})

test('session summary bounds expiry rows at 50 while retaining the exact count', async () => {
  const owner = randomUUID(), current = await session(owner)
  for (let i = 0; i < 53; i++) await session(owner)
  await db.exec('set role service_role')
  const result = await command('list', current, owner)
  assert.equal(result.otherSessionCount, 53); assert.equal(result.otherSessions.length, 50); assert.equal(result.truncated, true)
})

test('revocation removes only other staff rows and cascades their email proof while preserving current proof', async () => {
  const owner = randomUUID(), current = await session(owner), other = await session(owner), expired = await session(owner, 'staff', Date.now() - 1)
  const foreign = await session(randomUUID()), legacy = await session(owner, 'google')
  await emailProof(current, owner); await emailProof(other, owner)
  await db.exec('set role service_role')
  assert.deepEqual(await command('revoke_others', current, owner), { removedSessionCount: 2 })
  const remaining = (await db.query<{ token_hash: string }>('select token_hash from public.lk_sessions order by token_hash')).rows.map(row => row.token_hash)
  assert.deepEqual(remaining, [current, foreign, legacy].sort()); assert.ok(!remaining.includes(expired))
  assert.deepEqual((await db.query<{ token_hash: string }>('select token_hash from public.lk_staff_email_checks')).rows, [{ token_hash: current }])
  assert.deepEqual(await command('revoke_others', current, owner), { removedSessionCount: 0 })
})

test('a second previously authenticated session cannot remove the surviving current session', async () => {
  const owner = randomUUID(), first = await session(owner), second = await session(owner)
  await db.exec('set role service_role')
  assert.deepEqual(await command('revoke_others', first, owner), { removedSessionCount: 1 })
  await assert.rejects(command('revoke_others', second, owner), sessionRequired)
  assert.equal((await command('list', first, owner)).otherSessionCount, 0)
})

test('missing mismatched expired or legacy current sessions fail closed without deleting rows', async () => {
  const owner = randomUUID(), current = await session(owner), expired = await session(owner, 'staff', Date.now() - 1), legacy = await session(owner, 'google')
  await db.exec('set role service_role')
  for (const action of ['list', 'revoke_others']) {
    for (const [hash, user] of [[null, owner], [current, null], [randomUUID(), owner], [current, randomUUID()], [expired, owner], [legacy, owner]]) {
      await assert.rejects(command(action, hash, user), sessionRequired)
    }
  }
  assert.equal((await db.query<{ count: number }>('select count(*)::int count from public.lk_sessions')).rows[0].count, 3)
})

test('browser roles cannot call the session RPC or directly read the registry', async () => {
  const owner = randomUUID(), current = await session(owner)
  for (const role of ['anon', 'authenticated', 'lk_untrusted_probe']) {
    await db.exec(`reset role; set role ${role}`)
    await assert.rejects(command('list', current, owner), permissionDenied)
    await assert.rejects(command('revoke_others', current, owner), permissionDenied)
    await assert.rejects(db.query('select * from public.lk_sessions'), permissionDenied)
  }
})

test('the RPC remains invoker-only with pinned search path and explicit service-only execution', async () => {
  const result = (await db.query<{ definer: boolean; config: string[]; publicExecute: boolean; serviceExecute: boolean }>(`
    select p.prosecdef definer, p.proconfig config,
      exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') "publicExecute",
      has_function_privilege('service_role', p.oid, 'EXECUTE') "serviceExecute"
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='lk_staff_sessions_command'
  `)).rows[0]
  assert.deepEqual(result, { definer: false, config: ['search_path=""'], publicExecute: false, serviceExecute: true })
})

test('accidental execution grants cannot bypass the service role check', async () => {
  const owner = randomUUID(), current = await session(owner)
  await db.exec('begin')
  try {
    await db.exec('grant execute on function public.lk_staff_sessions_command(text,text,uuid) to lk_untrusted_probe; set local role lk_untrusted_probe;')
    await assert.rejects(command('revoke_others', current, owner), permissionDenied)
  } finally { await db.exec('rollback') }
})
