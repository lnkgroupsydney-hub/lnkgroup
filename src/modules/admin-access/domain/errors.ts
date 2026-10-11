const errors = {
  AUTHENTICATION_REQUIRED: { status: 401, message: 'Sign in to continue.' },
  ACCESS_DENIED: { status: 403, message: 'You do not have access to this resource.' },
  MFA_REQUIRED: { status: 403, message: 'Complete multi-factor authentication to continue.' },
  EMAIL_VERIFICATION_REQUIRED: { status: 403, message: 'Verify the code sent to your administrator email to continue.' },
  ACCESS_UNAVAILABLE: { status: 503, message: 'Administrator access is temporarily unavailable.' },
  STAFF_ORIGIN_DENIED: { status: 403, message: 'Administrator access is not available from this address.' },
  LOCAL_PREVIEW_UNAVAILABLE: { status: 503, message: 'Local administrator preview is unavailable.' },
  LOCAL_PREVIEW_ORIGIN_DENIED: { status: 403, message: 'Local administrator preview is not available at this address.' },
} as const

export type AdminAccessErrorCode = keyof typeof errors

/** Fixed messages deliberately exclude provider errors, account IDs and secrets. */
export class AdminAccessError extends Error {
  readonly code: AdminAccessErrorCode
  readonly status: 401 | 403 | 503

  constructor(code: AdminAccessErrorCode) {
    super(errors[code].message)
    this.name = 'AdminAccessError'
    this.code = code
    this.status = errors[code].status
  }
}
