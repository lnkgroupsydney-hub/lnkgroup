import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const tables = [
  'lk_enquiries', 'lk_sessions', 'lk_oauth_states', 'lk_google_connection',
  'lk_calendar_links', 'lk_outbox', 'lk_change_requests', 'lk_gmail_seen',
  'lk_gmail_threads', 'lk_gmail_quarantine', 'lk_sync_lease', 'lk_rate_buckets',
  'lk_quote_drafts', 'lk_quote_submissions',
]
const approvedOrigin = 'https://xlqyafthsxallostcqfe.supabase.co'
const missingSchemaCodes = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])
const healthMigration = 'supabase/migrations/20261002100953_google_connection_health.sql'
const draftMigration = 'supabase/migrations/20261002101142_customer_quote_drafts.sql'
const submissionMigration = 'supabase/migrations/20261002113243_demo_quote_submissions.sql'
const healthColumns = 'auth_health_code,auth_health_checked_at,gmail_health_code,gmail_health_checked_at,calendar_health_code,calendar_health_checked_at'
const privateRpcProbes = [
  { name:'lk_quote_submission', input:{command:'read',args:{owner_hash:'verification-probe'}}, rejection:'LK403', migration:submissionMigration },
  // The unknown action is rejected before the health RPC can select or update
  // application rows. This proves function visibility without recording health.
  { name:'lk_google_health', input:{action:'verify_read_only',args:{}}, rejection:'LK400', migration:healthMigration },
  // An invalid owner hash is rejected before the draft read/save branches.
  { name:'lk_quote_draft', input:{command:'read',args:{owner_hash:'verification-probe'}}, rejection:'LK403', migration:draftMigration },
]

class VerificationFailure extends Error {}
function fail(message) { throw new VerificationFailure(message) }
function pass(message) { process.stdout.write(`PASS: ${message}\n`) }

function client(url, key) {
  return createClient(url, key, {
    auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false },
    global: { fetch:(input, init) => fetch(input, { ...init, cache:'no-store', signal:AbortSignal.timeout(15000) }) },
  })
}

async function main() {
  // Parse as data, with explicit environment values taking precedence. Never
  // evaluate .env as shell code or print its values, provider errors, or rows.
  if (existsSync('.env.local')) {
    for (const [key, value] of Object.entries(parseEnv(readFileSync('.env.local', 'utf8')))) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY']
  if (names.some(name => !process.env[name]?.trim())) fail('Required Supabase settings are missing or blank in .env.local.')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL.trim()
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim()
  const secretKey = process.env.SUPABASE_SECRET_KEY.trim()
  let parsed
  try { parsed = new URL(url) } catch { fail('The Supabase project URL is invalid.') }
  if (parsed.origin !== approvedOrigin || !['', '/'].includes(parsed.pathname) || parsed.search || parsed.hash || parsed.username || parsed.password) {
    fail('The configured URL does not match the approved company Supabase project.')
  }
  if (publicKey === secretKey) fail('The public and server keys must be different.')
  const server = client(approvedOrigin, secretKey)
  const publicClient = client(approvedOrigin, publicKey)

  // The operations health command, zero-row table reads and deliberately invalid
  // RPC probes below cannot write application data. No migration, login, session
  // refresh, valid draft save, connection mutation or provider sync is performed.
  const health = await server.rpc('lk_operations_command', { command:'health', args:{} })
  if (health.error) {
    if (missingSchemaCodes.has(health.error.code)) {
      fail('Operations schema is not installed or visible yet. Apply supabase/migrations/20261001100420_operations_supabase.sql in the company project, then rerun this check.')
    }
    if ([401, 403].includes(health.status)) fail('Server access was denied. Check the server key and company project settings.')
    fail('Server health check failed. Check the network, server key, and database setup.')
  }
  if (health.data?.ready !== true || health.data?.schemaVersion !== 1) fail('Operations schema version is not supported by this app.')
  pass('Server health RPC is ready; schema version 1.')

  const privateReads = await Promise.all(tables.map(table => server.from(table).select('*').limit(0)))
  const missingTableIndex = privateReads.findIndex(result => result.error && missingSchemaCodes.has(result.error.code))
  if (missingTableIndex >= 0) {
    const migration = tables[missingTableIndex] === 'lk_quote_submissions' ? submissionMigration : tables[missingTableIndex] === 'lk_quote_drafts' ? draftMigration : 'supabase/migrations/20261001100420_operations_supabase.sql'
    fail(`A required private table is missing. Review ${migration} in the company project before using the app.`)
  }
  if (privateReads.some(result => result.error || !Array.isArray(result.data) || result.data.length !== 0)) {
    fail('Server read permissions are incomplete for the private operations tables.')
  }
  pass(`Server role can query all ${tables.length} private tables with a zero-row limit.`)

  const connectionColumns = await server.from('lk_google_connection').select(healthColumns).limit(0)
  if (connectionColumns.error) {
    if (missingSchemaCodes.has(connectionColumns.error.code) || ['42703','PGRST204'].includes(connectionColumns.error.code)) {
      fail(`Google recovery columns are missing or not visible. Apply ${healthMigration} in the company project, then rerun this check.`)
    }
    fail('The six Google recovery columns could not be checked. Review server access and network connectivity.')
  }
  if (!Array.isArray(connectionColumns.data) || connectionColumns.data.length !== 0) fail('Google recovery column verification returned an unexpected response.')
  pass('All six Google recovery columns are available with a zero-row limit.')

  const serverProbes = await Promise.all(privateRpcProbes.map(probe => server.rpc(probe.name, probe.input)))
  for (const [index,result] of serverProbes.entries()) {
    const probe = privateRpcProbes[index]
    if (result.error && missingSchemaCodes.has(result.error.code)) {
      fail(`A required private RPC is missing or not visible. Apply ${probe.migration} in the company project, then rerun this check.`)
    }
    if (result.error?.code !== probe.rejection) {
      fail(`The read-only rejection probe for ${probe.name} did not match its contract. Review ${probe.migration} and server access.`)
    }
  }
  pass('Google recovery, draft and submission RPCs exist and reject non-mutating probes as expected.')

  // Confirm this public key is valid first; an invalid key must not masquerade
  // as successful table protection. The returned public settings are discarded.
  const publicValidation = await fetch(`${approvedOrigin}/auth/v1/settings`, {
    headers:{ apikey:publicKey }, cache:'no-store', signal:AbortSignal.timeout(15000),
  })
  if (!publicValidation.ok) fail('The publishable key could not be validated. Check the public key and project settings.')
  await publicValidation.body?.cancel()

  const publicReads = await Promise.all(tables.map(table => publicClient.from(table).select('*').limit(0)))
  if (publicReads.some(result => !result.error)) fail('Public access to at least one private operations table is allowed. Review table grants and RLS before using the app.')
  if (publicReads.some(result => result.error?.code !== '42501')) {
    fail('Public table access did not return the expected permission denial. Review API permissions and network connectivity.')
  }
  const publicRpcs = await Promise.all([
    publicClient.rpc('lk_operations_command', { command:'health', args:{} }),
    ...privateRpcProbes.map(probe => publicClient.rpc(probe.name, probe.input)),
  ])
  if (publicRpcs.some(result => !result.error)) fail('A private application RPC is publicly accessible. Revoke public execution before using the app.')
  // PostgREST may hide a function when the current role has no EXECUTE grant.
  // Server health/probes above already establish that all private functions exist.
  // LK400/LK403 here would prove public execution reached a private function;
  // they are deliberately not accepted as a permission-denied result.
  if (publicRpcs.some(result => !['42501', 'PGRST202'].includes(result.error?.code))) {
    fail('Public RPC access did not return the expected permission denial. Review API permissions and network connectivity.')
  }
  pass(`Publishable-key access is denied for all ${tables.length} private tables and all ${privateRpcProbes.length + 1} private RPCs.`)
  pass('Read-only Supabase connection verification completed; no application data changed.')
}

try {
  await main()
} catch (error) {
  process.stderr.write(`FAIL: ${error instanceof VerificationFailure ? error.message : 'Verification could not complete. Check local configuration and network access.'}\n`)
  process.exitCode = 1
}
