import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const baselineTables = [
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
const bookingMigration = 'supabase/migrations/20261003111254_admin_booking_confirmation.sql'
const bookingCalendarMigration = 'supabase/migrations/20261003111541_booking_calendar_sync.sql'
const bookingTables = {
  lk_bookings: { migration:bookingMigration, columns:'id,revision,calendar_id,resource_id,status,confirmed_proposal_id,pending_proposal_id,sync_status,confirmed_at' },
  lk_booking_proposals: { migration:bookingMigration, columns:'id,booking_id,revision,snapshot,snapshot_hash,segments,signature,consented_at,email_status,email_payload,email_first_attempt_at,email_provider_id,lease_generation,lease_until,confirmed_at' },
  lk_booking_segments: { migration:bookingMigration, columns:'booking_id,segment_id,start_at,end_at' },
  lk_booking_outbox: { migration:bookingMigration, columns:'booking_id,revision,proposal_id,updated_at' },
  lk_booking_calendar_links: { migration:bookingCalendarMigration, columns:'event_id,booking_id,proposal_id,segment_id,kind,calendar_id,etag,synced_revision' },
  lk_booking_calendar_retire_intents: { migration:bookingCalendarMigration, columns:'event_id,booking_id,new_proposal_id,booking_revision,expected_provider_etag' },
  lk_booking_calendar_changes: { migration:bookingCalendarMigration, columns:'id,booking_id,proposal_id,segment_id,event_id,provider_etag,booking_revision,kind,status' },
}
const baselineRpcProbes = [
  { name:'lk_operations_command', input:{command:'verify_read_only_unknown',args:{}}, rejection:'LK400', migration:'supabase/migrations/20261001100420_operations_supabase.sql' },
  { name:'lk_quote_submission', input:{command:'verify_read_only_unknown',args:{}}, rejection:'LK400', migration:submissionMigration },
  { name:'lk_google_health', input:{action:'verify_read_only_unknown',args:{}}, rejection:'LK400', migration:healthMigration },
  // Draft hash validation precedes dispatch. A valid, synthetic hash permits only
  // the unknown-command branch, which raises before any draft row is accessed.
  { name:'lk_quote_draft', input:{command:'verify_read_only_unknown',args:{owner_hash:'0'.repeat(64)}}, rejection:'LK400', migration:draftMigration },
]
const bookingRpcProbes = [
  { name:'lk_booking_command', input:{command:'verify_read_only_unknown',args:{}}, rejection:'LK400', migration:bookingMigration },
  { name:'lk_booking_calendar', input:{command:'verify_read_only_unknown',args:{}}, rejection:'LK400', migration:bookingCalendarMigration },
  // This SQL helper has no dispatch argument. PostgreSQL rejects the invalid UUID
  // before executing its read-only body; no real submission identifier is sent.
  { name:'lk_booking_detail', input:{booking_id:'verify-read-only-invalid-uuid'}, rejection:'22P02', migration:bookingMigration },
]
function tableMigration(table) {
  return bookingTables[table]?.migration ?? (table === 'lk_quote_submissions' ? submissionMigration : table === 'lk_quote_drafts' ? draftMigration : 'supabase/migrations/20261001100420_operations_supabase.sql')
}
function schemaRequired(migrations) {
  const required = [...new Set(migrations)]
  fail(`Required schema is missing or not visible. Compare these migration files with the company schema and apply only missing changes: ${required.join(', ')}. Do not reapply earlier migrations or run db push blindly. Use --baseline to check the previous 14-table schema separately.`)
}

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
  const flags = process.argv.slice(2)
  if (flags.some(flag => !['--baseline','--help'].includes(flag))) fail('Unknown option. Use --baseline for the previous schema or --help for usage.')
  if (flags.includes('--help')) {
    process.stdout.write('Usage: node scripts/verify-supabase.mjs [--baseline]\nDefault: verify the company booking schema, private RPCs and denied public access.\n--baseline: verify only the previous 14 private tables and 4 RPCs.\nThis command never applies migrations, writes application data or prints credentials/rows.\n')
    return
  }
  const baseline = flags.includes('--baseline')
  const tables = baseline ? baselineTables : [...baselineTables,...Object.keys(bookingTables)]
  const privateRpcProbes = baseline ? baselineRpcProbes : [...baselineRpcProbes,...bookingRpcProbes]
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
      schemaRequired(['supabase/migrations/20261001100420_operations_supabase.sql'])
    }
    if ([401, 403].includes(health.status)) fail('Server access was denied. Check the server key and company project settings.')
    fail('Server health check failed. Check the network, server key, and database setup.')
  }
  if (health.data?.ready !== true || health.data?.schemaVersion !== 1) fail('Operations schema version is not supported by this app.')
  pass('Server health RPC is ready; schema version 1.')

  const privateReads = await Promise.all(tables.map(table => server.from(table).select(bookingTables[table]?.columns ?? '*').limit(0)))
  const missingTables = privateReads.flatMap((result,index) => result.error && (missingSchemaCodes.has(result.error.code) || ['42703','PGRST204'].includes(result.error.code)) ? [tables[index]] : [])
  if (missingTables.length) schemaRequired(missingTables.map(tableMigration))
  if (privateReads.some(result => result.error || !Array.isArray(result.data) || result.data.length !== 0)) {
    fail('Server read permissions are incomplete for the private operations tables.')
  }
  pass(`Server role can query all ${tables.length} private tables with a zero-row limit.`)

  const connectionColumns = await server.from('lk_google_connection').select(healthColumns).limit(0)
  if (connectionColumns.error) {
    if (missingSchemaCodes.has(connectionColumns.error.code) || ['42703','PGRST204'].includes(connectionColumns.error.code)) {
      schemaRequired([healthMigration])
    }
    fail('The six Google recovery columns could not be checked. Review server access and network connectivity.')
  }
  if (!Array.isArray(connectionColumns.data) || connectionColumns.data.length !== 0) fail('Google recovery column verification returned an unexpected response.')
  pass('All six Google recovery columns are available with a zero-row limit.')

  if (!baseline) {
    const readyColumn = await server.from('lk_bookings').select('calendar_ready_revision').limit(0)
    if (readyColumn.error && (missingSchemaCodes.has(readyColumn.error.code) || ['42703','PGRST204'].includes(readyColumn.error.code))) schemaRequired([bookingCalendarMigration])
    if (readyColumn.error || !Array.isArray(readyColumn.data) || readyColumn.data.length !== 0) fail('The booking Calendar readiness column could not be verified.')
    pass('The booking Calendar readiness column is available with a zero-row limit.')
  }

  const serverProbes = await Promise.all(privateRpcProbes.map(probe => server.rpc(probe.name, probe.input)))
  for (const [index,result] of serverProbes.entries()) {
    const probe = privateRpcProbes[index]
    if (result.error && missingSchemaCodes.has(result.error.code)) {
      schemaRequired([probe.migration])
    }
    if (result.error?.code !== probe.rejection) {
      fail(`The read-only rejection probe for ${probe.name} did not match its contract. Review ${probe.migration} and server access.`)
    }
  }
  pass(`All ${privateRpcProbes.length} private RPCs exist and reject non-mutating probes as expected.`)

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
  pass(`Publishable-key access is denied for all ${tables.length} private tables and all ${privateRpcProbes.length} private RPCs.`)
  pass(`Read-only Supabase ${baseline ? 'baseline' : 'booking-schema'} verification completed; no application data changed.`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`FAIL: ${error instanceof VerificationFailure ? error.message : 'Verification could not complete. Check local configuration and network access.'}\n`)
  process.exitCode = 1
}
