import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

type Capture = { calls: number; options?: { cookieOptions: { secure: boolean; httpOnly: boolean; name: string }; cookies: { setAll(values: unknown[], headers: Record<string, string>): void } } }
const state: Capture = { calls: 0 }
Object.assign(globalThis, { __lkMiddlewareTest: state })
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/server') return next('next/server.js', context)
    if (specifier === '@supabase/ssr') return { url: 'lk-test:middleware-ssr', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url !== 'lk-test:middleware-ssr') return next(url, context)
    return { format: 'module', shortCircuit: true, source: `export function createServerClient(url,key,options) {
      const state=globalThis.__lkMiddlewareTest;state.calls++;state.options=options;
      return {auth:{async getClaims(){options.cookies.setAll([{name:'lk-staff-auth',value:'synthetic-refreshed',options:options.cookieOptions}],{'cache-control':'private, no-store'});return {data:{claims:{}}};}}};
    }` }
  },
})
const { NextRequest } = await import('next/server.js')
const { updateSession } = await import('./middleware.ts')
const keys = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'STAFF_ADMIN_AUTH_ENABLED', 'APP_BASE_URL', 'LOCAL_OPERATIONS_ENABLED']
const old = new Map(keys.map(key => [key, process.env[key]]))
beforeEach(() => {
  state.calls = 0; delete state.options
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public'
  process.env.STAFF_ADMIN_AUTH_ENABLED = 'true'
  process.env.LOCAL_OPERATIONS_ENABLED = 'false'
  process.env.APP_BASE_URL = 'https://www.lnkgroupsydney.com.au'
})
after(() => {
  hook.deregister()
  delete (globalThis as Record<string, unknown>).__lkMiddlewareTest
  for (const [key,value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})

test('HTTPS staff refresh preserves Secure, HttpOnly and the isolated staff cookie', async () => {
  const response = await updateSession(new NextRequest('https://www.lnkgroupsydney.com.au/admin', { headers: { host: 'www.lnkgroupsydney.com.au' } }))
  assert.equal(state.calls, 1)
  assert.match(response.headers.get('set-cookie') ?? '', /Secure/i)
  assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/i)
  assert.match(response.headers.get('set-cookie') ?? '', /lk-staff-auth=/)
  assert.doesNotMatch(response.headers.get('set-cookie') ?? '', /Domain=/i)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('an unapproved alias or forged proxy header does not refresh staff credentials', async () => {
  for (const [url, headers] of [
    ['https://foreign.invalid/admin', { host: 'foreign.invalid' }],
    ['https://www.lnkgroupsydney.com.au/admin', { host: 'www.lnkgroupsydney.com.au', 'x-forwarded-host': 'foreign.invalid' }],
  ] as const) {
    const response = await updateSession(new NextRequest(url, { headers }))
    assert.equal(response.headers.get('set-cookie'), null)
  }
  assert.equal(state.calls, 0)
})

test('the explicitly enabled loopback development session remains usable', async () => {
  process.env.APP_BASE_URL = 'http://127.0.0.1:3002'
  process.env.LOCAL_OPERATIONS_ENABLED = 'true'
  const response = await updateSession(new NextRequest('http://127.0.0.1:3002/admin', { headers: { host: '127.0.0.1:3002' } }))
  assert.equal(state.calls, 1)
  assert.doesNotMatch(response.headers.get('set-cookie') ?? '', /Secure/i)
})
