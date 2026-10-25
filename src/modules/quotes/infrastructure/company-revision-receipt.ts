import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib'
import { staffMailSender, type CompanyMailSender } from '../../../shared/email/company-sender.ts'
import { parseBookingSignature, type LiveBookingSignature } from '../domain/booking-flow.ts'
import { COMPANY_REVISION_ACK, calculateCompanyRevisionPricing, validateCompanyRevisionComparison, type CompanyRevision } from '../domain/company-revision.ts'

export type CompanyRevisionMailKind = 'revision_notice' | 'revision_acceptance_receipt'
export interface FrozenCompanyRevisionMail { pdfBase64: string; pdfHash: string; payload: Record<string, unknown> }
export interface CompanyRevisionMailPrepared { revision: CompanyRevision; recipientEmail: string; reference: string; signature?: LiveBookingSignature; signedContentHash?: string; acknowledgment?: typeof COMPANY_REVISION_ACK }
let fontBytes: Promise<Uint8Array> | undefined
const fontData = () => fontBytes ??= readFile(join(process.cwd(), 'src/shared/assets/pdf-fonts/LKDemoSans-Regular.ttf')).catch(error => { fontBytes = undefined; throw error })
const HASH = /^[a-f0-9]{64}$/
const titles = { revision_notice: 'Revised quote for your booking request', revision_acceptance_receipt: 'Revised quote acceptance receipt' }
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const money = (cents: number) => `AUD ${(cents / 100).toFixed(2)}`
function sender() { return staffMailSender({ companyFrom: process.env.COMPANY_EMAIL_FROM, companyReplyTo: process.env.COMPANY_EMAIL_REPLY_TO }) }
function validatePrepared(kind: CompanyRevisionMailKind, prepared: CompanyRevisionMailPrepared) {
  const r = prepared.revision
  validateCompanyRevisionComparison(r.comparison, r.totalCents)
  if (!Object.hasOwn(titles, kind) || !r.snapshot || !HASH.test(String(r.snapshotHash)) || !HASH.test(r.baseSnapshotHash) || !HASH.test(r.baseSignedContentHash) || !/^[A-Z0-9-]{1,80}$/.test(prepared.reference) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(prepared.recipientEmail) || prepared.recipientEmail.length > 254 || !Number.isSafeInteger(r.versionNo) || r.versionNo < 1 || r.pricing.tax !== 0 || r.totalCents !== calculateCompanyRevisionPricing(r.payload).total || r.comparison.company.totalCents !== r.totalCents || r.comparison.deltaCents !== r.totalCents - r.comparison.original.totalCents) throw Error('Invalid prepared revision receipt')
  if (kind === 'revision_acceptance_receipt') {
    parseBookingSignature(prepared.signature)
    if (!HASH.test(String(prepared.signedContentHash)) || prepared.acknowledgment?.version !== COMPANY_REVISION_ACK.version || prepared.acknowledgment.text !== COMPANY_REVISION_ACK.text) throw Error('Invalid prepared revision acceptance')
  }
}
const changeLabels: Record<string, string> = {
 'quantities.doorCount':'Cabinet doors', 'quantities.drawerCount':'Drawer fronts', 'quantities.moderateRepair':'Moderate repair',
 'contact.name':'Name', 'contact.email':'Email', 'contact.phone':'Phone', 'contact.siteAddress':'Site address', 'contact.suburb':'Suburb', 'contact.postcode':'Postcode', 'contact.details':'Details', 'customerNote':'Company note',
}
const readableValue = (value: unknown): string => value === null || value === undefined || value === '' ? 'Not provided' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : typeof value === 'string' || typeof value === 'number' ? String(value) : 'Changed'
function readableChanges(r: CompanyRevision): string[] {
 return r.comparison.changes.flatMap(change => {
  if(change.field === 'extraItems')return r.payload.extraItems.map(item => `Additional item: ${item.description} (${money(item.amountCents)}). Reason: ${item.reason}`)
  const label=changeLabels[change.field]
  return label ? [`${label}: ${readableValue(change.before)} -> ${readableValue(change.after)}`] : ['Other change: updated']
 })
}
function monetarySummary(r: CompanyRevision): string[] {
 const original=r.comparison.original
 return [
  `Original signed quote subtotal: ${money(original.subtotalCents)}`,
  ...(original.taxCents>0 ? [`Original GST (as signed): ${money(original.taxCents)}`] : []),
  `Original signed quote total: ${money(original.totalCents)}`,
  `Company revised quote: ${money(r.totalCents)}`, `Difference: ${money(r.comparison.deltaCents)}`,
  'Revised quote GST: AUD 0.00. No GST is charged on the revised quote.',
 ]
}
/** Uses only DB-prepared evidence. No publication/acceptance time or identity is invented here. */
export async function createCompanyRevisionMail(kind: CompanyRevisionMailKind, prepared: CompanyRevisionMailPrepared, baseUrl: string, configuredSender?: CompanyMailSender): Promise<FrozenCompanyRevisionMail> {
  if (typeof window !== 'undefined') throw Error('Company revision receipts are server-only')
  validatePrepared(kind, prepared)
  const r = prepared.revision, company = configuredSender ? staffMailSender({ companyFrom: configuredSender.from, companyReplyTo: configuredSender.replyTo }) : sender()
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw Error('Invalid quote return URL')
  const returnUrl = new URL('/quote/start?service=cabinet-painting', base.origin).href
  const title = titles[kind], pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await fontData(), { subset: true }), supported = new Set(font.getCharacterSet())
  // PDF metadata is deliberately independent of a transaction that has not committed yet.
  pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0)); pdf.setTitle(`${title} - ${prepared.reference}`); pdf.setCreator('L&K Group company quote revision'); pdf.setProducer('L&K Group')
  let page!: PDFPage; let y = 0
  const ink = rgb(.09, .15, .12), margin = 46, width = 503
  const addPage = () => { page = pdf.addPage([595.28, 841.89]); y = 792 }
  const safe = (value: unknown) => Array.from(String(value ?? '')).map(c => c === '\n' || supported.has(c.codePointAt(0)!) ? c : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`).join('')
  const line = (value: string, size = 10) => { if (y < 65) addPage(); page.drawText(value || ' ', { x: margin, y, font, size, color: ink }); y -= size + 6 }
  const text = (value: unknown, size = 10) => { for (const paragraph of safe(value).split('\n')) { let pending = ''; for (const c of paragraph) { if (pending && font.widthOfTextAtSize(pending + c, size) > width) { line(pending, size); pending = '' } pending += c } line(pending, size) } }
  addPage(); text(title, 19); text(`Request: ${prepared.reference} / revision ${r.versionNo}`); text(`Customer: ${r.payload.contact.name}`); text(`Site: ${r.payload.contact.siteAddress}, ${r.payload.contact.suburb} ${r.payload.contact.postcode}`); text(`Verified recipient: ${prepared.recipientEmail}`)
  for (const summary of monetarySummary(r)) text(summary)
  text('Quantities compared with the original signed request', 13)
  text(`Cabinet doors: ${r.comparison.original.quantities.doorCount} -> ${r.payload.quantities.doorCount}`)
  text(`Drawer fronts: ${r.comparison.original.quantities.drawerCount} -> ${r.payload.quantities.drawerCount}`)
  text(`Moderate repair: ${readableValue(r.comparison.original.quantities.moderateRepair)} -> ${readableValue(r.payload.quantities.moderateRepair)}`)
  text('Original line items', 13); for (const item of r.comparison.original.lineItems) text(`${item.label}: ${item.quantity} x ${money(item.unitAmount)} = ${money(item.amount)}`)
  text('Revised line items', 13); for (const item of r.pricing.lineItems) text(`${item.label}: ${item.quantity} x ${money(item.unitAmount)} = ${money(item.amount)}`)
  for (const extra of r.payload.extraItems) text(`Additional item reason (${extra.description}): ${extra.reason}`)
  text('Changes against original signed request', 13); for (const change of readableChanges(r)) text(change)
  text(`Company note: ${r.payload.customerNote || 'None'}`); text(COMPANY_REVISION_ACK.text); text(`Acknowledgment: ${COMPANY_REVISION_ACK.version}`)
  text(`Revision snapshot SHA-256: ${r.snapshotHash}`); text(`Original snapshot SHA-256: ${r.baseSnapshotHash}`); text(`Original signed content SHA-256: ${r.baseSignedContentHash}`)
  if (kind === 'revision_acceptance_receipt') {
    const signature = prepared.signature!; text(`New signed name / method: ${signature.name} / ${signature.method ?? 'drawn'}`); text(`Accepted signed content SHA-256: ${prepared.signedContentHash}`)
    if (signature.strokes.length) { if (y < 200) addPage(); const bottom = y - 110; page.drawRectangle({ x: margin, y: bottom, width, height: 100, borderWidth: .6, borderColor: ink }); for (const stroke of signature.strokes) for (let i = 1; i < stroke.length; i++) { const a = stroke[i - 1], b = stroke[i]; page.drawLine({ start: { x: margin + 8 + a.x * (width - 16), y: bottom + 8 + (1 - a.y) * 84 }, end: { x: margin + 8 + b.x * (width - 16), y: bottom + 8 + (1 - b.y) * 84 }, thickness: 1.3, color: ink }) } y = bottom - 20 }
  }
  text('Unsupported font characters are shown as Unicode code points. Original saved data is unchanged.', 8)
  const bytes = await pdf.save({ useObjectStreams: false }), pdfBase64 = Buffer.from(bytes).toString('base64'), pdfHash = createHash('sha256').update(bytes).digest('hex')
  const notice = kind === 'revision_notice' ? 'Please compare the revised quote with your original signed booking request. Sign in using your email one-time code, review the changes and explicitly accept with a new signature. Opening this email or its link does not accept anything.' : 'Your explicit acceptance and new signature have been recorded. Company booking confirmation is still required. No date is held by this receipt.'
  const body = `L&K Group - ${title}\n\nReference: ${prepared.reference}\nRevision: ${r.versionNo}\n${monetarySummary(r).join('\n')}\n\nChanges against original signed request:\n${readableChanges(r).join('\n')}\n\n${notice}\n\n${COMPANY_REVISION_ACK.text}\n\nOpen your saved quote and verify your email: ${returnUrl}\n\nReply to this email if you need assistance or wish to discuss these changes. The private revised quote PDF is attached.`
  const payload = { from: company.from, reply_to: company.replyTo!, to: [prepared.recipientEmail], subject: `L&K Group ${title.toLowerCase()} - ${prepared.reference}`, text: body, html: `<!doctype html><html lang="en"><body><h1>${escape(title)}</h1>${body.split('\n\n').map(part => `<p>${escape(part).replace(/\n/g, '<br>')}</p>`).join('')}</body></html>`, attachments: [{ filename: `${prepared.reference}-${kind}-v${r.versionNo}.pdf`, content: pdfBase64 }] }
  const frozen = { pdfBase64, pdfHash, payload }
  if (!companyRevisionMailValid(frozen, prepared.recipientEmail)) throw Error('Invalid frozen revision mail')
  return frozen
}
export function companyRevisionMailValid(value: unknown, recipientEmail?: string): value is FrozenCompanyRevisionMail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Partial<FrozenCompanyRevisionMail>, p = r.payload
  if (typeof r.pdfBase64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(r.pdfBase64) || !HASH.test(String(r.pdfHash)) || !p || typeof p !== 'object' || Array.isArray(p)) return false
  const bytes = Buffer.from(r.pdfBase64, 'base64')
  if (bytes.toString('base64') !== r.pdfBase64 || bytes.length > 750000 || bytes.subarray(0, 5).toString() !== '%PDF-' || createHash('sha256').update(bytes).digest('hex') !== r.pdfHash) return false
  try { staffMailSender({ companyFrom: String(p.from), companyReplyTo: String(p.reply_to) }) } catch { return false }
  if (Object.keys(p).length !== 7 || !['from', 'reply_to', 'to', 'subject', 'text', 'html', 'attachments'].every(k => Object.hasOwn(p, k)) || !Array.isArray(p.to) || p.to.length !== 1 || typeof p.to[0] !== 'string' || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(p.to[0]) || recipientEmail !== undefined && p.to[0] !== recipientEmail || typeof p.subject !== 'string' || p.subject.length > 200 || /[\r\n]/.test(p.subject) || typeof p.text !== 'string' || p.text.length > 50000 || typeof p.html !== 'string' || p.html.length > 70000 || !Array.isArray(p.attachments) || p.attachments.length !== 1) return false
  const attachment = p.attachments[0] as Record<string, unknown>
  return !!attachment && Object.keys(attachment).length === 2 && typeof attachment.filename === 'string' && /^[A-Z0-9_-]+-(revision_notice|revision_acceptance_receipt)-v\d+\.pdf$/.test(attachment.filename) && attachment.content === r.pdfBase64 && Buffer.byteLength(JSON.stringify(p), 'utf8') <= 1000000
}
