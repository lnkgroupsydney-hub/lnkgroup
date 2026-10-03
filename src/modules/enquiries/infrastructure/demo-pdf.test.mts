import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib'
import { createDemoPdfDocuments, createDemoPdfEmailPayload, type DemoPdfSchedule } from './demo-pdf.ts'
import { pdfFixture } from './demo-document.fixture.mts'

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
