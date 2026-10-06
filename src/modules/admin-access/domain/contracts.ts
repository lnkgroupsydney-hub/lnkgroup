export type AdminPermission =
  | 'operations.read'
  | 'operations.write'
  | 'integrations.manage'
  | 'staff.manage'

/** Supplied only by a server-side session verifier, never decoded client claims. */
export interface VerifiedAdminSession {
  userId: string
  sessionId: string
  expiresAt: number
  assurance: 'aal1' | 'aal2'
  /** Application email check, distinct from the identity provider's MFA level. */
  emailVerification?: { userId: string; sessionId: string; expiresAt: number }
}

/** Current server-owned membership; email domains and JWT metadata are not roles. */
export interface AdminMembership {
  userId: string
  companyId: string
  role: 'admin' | 'owner'
  status: 'active' | 'invited' | 'revoked'
}

export interface AdminAccessInput {
  companyId: string
  permission: AdminPermission
}

export interface AuthorizedAdmin {
  userId: string
  companyId: string
  sessionId: string
  role: AdminMembership['role']
  permission: AdminPermission
}

export interface LocalPreviewRequest {
  enabled: boolean
  configuredUrl: string | undefined
  requestUrl: string
}

export interface LocalPreviewSession {
  tokenHash: string
  mode: 'local' | 'google'
  expiresAt: number
}

export interface LocalPreviewAccessInput extends LocalPreviewRequest {
  session: LocalPreviewSession | null
  now: number
}
