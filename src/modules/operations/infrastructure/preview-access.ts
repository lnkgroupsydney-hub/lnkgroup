import { AdminAccessError, assertLocalPreviewAccess, assertLocalPreviewRequest } from '../../admin-access/index.ts'
import { localPreviewContext } from '../../admin-access/request.ts'
import { AppError } from '../domain/validation.ts'

/** Existing company-demo access only; this never creates a staff/MFA principal. */
export function requireLocalPreviewRequest(req: Request): void {
  try {
    assertLocalPreviewRequest(localPreviewContext(req))
  }
  catch (error) {
    if (error instanceof AdminAccessError) throw new AppError(error.status, error.message)
    throw error
  }
}

export function localPreviewRequestAllowed(req: Request): boolean {
  try { requireLocalPreviewRequest(req); return true }
  catch (error) { if (error instanceof AppError) return false; throw error }
}

export function localPreviewSessionActive(req: Request, session: {
  tokenHash: string; mode: 'local' | 'google'; expiresAt: number;
}): boolean {
  try {
    assertLocalPreviewAccess({ ...localPreviewContext(req), session, now: Date.now() })
    return true
  } catch (error) {
    if (error instanceof AdminAccessError) return false
    throw error
  }
}
