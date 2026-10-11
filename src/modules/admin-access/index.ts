export { authorizeAdmin } from './application/authorize-admin.ts'
export type { AdminAccessPorts } from './application/authorize-admin.ts'
export { AdminAccessError } from './domain/errors.ts'
export type { AdminAccessErrorCode } from './domain/errors.ts'
export { assertLocalPreviewAccess, assertLocalPreviewRequest } from './domain/local-preview.ts'
export { configuredStaffOrigin } from './domain/staff-transport.ts'
export type {
  AdminAccessInput,
  AdminMembership,
  AdminPermission,
  AuthorizedAdmin,
  LocalPreviewAccessInput,
  LocalPreviewRequest,
  LocalPreviewSession,
  VerifiedAdminSession,
} from './domain/contracts.ts'
