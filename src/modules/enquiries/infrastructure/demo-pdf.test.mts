import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import { createDemoPdfDocuments, createDemoPdfEmailPayload, type DemoPdfSchedule } from './demo-pdf.ts'
import { pdfFixture } from './demo-document.fixture.mts'
import { createDemoEmailPayload } from './demo-documents.ts'
import { CURRENT_DEMO_VERSION, type DemoSnapshot } from '../domain/demo-submission.ts'
import { PHOTO_PROCESSING_VERSION } from '../domain/quote-photos.ts'

const photoEvidence = () => ({photoId:'33333333-2222-4333-8444-555555555555',contentHash:'c'.repeat(64),processingVersion:PHOTO_PROCESSING_VERSION})

test('embedded font glyph offsets remain aligned when the PDF subset uses short loca offsets', async () => {
  const bytes = await readFile(new URL('../../../shared/assets/pdf-fonts/LKDemoSans-Regular.ttf', import.meta.url))
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const at = 12 + i * 16
    tables.set(bytes.toString('ascii', at, at + 4), { offset: bytes.readUInt32BE(at + 8), length: bytes.readUInt32BE(at + 12) })
  }
  const head = tables.get('head')!, loca = tables.get('loca')!
  const short = bytes.readInt16BE(head.offset + 50) === 0
  for (let at = loca.offset; at < loca.offset + loca.length; at += short ? 2 : 4) {
    const offset = short ? bytes.readUInt16BE(at) * 2 : bytes.readUInt32BE(at)
    assert.equal(offset % 2, 0, 'odd glyph offsets are truncated by short PDF loca and render missing text')
  }
})

test('immutable Unicode source generates stable, readable PDF containers with embedded TrueType and no active content', async () => {
  const source = pdfFixture(), original = structuredClone(source)
  const first = await createDemoPdfDocuments(source), second = await createDemoPdfDocuments(source)
  for (const kind of ['quote', 'agreement'] as const) {
    const document = first[kind]
    assert.deepEqual(document.bytes, second[kind].bytes)
    assert.equal(document.sha256, second[kind].sha256)
    assert.match(Buffer.from(document.bytes).toString('ascii', 0, 8), /^%PDF-1\.7/)
    assert.ok(document.bytes.length < 750_000)
    const parsed = await PDFDocument.load(document.bytes)
    assert.ok(parsed.getPageCount() >= 2)
    assert.equal(parsed.getCreationDate()?.toISOString(), source.submitted_at)
    assert.equal(parsed.catalog.has(PDFName.of('OpenAction')), false)
    assert.equal(parsed.catalog.has(PDFName.of('AcroForm')), false)
    assert.ok(parsed.context.enumerateIndirectObjects().some(([, object]) => object instanceof PDFDict && object.has(PDFName.of('FontFile2'))))
  }
  assert.deepEqual(source, original)
})
test('changed schedule is a separate PDF version and invalid intervals cannot become signed attachments', async () => {
  const source = pdfFixture()
  const schedule: DemoPdfSchedule = { proposalId: '11111111-2222-4333-8444-999999999999', revision: 1, segments: [{ id: 'one', startAt: '2026-10-12T22:00:00Z', endAt: '2026-10-13T00:00:00Z' }], notes: 'DEMO ONLY - separate work visit.' }
  const initial = await createDemoPdfDocuments(source)
  const changed = await createDemoPdfDocuments({ ...source, snapshot_hash: 'b'.repeat(64) }, schedule)
  assert.notEqual(initial.agreement.sha256, changed.agreement.sha256)
  assert.match(changed.agreement.filename, /schedule-1.*\.pdf$/)
  await assert.rejects(createDemoPdfDocuments(source, { ...schedule, segments: [{ ...schedule.segments[0], endAt: '2026-10-12T20:00:00Z' }] }))
  await assert.rejects(createDemoPdfEmailPayload(source, 'onboarding@resend.dev', 'another@example.com'))
})
test('long saved notes paginate within A4 and email attachments remain bounded PDF bytes', async () => {
  const source = pdfFixture(); source.snapshot.payload.contact.details = '한글 review details <script>alert(1)</script> '.repeat(35)
  const payload = await createDemoPdfEmailPayload(source, 'L&K Demo <onboarding@resend.dev>', 'lnkgroupsydney@gmail.com')
  assert.deepEqual(payload.to, ['lnkgroupsydney@gmail.com'])
  assert.equal(payload.attachments.length, 2)
  for (const attachment of payload.attachments) {
    assert.match(attachment.filename, /\.pdf$/)
    const bytes = Buffer.from(attachment.content, 'base64')
    assert.match(bytes.toString('ascii', 0, 5), /^%PDF-/)
    const pdf = await PDFDocument.load(bytes)
    assert.ok(pdf.getPageCount() >= 2)
    for (const page of pdf.getPages()) { assert.equal(page.getWidth(), 595.28); assert.equal(page.getHeight(), 841.89) }
  }
})

test('v2 photo evidence changes immutable PDF content without embedding images, private URLs or active actions', async () => {
  const source=pdfFixture()
  source.snapshot={...source.snapshot,version:CURRENT_DEMO_VERSION,photos:[photoEvidence()]}
  const original=structuredClone(source)
  const first=await createDemoPdfDocuments(source),second=await createDemoPdfDocuments(source)
  const changed=structuredClone(source)
  changed.snapshot.photos![0].contentHash='d'.repeat(64)
  // Hold every other field fixed so this proves the manifest itself is rendered.
  const changedDocuments=await createDemoPdfDocuments(changed)
  const html=createDemoEmailPayload(source,'onboarding@resend.dev','lnkgroupsydney@gmail.com')
  for(const attachment of html.attachments){
    const text=Buffer.from(attachment.content,'base64').toString('utf8')
    assert.ok(text.includes(photoEvidence().photoId))
    assert.ok(text.includes(photoEvidence().contentHash))
    assert.ok(text.includes(PHOTO_PROCESSING_VERSION))
    assert.doesNotMatch(text,/<img\b|storage\/v1|\/api\/quote\/photos|https:\/\//i)
  }
  for(const kind of ['quote','agreement'] as const){
    assert.deepEqual(first[kind].bytes,second[kind].bytes)
    assert.notEqual(first[kind].sha256,changedDocuments[kind].sha256)
    const pdf=await PDFDocument.load(first[kind].bytes)
    assert.equal(pdf.catalog.has(PDFName.of('OpenAction')),false)
    assert.equal(pdf.catalog.has(PDFName.of('Names')),false)
    for(const [,object] of pdf.context.enumerateIndirectObjects()){
      if(!(object instanceof PDFDict))continue
      for(const key of ['URI','JavaScript','JS','AA','EF'])assert.equal(object.has(PDFName.of(key)),false)
      assert.notEqual(object.get(PDFName.of('Subtype'))?.toString(),'/Image')
      assert.notEqual(object.get(PDFName.of('Type'))?.toString(),'/Filespec')
    }
  }
  assert.deepEqual(source,original)
})

test('v2 documents reject missing, duplicate, oversized or malformed photo manifests before producing attachments', async () => {
  const entry=photoEvidence()
  const invalid:unknown[]=[undefined,null,{},[entry,entry],[{...entry,photoId:'https://private.invalid/object'}],[{...entry,contentHash:'invalid'}],[{...entry,processingVersion:'https://private.invalid/image'}],Array.from({length:9},(_,i)=>({...entry,photoId:`33333333-2222-4333-8444-${String(i).padStart(12,'0')}`}))]
  for(const photos of invalid){
    const source=pdfFixture()
    source.snapshot={...source.snapshot,version:CURRENT_DEMO_VERSION,photos} as DemoSnapshot
    await assert.rejects(createDemoPdfDocuments(source))
  }
  const legacy=pdfFixture()
  legacy.snapshot.photos=[entry]
  await assert.rejects(createDemoPdfDocuments(legacy))
})

test('legacy photo-free documents remain unchanged and new photo-free v2 documents are valid', async () => {
  const legacy=pdfFixture(),before=await createDemoPdfDocuments(legacy)
  const current=pdfFixture()
  current.snapshot={...current.snapshot,version:CURRENT_DEMO_VERSION,photos:[]}
  const currentPayload=await createDemoPdfEmailPayload(current,'onboarding@resend.dev','lnkgroupsydney@gmail.com')
  assert.equal(currentPayload.attachments.length,2)
  for(const item of currentPayload.attachments)await PDFDocument.load(Buffer.from(item.content,'base64'))
  const after=await createDemoPdfDocuments(legacy)
  assert.deepEqual(after.quote.bytes,before.quote.bytes)
  assert.deepEqual(after.agreement.bytes,before.agreement.bytes)
  assert.equal(legacy.snapshot.version,'kcp-demo-v1')
  assert.equal(legacy.snapshot.photos,undefined)
})
