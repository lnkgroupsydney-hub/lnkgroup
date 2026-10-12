import test, { after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { staffMailSender } from './company-sender.ts'
import { sendStaffEmailCode } from '../../modules/admin-access/infrastructure/email-verification.ts'

const originalFetch = globalThis.fetch
const envKeys = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'COMPANY_EMAIL_FROM', 'COMPANY_EMAIL_REPLY_TO']
const previous = new Map(envKeys.map(key => [key, process.env[key]]))
beforeEach(() => {
  process.env.RESEND_API_KEY = 'synthetic-private-key'
  process.env.RESEND_FROM_EMAIL = 'L&K Demo <onboarding@resend.dev>'
  delete process.env.COMPANY_EMAIL_FROM
  delete process.env.COMPANY_EMAIL_REPLY_TO
  globalThis.fetch = async () => { throw new Error('Unexpected external request') }
})
after(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
})

test('verified company sender does not alter the company-only demo sender', () => {
  assert.deepEqual(staffMailSender({ companyFrom: 'L&K Group <quotes@lnkgroupsydney.com.au>' }), {
    from: 'L&K Group <quotes@lnkgroupsydney.com.au>', replyTo: 'lnkgroupsydney@gmail.com',
  })
  assert.deepEqual(staffMailSender({ legacyDemoFrom: 'L&K Demo <onboarding@resend.dev>' }), { from: 'L&K Demo <onboarding@resend.dev>' })
})

test('invalid live sender fails closed instead of falling back to a trial sender', () => {
  for (const companyFrom of ['', 'a@example.com', 'a@lnkgroupsydney.com.au.attacker.invalid',
    'L&K <a@lnkgroupsydney.com.au>\r\nBcc: other@example.com', 'a@lnkgroupsydney.com.au>',
    'L&K <a@lnkgroupsydney.com.au', 'a@lnkgroupsydney.com.au,b@example.com']) {
    assert.throws(() => staffMailSender({ companyFrom, legacyDemoFrom: 'onboarding@resend.dev' }))
  }
  assert.throws(() => staffMailSender({ companyFrom: 'quotes@lnkgroupsydney.com.au', companyReplyTo: 'other@example.com' }))
})

test('staff code uses the verified From and Reply-To, fixed recipient and stable idempotency key', async () => {
  process.env.COMPANY_EMAIL_FROM = 'L&K Group <quotes@lnkgroupsydney.com.au>'
  process.env.COMPANY_EMAIL_REPLY_TO = 'lnkgroupsydney@gmail.com'
  let calls = 0
  globalThis.fetch = async (url, init) => {
    const req = new Request(url, init)
    assert.equal(req.url, 'https://api.resend.com/emails')
    assert.equal(req.headers.get('idempotency-key'), 'lk-staff-email:synthetic-challenge')
    const body = await req.json()
    assert.equal(body.from, process.env.COMPANY_EMAIL_FROM)
    assert.equal(body.reply_to, 'lnkgroupsydney@gmail.com')
    assert.deepEqual(body.to, ['lnkgroupsydney@gmail.com'])
    assert.equal(body.subject, 'L&K Group EMS sign-in code')
    assert.match(body.text, /123456/)
    calls++
    return Response.json({ id: 'synthetic-email' })
  }
  await sendStaffEmailCode({ email: 'Lnkgroupsydney@gmail.com', challengeId: 'synthetic-challenge', code: '123456' })
  assert.equal(calls, 1)
  await assert.rejects(sendStaffEmailCode({ email: 'customer@example.com', challengeId: 'synthetic-challenge', code: '123456' }))
  assert.equal(calls, 1, 'Company sender must not expand staff recipient access')
})
