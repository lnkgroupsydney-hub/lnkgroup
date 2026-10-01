import { existsSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

const path = resolve('.env.local')
if (existsSync(path)) {
  process.stdout.write('.env.local already exists; no changes made.\n')
  process.exit(0)
}
const password = randomBytes(32).toString('base64url')
const key = randomBytes(32).toString('hex')
const content = [
  'OPERATIONS_STORE=supabase',
  'NEXT_PUBLIC_SUPABASE_URL=https://xlqyafthsxallostcqfe.supabase.co',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=',
  'SUPABASE_SECRET_KEY=',
  'LOCAL_OPERATIONS_ENABLED=true',
  'APP_BASE_URL=http://127.0.0.1:3002',
  `LOCAL_OWNER_PASSWORD=${password}`,
  'GOOGLE_CLIENT_ID=',
  'GOOGLE_CLIENT_SECRET=',
  `GOOGLE_TOKEN_ENCRYPTION_KEY=${key}`,
  '',
].join('\n')
writeFileSync(path, content, { flag:'wx', mode:0o600 })
process.stdout.write('.env.local created. Open that private file to retrieve LOCAL_OWNER_PASSWORD. Add company Supabase keys and apply the migration before using operations. Add Google OAuth credentials when ready.\n')
