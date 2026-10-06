import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AdminAccessError,
  assertLocalPreviewAccess,
  assertLocalPreviewRequest,
  authorizeAdmin,
} from './index.ts'
import type {
  AdminAccessErrorCode,
  AdminAccessInput,
  AdminAccessPorts,
  AdminMembership,
  LocalPreviewAccessInput,
  VerifiedAdminSession,
} from './index.ts'

const instant = 1_800_000_000_000
const session: VerifiedAdminSession = { userId: 'staff-1', sessionId: 'session-1', expiresAt: instant + 60_000, assurance: 'aal2' }
const membership: AdminMembership = { userId: 'staff-1', companyId: 'company-1', role: 'admin', status: 'active' }
const read: AdminAccessInput = { companyId: 'company-1', permission: 'operations.read' }

function fixture() {
  const state: { session: unknown; membership: unknown; now: number; calls: string[]; lookup: unknown } = {
    session: { ...session }, membership: { ...membership }, now: instant, calls: [], lookup: null,
  }
  const ports: AdminAccessPorts = {
    async verifySession() { state.calls.push('verify'); return state.session as VerifiedAdminSession | null },
    async findMembership(input) { state.calls.push('membership'); state.lookup = input; return state.membership as AdminMembership | null },
    now() { state.calls.push('clock'); return state.now },
  }
  return { state, ports }
}

function failure(code: AdminAccessErrorCode, status: 401 | 403 | 503) {
  return (error: unknown) => {
    assert.ok(error instanceof AdminAccessError)
    assert.equal(error.code, code)
    assert.equal(error.status, status)
    assert.doesNotMatch(error.message, /staff-1|company-1|PRIVATE_PROVIDER_SECRET/)
    assert.equal(error.cause, undefined)
    return true
  }
}

test('verified identity scopes the live membership lookup and grant', async () => {
  const { state, ports } = fixture()
  assert.deepEqual(await authorizeAdmin(ports, read), {
    userId: 'staff-1', sessionId: 'session-1', companyId: 'company-1', role: 'admin', permission: 'operations.read',
  })
  assert.deepEqual(state.lookup, { userId: 'staff-1', companyId: 'company-1' })
  assert.deepEqual(state.calls, ['verify', 'clock', 'membership', 'clock'])
})

for (const role of ['admin', 'owner'] as const) {
  for (const permission of ['operations.read', 'operations.write', 'integrations.manage', 'staff.manage'] as const) {
    test(`${role} permission boundary: ${permission}`, async () => {
      const { ports, state } = fixture()
      state.membership = { ...membership, role }
      if (role === 'admin' && (permission === 'integrations.manage' || permission === 'staff.manage')) {
        await assert.rejects(authorizeAdmin(ports, { ...read, permission }), failure('ACCESS_DENIED', 403))
      } else {
        assert.equal((await authorizeAdmin(ports, { ...read, permission })).permission, permission)
      }
    })
  }
}

test('unauthenticated request fails before clock, requested resource or membership inspection', async () => {
  const { state, ports } = fixture()
  state.session = null
  await assert.rejects(authorizeAdmin(ports, null as unknown as AdminAccessInput), failure('AUTHENTICATION_REQUIRED', 401))
  assert.deepEqual(state.calls, ['verify'])
})

test('expired, malformed and fabricated session claims cannot reach membership lookup', async () => {
  const invalidSessions: unknown[] = [
    {}, [], 'staff-1', false,
    { ...session, expiresAt: instant }, { ...session, expiresAt: instant - 1 },
    { ...session, expiresAt: Infinity }, { ...session, expiresAt: NaN },
    { ...session, expiresAt: String(instant + 60_000) },
    { ...session, userId: '' }, { ...session, userId: ' ' }, { ...session, userId: ' staff-1' },
    { ...session, userId: 1 }, { ...session, sessionId: '\t' }, { ...session, sessionId: 'session\u0000-1' },
    { ...session, assurance: 'aal3' }, { ...session, assurance: true },
    { userId: 'staff-1', email: 'owner@company.example', metadata: { role: 'owner' } },
  ]
  for (const invalid of invalidSessions) {
    const { state, ports } = fixture()
    state.session = invalid
    await assert.rejects(authorizeAdmin(ports, read), failure('AUTHENTICATION_REQUIRED', 401))
    assert.ok(!state.calls.includes('membership'), `Membership queried for ${JSON.stringify(invalid)}`)
  }
})

test('first-factor identity alone cannot use operations or query membership', async () => {
  const { state, ports } = fixture()
  state.session = { ...session, assurance: 'aal1' }
  await assert.rejects(authorizeAdmin(ports, read), failure('MFA_REQUIRED', 403))
  assert.ok(!state.calls.includes('membership'))
})

test('server-verified email proof permits the bound session without inventing aal2', async () => {
  const { state, ports } = fixture()
  state.session = { ...session, assurance: 'aal1', emailVerification: { userId: session.userId, sessionId: session.sessionId, expiresAt: instant + 30_000 } }
  assert.equal((await authorizeAdmin(ports, read)).userId, session.userId)
})

test('email proof cannot cross users, sessions, expiry or extend the authenticated session', async () => {
  for (const proof of [undefined, true, {}, { userId: 'other', sessionId: session.sessionId, expiresAt: instant + 30_000 }, { userId: session.userId, sessionId: 'other', expiresAt: instant + 30_000 }, { userId: session.userId, sessionId: session.sessionId, expiresAt: instant }, { userId: session.userId, sessionId: session.sessionId, expiresAt: session.expiresAt + 1 }]) {
    const { state, ports } = fixture()
    state.session = { ...session, assurance: 'aal1', emailVerification: proof }
    await assert.rejects(authorizeAdmin(ports, read), failure('MFA_REQUIRED', 403))
  }
})

test('email proof expiring during membership lookup is denied', async () => {
  const { state, ports } = fixture()
  state.session = { ...session, assurance: 'aal1', emailVerification: { userId: session.userId, sessionId: session.sessionId, expiresAt: instant + 100 } }
  ports.findMembership = async () => { state.now = instant + 100; return membership }
  await assert.rejects(authorizeAdmin(ports, read), failure('MFA_REQUIRED', 403))
})

test('same email, another user, another company and absent membership cannot grant access', async () => {
  for (const value of [
    null,
    { ...membership, userId: 'staff-2' },
    { ...membership, companyId: 'company-2' },
    { email: 'owner@company.example', role: 'owner', status: 'active' },
    { ...membership, role: 'customer', metadata: { role: 'owner' } },
  ]) {
    const { state, ports } = fixture()
    state.membership = value
    await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_DENIED', 403))
  }
})

test('invited, revoked and unsupported membership values fail closed', async () => {
  for (const value of [
    {}, [], 'owner',
    { ...membership, status: 'invited' }, { ...membership, status: 'revoked' },
    { ...membership, status: 'enabled' }, { ...membership, status: true },
    { ...membership, role: 'superadmin' }, { ...membership, role: '__proto__' },
    { ...membership, role: ['owner'] }, { ...membership, companyId: ' ' },
    { ...membership, userId: '\n' },
  ]) {
    const { state, ports } = fixture()
    state.membership = value
    await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_DENIED', 403))
  }
})

test('revocation and role reduction affect the very next authorization with the same verified session', async () => {
  const { state, ports } = fixture()
  state.membership = { ...membership, role: 'owner' }
  await authorizeAdmin(ports, { ...read, permission: 'staff.manage' })
  state.membership = { ...membership, role: 'admin' }
  await assert.rejects(authorizeAdmin(ports, { ...read, permission: 'staff.manage' }), failure('ACCESS_DENIED', 403))
  state.membership = { ...membership, status: 'revoked' }
  await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_DENIED', 403))
  assert.equal(state.calls.filter(call => call === 'verify').length, 3)
  assert.equal(state.calls.filter(call => call === 'membership').length, 3)
})

test('unsupported server permissions and malformed company IDs never query memberships', async () => {
  for (const input of [
    null, {}, { ...read, permission: '*' }, { ...read, permission: 'toString' },
    { ...read, permission: '__proto__' }, { ...read, permission: ['operations.read'] },
    { ...read, companyId: '' }, { ...read, companyId: ' ' }, { ...read, companyId: 'company-1 ' },
    { ...read, companyId: 1 },
  ]) {
    const { state, ports } = fixture()
    await assert.rejects(authorizeAdmin(ports, input as AdminAccessInput), failure('ACCESS_DENIED', 403))
    assert.ok(!state.calls.includes('membership'))
  }
})

test('provider verification error is unavailable and never falls back to local claims', async () => {
  const { state, ports } = fixture()
  ports.verifySession = async () => { throw new Error('PRIVATE_PROVIDER_SECRET') }
  await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_UNAVAILABLE', 503))
  assert.deepEqual(state.calls, [])
})

test('membership dependency errors are unavailable and cannot grant cached roles', async () => {
  const { ports } = fixture()
  await authorizeAdmin(ports, read)
  ports.findMembership = async () => { throw new Error('PRIVATE_PROVIDER_SECRET') }
  await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_UNAVAILABLE', 503))
})

test('invalid or failing server clocks fail closed before membership lookup', async () => {
  for (const invalid of [NaN, Infinity, -Infinity, -1, '1800000000000', null]) {
    const { state, ports } = fixture()
    state.now = invalid as number
    await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_UNAVAILABLE', 503))
    assert.ok(!state.calls.includes('membership'))
  }
  const { state, ports } = fixture()
  ports.now = () => { throw new Error('PRIVATE_PROVIDER_SECRET') }
  await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_UNAVAILABLE', 503))
  assert.ok(!state.calls.includes('membership'))
})

test('session expiration during membership lookup cannot produce a grant', async () => {
  const { state, ports } = fixture()
  ports.findMembership = async () => { state.now = session.expiresAt; return { ...membership } }
  await assert.rejects(authorizeAdmin(ports, read), failure('AUTHENTICATION_REQUIRED', 401))
})

test('a second clock failure is unavailable after membership returns', async () => {
  for (const second of [() => NaN, () => { throw new Error('PRIVATE_PROVIDER_SECRET') }]) {
    const { ports } = fixture()
    let calls = 0
    ports.now = () => ++calls === 1 ? instant : second()
    await assert.rejects(authorizeAdmin(ports, read), failure('ACCESS_UNAVAILABLE', 503))
  }
})

const preview: LocalPreviewAccessInput = {
  enabled: true, configuredUrl: 'http://127.0.0.1:3002', requestUrl: 'http://127.0.0.1:3002/api/operations',
  session: { tokenHash: 'ab'.repeat(32), mode: 'local', expiresAt: instant + 60_000 }, now: instant,
}

test('local and company Google legacy sessions remain explicitly local preview only', async () => {
  for (const mode of ['local', 'google'] as const) {
    const localSession = { ...preview.session!, mode }
    assert.deepEqual(assertLocalPreviewAccess({ ...preview, session: localSession }), localSession)
    const { state, ports } = fixture()
    state.session = localSession
    await assert.rejects(authorizeAdmin(ports, read), failure('AUTHENTICATION_REQUIRED', 401))
  }
})

test('supported loopback names and explicit default port use standard origin equality', () => {
  for (const [configuredUrl, requestUrl] of [
    ['http://localhost:3002/', 'http://localhost:3002/admin?next=bookings'],
    ['http://127.0.0.1:3002', 'http://127.0.0.1:3002/api/operations/bookings'],
    ['http://localhost:80', 'http://localhost/admin'],
  ]) assert.doesNotThrow(() => assertLocalPreviewRequest({ enabled: true, configuredUrl, requestUrl }))
})

test('disabled and malformed preview configuration fail closed before session inspection', () => {
  for (const configuredUrl of [
    undefined, '', ' ', 'https://localhost:3002', 'http://company.example', 'http://0.0.0.0:3002',
    'http://[::1]:3002', 'http://127.1:3002', 'http://2130706433:3002', 'http://0x7f000001:3002',
    'http://127.0.0.1:3002/admin', 'http://127.0.0.1:3002?key=PRIVATE_PROVIDER_SECRET',
    'http://127.0.0.1:3002#fragment', 'http://name:PRIVATE_PROVIDER_SECRET@127.0.0.1:3002',
    'http://127.0.0.1:99999', ' http://127.0.0.1:3002', 'http://localhost.:3002',
  ]) assert.throws(() => assertLocalPreviewAccess({ ...preview, configuredUrl, session: null }), failure('LOCAL_PREVIEW_UNAVAILABLE', 503))
  for (const enabled of [false, undefined, 'true', 1]) {
    assert.throws(() => assertLocalPreviewAccess({ ...preview, enabled: enabled as boolean }), failure('LOCAL_PREVIEW_UNAVAILABLE', 503))
  }
})

test('public hosts, spoofed loopback names, alternate ports and userinfo cannot use preview', () => {
  for (const requestUrl of [
    'https://127.0.0.1:3002/admin', 'http://127.0.0.1:3003/admin', 'http://127.0.0.1/admin',
    'http://localhost:3002/admin', 'http://127.0.0.1.evil.example:3002/admin',
    'http://127.0.0.1:3002@evil.example/admin', 'http://127.0.0.1@127.0.0.1:3002/admin',
    'http://127.1:3002/admin', 'http://2130706433:3002/admin',
    'http://0x7f000001:3002/admin', 'http://[::1]:3002/admin',
    'http://127.0.0.1.:3002/admin', 'http://127.0.0.1:3002\\@evil.example/admin',
    '/admin', 'not a url', '',
  ]) assert.throws(() => assertLocalPreviewAccess({ ...preview, requestUrl }), failure('LOCAL_PREVIEW_ORIGIN_DENIED', 403))
})

test('null, expired and malformed preview sessions fail authentication', () => {
  for (const value of [
    null, {}, [], 'session',
    { ...preview.session, expiresAt: instant }, { ...preview.session, expiresAt: instant - 1 },
    { ...preview.session, expiresAt: Infinity }, { ...preview.session, expiresAt: NaN },
    { ...preview.session, expiresAt: String(instant + 60_000) },
    { ...preview.session, tokenHash: '' }, { ...preview.session, tokenHash: 'ab'.repeat(31) },
    { ...preview.session, tokenHash: 'AB'.repeat(32) }, { ...preview.session, tokenHash: 'z'.repeat(64) },
    { ...preview.session, mode: 'owner' }, { ...preview.session, mode: undefined },
  ]) assert.throws(() => assertLocalPreviewAccess({ ...preview, session: value as LocalPreviewAccessInput['session'] }), failure('AUTHENTICATION_REQUIRED', 401))
})

test('malformed preview clocks do not preserve a legacy grant', () => {
  for (const now of [NaN, Infinity, -1, '1800000000000']) {
    assert.throws(() => assertLocalPreviewAccess({ ...preview, now: now as number }), failure('LOCAL_PREVIEW_UNAVAILABLE', 503))
  }
})
