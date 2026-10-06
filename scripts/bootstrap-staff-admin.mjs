import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'

// Explicit first-account bootstrap only. Never reset an existing account or
// send credentials by email; the one-time handoff stays in ignored local files.
const email = 'lnkgroupsydney@gmail.com'
const origin = 'https://xlqyafthsxallostcqfe.supabase.co'
const path = '.local/admin-onboarding.json'
if (process.argv[2] !== '--create') throw new Error('Use --create only for the authorized initial company administrator.')
if (existsSync(path)) throw new Error('A local onboarding record already exists. Review it; no account was changed.')
const env = { ...parseEnv(readFileSync('.env.local', 'utf8')), ...process.env }
if (env.NEXT_PUBLIC_SUPABASE_URL !== origin || !env.SUPABASE_SECRET_KEY) throw new Error('Approved company configuration is required.')
const client = createClient(origin, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }) },
})
let page = 1
while (true) {
  const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw new Error('Account lookup failed. No account was created.')
  if (data.users.some(user => user.email?.toLowerCase() === email)) throw new Error('The account already exists; no password or access was changed.')
  if (!data.nextPage) break
  page = data.nextPage
}
const password = `${randomBytes(24).toString('base64url')}aA7!`
mkdirSync('.local', { recursive: true, mode: 0o700 })
// Persist before sending so an ambiguous response can be recovered without
// resetting a password. This file is never included in version control.
writeFileSync(path, JSON.stringify({ email, temporaryPassword: password, createdAt: new Date().toISOString(), status: 'creation_pending' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
const { data, error } = await client.auth.admin.createUser({
  email, password, email_confirm: true,
  app_metadata: { lk_staff: { company_id: 'lk-group', role: 'owner', status: 'active' }, lk_staff_password_change_required: true },
})
if (error || !data.user) throw new Error('Creation was not confirmed. Check the account and local onboarding record before retrying.')
writeFileSync(path, JSON.stringify({ email, temporaryPassword: password, userId: data.user.id, createdAt: data.user.created_at, status: 'password_change_required' }, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ created: true, email, userId: data.user.id, credentialsFile: path, passwordChangeRequired: true, mfaRequired: true }))
