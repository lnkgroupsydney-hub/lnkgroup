import { AppError } from '../domain/validation.ts'

export const GOOGLE_FAILURE_CODES = [
  'google_reconnect_required', 'google_temporary', 'google_configuration',
  'google_permission_denied', 'google_invalid_response', 'google_not_connected',
  'google_connection_changed',
] as const
export type GoogleFailureCode = typeof GOOGLE_FAILURE_CODES[number]
export type GoogleHealthCode = GoogleFailureCode | 'unverified' | 'ready' | 'partial'

const messages: Record<GoogleFailureCode, string> = {
  google_reconnect_required: 'Google permissions need renewal; reconnect the company account',
  google_temporary: 'Google is temporarily unavailable; retry later',
  google_configuration: 'Review Google API and OAuth client configuration',
  google_permission_denied: 'Google denied access; review the selected resource and company permissions',
  google_invalid_response: 'Google returned an invalid response; retry or review the integration',
  google_not_connected: 'Connect the approved company Google account',
  google_connection_changed: 'Google connection changed; retry the operation',
}

export class GoogleIntegrationError extends AppError {
  readonly code: GoogleFailureCode
  readonly retryable: boolean
  constructor(code: GoogleFailureCode) {
    super(code === 'google_connection_changed' ? 409 : code === 'google_reconnect_required' || code === 'google_permission_denied' ? 403 : code === 'google_invalid_response' ? 502 : 503, messages[code])
    this.name = 'GoogleIntegrationError'
    this.code = code
    this.retryable = code === 'google_temporary' || code === 'google_connection_changed'
  }
}

export function googleFailure(error: unknown): GoogleIntegrationError {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code)
    if (GOOGLE_FAILURE_CODES.includes(code as GoogleFailureCode)) return new GoogleIntegrationError(code as GoogleFailureCode)
    if (code === 'unauthorized') return new GoogleIntegrationError('google_reconnect_required')
    if (code === 'forbidden') return new GoogleIntegrationError('google_permission_denied')
    if (['rate_limited', 'server_error', 'network_error'].includes(code)) return new GoogleIntegrationError('google_temporary')
    if (['invalid_response', 'payload_too_large', 'gmail_invalid_page_token'].includes(code)) return new GoogleIntegrationError('google_invalid_response')
  }
  if (error instanceof AppError && error.status === 409) return new GoogleIntegrationError('google_connection_changed')
  return new GoogleIntegrationError('google_temporary')
}

// Only provider error identifiers are examined; descriptions and request data are never returned.
export async function googleResponseFailure(response: Response, tokenEndpoint = false): Promise<GoogleIntegrationError> {
  let code = '', reasons: string[] = []
  try {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing response')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 16384) { await reader.cancel(); throw new Error('Oversized response') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as { error?: string | { status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }
    if (typeof body.error === 'string') code = body.error
    else if (body.error && typeof body.error === 'object') {
      code = body.error.status || ''
      reasons = [...(body.error.errors || []), ...(body.error.details || [])].map(entry => entry.reason || '')
    }
  } catch { /* Unreadable provider errors stay bounded and generic. */ }
  if (response.status === 429 || response.status >= 500 || reasons.some(reason => ['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'RATE_LIMIT_EXCEEDED', 'RESOURCE_EXHAUSTED'].includes(reason))) return new GoogleIntegrationError('google_temporary')
  if ((tokenEndpoint && ['invalid_client', 'unauthorized_client', 'unsupported_grant_type', 'invalid_request'].includes(code)) || reasons.some(reason => ['accessNotConfigured', 'SERVICE_DISABLED', 'API_KEY_INVALID'].includes(reason))) return new GoogleIntegrationError('google_configuration')
  if (code === 'invalid_grant' || response.status === 401 || reasons.some(reason => ['authError', 'insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'].includes(reason))) return new GoogleIntegrationError('google_reconnect_required')
  if (response.status === 403) return new GoogleIntegrationError('google_permission_denied')
  return new GoogleIntegrationError('google_invalid_response')
}
