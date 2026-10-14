import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib'
import { staffMailSender, type CompanyMailSender } from '../../../shared/email/company-sender.ts'
import { BOOKING_SIMPLE_ACK_VERSION, isBookingAcknowledgment, parseBookingSignature, type LiveBookingSubmission } from '../domain/booking-flow.ts'
import { validateEstimatePricing } from '../domain/pricing.ts'
import { quotePricingDisplay, NO_GST_NOTICE } from '../domain/pricing-display.ts'

export interface LiveBookingEmailPayload extends Record<string, unknown> {
  from: string; reply_to: string; to: [string]; subject: string; text: string; html: string
  attachments: [{ filename: string; content: string }]
}
export interface FrozenBookingReceipt {
  pdfBase64: string; pdfHash: string; payload: LiveBookingEmailPayload
}
export const MAX_BOOKING_EMAIL_BYTES = 1_000_000
const HASH = /^[a-f0-9]{64}$/
const email = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value)
let fontBytes: Promise<Uint8Array> | undefined
const fontData = () => fontBytes ??= readFile(join(process.cwd(), 'src/shared/assets/pdf-fonts/LKDemoSans-Regular.ttf')).catch(error => { fontBytes = undefined; throw error })

export function validateReceiptSource(source: LiveBookingSubmission): void {
  const s = source.snapshot
  if (!s || s.mode !== 'live' || s.kind !== 'nonbinding_booking_request' || s.version !== s.acknowledgment?.version ||
      !isBookingAcknowledgment(s.version, s.acknowledgment.text) ||
      !HASH.test(source.snapshotHash) || !HASH.test(source.signedContentHash) || !Number.isFinite(Date.parse(source.submittedAt)) || !/^[A-Z0-9-]{1,80}$/.test(source.reference) ||
      !email(s.verifiedEmail) || s.verifiedEmail !== s.payload.contact.email || s.preferredDate !== source.preferredDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(source.preferredDate) || !Array.isArray(s.photos) || s.photos.length > 8 ||
      s.photos.some(photo => !HASH.test(photo.contentHash) || !/^[a-zA-Z0-9_-]{1,100}$/.test(photo.id))) throw new Error('Invalid frozen booking request')
  if (s.version === BOOKING_SIMPLE_ACK_VERSION) {
    if (typeof source.preferredTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(source.preferredTime) || s.preferredTime !== source.preferredTime) throw new Error('The signed take-off time is invalid')
  } else if (s.preferredTime != null || source.preferredTime != null) throw new Error('A legacy request cannot acquire an unsigned take-off time')
  const pricing = validateEstimatePricing(s.pricing)
  if (pricing.status !== 'provisional_estimate' || pricing.total === null) throw new Error('A frozen provisional estimate is required')
  parseBookingSignature(source.signature)
}

/** One private, deterministic receipt. The source is the frozen submission, never a current request. */
export async function createBookingReceiptPdf(source: LiveBookingSubmission): Promise<{ bytes: Uint8Array; sha256: string; filename: string }> {
  if (typeof window !== 'undefined') throw new Error('Booking receipts are server-only')
  validateReceiptSource(source)
  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await fontData(), { subset: true })
  const supported = new Set(font.getCharacterSet())
  const safe = (value: unknown) => Array.from(String(value ?? 'Not specified').replace(/\r\n?/g, '\n').replace(/\t/g, '  ')).map(char => {
    const code = char.codePointAt(0)!
    return char === '\n' || supported.has(code) ? char : `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`
  }).join('')
  const date = new Date(source.submittedAt)
  pdf.setCreationDate(date); pdf.setModificationDate(date)
  pdf.setCreator(`L&K Group booking request receipt ${source.snapshot.version === BOOKING_SIMPLE_ACK_VERSION ? 'v2' : 'v1'}`); pdf.setProducer('L&K Group')
  pdf.setTitle(`Booking request receipt - ${source.reference}`)
  pdf.setSubject('Nonbinding booking request. Pending company confirmation. No payment is due.')
  const width = 595.28, height = 841.89, margin = 46, contentWidth = width - margin * 2
  const ink = rgb(.09, .15, .12), muted = rgb(.32, .37, .34)
  let page: PDFPage, y = 0
  const addPage = () => {
    page = pdf.addPage([width, height]); y = height - 50
    page.drawText('L&K GROUP / BOOKING REQUEST RECEIPT', { x: margin, y, size: 10, font, color: muted }); y -= 28
  }
  const need = (space: number) => { if (y - space < 65) addPage() }
  const line = (value: string, size: number) => {
    need(size + 6); page.drawText(value, { x: margin, y, size, font, color: ink }); y -= size + 6
  }
  const paragraph = (value: unknown, size = 10) => {
    for (const part of safe(value).split('\n')) {
      let pending = ''
      for (const char of part) {
        if (pending && font.widthOfTextAtSize(pending + char, size) > contentWidth) {
          const space = pending.lastIndexOf(' ')
          if (space > pending.length / 2) { line(pending.slice(0, space), size); pending = pending.slice(space + 1) }
          else { line(pending, size); pending = '' }
        }
        pending += char
      }
      line(pending || ' ', size)
    }
  }
  const field = (label: string, value: unknown) => { need(38); paragraph(label.toUpperCase(), 8); paragraph(value === '' || value == null ? 'Not specified' : value); y -= 5 }
  const money = (cents: number) => `AUD ${(cents / 100).toFixed(2)}`
  addPage()
  paragraph('Booking request received', 21); y -= 8
  paragraph('NONBINDING REQUEST - Pending company confirmation. This does not reserve the date, authorise work, create a contract or require payment.', 11); y -= 12
  const s = source.snapshot, contact = s.payload.contact, service = s.payload.service!, pricing = s.pricing
  field('Request / submission', `${source.reference} / ${source.id}`)
  field('Submitted and acknowledged (Sydney)', new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'long', timeZone: 'Australia/Sydney' }).format(date))
  field('Customer', contact.name)
  field('Verified email / phone', [s.verifiedEmail, contact.phone].filter(Boolean).join(' / '))
  field('Site address', [contact.siteAddress, contact.suburb, contact.postcode].filter(Boolean).join(', '))
  field('Project details', contact.details)
  field('Service', 'Kitchen Cabinet Painting - existing cabinets')
  field('Requested work / surfaces', `${service.intent} / ${service.surfaces.join(', ')}`)
  field('Material / colour preference', [service.material, service.colourPreference].filter(Boolean).join(' / '))
  if (s.version === BOOKING_SIMPLE_ACK_VERSION) field('Requested take-off date and time (Sydney; not reserved)', `${source.preferredDate} ${source.preferredTime}`)
  else field('Preferred start date (not reserved)', source.preferredDate)
  paragraph('Frozen provisional painting estimate', 15); y -= 6
  for (const item of pricing.lineItems) field(item.label, `${item.quantity} x ${money(item.unitAmount)} = ${money(item.amount)}`)
  if (quotePricingDisplay(pricing.pricingVersion).includesGst) field('Subtotal / GST / total', `${money(pricing.subtotal!)} / ${money(pricing.tax!)} / ${money(pricing.total!)}`)
  else { field('Estimated total (AUD)', money(pricing.total!)); field('GST', NO_GST_NOTICE) }
  field('Pricing basis', `${pricing.pricingVersion}; AI estimated doors ${pricing.basis!.doors}, drawer fronts ${pricing.basis!.drawers}; ${pricing.basis!.extent}`)
  field('Estimate notice', pricing.notice)
  const scope = s.analysis.estimateScope as { assumptions?: unknown; description?: unknown } | undefined
  if (scope?.description) field('Photo scope', scope.description)
  if (Array.isArray(scope?.assumptions)) field('Scope assumptions', scope.assumptions.join('\n'))
  field('Site confirmation / limitations', pricing.reviewReasons.join('\n'))
  field('Excluded work', pricing.exclusions.length ? pricing.exclusions.map(item => `${item.description}${item.damageIds.length ? ` (Evidence: ${item.damageIds.join(', ')})` : ''}`).join('\n') : 'No additional exclusions were listed in the saved estimate. Hidden conditions and final scope still require site confirmation.')
  field('Saved analysis / input revision', `${s.analysisId} / ${s.inputRevision}`)
  if (typeof s.inputSnapshot?.sourceHash === 'string' && HASH.test(s.inputSnapshot.sourceHash)) field('Saved source content SHA-256', s.inputSnapshot.sourceHash)
  // Only identifiers and content hashes are exported; object paths and private URLs stay in the DB.
  field('Photo evidence', `${s.photos.length} private photos. Photo files and private access URLs are not attached.`)
  for (const photo of s.photos) field('Photo identifier / role / content SHA-256', `${photo.id} / ${photo.role}\n${photo.contentHash}`)
  need(250)
  paragraph('Booking request acknowledgment', 15); y -= 5
  paragraph(s.acknowledgment.text); y -= 8
  field('Acknowledgment version', s.acknowledgment.version)
  field('Signed name / method', `${source.signature.name} / ${source.signature.method ?? 'drawn'}`)
  if (source.signature.strokes.length) {
    need(145)
    const boxY = y - 110
    page!.drawRectangle({ x: margin, y: boxY, width: contentWidth, height: 100, borderWidth: .6, borderColor: muted })
    for (const stroke of source.signature.strokes) for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1], b = stroke[i]
      page!.drawLine({ start: { x: margin + 8 + a.x * (contentWidth - 16), y: boxY + 8 + (1 - a.y) * 84 }, end: { x: margin + 8 + b.x * (contentWidth - 16), y: boxY + 8 + (1 - b.y) * 84 }, thickness: 1.3, color: ink })
    }
    y = boxY - 20
  }
  field('Frozen snapshot SHA-256', source.snapshotHash)
  field('Signed content SHA-256 (snapshot and signature)', source.signedContentHash)
  paragraph(s.version === BOOKING_SIMPLE_ACK_VERSION ? 'The company will confirm your take-off appointment and assign the installation appointment by email. More extensive damage may increase the price after an on-site inspection; additional work and cost will be discussed before proceeding. No payment is due.' : 'Exact quantities, repairs, final price, duration and legal terms require a later company proposal and separate acceptance. No payment is due.', 9)
  paragraph('Unsupported font characters appear as [U+code point]. Original saved data remains unchanged.', 8)
  pdf.getPages().forEach((p, index) => p.drawText(`${source.reference} | NONBINDING REQUEST | ${index + 1} / ${pdf.getPageCount()}`, { x: margin, y: 31, size: 8, font, color: muted }))
  const bytes = await pdf.save({ useObjectStreams: false })
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), filename: `${source.reference}-booking-request-receipt.pdf` }
}

export async function createFrozenBookingReceipt(source: LiveBookingSubmission, sender: CompanyMailSender): Promise<FrozenBookingReceipt> {
  const company = staffMailSender({ companyFrom: sender.from, companyReplyTo: sender.replyTo })
  const pdf = await createBookingReceiptPdf(source)
  const pdfBase64 = Buffer.from(pdf.bytes).toString('base64')
  const simple = source.snapshot.version === BOOKING_SIMPLE_ACK_VERSION
  const selected = simple ? `Requested take-off: ${source.preferredDate} ${source.preferredTime} (Sydney; not reserved)` : `Preferred start date: ${source.preferredDate} (not reserved)`
  const next = simple ? 'No further online approval is required for the company to schedule these appointments. The company will confirm your take-off appointment and assign the installation appointment by email. Additional damage found on site may increase the price; any additional work and cost will be discussed before proceeding.' : 'Exact quantities, repairs, final scope, price and duration require company review and site confirmation. Final terms and any confirmed booking require a separate proposal and your acceptance.'
  const priceNotice = quotePricingDisplay(source.snapshot.pricing.pricingVersion).includesGst ? '' : `Photo-based provisional estimate: AUD ${(source.snapshot.pricing.total! / 100).toFixed(2)}. ${NO_GST_NOTICE}\n\n`
  const text = `L&K Group booking request receipt\n\nReference: ${source.reference}\n${selected}\n\n${priceNotice}Your signed booking request receipt is attached. This is a nonbinding request pending company confirmation. It does not authorise work, create a contract or require payment. ${next}\n\nReply to this email if you need assistance.`
  const payload: LiveBookingEmailPayload = {
    from: company.from, reply_to: company.replyTo!, to: [source.snapshot.verifiedEmail], subject: `L&K Group booking request receipt - ${source.reference}`,
    text, html: `<!doctype html><html lang="en"><head><title>Booking request receipt</title></head><body><h1>L&amp;K Group booking request receipt</h1><p>Reference: ${source.reference}</p><p>${selected}</p>${priceNotice ? `<p>${priceNotice.trim()}</p>` : ''}<p><strong>Nonbinding request. Pending company confirmation. No payment is due.</strong></p><p>Your signed booking request receipt is attached. ${next}</p><p>Reply to this email if you need assistance.</p></body></html>`,
    attachments: [{ filename: pdf.filename, content: pdfBase64 }],
  }
  const frozen = { pdfBase64, pdfHash: pdf.sha256, payload }
  if (!validFrozenBookingReceipt(frozen, source)) throw new Error('Booking receipt exceeds the private storage limit or is invalid')
  return frozen
}

export function validFrozenBookingReceipt(value: unknown, source: LiveBookingSubmission): value is FrozenBookingReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>, p = row.payload as Record<string, unknown> | undefined
  if (typeof row.pdfBase64 !== 'string' || !row.pdfBase64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(row.pdfBase64) || !HASH.test(String(row.pdfHash)) || !p || typeof p !== 'object' || Array.isArray(p)) return false
  const bytes = Buffer.from(row.pdfBase64, 'base64')
  if (bytes.toString('base64') !== row.pdfBase64 || bytes.length > 750_000 || bytes.subarray(0, 5).toString() !== '%PDF-' || createHash('sha256').update(bytes).digest('hex') !== row.pdfHash) return false
  try { staffMailSender({ companyFrom: String(p.from), companyReplyTo: String(p.reply_to) }) } catch { return false }
  if (Object.keys(p).length !== 7 || !['from','reply_to','to','subject','text','html','attachments'].every(key => Object.hasOwn(p, key)) ||
      !Array.isArray(p.to) || p.to.length !== 1 || p.to[0] !== source.snapshot.verifiedEmail ||
      p.subject !== `L&K Group booking request receipt - ${source.reference}` || typeof p.text !== 'string' || p.text.length > 20_000 || typeof p.html !== 'string' || p.html.length > 30_000 ||
      !Array.isArray(p.attachments) || p.attachments.length !== 1) return false
  const attachment = p.attachments[0] as Record<string, unknown>
  return !!attachment && Object.keys(attachment).length === 2 && attachment.filename === `${source.reference}-booking-request-receipt.pdf` && attachment.content === row.pdfBase64 && Buffer.byteLength(JSON.stringify(p), 'utf8') <= MAX_BOOKING_EMAIL_BYTES
}
