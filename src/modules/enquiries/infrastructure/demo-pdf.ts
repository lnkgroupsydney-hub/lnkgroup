import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFPage } from 'pdf-lib'
import { createDemoEmailPayload, DEMO_RECIPIENT, type DemoDocumentSource, type DemoEmailPayload } from './demo-documents.ts'

export interface DemoPdfSchedule {
  proposalId: string
  revision: number
  segments: { id: string; startAt: string; endAt: string }[]
  notes: string
}
export interface DemoPdfDocument {
  filename: string
  contentType: 'application/pdf'
  bytes: Uint8Array
  sha256: string
}
let fontBytes: Promise<Uint8Array> | undefined
function fontData() {
  // Kept outside public/: only subset glyphs are embedded in private documents.
  return fontBytes ??= readFile(join(process.cwd(), 'src/shared/assets/pdf-fonts/LKDemoSans-Regular.ttf')).catch(error => { fontBytes = undefined; throw error })
}
function validateSchedule(schedule?: DemoPdfSchedule) {
  if (!schedule) return
  if (!/^[a-f0-9-]{36}$/i.test(schedule.proposalId) || !Number.isSafeInteger(schedule.revision) || schedule.revision < 1 ||
      !Array.isArray(schedule.segments) || !schedule.segments.length || schedule.segments.length > 30 ||
      typeof schedule.notes !== 'string' || schedule.notes.length > 4000) throw new Error('Invalid demonstration schedule document')
  for (const s of schedule.segments) {
    if (!s || !Number.isFinite(Date.parse(s.startAt)) || !Number.isFinite(Date.parse(s.endAt)) || Date.parse(s.startAt) >= Date.parse(s.endAt)) throw new Error('Invalid demonstration schedule document')
  }
}
function time(value: string) {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' }).format(new Date(value))
}

/** Deterministic private derivatives of immutable signed data; no current draft lookup. */
export async function createDemoPdfDocuments(source: DemoDocumentSource, schedule?: DemoPdfSchedule): Promise<{ quote: DemoPdfDocument; agreement: DemoPdfDocument }> {
  if (typeof window !== 'undefined') throw new Error('Document generation is server-only')
  // Reuse the stricter snapshot, fixed price/terms and normalized signature validator.
  createDemoEmailPayload(source, 'onboarding@resend.dev', DEMO_RECIPIENT)
  validateSchedule(schedule)
  const fontBuffer = await fontData()
  const make = async (agreement: boolean): Promise<DemoPdfDocument> => {
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)
    const font = await pdf.embedFont(fontBuffer, { subset: true })
    const supported = new Set(font.getCharacterSet())
    const text = (value: unknown) => Array.from(String(value ?? 'Not specified').replace(/\r\n?/g, '\n').replace(/\t/g, '  ')).map(char => {
      if (char === '\n') return char
      const code = char.codePointAt(0)!
      return supported.has(code) ? char : `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`
    }).join('')
    const date = new Date(source.submitted_at)
    pdf.setCreationDate(date); pdf.setModificationDate(date)
    pdf.setCreator('L&K Group demo documents v1'); pdf.setProducer('L&K Group')
    pdf.setTitle(`${agreement ? 'Signed demo terms' : 'Demo quote'} - ${source.reference}`)
    pdf.setSubject('Demonstration only. Not a binding contract, invoice or confirmed booking.')
    const width = 595.28, height = 841.89, margin = 46, contentWidth = width - margin * 2
    const ink = rgb(.09, .15, .12), muted = rgb(.32, .37, .34)
    let page: PDFPage, y = 0
    const addPage = () => {
      page = pdf.addPage([width, height]); y = height - 50
      page.drawText('L&K GROUP  /  DEMONSTRATION', { x: margin, y, size: 10, font, color: muted })
      y -= 29
    }
    const need = (size: number) => { if (y - size < 65) addPage() }
    const line = (value: string, size = 10) => {
      need(size + 6)
      page.drawText(value, { x: margin, y, size, font, color: ink })
      y -= size + 6
    }
    const paragraph = (value: unknown, size = 10) => {
      for (const part of text(value).split('\n')) {
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
    const field = (label: string, value: unknown) => { need(40); paragraph(label.toUpperCase(), 8); paragraph(value === '' || value == null ? 'Not specified' : value); y -= 5 }
    addPage()
    paragraph(agreement ? 'Signed demonstration terms' : 'Demonstration quote', 21)
    y -= 8
    paragraph('DEMO ONLY - Not a binding quote, contract or invoice. No payment is due. Company review is required; this document does not confirm a booking.', 10)
    y -= 13
    const { contact, service } = source.snapshot.payload
    field('Reference', source.reference)
    field(schedule ? 'Schedule acknowledged (Sydney)' : 'Submitted (Sydney)', time(source.submitted_at))
    field('Customer', contact.name)
    field('Contact email / phone', [contact.email, contact.phone].filter(Boolean).join(' / '))
    field('Site address', [contact.siteAddress, contact.suburb, contact.postcode].filter(Boolean).join(', '))
    field('Project details', contact.details)
    field('Service', 'Kitchen Cabinet Painting - existing cabinets only')
    field('Requested work / surfaces', [service!.intent, service!.surfaces.join(', ')].join(' / '))
    field('Cabinet doors / drawer fronts', `${service!.doorCount ?? 'Unknown'} / ${service!.drawerCount ?? 'Unknown'}`)
    field('Material / colour or finish', [service!.material, service!.colourPreference].filter(Boolean).join(' / '))
    field('Preferred start date in original request', source.snapshot.preferredDate)
    field('Demonstration amount', `AUD ${(source.snapshot.price.totalCents / 100).toFixed(2)} - sample only; no tax or payment obligation established`)
    if (schedule) {
      field('Schedule proposal', `Revision ${schedule.revision} / ${schedule.proposalId}`)
      field('Work segments', schedule.segments.map((segment, index) => `${index + 1}. ${time(segment.startAt)} to ${time(segment.endAt)} (Australia/Sydney)`).join('\n'))
      field('Company schedule notes', schedule.notes)
      paragraph('These acknowledged demo work segments still require the company conflict check and Calendar confirmation. This is not an operational booking.')
      y -= 10
    }
    if (agreement) {
      need(55); paragraph('Demonstration terms', 15); y -= 5
      source.snapshot.terms.forEach((term, index) => paragraph(`${index + 1}. ${term}`))
      y -= 13
    }
    // Keep the signature and the saved-content identifiers together on a page.
    need(300)
    paragraph('Demonstration acknowledgement', 15)
    paragraph(`Signed by: ${source.signature.name}`)
    paragraph('The signature applies to the exact saved demo content identified below.', 9)
    const boxY = y - 110
    page!.drawRectangle({ x: margin, y: boxY, width: contentWidth, height: 100, borderWidth: .6, borderColor: muted })
    for (const stroke of source.signature.strokes) {
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1], b = stroke[i]
        page!.drawLine({ start: { x: margin + 8 + a.x * (contentWidth - 16), y: boxY + 8 + (1 - a.y) * 84 }, end: { x: margin + 8 + b.x * (contentWidth - 16), y: boxY + 8 + (1 - b.y) * 84 }, thickness: 1.3, color: ink })
      }
    }
    y = boxY - 20
    field('Signed content SHA-256', source.snapshot_hash)
    field('Demo terms version', source.snapshot.version)
    paragraph('Characters unavailable in the embedded font are displayed as their [U+code point]. Original saved data is retained unchanged.', 8)
    pdf.getPages().forEach((p, index) => {
      p.drawText(`${source.reference} | DEMO ONLY | ${index + 1} / ${pdf.getPageCount()}`, { x: margin, y: 31, size: 8, font, color: muted })
    })
    const bytes = await pdf.save({ useObjectStreams: false })
    const suffix = schedule ? `-schedule-${schedule.revision}` : ''
    return { filename: `${source.reference}${suffix}-${agreement ? 'signed-demo-terms' : 'demo-quote'}.pdf`, contentType: 'application/pdf', bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  return { quote: await make(false), agreement: await make(true) }
}

export async function createDemoPdfEmailPayload(source: DemoDocumentSource, from: string, recipient: string, schedule?: DemoPdfSchedule): Promise<DemoEmailPayload> {
  const payload = createDemoEmailPayload(source, from, recipient)
  const documents = await createDemoPdfDocuments(source, schedule)
  const description = schedule ? 'The attached PDFs contain the newly acknowledged demo work schedule and signed demo terms. Company confirmation is still required.' : 'The attached PDFs contain the demonstration quote and signed demonstration terms. The preferred date remains pending company confirmation.'
  return {
    ...payload,
    subject: schedule ? `[DEMO] L&K acknowledged schedule ${schedule.revision} - ${source.reference}` : payload.subject,
    text: `DEMONSTRATION ONLY - no binding contract, invoice or confirmed booking.\nReference: ${source.reference}\n${description}\nNo payment is due.`,
    html: `<h1>L&amp;K Group demonstration documents</h1><p><strong>DEMONSTRATION ONLY.</strong> No binding contract, invoice or confirmed booking. No payment is due.</p><p>Reference: ${source.reference}</p><p>${description}</p>`,
    attachments: Object.values(documents).map(document => ({ filename: document.filename, content: Buffer.from(document.bytes).toString('base64') })),
  }
}
