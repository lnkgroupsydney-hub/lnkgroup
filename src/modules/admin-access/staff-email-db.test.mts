import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create role lk_email_probe;')
for (const file of readdirSync(new URL('../../../supabase/migrations/', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL(`../../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
}
await db.exec('create schema auth; create table auth.sessions(id uuid primary key);')
beforeEach(async () => { await db.exec('reset role; truncate public.lk_sessions cascade;') })
after(() => db.close())

type Identity = { token_hash: string; user_id: string; email_hash: string }
type Challenge = Identity & { challenge_id: string; code_hash: string }
type Status = { challengeId: string; sent: boolean; expiresAt: number; retryAt: number; verifiedUntil: number | null }
const hash = (value: string = randomUUID()) => createHash('sha256').update(value).digest('hex')
const permissionDenied = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === '42501'
const message = (text: string) => (error: unknown) => error instanceof Error && error.message === text

async function command<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await db.query<{ result: T }>('select public.lk_staff_email_command($1,$2::jsonb) result', [name, JSON.stringify(args)])).rows[0].result
}

async function fixture(mode = 'staff', expiresAt = Date.now() + 3_600_000) {
  const identity: Identity = { token_hash: hash(), user_id: randomUUID(), email_hash: hash('staff@example.invalid') }
  await db.query('insert into public.lk_sessions(token_hash,mode,account_sub,expires_at) values($1,$2,$3,$4)', [identity.token_hash, mode, identity.user_id, expiresAt])
  await db.exec('set role service_role')
  return { identity, expiresAt }
}

async function issue(identity: Identity) {
  const challenge: Challenge = { ...identity, challenge_id: randomUUID(), code_hash: hash() }
  const status = await command<Status>('issue', challenge)
  return { challenge, status }
}

async function sent(identity: Identity) {
  const issued = await issue(identity)
  assert.deepEqual(await command('sent', issued.challenge), { updated: true })
  return issued
}

test('issue returns only safe pending status, then delivery permits session-bound verification', async () => {
  const { identity, expiresAt } = await fixture()
  assert.equal(await command('status', identity), null)
  const { challenge, status } = await issue(identity)
  assert.deepEqual(Object.keys(status).sort(), ['challengeId', 'expiresAt', 'retryAt', 'sent', 'verifiedUntil'].sort())
  assert.equal(status.challengeId, challenge.challenge_id)
  assert.equal(status.sent, false)
  assert.equal(status.verifiedUntil, null)
  assert.equal(status.expiresAt - status.retryAt, 540_000)
  assert.deepEqual(await command('verify', challenge), { verified: false })
  assert.deepEqual(await command('sent', challenge), { updated: true })
  assert.equal((await command<Status>('status', identity)).sent, true)
  assert.deepEqual(await command('verify', challenge), { verified: true, verifiedUntil: expiresAt })
  assert.equal((await command<Status>('status', identity)).verifiedUntil, expiresAt)
  const saved = (await db.query<{ code_hash: string | null; status: string }>('select code_hash,status from public.lk_staff_email_checks')).rows[0]
  assert.deepEqual(saved, { code_hash: null, status: 'verified' })
})

test('anon, authenticated and ungranted roles cannot query checks, run commands or read Auth sessions', async () => {
  const { identity } = await fixture()
  await issue(identity)
  for (const role of ['anon', 'authenticated', 'lk_email_probe']) {
    await db.exec(`reset role; set role ${role}`)
    await assert.rejects(command('status', identity), permissionDenied)
    await assert.rejects(db.query('select * from public.lk_staff_email_checks'), permissionDenied)
    await assert.rejects(db.query('select * from auth.sessions'), permissionDenied)
  }
  await db.exec('reset role; set role service_role')
  await assert.rejects(db.query('select * from auth.sessions'), permissionDenied)
})

test('accidentally granting execution to another role does not pass the server-role guard', async () => {
  const { identity } = await fixture()
  await db.exec('reset role; begin')
  try {
    await db.exec('grant execute on function public.lk_staff_email_command(text,jsonb) to lk_email_probe; set local role lk_email_probe')
    await assert.rejects(command('status', identity), permissionDenied)
  } finally { await db.exec('rollback') }
})

test('missing, expired, legacy or differently owned sessions cannot issue or reuse proof', async () => {
  for (const mode of ['local', 'google', 'staff']) {
    await db.exec('reset role')
    const { identity } = await fixture(mode, mode === 'staff' ? Date.now() - 1 : Date.now() + 60_000)
    await assert.rejects(issue(identity), message('STAFF_EMAIL_ACCESS_UNAVAILABLE'))
    assert.equal(await command('status', identity), null)
  }
  await db.exec('reset role')
  const { identity } = await fixture()
  const { challenge } = await sent(identity)
  for (const wrong of [{ ...challenge, token_hash: hash() }, { ...challenge, user_id: randomUUID() }]) {
    assert.equal(await command('status', wrong), null)
    assert.deepEqual(await command('verify', wrong), { verified: false })
    await assert.rejects(command('issue', wrong), message('STAFF_EMAIL_ACCESS_UNAVAILABLE'))
  }
})

test('email and challenge binding reject a different email or challenge without consuming valid attempts', async () => {
  const { identity } = await fixture()
  const { challenge } = await sent(identity)
  const wrongEmail = { ...challenge, email_hash: hash() }
  assert.equal(await command('status', wrongEmail), null)
  assert.deepEqual(await command('verify', wrongEmail), { verified: false })
  assert.deepEqual(await command('verify', { ...challenge, challenge_id: randomUUID() }), { verified: false })
  assert.equal((await db.query<{ attempts: number }>('select attempts from public.lk_staff_email_checks')).rows[0].attempts, 0)
  assert.equal((await command<{ verified: boolean }>('verify', challenge)).verified, true)
})

test('resend cooldown applies to pending, failed and changed-email requests', async () => {
  const { identity } = await fixture()
  const { challenge } = await issue(identity)
  await assert.rejects(issue(identity), message('STAFF_EMAIL_RATE_LIMITED'))
  assert.deepEqual(await command('failed', challenge), { updated: true })
  await assert.rejects(issue(identity), message('STAFF_EMAIL_RATE_LIMITED'))
  await assert.rejects(issue({ ...identity, email_hash: hash() }), message('STAFF_EMAIL_RATE_LIMITED'))
  await db.query('update public.lk_staff_email_checks set retry_at=0 where token_hash=$1', [identity.token_hash])
  const replacement = await issue(identity)
  assert.notEqual(replacement.challenge.challenge_id, challenge.challenge_id)
})

test('a replacement invalidates old codes and late delivery success or failure acknowledgements', async () => {
  const { identity } = await fixture()
  const first = await sent(identity)
  await db.query('update public.lk_staff_email_checks set retry_at=0 where token_hash=$1', [identity.token_hash])
  const second = await issue(identity)
  assert.deepEqual(await command('sent', first.challenge), { updated: false })
  assert.deepEqual(await command('failed', first.challenge), { updated: false })
  assert.deepEqual(await command('verify', first.challenge), { verified: false })
  assert.deepEqual(await command('sent', second.challenge), { updated: true })
  assert.deepEqual(await command('failed', first.challenge), { updated: false })
  assert.equal((await command<{ verified: boolean }>('verify', second.challenge)).verified, true)
  const verified = await command<Status>('status', identity)
  assert.deepEqual(await command('failed', first.challenge), { updated: false })
  assert.deepEqual(await command('failed', second.challenge), { updated: false })
  assert.deepEqual(await command('status', identity), verified)
})

test('failed delivery cannot be verified or changed to sent by a late acknowledgement', async () => {
  const { identity } = await fixture()
  const { challenge } = await issue(identity)
  assert.deepEqual(await command('failed', challenge), { updated: true })
  assert.deepEqual(await command('sent', challenge), { updated: false })
  assert.deepEqual(await command('verify', challenge), { verified: false })
  assert.equal((await db.query<{ code_hash: string | null }>('select code_hash from public.lk_staff_email_checks')).rows[0].code_hash, null)
})

test('unknown delivery acknowledgement can revoke the exact sent challenge without leaving a usable code', async () => {
  const { identity } = await fixture()
  const { challenge } = await sent(identity)
  assert.deepEqual(await command('failed', challenge), { updated: true })
  assert.deepEqual(await command('verify', challenge), { verified: false })
  assert.deepEqual(await command('sent', challenge), { updated: false })
  assert.deepEqual(await command('failed', challenge), { updated: false })
  assert.equal((await command<Status>('status', identity)).sent, false)
  assert.equal((await db.query<{ code_hash: string | null }>('select code_hash from public.lk_staff_email_checks')).rows[0].code_hash, null)
})

test('five incorrect guesses persist and exhaust the challenge even when the correct code follows', async () => {
  const { identity } = await fixture()
  const { challenge } = await sent(identity)
  for (let attempt = 1; attempt <= 5; attempt++) {
    assert.deepEqual(await command('verify', { ...challenge, code_hash: hash() }), { verified: false })
    assert.equal((await db.query<{ attempts: number }>('select attempts from public.lk_staff_email_checks')).rows[0].attempts, attempt)
  }
  assert.deepEqual(await command('verify', challenge), { verified: false })
  const status = await command<Status>('status', identity)
  assert.equal(status.sent, false)
  assert.equal(status.verifiedUntil, null)
})

test('challenge expiry blocks verification and a late send acknowledgement', async () => {
  const { identity } = await fixture()
  const { challenge } = await sent(identity)
  await db.query('update public.lk_staff_email_checks set expires_at=0 where token_hash=$1', [identity.token_hash])
  assert.deepEqual(await command('verify', challenge), { verified: false })
  await db.query("update public.lk_staff_email_checks set status='pending' where token_hash=$1", [identity.token_hash])
  assert.deepEqual(await command('sent', challenge), { updated: false })
})

test('verified proof outlives the used code but cannot outlive or extend the original session', async () => {
  const { identity, expiresAt } = await fixture()
  const { challenge } = await sent(identity)
  await command('verify', challenge)
  await db.query('update public.lk_staff_email_checks set expires_at=0 where token_hash=$1', [identity.token_hash])
  assert.equal((await command<Status>('status', identity)).verifiedUntil, expiresAt)
  await db.query('update public.lk_sessions set expires_at=$2 where token_hash=$1', [identity.token_hash, expiresAt + 60_000])
  assert.equal((await command<Status>('status', identity)).verifiedUntil, expiresAt)
  await db.query('update public.lk_sessions set expires_at=$2 where token_hash=$1', [identity.token_hash, expiresAt - 60_000])
  assert.equal((await command<Status>('status', identity)).verifiedUntil, expiresAt - 60_000)
  await db.query('update public.lk_sessions set expires_at=0 where token_hash=$1', [identity.token_hash])
  assert.equal(await command('status', identity), null)
})

test('session deletion cascades challenges and proof without altering legacy positional inserts', async () => {
  const { identity, expiresAt } = await fixture()
  const { challenge } = await sent(identity)
  await command('verify', challenge)
  await db.query('delete from public.lk_sessions where token_hash=$1', [identity.token_hash])
  assert.equal((await db.query('select * from public.lk_staff_email_checks')).rows.length, 0)
  assert.equal(await command('status', identity), null)
  await db.query('insert into public.lk_sessions values($1,$2,$3,$4)', [hash(), 'local', null, expiresAt])
})

test('duplicate queued verification calls consume a challenge at most once', async () => {
  const { identity } = await fixture()
  const { challenge } = await sent(identity)
  // PGlite serializes its single connection. These queued requests validate
  // replay semantics; multi-connection PostgreSQL lock scheduling is separate.
  const results = await Promise.all([command<{ verified: boolean }>('verify', challenge), command<{ verified: boolean }>('verify', challenge)])
  assert.equal(results.filter(result => result.verified).length, 1)
  assert.deepEqual(await command('verify', challenge), { verified: false })
})

test('malformed input is rejected before any challenge is written', async () => {
  const { identity } = await fixture()
  for (const args of [{}, { ...identity, user_id: 'bad' }, { ...identity, email_hash: '123' }, { ...identity, token_hash: 'staff-session' }]) {
    await assert.rejects(command('issue', args), message('STAFF_EMAIL_INVALID_REQUEST'))
  }
  await assert.rejects(command('unknown', identity), message('STAFF_EMAIL_INVALID_REQUEST'))
  assert.equal((await db.query('select * from public.lk_staff_email_checks')).rows.length, 0)
})

test('schema exposes only an RLS-protected table and an invoker function with explicit service grants', async () => {
  const table = (await db.query<{ rls: boolean; service: boolean; anon: boolean; authenticated: boolean }>(`
    select c.relrowsecurity rls,
      has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') service,
      has_table_privilege('anon', c.oid, 'SELECT') anon,
      has_table_privilege('authenticated', c.oid, 'SELECT') authenticated
    from pg_class c where c.oid='public.lk_staff_email_checks'::regclass
  `)).rows[0]
  assert.deepEqual(table, { rls: true, service: true, anon: false, authenticated: false })
  const fn = (await db.query<{ definer: boolean; config: string[]; publicExecute: boolean; service: boolean }>(`
    select p.prosecdef definer,p.proconfig config,
      exists(select 1 from aclexplode(p.proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') "publicExecute",
      has_function_privilege('service_role', p.oid, 'EXECUTE') service
    from pg_proc p where p.oid='public.lk_staff_email_command(text,jsonb)'::regprocedure
  `)).rows[0]
  assert.deepEqual(fn, { definer: false, config: ['search_path=""'], publicExecute: false, service: true })
})
