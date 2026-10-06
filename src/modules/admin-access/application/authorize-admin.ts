import type { AdminAccessInput, AdminMembership, AuthorizedAdmin, VerifiedAdminSession } from '../domain/contracts.ts'
import { AdminAccessError } from '../domain/errors.ts'
import { assertAdminAccessInput, assertAdminMembershipAccess, assertVerifiedAdminSession } from '../domain/policy.ts'

export interface AdminAccessPorts {
  /** Verify with the identity provider on each request; never trust decode-only claims. */
  verifySession(): Promise<VerifiedAdminSession | null>
  /** Read current server-owned membership on each authorization; do not cache grants. */
  findMembership(input: { userId: string; companyId: string }): Promise<AdminMembership | null>
  now(): number
}

/** companyId, permission and clock are server inputs, not request payload claims. */
export async function authorizeAdmin(ports: AdminAccessPorts, input: AdminAccessInput): Promise<AuthorizedAdmin> {
  let verified: VerifiedAdminSession | null
  try {
    verified = await ports.verifySession()
  } catch {
    throw new AdminAccessError('ACCESS_UNAVAILABLE')
  }
  // Authentication must fail before the membership repository can be queried.
  if (!verified) throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  let now: number
  try {
    now = ports.now()
  } catch {
    throw new AdminAccessError('ACCESS_UNAVAILABLE')
  }
  const session = assertVerifiedAdminSession(verified, now)
  const access = assertAdminAccessInput(input)
  let membership: AdminMembership | null
  try {
    membership = await ports.findMembership({ userId: session.userId, companyId: access.companyId })
  } catch {
    throw new AdminAccessError('ACCESS_UNAVAILABLE')
  }
  // A slow membership lookup must not make an expired session usable.
  try {
    now = ports.now()
  } catch {
    throw new AdminAccessError('ACCESS_UNAVAILABLE')
  }
  assertVerifiedAdminSession(session, now)
  return assertAdminMembershipAccess(session, membership, access)
}
