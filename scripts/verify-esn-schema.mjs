import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const approvedOrigin = 'https://xlqyafthsxallostcqfe.supabase.co'
const tables = [
  { name: 'lk_customers', columns: 'id,company_id,name,email,phone,address,revision,created_at,updated_at' },
  { name: 'lk_customer_record_links', columns: 'company_id,customer_id,source_type,source_id,enquiry_id,submission_id,created_at' },
  { name: 'lk_customer_audit_events', columns: 'id,company_id,customer_id,action,source_type,source_id,reason,actor_user_id,actor_session_id,idempotency_key,request_hash,result_json,revision,created_at' },
]
const probes = [
  { name: 'lk_customers_command', input: { command: 'verify_read_only_unknown', args: {} }, rejection: 'LK403' },
  { name: 'lk_customer_json', input: { c: null }, nullCustomer: true },
  { name: 'lk_customer_records', input: {}, zeroRows: true },
  { name: 'lk_staff_sessions_command', input: { command: 'list', input_token_hash: null, input_user_id: null }, rejection: 'P0001' },
]
class VerificationFailure extends Error {}
function fail(message) { throw new VerificationFailure(message) }
function client(key) {
  return createClient(approvedOrigin, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store', signal: AbortSignal.timeout(15000) }) },
  })
}
function probe(api, item) {
  const query = api.rpc(item.name, item.input)
  return item.zeroRows ? query.limit(0) : query
}
async function main() {
  const flags = process.argv.slice(2)
  if (flags.some(flag => flag !== '--help')) fail('Unknown option.')
  if (flags.includes('--help')) {
    process.stdout.write('Usage: node scripts/verify-esn-schema.mjs\nRead-only: zero-row ESN table reads, null/invalid RPC probes and anonymous permission checks. No rows or credentials are printed; no migration, login or mutation is performed.\n')
    return
  }
  if (existsSync('.env.local')) {
    for (const [name, value] of Object.entries(parseEnv(readFileSync('.env.local', 'utf8')))) {
      if (process.env[name] === undefined) process.env[name] = value
    }
  }
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']
  if (names.some(name => !process.env[name]?.trim())) fail('Required Supabase settings are missing or blank.')
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim()
  const secretKey = process.env.SUPABASE_SECRET_KEY.trim()
  let url
  try { url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL.trim()) } catch { fail('The configured project URL is invalid.') }
  if (url.origin !== approvedOrigin || !['', '/'].includes(url.pathname) || url.search || url.hash || url.username || url.password) fail('The project URL does not match the approved company project.')
  if (publicKey === secretKey) fail('The public and server keys must differ.')
  const server = client(secretKey), anonymous = client(publicKey)
  const validation = await fetch(`${approvedOrigin}/auth/v1/settings`, { headers: { apikey: publicKey }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!validation.ok) fail('The publishable key could not be validated.')
  await validation.body?.cancel()

  const reads = await Promise.all(tables.map(table => server.from(table.name).select(table.columns).limit(0)))
  const invalidReads = reads.flatMap((result, i) => result.error || !Array.isArray(result.data) || result.data.length !== 0 ? [tables[i].name] : [])
  if (invalidReads.length) fail(`Server zero-row table checks failed: ${invalidReads.join(', ')}.`)
  process.stdout.write(`PASS: Server zero-row table checks ${reads.length}/${tables.length}.\n`)
  const serverResults = await Promise.all(probes.map(item => probe(server, item)))
  const invalidRpcs = serverResults.flatMap((result, i) => {
    const item = probes[i]
    const valid = item.rejection ? result.error?.code === item.rejection
      : item.zeroRows ? !result.error && Array.isArray(result.data) && result.data.length === 0
      : !result.error && result.data?.id === null && result.data?.revision === null
    return valid ? [] : [item.name]
  })
  if (invalidRpcs.length) fail(`Server read-only RPC contract checks failed: ${invalidRpcs.join(', ')}.`)
  process.stdout.write(`PASS: Server read-only RPC checks ${serverResults.length}/${probes.length}.\n`)
  const publicReads = await Promise.all(tables.map(table => anonymous.from(table.name).select(table.columns).limit(0)))
  const allowedReads = publicReads.flatMap((result, i) => result.error?.code === '42501' ? [] : [tables[i].name])
  if (allowedReads.length) fail(`Anonymous table denial checks failed: ${allowedReads.join(', ')}.`)
  const publicResults = await Promise.all(probes.map(item => probe(anonymous, item)))
  const allowedRpcs = publicResults.flatMap((result, i) => ['42501', 'PGRST202'].includes(result.error?.code) ? [] : [probes[i].name])
  if (allowedRpcs.length) fail(`Anonymous RPC denial checks failed: ${allowedRpcs.join(', ')}.`)
  process.stdout.write(`PASS: Anonymous denial checks ${publicReads.length + publicResults.length}/${tables.length + probes.length}.\n`)
  process.stdout.write(`PASS: Read-only ESN permission checks ${reads.length + serverResults.length + publicReads.length + publicResults.length}/14; no application data changed.\n`)
}
try { await main() } catch (error) {
  process.stderr.write(`FAIL: ${error instanceof VerificationFailure ? error.message : 'Verification could not complete. Check configuration and network access.'}\n`)
  process.exitCode = 1
}
