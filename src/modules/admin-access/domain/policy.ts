import type {
  AdminAccessInput,
  AdminMembership,
  AdminPermission,
  AuthorizedAdmin,
  VerifiedAdminSession,
} from './contracts.ts'
import { AdminAccessError } from './errors.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\s\u0000-\u001f\u007f]/.test(value)
}

export function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPermission(value: unknown): value is AdminPermission {
  return value === 'operations.read' || value === 'operations.write'
    || value === 'integrations.manage' || value === 'staff.manage'
}

export function assertVerifiedAdminSession(value: unknown, now: unknown): VerifiedAdminSession {
  if (!isTimestamp(now)) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  if (!isRecord(value) || !isIdentifier(value.userId) || !isIdentifier(value.sessionId)
    || !isTimestamp(value.expiresAt) || value.expiresAt <= now
    || (value.assurance !== 'aal1' && value.assurance !== 'aal2')) {
    throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  }
  const proof = value.emailVerification
  const emailVerification = isRecord(proof) && proof.userId === value.userId && proof.sessionId === value.sessionId
    && isTimestamp(proof.expiresAt) && proof.expiresAt > now && proof.expiresAt <= value.expiresAt
    ? { userId: value.userId, sessionId: value.sessionId, expiresAt: proof.expiresAt } : undefined
  if (value.assurance !== 'aal2' && !emailVerification) throw new AdminAccessError('MFA_REQUIRED')
  return { userId: value.userId, sessionId: value.sessionId, expiresAt: value.expiresAt, assurance: value.assurance, ...(emailVerification ? { emailVerification } : {}) }
}

export function assertAdminAccessInput(value: unknown): AdminAccessInput {
  if (!isRecord(value) || !isIdentifier(value.companyId) || !isPermission(value.permission)) {
    throw new AdminAccessError('ACCESS_DENIED')
  }
  return { companyId: value.companyId, permission: value.permission }
}

export function assertAdminMembershipAccess(
  session: VerifiedAdminSession,
  value: unknown,
  input: AdminAccessInput,
): AuthorizedAdmin {
  // Do not coerce, default or infer roles from unrelated identity attributes.
  if (!isRecord(value) || !isIdentifier(value.userId) || !isIdentifier(value.companyId)
    || value.userId !== session.userId || value.companyId !== input.companyId
    || (value.role !== 'admin' && value.role !== 'owner') || value.status !== 'active') {
    throw new AdminAccessError('ACCESS_DENIED')
  }
  const role: AdminMembership['role'] = value.role
  if (role === 'admin' && input.permission !== 'operations.read' && input.permission !== 'operations.write') {
    throw new AdminAccessError('ACCESS_DENIED')
  }
  return { userId: session.userId, companyId: input.companyId, sessionId: session.sessionId, role, permission: input.permission }
}
