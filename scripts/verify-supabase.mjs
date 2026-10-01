import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

const tables = [
  'lk_enquiries', 'lk_sessions', 'lk_oauth_states', 'lk_google_connection',
  'lk_calendar_links', 'lk_outbox', 'lk_change_requests', 'lk_gmail_seen',
  'lk_gmail_threads', 'lk_gmail_quarantine', 'lk_sync_lease', 'lk_rate_buckets',
]
const approvedOrigin = 'https://xlqyafthsxallostcqfe.supabase.co'
const missingSchemaCodes = new Set(['PGRST202', 'PGRST205', '42883', '42P01'])

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

  // Only the read-only health command is invoked. No migration, write, login,
  // session refresh, or provider sync is performed by this verification script.
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
  if (privateReads.some(result => result.error && missingSchemaCodes.has(result.error.code))) {
    fail('Some operations tables are missing. Review the migration before using the app.')
  }
  if (privateReads.some(result => result.error || !Array.isArray(result.data) || result.data.length !== 0)) {
    fail('Server read permissions are incomplete for the private operations tables.')
  }
  pass(`Server role can query all ${tables.length} private tables with a zero-row limit.`)

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
  const publicRpc = await publicClient.rpc('lk_operations_command', { command:'health', args:{} })
  if (!publicRpc.error) fail('The private operations RPC is publicly accessible. Revoke public execution before using the app.')
  // PostgREST may hide a function when the current role has no EXECUTE grant.
  // Server health above already establishes that the function exists.
  if (!['42501', 'PGRST202'].includes(publicRpc.error.code)) {
    fail('Public RPC access did not return the expected permission denial. Review API permissions and network connectivity.')
  }
  pass(`Publishable-key access is denied for all ${tables.length} private tables and the operations RPC.`)
  pass('Read-only Supabase connection verification completed; no application data changed.')
}

try {
  await main()
} catch (error) {
  process.stderr.write(`FAIL: ${error instanceof VerificationFailure ? error.message : 'Verification could not complete. Check local configuration and network access.'}\n`)
  process.exitCode = 1
}
