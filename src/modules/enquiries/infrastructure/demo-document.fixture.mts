import { DEMO_PRICE, DEMO_TERMS, DEMO_VERSION } from '../domain/demo-submission.ts'
import type { DemoDocumentSource } from './demo-documents.ts'

export const pdfFixture = (): DemoDocumentSource => ({
  id: '11111111-2222-4333-8444-555555555555', reference: 'DEMO-PDFCHECK', submitted_at: '2026-10-03T12:00:00.000Z', snapshot_hash: 'a'.repeat(64),
  snapshot: { mode: 'demo', version: DEMO_VERSION, draftId: '66666666-2222-4333-8444-555555555555', draftRevision: 2, preferredDate: '2026-10-12', price: DEMO_PRICE, terms: DEMO_TERMS, payload: {
    contact: { name: '가상 고객 / DEMO TEST', email: 'lnkgroupsydney@gmail.com', phone: '', siteAddress: 'DEMO ONLY - 12 Test Road', suburb: 'Ermington', postcode: '2115', details: 'Synthetic cabinet repainting enquiry. 한글 표시 확인.', consent: true },
    service: { serviceId: 'cabinet-painting', intent: 'full-repainting', surfaces: ['doors'], doorCount: 4, drawerCount: 1, material: 'Wood', colourPreference: 'White' },
  } },
  signature: { name: '가상 서명 / TEST SIGNER', acknowledged: true, strokes: [[{ x: .1, y: .5 }, { x: .2, y: .3 }, { x: .3, y: .6 }, { x: .4, y: .2 }, { x: .6, y: .5 }]] },
})
