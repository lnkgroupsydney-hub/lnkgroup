import type { LocalPreviewAccessInput, LocalPreviewRequest, LocalPreviewSession } from './contracts.ts'
import { AdminAccessError } from './errors.ts'
import { isTimestamp } from './policy.ts'

function configuredOrigin(value: unknown): string {
  // Check raw spelling too: URL normalizes decimal/hex/short IPv4 to 127.0.0.1.
  if (typeof value !== 'string' || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::[1-9][0-9]{0,4})?\/?$/.test(value)) {
    throw new AdminAccessError('LOCAL_PREVIEW_UNAVAILABLE')
  }
  try {
    return new URL(value).origin
  } catch {
    throw new AdminAccessError('LOCAL_PREVIEW_UNAVAILABLE')
  }
}

/** The loopback exception is a local preview boundary, never staff authentication. */
export function assertLocalPreviewRequest(input: LocalPreviewRequest): void {
  if (!input || input.enabled !== true) throw new AdminAccessError('LOCAL_PREVIEW_UNAVAILABLE')
  const origin = configuredOrigin(input.configuredUrl)
  let url: URL
  try {
    if (typeof input.requestUrl !== 'string'
      || !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::[1-9][0-9]{0,4})?(?:[/?#]|$)/.test(input.requestUrl)) {
      throw new Error('Invalid local request')
    }
    url = new URL(input.requestUrl)
  } catch {
    throw new AdminAccessError('LOCAL_PREVIEW_ORIGIN_DENIED')
  }
  if (url.origin !== origin || url.username || url.password) {
    throw new AdminAccessError('LOCAL_PREVIEW_ORIGIN_DENIED')
  }
}

export function assertLocalPreviewAccess(input: LocalPreviewAccessInput): LocalPreviewSession {
  assertLocalPreviewRequest(input)
  if (!isTimestamp(input.now)) throw new AdminAccessError('LOCAL_PREVIEW_UNAVAILABLE')
  const session = input.session
  if (!session || typeof session !== 'object' || Array.isArray(session)
    || typeof session.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(session.tokenHash)
    || (session.mode !== 'local' && session.mode !== 'google')
    || !isTimestamp(session.expiresAt) || session.expiresAt <= input.now) {
    throw new AdminAccessError('AUTHENTICATION_REQUIRED')
  }
  return { tokenHash: session.tokenHash, mode: session.mode, expiresAt: session.expiresAt }
}
