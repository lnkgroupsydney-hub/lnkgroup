import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto'
import { AdminAccessError } from '../domain/errors.ts'
import { staffMailSender } from '../../../shared/email/company-sender.ts'

const INITIAL_ADMIN_EMAIL = 'lnkgroupsydney@gmail.com'
export type EmailVerificationState = {
  challengeId: string; sent: boolean; expiresAt: number; retryAt: number; verifiedUntil: number | null;
}

export function emailVerificationEnabled() {
  const mode = process.env.STAFF_ADMIN_SECOND_STEP ?? 'totp'
  if (mode !== 'email' && mode !== 'totp') throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return mode === 'email'
}

export function staffEmailAddress(value: unknown) {
  if (typeof value !== 'string' || value.trim().toLowerCase() !== INITIAL_ADMIN_EMAIL) throw new AdminAccessError('ACCESS_DENIED')
  return INITIAL_ADMIN_EMAIL
}
export const staffEmailHash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

export function parseEmailVerification(value: unknown): EmailVerificationState | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  const row = value as Record<string, unknown>
  if (typeof row.challengeId !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.challengeId) || typeof row.sent !== 'boolean'
    || !Number.isSafeInteger(row.expiresAt) || Number(row.expiresAt) < 0 || !Number.isSafeInteger(row.retryAt) || Number(row.retryAt) < 0
    || !(row.verifiedUntil === null || (Number.isSafeInteger(row.verifiedUntil) && Number(row.verifiedUntil) >= 0))) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return row as EmailVerificationState
}

export function staffEmailCodeHash(input: { tokenHash: string; userId: string; emailHash: string; challengeId: string; code: string }) {
  const secret = process.env.STAFF_EMAIL_OTP_SECRET
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify(['lk-staff-email-v1', input.tokenHash, input.userId, input.emailHash, input.challengeId, input.code])).digest('hex')
}

export function newStaffEmailCode() {
  return { challengeId: randomUUID(), code: String(randomInt(0, 1_000_000)).padStart(6, '0') }
}

export async function sendStaffEmailCode(input: { email: string; challengeId: string; code: string }) {
  const email = staffEmailAddress(input.email)
  const key = process.env.RESEND_API_KEY
  if (!key) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  let sender: ReturnType<typeof staffMailSender>
  try {
    sender = staffMailSender({ companyFrom: process.env.COMPANY_EMAIL_FROM,
      companyReplyTo: process.env.COMPANY_EMAIL_REPLY_TO, legacyDemoFrom: process.env.RESEND_FROM_EMAIL })
  } catch { throw new AdminAccessError('ACCESS_UNAVAILABLE') }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', 'idempotency-key': `lk-staff-email:${input.challengeId}` },
    body: JSON.stringify({ from: sender.from, ...(sender.replyTo ? { reply_to: sender.replyTo } : {}), to: [email], subject: 'L&K Group EMS sign-in code',
      text: `Your L&K Group EMS verification code is: ${input.code}\n\nEnter this code in the administrator sign-in screen. It expires in 10 minutes and can be used once. Only the newest code works.\n\nIf you did not request this code, you can ignore this message. Never share the code with anyone.` }),
  })
  if (!response.ok) throw new AdminAccessError('ACCESS_UNAVAILABLE')
  const result: unknown = await response.json()
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !/^[a-z0-9_-]{1,160}$/i.test(result.id)) throw new AdminAccessError('ACCESS_UNAVAILABLE')
}
