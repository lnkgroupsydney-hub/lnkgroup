import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const { PGlite } = await import(createRequire('/Users/jimee/orca/workspaces/L&K Group/sablefish/package.json').resolve('@electric-sql/pglite'))
// Usage: node verify-rollout-bundle.mjs <dir with ems-rollout.sql and base/ (origin/main migrations at 5c42702)>
const dir = process.argv[2], bundle = readFileSync(`${dir}/ems-rollout.sql`, 'utf8')
async function base() {
  const db = new PGlite()
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); create schema auth; create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);")
  for (const f of readdirSync(`${dir}/base`).sort()) await db.exec(readFileSync(`${dir}/base/${f}`, 'utf8'))
  await db.exec("insert into public.lk_rate_buckets(bucket, count, reset_at) values ('rollout-test', 3, 4102444800000)").catch(e => console.log('seed note:', e.message))
  return db
}
const exists = async (db, rel) => (await db.query(`select to_regclass('${rel}') is not null as e`)).rows[0].e
let db = await base()
const tables = (await db.query("select count(*)::int n from pg_tables where schemaname='public' and tablename like 'lk\\_%'")).rows[0].n
console.log('base lk tables', tables)
await db.exec(bundle)
console.log('positive: applied, company_revisions', await exists(db, 'public.lk_quote_company_revisions'), 'customer_properties', await exists(db, 'public.lk_customer_properties'), 'seed kept', (await db.query("select count from public.lk_rate_buckets where bucket='rollout-test'")).rows[0]?.count)
db = await base()
const tampered = bundle.replace('-- ===== verification', "update public.lk_rate_buckets set count = count + 1 where bucket='rollout-test';\n-- ===== verification")
try { await db.exec(tampered); console.log('negative: UNEXPECTED success') } catch (e) { console.log('negative: aborted ->', e.message.slice(0, 120)); await db.exec('rollback').catch(() => {}) }
console.log('negative: company_revisions after abort', await exists(db, 'public.lk_quote_company_revisions'), 'seed count', (await db.query("select count from public.lk_rate_buckets where bucket='rollout-test'")).rows[0]?.count)
