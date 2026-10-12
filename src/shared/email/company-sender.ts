/** Company sending domain verified in Resend. Demo delivery has its own policy. */
const COMPANY_DOMAIN = 'lnkgroupsydney.com.au'
const COMPANY_REPLY_TO = 'lnkgroupsydney@gmail.com'

export type CompanyMailSender = { from: string; replyTo?: string }

export function staffMailSender(input: {
  companyFrom?: string; companyReplyTo?: string; legacyDemoFrom?: string;
}): CompanyMailSender {
  if (input.companyFrom !== undefined) {
    const from = input.companyFrom.trim()
    if (!from || from.length > 254 || /[\r\n\x00]/.test(from)) throw new Error('Company email sender is not configured.')
    const match = /^(?:[^<>\r\n]{1,100}\s*<)?([a-z0-9][a-z0-9._+-]{0,63}@lnkgroupsydney\.com\.au)>?$/i.exec(from)
    if (!match || from.includes('<') !== from.endsWith('>') || match[1].split('@')[1].toLowerCase() !== COMPANY_DOMAIN) throw new Error('Company email sender is not configured.')
    const replyTo = input.companyReplyTo ?? COMPANY_REPLY_TO
    if (replyTo.trim().toLowerCase() !== COMPANY_REPLY_TO || /[\r\n\x00]/.test(replyTo)) throw new Error('Company email reply address is not configured.')
    return { from, replyTo: COMPANY_REPLY_TO }
  }
  // Retain the explicitly configured company-only trial sender for local tests
  // and older deployments. Never fall back after invalid live configuration.
  const from = input.legacyDemoFrom
  if (!from || !/^(?:onboarding@resend\.dev|[^<>\r\n]{1,100}<onboarding@resend\.dev>)$/i.test(from)) throw new Error('Company email sender is not configured.')
  return { from }
}
