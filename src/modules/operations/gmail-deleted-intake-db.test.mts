import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Production migrations run only in an isolated Postgres engine. No application
// adapter, credentials, browser session or external provider is used here.
const db = new PGlite()
const migrationDirectory = new URL('../../../supabase/migrations/', import.meta.url)
const migrationName = '20261013011739_gmail_import_tombstones.sql'
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
for (const name of readdirSync(migrationDirectory).filter(name => name.endsWith('.sql') && name < migrationName).sort()) {
  await db.exec(readFileSync(new URL(name, migrationDirectory), 'utf8'))
}
after(async () => { await db.close() })

const account = 'synthetic-company'
const holder = 'synthetic-cleanup-worker'
const deletedId = randomUUID()
const retainedId = randomUUID()
type EnquiryRow = { id:string; revision:number }
async function command<T = unknown>(command:string, args:Record<string, unknown> = {}):Promise<T> {
  return (await db.query<{result:T}>('select public.lk_operations_command($1, $2::jsonb) as result', [command, JSON.stringify(args)])).rows[0].result
}
function importArgs(message:string, thread:string, id = randomUUID()) {
  const received = '2099-01-01T00:00:00Z'
  const entry = {messageId:message, receivedAt:received, subject:'Synthetic intake', bodyText:'Synthetic body'}
  return {
    account, holder, message, thread, id, reference:`KCP-${id}`, received, attachments:0,
    entry, payload:{name:'Synthetic intake', email:'test@example.invalid', gmail:{threadId:thread, messages:[entry], historyTruncated:false}},
  }
}
const errorCode = (expected:string) => (error:unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === expected

async function protections() {
  return {
    table:(await db.query("select relacl::text, relrowsecurity, relforcerowsecurity from pg_class where oid='public.lk_gmail_seen'::regclass")).rows,
    constraints:(await db.query("select conname, contype, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.lk_gmail_seen'::regclass and contype in ('p','f') order by conname")).rows,
    policies:(await db.query("select * from pg_policies where schemaname='public' and tablename='lk_gmail_seen'")).rows,
    rpc:(await db.query("select proacl::text, pg_get_functiondef(oid) as definition from pg_proc where oid='public.lk_operations_command(text,jsonb)'::regprocedure")).rows,
    privileges:(await db.query(`
      select role, has_table_privilege(role,'public.lk_gmail_seen','SELECT') as can_select,
        has_table_privilege(role,'public.lk_gmail_seen','UPDATE') as can_update,
        has_table_privilege(role,'public.lk_gmail_seen','DELETE') as can_delete,
        has_function_privilege(role,'public.lk_operations_command(text,jsonb)','EXECUTE') as can_execute
      from unnest(array['anon','authenticated','service_role']) as role order by role
    `)).rows,
  }
}
const protectionsBefore = await protections()
await db.exec('set role service_role')
assert.equal(await command('sync_acquire', {holder}), true)
await command('gmail_import', importArgs('deleted-message', 'deleted-thread', deletedId))
await command('gmail_import', importArgs('retained-message', 'retained-thread', retainedId))
await db.exec('reset role')
await db.exec(readFileSync(new URL(migrationName, migrationDirectory), 'utf8'))

test('nullable Gmail tombstones preserve existing data, FK/PK, RLS, grants and RPC definition', async () => {
  assert.deepEqual(await protections(), protectionsBefore)
  const nullable = await db.query<{is_nullable:string}>("select is_nullable from information_schema.columns where table_schema='public' and table_name='lk_gmail_seen' and column_name='enquiry_id'")
  assert.equal(nullable.rows[0].is_nullable, 'YES')
  const seen = await db.query<{message_id:string; enquiry_id:string}>('select message_id, enquiry_id from public.lk_gmail_seen order by message_id')
  assert.deepEqual(seen.rows, [
    {message_id:'deleted-message', enquiry_id:deletedId},
    {message_id:'retained-message', enquiry_id:retainedId},
  ])
  assert.equal((await db.query('select id from public.lk_enquiries')).rows.length, 2)
  await assert.rejects(db.query('insert into public.lk_gmail_seen values ($1,$2,$3)', [account,'invalid-reference',randomUUID()]), errorCode('23503'))
  await assert.rejects(db.query('insert into public.lk_gmail_seen values ($1,$2,null)', [account,'deleted-message']), errorCode('23505'))
  await assert.rejects(db.query('insert into public.lk_gmail_seen values (null,$1,null)', ['missing-account']), errorCode('23502'))
  await assert.rejects(db.query('insert into public.lk_gmail_seen values ($1,null,null)', [account]), errorCode('23502'))
})

test('deleted messages stay deduplicated and a new message can recreate only its own thread', async () => {
  await db.exec('set role service_role')
  // The scoped cleanup caller fences sync before releasing an enquiry reference.
  await db.query('update public.lk_gmail_seen set enquiry_id=null where enquiry_id=$1', [deletedId])
  await db.query('delete from public.lk_gmail_threads where enquiry_id=$1', [deletedId])
  await db.query('delete from public.lk_enquiries where id=$1', [deletedId])
  assert.equal(await command('gmail_seen', {account,message:'deleted-message'}), true)
  assert.equal(await command('gmail_seen', {account:'another-account',message:'deleted-message'}), false)
  for (let attempt = 0; attempt < 2; attempt++) {
    // A tombstone has no enquiry to return. The reader checks gmail_seen first;
    // direct RPC replay is checked for absence of writes, not adapter compatibility.
    await command('gmail_import', importArgs('deleted-message', 'deleted-thread'))
    assert.equal((await db.query('select id from public.lk_enquiries')).rows.length, 1)
    assert.equal((await db.query('select * from public.lk_gmail_threads where thread_id=$1', ['deleted-thread'])).rows.length, 0)
  }
  const retained = await command<EnquiryRow>('gmail_import', importArgs('retained-message', 'retained-thread'))
  assert.equal(retained.id, retainedId)
  assert.equal(retained.revision, 1)
  const nextId = randomUUID()
  const next = await command<EnquiryRow>('gmail_import', importArgs('new-message', 'deleted-thread', nextId))
  assert.equal(next.id, nextId)
  assert.notEqual(next.id, deletedId)
  assert.equal(await command('gmail_seen', {account,message:'new-message'}), true)
  assert.deepEqual((await db.query('select enquiry_id from public.lk_gmail_threads where account_sub=$1 and thread_id=$2', [account,'deleted-thread'])).rows, [{enquiry_id:nextId}])
  assert.deepEqual((await db.query('select enquiry_id from public.lk_gmail_seen where account_sub=$1 and message_id=$2', [account,'deleted-message'])).rows, [{enquiry_id:null}])
  assert.deepEqual((await db.query('select enquiry_id from public.lk_gmail_seen where account_sub=$1 and message_id=$2', [account,'retained-message'])).rows, [{enquiry_id:retainedId}])
  assert.equal((await db.query('select id from public.lk_enquiries')).rows.length, 2)
  await db.exec('reset role')
})

test('anon/authenticated cannot read or modify tombstones or call the operations RPC', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query('select * from public.lk_gmail_seen'), errorCode('42501'))
    await assert.rejects(db.query('update public.lk_gmail_seen set enquiry_id=null'), errorCode('42501'))
    await assert.rejects(db.query('delete from public.lk_gmail_seen'), errorCode('42501'))
    await assert.rejects(command('gmail_seen', {account,message:'deleted-message'}), errorCode('42501'))
    await db.exec('reset role')
  }
  assert.deepEqual(await protections(), protectionsBefore)
})
