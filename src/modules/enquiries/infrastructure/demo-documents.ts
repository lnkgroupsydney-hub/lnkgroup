import { DEMO_PRICE, DEMO_TERMS, DEMO_VERSION, type DemoSignature, type DemoSnapshot } from '../domain/demo-submission.ts'
import { validateQuoteDraft } from '../domain/quote-draft.ts'

export interface DemoDocumentSource {
  id: string
  reference: string
  submitted_at: string
  snapshot_hash: string
  snapshot: DemoSnapshot
  signature: DemoSignature
}
export interface DemoEmailPayload {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  attachments: { filename: string; content: string }[]
}
export const DEMO_RECIPIENT = 'lnkgroupsydney@gmail.com'

function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, value => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]!))
}
function validSource(source: DemoDocumentSource) {
  const s = source.snapshot
  if (!s || s.mode !== 'demo' || s.version !== DEMO_VERSION || !s.price || s.price.currency !== DEMO_PRICE.currency || s.price.totalCents !== DEMO_PRICE.totalCents || s.price.label !== DEMO_PRICE.label ||
      JSON.stringify(s.terms) !== JSON.stringify(DEMO_TERMS) || !/^[A-Za-z0-9-]{1,80}$/.test(source.reference) ||
      !/^[a-f0-9]{64}$/.test(source.snapshot_hash) || !Number.isFinite(Date.parse(source.submitted_at)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s.preferredDate)) throw new Error('Invalid demonstration document source')
  if (!validateQuoteDraft(s.payload).service) throw new Error('Missing demonstration service')
  const signature = source.signature
  if (!signature || signature.acknowledged !== true || typeof signature.name !== 'string' || !signature.name.trim() || signature.name.length > 120 || !Array.isArray(signature.strokes)) throw new Error('Invalid demonstration signature')
  let count = 0, minX = 1, maxX = 0, minY = 1, maxY = 0
  for (const stroke of signature.strokes) {
    if (!Array.isArray(stroke) || stroke.length < 1) throw new Error('Invalid demonstration signature')
    for (const point of stroke) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || ++count > 2000) throw new Error('Invalid demonstration signature')
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
    }
  }
  if (count < 4 || Math.max(maxX-minX, maxY-minY) < .02) throw new Error('Invalid demonstration signature')
}
function signatureSvg(signature: DemoSignature): string {
  const strokes = signature.strokes.map(stroke => `<polyline points="${stroke.map(point => `${(point.x*600).toFixed(2)},${(point.y*180).toFixed(2)}`).join(' ')}"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 180" role="img" aria-label="Demonstration signature" style="max-width:600px;width:100%;border:1px solid #777"><g fill="none" stroke="#17231b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${strokes}</g></svg>`
}
function document(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${escape(title)}</title><style>body{font:16px/1.6 Arial,sans-serif;max-width:800px;margin:32px auto;padding:0 20px;color:#17231b}h1{line-height:1.2}.notice{padding:16px;background:#fff3cc;border:1px solid #b78500}dt{font-weight:bold}dd{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}.hash{font:12px monospace;overflow-wrap:anywhere}svg{display:block;margin:16px 0}@media print{body{margin:0}}</style></head><body>${body}</body></html>`
}
function row(label: string, value: unknown) { return `<dt>${escape(label)}</dt><dd>${escape(value === '' || value == null ? 'Not specified' : value)}</dd>` }

/** Two self-contained HTML documents, never represented as PDFs or real commercial terms. */
export function createDemoEmailPayload(source: DemoDocumentSource, from: string, recipient: string): DemoEmailPayload {
  validSource(source)
  if (!/^(?:onboarding@resend\.dev|[^<>\r\n]{1,100}<onboarding@resend\.dev>)$/i.test(from) || recipient.toLowerCase() !== DEMO_RECIPIENT) throw new Error('Demonstration email configuration is not permitted')
  const { snapshot, signature, reference } = source
  const { contact, service } = snapshot.payload
  const amount = new Intl.NumberFormat('en-AU', { style:'currency', currency:'AUD' }).format(snapshot.price.totalCents/100)
  const notice = `<p class="notice"><strong>DEMONSTRATION ONLY.</strong> This is not a binding quote, contract or invoice. No payment is due. The preferred date remains pending company confirmation.</p>`
  const details = `<dl>${row('Reference',reference)}${row('Submitted',source.submitted_at)}${row('Customer',contact.name)}${row('Contact email',contact.email)}${row('Phone',contact.phone)}${row('Site address',[contact.siteAddress,contact.suburb,contact.postcode].filter(Boolean).join(', '))}${row('Project details',contact.details)}${row('Service','Kitchen Cabinet Painting — existing cabinets only')}${row('Requested work',service?.intent)}${row('Surfaces',service?.surfaces.join(', '))}${row('Cabinet doors',service?.doorCount ?? 'Unknown')}${row('Drawer fronts',service?.drawerCount ?? 'Unknown')}${row('Material',service?.material)}${row('Colour or finish',service?.colourPreference)}${row('Preferred start date',snapshot.preferredDate)}${row('Booking status','Pending confirmation — work duration and conflicts require company review')}${row('Demonstration amount',`${amount} AUD — sample only, no payment due`)}</dl>`
  const audit = `<p>Demonstration version: ${escape(snapshot.version)}</p><p class="hash">Signed snapshot: ${escape(source.snapshot_hash)}</p>`
  const quote = document(`Demo quote ${reference}`, `<h1>L&amp;K Group — demonstration quote</h1>${notice}${details}${audit}`)
  const terms = document(`Signed demo terms ${reference}`, `<h1>L&amp;K Group — signed demonstration terms</h1>${notice}${details}<h2>Demonstration terms</h2><ol>${snapshot.terms.map(term=>`<li>${escape(term)}</li>`).join('')}</ol><h2>Demonstration acknowledgement</h2><p>Signed by: ${escape(signature.name)}</p><p>The signer acknowledged the demonstration terms above for this exact saved snapshot.</p>${signatureSvg(signature)}${audit}`)
  const subject = `[DEMO] L&K quote and signed terms — ${reference}`
  const text = `Demonstration only — no payment or confirmed booking.\nReference: ${reference}\nSample amount: ${amount} AUD\nPreferred start: ${snapshot.preferredDate} (pending confirmation)\nThe attached HTML files contain the demonstration quote and signed demonstration terms. They are not PDFs or binding commercial documents.`
  const html = `<h1>L&amp;K Group demonstration documents</h1>${notice}<p>Reference: ${escape(reference)}</p><p>Sample amount: ${escape(amount)} AUD</p><p>Preferred start: ${escape(snapshot.preferredDate)} — pending confirmation.</p><p>Attached are two HTML documents: the demonstration quote and signed demonstration terms. No payment is due.</p>`
  return { from, to:[DEMO_RECIPIENT], subject, html, text, attachments:[
    { filename:`${reference}-demo-quote.html`, content:Buffer.from(quote,'utf8').toString('base64') },
    { filename:`${reference}-signed-demo-terms.html`, content:Buffer.from(terms,'utf8').toString('base64') },
  ] }
}
