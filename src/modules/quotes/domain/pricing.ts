import type { PhotoAnalysis } from './analysis.ts'
import type { ServiceDetails } from './contracts.ts'

/** L&K's initial estimating rules, not an official Sydney market average. */
export const QUOTE_PRICING_VERSION = 'lk-sydney-cabinet-v1-20261011'
export interface PendingCompanyPricing {
  status: 'awaiting_company_rates'; currency: 'AUD'; pricingVersion: 'unconfigured'
  lineItems: []; subtotal: null; tax: null; total: null; notice: string
}
export interface EstimateLineItem { code: string; label: string; quantity: number; unitAmount: number; amount: number }
export interface CalculatedEstimatePricing {
  status: 'estimate_ready' | 'review_required'; currency: 'AUD'; pricingVersion: typeof QUOTE_PRICING_VERSION
  amountUnit: 'cents'; minimumSubtotal: 150000; gstRateBps: 1000; lineItems: EstimateLineItem[]
  subtotal: number | null; tax: number | null; total: number | null; reviewReasons: string[]; notice: string
}
export type EstimatePricing = PendingCompanyPricing | CalculatedEstimatePricing
export function pendingCompanyPricing(): PendingCompanyPricing {
  return {status:'awaiting_company_rates',currency:'AUD',pricingVersion:'unconfigured',lineItems:[],subtotal:null,tax:null,total:null,notice:'Company pricing rules are being prepared. Your photo assessment and work details are saved; the estimate amount is pending.'}
}
const notice = 'Photo-based estimate using L&K initial pricing rules, starting from A$1,500 excluding GST. Ordinary preparation and minor coating repairs are included. Material, dimensions, adhesion and hidden damage require site confirmation. Frames, end panels, replacement and structural repairs require separate review. Scope and price may change after site inspection; this is not a confirmed booking or contract.'
export function calculateEstimatePricing(analysis: PhotoAnalysis, service: ServiceDetails): CalculatedEstimatePricing {
  const reviewReasons: string[] = []
  if (analysis.outcome !== 'analysis_ready') reviewReasons.push('The photo assessment requires additional photos or site review.')
  if (!analysis.photoQuality.length || analysis.photoQuality.some(photo => !photo.usable) || ['overview','lower','side'].some(role => !analysis.coverage.some(item => item.role === role && item.covered && item.photoIds.length))) reviewReasons.push('Usable photos must show the overall cabinets, lower fronts and sides.')
  const quantities = [analysis.quantities.doors, analysis.quantities.drawers]
  if (quantities.some((count, index) => count.needsConfirmation || count.observed === null || !Number.isInteger(count.observed) || count.observed < 0 || count.observed > 500 || count.customer !== count.observed || count.customer !== [service.doorCount, service.drawerCount][index]) || (service.doorCount ?? 0) + (service.drawerCount ?? 0) === 0) reviewReasons.push('Confirm the door and drawer quantities before calculating the estimate.')
  if (service.serviceId !== 'cabinet-painting' || !['full-repainting','colour-change'].includes(service.intent) || !service.surfaces.length || service.surfaces.some(surface => !['doors','drawers','repairs'].includes(surface)) || !service.surfaces.some(surface => ['doors','drawers'].includes(surface)) || ((service.doorCount ?? 0) > 0 && !service.surfaces.includes('doors')) || ((service.drawerCount ?? 0) > 0 && !service.surfaces.includes('drawers'))) reviewReasons.push('The requested service or additional surfaces need a separate scope review.')
  if (analysis.observedDamage.some(damage => damage.severity === 'severe' || ['swelling','joint_gap','other'].includes(damage.kind))) reviewReasons.push('Structural, swollen, severe or unclassified damage requires site review.')
  const result: CalculatedEstimatePricing = {status:reviewReasons.length ? 'review_required' : 'estimate_ready',currency:'AUD',pricingVersion:QUOTE_PRICING_VERSION,amountUnit:'cents',minimumSubtotal:150000,gstRateBps:1000,lineItems:[],subtotal:null,tax:null,total:null,reviewReasons,notice}
  if (reviewReasons.length) return result
  const add = (code: string, label: string, quantity: number, unitAmount: number) => { if (quantity && unitAmount > 0) result.lineItems.push({code,label,quantity,unitAmount,amount:quantity * unitAmount}) }
  add('doors','Cabinet door preparation and painting',service.doorCount!,15000)
  add('drawers','Drawer front preparation and painting',service.drawerCount!,10000)
  const painting = result.lineItems.reduce((sum,item) => sum + item.amount,0)
  add('minimum_adjustment','Minimum painting charge adjustment',1,Math.max(0,150000 - painting))
  if (analysis.observedDamage.some(damage => damage.severity === 'moderate')) add('moderate_repairs','Moderate coating repairs (once per project)',1,25000)
  result.subtotal = result.lineItems.reduce((sum,item) => sum + item.amount,0)
  result.tax = Math.round(result.subtotal * 1000 / 10000)
  result.total = result.subtotal + result.tax
  return result
}

/** Validate stored/public money independently of AI and JSON type assertions. */
export function validateEstimatePricing(value: unknown): EstimatePricing {
  const fail = (): never => { throw new Error('The saved estimate pricing could not be validated.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const row = value as Record<string,unknown>
  const hasKeys = (keys: string[]) => Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row,key))
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 2000
  if (row.currency !== 'AUD' || !text(row.notice) || !Array.isArray(row.lineItems)) return fail()
  if (row.status === 'awaiting_company_rates') {
    if (!hasKeys(['status','currency','pricingVersion','lineItems','subtotal','tax','total','notice']) || row.pricingVersion !== 'unconfigured' || row.lineItems.length || row.subtotal !== null || row.tax !== null || row.total !== null) return fail()
    return value as PendingCompanyPricing
  }
  if (!hasKeys(['status','currency','pricingVersion','amountUnit','minimumSubtotal','gstRateBps','lineItems','subtotal','tax','total','reviewReasons','notice']) || row.pricingVersion !== QUOTE_PRICING_VERSION || row.amountUnit !== 'cents' || row.minimumSubtotal !== 150000 || row.gstRateBps !== 1000 || !Array.isArray(row.reviewReasons) || row.reviewReasons.length > 20 || !row.reviewReasons.every(text)) return fail()
  if (row.status === 'review_required') {
    if (!row.reviewReasons.length || row.lineItems.length || row.subtotal !== null || row.tax !== null || row.total !== null) return fail()
  } else if (row.status === 'estimate_ready') {
    const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 20000000
    if (row.reviewReasons.length || !row.lineItems.length || row.lineItems.length > 4 || !integer(row.subtotal) || row.subtotal < 150000 || !integer(row.tax) || !integer(row.total)) return fail()
    let sum = 0
    const codes = new Set<string>()
    for (const item of row.lineItems) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return fail()
      const line = item as Record<string,unknown>
      if (Object.keys(line).length !== 5 || !['code','label','quantity','unitAmount','amount'].every(key => Object.hasOwn(line,key)) || !text(line.code) || !text(line.label) || !integer(line.quantity) || line.quantity < 1 || !integer(line.unitAmount) || line.unitAmount < 1 || !integer(line.amount) || line.amount !== line.quantity * line.unitAmount) return fail()
      const code = line.code as string
      if (codes.has(code) || !['doors','drawers','minimum_adjustment','moderate_repairs'].includes(code) || (['doors','drawers'].includes(code) && (line.quantity > 500 || line.unitAmount !== (code === 'doors' ? 15000 : 10000))) || (['minimum_adjustment','moderate_repairs'].includes(code) && line.quantity !== 1) || (code === 'moderate_repairs' && line.unitAmount !== 25000)) return fail()
      codes.add(code); sum += line.amount
    }
    const lines = row.lineItems as EstimateLineItem[]
    const painting = lines.filter(line => ['doors','drawers'].includes(line.code)).reduce((sum,line) => sum + line.amount,0)
    const adjustment = lines.find(line => line.code === 'minimum_adjustment')?.amount ?? 0
    if (!painting || adjustment !== Math.max(0,150000 - painting) || sum !== row.subtotal || row.tax !== Math.round(row.subtotal * 1000 / 10000) || row.total !== row.subtotal + row.tax) return fail()
  } else return fail()
  return value as CalculatedEstimatePricing
}
