import type { PhotoAnalysis, ProvisionalPhotoAnalysis } from './analysis.ts'
import type { ServiceDetails } from './contracts.ts'

/** L&K's initial estimating rules, not an official Sydney market average. */
export const LEGACY_QUOTE_PRICING_VERSION = 'lk-sydney-cabinet-v1-20261011'
export const PREVIOUS_QUOTE_PRICING_VERSION = 'lk-sydney-cabinet-v2-20261011'
export const QUOTE_PRICING_VERSION = 'lk-sydney-cabinet-v3-20261014'
export function quotePricingPolicy(version: string = QUOTE_PRICING_VERSION) {
  if (version === QUOTE_PRICING_VERSION) return { minimumSubtotal: 145000, gstRateBps: 0 } as const
  if (version === PREVIOUS_QUOTE_PRICING_VERSION || version === LEGACY_QUOTE_PRICING_VERSION) return { minimumSubtotal: 150000, gstRateBps: 1000 } as const
  throw new Error('The quote pricing policy could not be validated.')
}
export interface PendingCompanyPricing {
  status: 'awaiting_company_rates'; currency: 'AUD'; pricingVersion: 'unconfigured'
  lineItems: []; subtotal: null; tax: null; total: null; notice: string
}
export interface EstimateLineItem { code: string; label: string; quantity: number; unitAmount: number; amount: number }
export interface LegacyCalculatedEstimatePricing {
  status: 'estimate_ready' | 'review_required'; currency: 'AUD'; pricingVersion: typeof LEGACY_QUOTE_PRICING_VERSION
  amountUnit: 'cents'; minimumSubtotal: 150000; gstRateBps: 1000; lineItems: EstimateLineItem[]
  subtotal: number | null; tax: number | null; total: number | null; reviewReasons: string[]; notice: string
}
export const EXCLUDED_WORK_CODES = ['structural_or_unclassified_repairs','unverified_damage_scope','additional_surfaces','unseen_cabinetry'] as const
export interface ExcludedEstimateWork { code: typeof EXCLUDED_WORK_CODES[number]; description: string; damageIds: string[] }
export interface ProvisionalEstimatePricing extends Omit<LegacyCalculatedEstimatePricing, 'status' | 'pricingVersion' | 'minimumSubtotal' | 'gstRateBps'> {
  status: 'provisional_estimate' | 'review_required'; pricingVersion: typeof QUOTE_PRICING_VERSION | typeof PREVIOUS_QUOTE_PRICING_VERSION
  minimumSubtotal: 145000 | 150000; gstRateBps: 0 | 1000
  amountScope: 'painting_only'; siteConfirmationRequired: true
  basis: { type: 'ai_estimated_quantities'; extent: 'whole_project' | 'primary_view'; anchorPhotoId: string; doors: number; drawers: number } | null
  exclusions: ExcludedEstimateWork[]
}
export type CalculatedEstimatePricing = LegacyCalculatedEstimatePricing | ProvisionalEstimatePricing
export type EstimatePricing = PendingCompanyPricing | CalculatedEstimatePricing
export function pendingCompanyPricing(): PendingCompanyPricing {
  return {status:'awaiting_company_rates',currency:'AUD',pricingVersion:'unconfigured',lineItems:[],subtotal:null,tax:null,total:null,notice:'Company pricing rules are being prepared. Your photo assessment and work details are saved; the estimate amount is pending.'}
}
const notice = 'Photo-based estimate using L&K initial pricing rules, starting from A$1,500 excluding GST. Ordinary preparation and minor coating repairs are included. Material, dimensions, adhesion and hidden damage require site confirmation. Frames, end panels, replacement and structural repairs require separate review. Scope and price may change after site inspection; this is not a confirmed booking or contract.'
export function calculateLegacyEstimatePricing(analysis: PhotoAnalysis, service: ServiceDetails): LegacyCalculatedEstimatePricing {
  const reviewReasons: string[] = []
  if (analysis.outcome !== 'analysis_ready') reviewReasons.push('The photo assessment requires additional photos or site review.')
  if (!analysis.photoQuality.length || analysis.photoQuality.some(photo => !photo.usable) || ['overview','lower','side'].some(role => !analysis.coverage.some(item => item.role === role && item.covered && item.photoIds.length))) reviewReasons.push('Usable photos must show the overall cabinets, lower fronts and sides.')
  const quantities = [analysis.quantities.doors, analysis.quantities.drawers]
  if (quantities.some((count, index) => count.needsConfirmation || count.observed === null || !Number.isInteger(count.observed) || count.observed < 0 || count.observed > 500 || count.customer !== count.observed || count.customer !== [service.doorCount, service.drawerCount][index]) || (service.doorCount ?? 0) + (service.drawerCount ?? 0) === 0) reviewReasons.push('Confirm the door and drawer quantities before calculating the estimate.')
  if (service.serviceId !== 'cabinet-painting' || !['full-repainting','colour-change'].includes(service.intent) || !service.surfaces.length || service.surfaces.some(surface => !['doors','drawers','repairs'].includes(surface)) || !service.surfaces.some(surface => ['doors','drawers'].includes(surface)) || ((service.doorCount ?? 0) > 0 && !service.surfaces.includes('doors')) || ((service.drawerCount ?? 0) > 0 && !service.surfaces.includes('drawers'))) reviewReasons.push('The requested service or additional surfaces need a separate scope review.')
  if (analysis.observedDamage.some(damage => damage.severity === 'severe' || ['swelling','joint_gap','other'].includes(damage.kind))) reviewReasons.push('Structural, swollen, severe or unclassified damage requires site review.')
  const result: LegacyCalculatedEstimatePricing = {status:reviewReasons.length ? 'review_required' : 'estimate_ready',currency:'AUD',pricingVersion:LEGACY_QUOTE_PRICING_VERSION,amountUnit:'cents',minimumSubtotal:150000,gstRateBps:1000,lineItems:[],subtotal:null,tax:null,total:null,reviewReasons,notice}
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

export const EXCLUDED_WORK_DESCRIPTIONS: Record<ExcludedEstimateWork['code'],string> = {
  structural_or_unclassified_repairs:'Severe, swollen, structural or unclassified repairs are not priced. The company must assess this work separately on site.',
  unverified_damage_scope:'Damage outside the selected door or drawer painting surfaces, outside the estimated scope, or with an unclassified surface is not priced. Confirm its relevance and repair needs on site.',
  additional_surfaces:'Frames, end panels and other additional surfaces are not included in this painting amount. Confirm separate work on site.',
  unseen_cabinetry:'This amount covers the cabinet fronts estimated from the primary overview and matching views. Unseen cabinetry and other project areas are not included.',
}
function isPricedDamage(damage:ProvisionalPhotoAnalysis['observedDamage'][number],analysis:ProvisionalPhotoAnalysis,service:ServiceDetails):boolean {
  return damage.estimateScope==='included'&&['doors','drawers'].includes(damage.surface)&&service.surfaces.includes(damage.surface)&&damage.photoIds.length>0&&damage.photoIds.every(id=>analysis.estimateScope.scopePhotoIds.includes(id)&&analysis.photoQuality.some(photo=>photo.photoId===id&&photo.usable))
}
function provisionalExclusions(analysis: ProvisionalPhotoAnalysis, service: ServiceDetails): ExcludedEstimateWork[] {
  const exclusions:ExcludedEstimateWork[]=[]
  const add=(code:ExcludedEstimateWork['code'],damageIds:string[]=[])=>exclusions.push({code,description:EXCLUDED_WORK_DESCRIPTIONS[code],damageIds})
  const structural=analysis.observedDamage.filter(damage=>isPricedDamage(damage,analysis,service)&&(damage.severity==='severe'||['swelling','joint_gap','other'].includes(damage.kind))).map(damage=>damage.id)
  const unverified=analysis.observedDamage.filter(damage=>!isPricedDamage(damage,analysis,service)).map(damage=>damage.id)
  if(structural.length)add('structural_or_unclassified_repairs',structural)
  if(unverified.length)add('unverified_damage_scope',unverified)
  if(service.surfaces.some(surface=>['frames','panels','unknown'].includes(surface)))add('additional_surfaces')
  if(analysis.estimateScope.extent==='primary_view')add('unseen_cabinetry')
  return exclusions
}
export function calculateEstimatePricing(analysis: PhotoAnalysis, service: ServiceDetails): ProvisionalEstimatePricing {
  return calculateProvisionalPricing(analysis, service, QUOTE_PRICING_VERSION)
}
export function calculatePreviousEstimatePricing(analysis: PhotoAnalysis, service: ServiceDetails): ProvisionalEstimatePricing {
  return calculateProvisionalPricing(analysis, service, PREVIOUS_QUOTE_PRICING_VERSION)
}
function calculateProvisionalPricing(analysis: PhotoAnalysis, service: ServiceDetails, version: ProvisionalEstimatePricing['pricingVersion']): ProvisionalEstimatePricing {
  const policy = quotePricingPolicy(version)
  const reasons:string[]=[]
  const provisional='estimateScope' in analysis?analysis:null
  const selectedDoors=service.surfaces.includes('doors'),selectedDrawers=service.surfaces.includes('drawers')
  const validCount=(value:unknown):value is number=>Number.isInteger(value)&&(value as number)>=0&&(value as number)<=500
  let doors=0,drawers=0
  if(!provisional||provisional.estimateScope.status!=='estimable'||!provisional.estimateScope.anchorPhotoId) reasons.push('A usable overview must support a defined painting scope before a provisional amount can be calculated.')
  if(service.serviceId!=='cabinet-painting'||!['full-repainting','colour-change'].includes(service.intent)||!selectedDoors&&!selectedDrawers) reasons.push('Select cabinet doors or drawer fronts for a supported painting service.')
  if(provisional){
    const scope=provisional.estimateScope
    const usable=(id:string)=>scope.scopePhotoIds.includes(id)&&provisional.photoQuality.some(photo=>photo.photoId===id&&photo.usable)
    const anchorPhotoId=scope.anchorPhotoId
    if(!anchorPhotoId||!usable(anchorPhotoId)||!provisional.coverage.some(item=>item.role==='overview'&&item.covered&&item.photoIds.includes(anchorPhotoId))||scope.extent==='whole_project'&&scope.conflictingPhotoIds.length) reasons.push('The estimate anchor and photo scope require confirmation.')
    for(const [selected,quantity]of [[selectedDoors,provisional.quantities.doors],[selectedDrawers,provisional.quantities.drawers]] as const){
      if(selected&&(!validCount(quantity.estimated)||!quantity.basisPhotoIds.length||quantity.basisPhotoIds.some(id=>!usable(id)))) reasons.push('The selected cabinet-front quantities need usable photo evidence before estimating.')
    }
    if(selectedDoors&&validCount(provisional.quantities.doors.estimated))doors=provisional.quantities.doors.estimated
    if(selectedDrawers&&validCount(provisional.quantities.drawers.estimated))drawers=provisional.quantities.drawers.estimated
  }
  if(doors+drawers===0)reasons.push('At least one selected cabinet front must be reasonably estimated from the photos.')
  const warnings=['This is a provisional painting amount. Confirm exact quantities, repair work and final price on site.']
  if(provisional&&(provisional.quantities.doors.needsConfirmation||provisional.quantities.drawers.needsConfirmation))warnings.push('Customer counts and photographed counts need confirmation; the amount uses the AI estimates for the selected fronts.')
  if(provisional&&[provisional.quantities.doors,provisional.quantities.drawers].some(quantity=>quantity.confidence==='low'))warnings.push('Some photo quantity estimates have low confidence and need particular attention on site.')
  const result:ProvisionalEstimatePricing={status:reasons.length?'review_required':'provisional_estimate',currency:'AUD',pricingVersion:version,amountUnit:'cents',minimumSubtotal:policy.minimumSubtotal,gstRateBps:policy.gstRateBps,lineItems:[],subtotal:null,tax:null,total:null,reviewReasons:[...new Set([...reasons,...warnings])],notice:`Provisional photo-based painting amount using L&K initial pricing rules, starting from ${version===QUOTE_PRICING_VERSION?'A$1,450. No GST charged. The supplier is not registered for GST.':'A$1,500 excluding GST.'} Ordinary preparation and minor coating repairs are included. AI quantities are indicative; exact quantities, materials, adhesion, hidden damage and final scope require site confirmation. Separately listed excluded work is not priced. This is not a confirmed booking or contract.`,amountScope:'painting_only',siteConfirmationRequired:true,basis:null,exclusions:provisional?provisionalExclusions(provisional,service):[]}
  if(reasons.length||!provisional)return result
  result.basis={type:'ai_estimated_quantities',extent:provisional.estimateScope.extent,anchorPhotoId:provisional.estimateScope.anchorPhotoId!,doors,drawers}
  const add=(code:string,label:string,quantity:number,unitAmount:number)=>{if(quantity&&unitAmount>0)result.lineItems.push({code,label,quantity,unitAmount,amount:quantity*unitAmount})}
  add('doors','Estimated cabinet door preparation and painting',doors,15000)
  add('drawers','Estimated drawer front preparation and painting',drawers,10000)
  const painting=result.lineItems.reduce((sum,item)=>sum+item.amount,0)
  add('minimum_adjustment','Minimum painting charge adjustment',1,Math.max(0,policy.minimumSubtotal-painting))
  if(provisional.observedDamage.some(damage=>isPricedDamage(damage,provisional,service)&&damage.severity==='moderate'&&['peeling','chipping','cracking'].includes(damage.kind)))add('moderate_repairs','Moderate coating repairs (once per estimated scope)',1,25000)
  result.subtotal=result.lineItems.reduce((sum,item)=>sum+item.amount,0);result.tax=Math.round(result.subtotal*policy.gstRateBps/10000);result.total=result.subtotal+result.tax
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
  const provisional=row.pricingVersion===QUOTE_PRICING_VERSION||row.pricingVersion===PREVIOUS_QUOTE_PRICING_VERSION
  if (![QUOTE_PRICING_VERSION, PREVIOUS_QUOTE_PRICING_VERSION, LEGACY_QUOTE_PRICING_VERSION].includes(row.pricingVersion as string)) return fail()
  const policy=quotePricingPolicy(row.pricingVersion as string)
  if (!hasKeys(['status','currency','pricingVersion','amountUnit','minimumSubtotal','gstRateBps','lineItems','subtotal','tax','total','reviewReasons','notice',...(provisional?['amountScope','siteConfirmationRequired','basis','exclusions']:[])]) || ![QUOTE_PRICING_VERSION,PREVIOUS_QUOTE_PRICING_VERSION,LEGACY_QUOTE_PRICING_VERSION].includes(row.pricingVersion as string) || row.amountUnit !== 'cents' || row.minimumSubtotal !== policy.minimumSubtotal || row.gstRateBps !== policy.gstRateBps || !Array.isArray(row.reviewReasons) || row.reviewReasons.length > 20 || !row.reviewReasons.every(text)) return fail()
  if(provisional){
    if(row.amountScope!=='painting_only'||row.siteConfirmationRequired!==true||!Array.isArray(row.exclusions)||row.exclusions.length>4)return fail()
    const codes=new Set<string>(),damageIds=new Set<string>()
    for(const value of row.exclusions){
      if(!value||typeof value!=='object'||Array.isArray(value))return fail()
      const item=value as Record<string,unknown>,code=item.code as ExcludedEstimateWork['code']
      if(Object.keys(item).length!==3||!['code','description','damageIds'].every(key=>Object.hasOwn(item,key))||!EXCLUDED_WORK_CODES.includes(code)||codes.has(code)||item.description!==EXCLUDED_WORK_DESCRIPTIONS[code]||!Array.isArray(item.damageIds)||item.damageIds.length>30)return fail()
      codes.add(code)
      if(['structural_or_unclassified_repairs','unverified_damage_scope'].includes(code)!==(item.damageIds.length>0))return fail()
      for(const id of item.damageIds){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||damageIds.has(id))return fail();damageIds.add(id)}
    }
    if(row.basis!==null){
      if(!row.basis||typeof row.basis!=='object'||Array.isArray(row.basis))return fail()
      const basis=row.basis as Record<string,unknown>
      if(Object.keys(basis).length!==5||!['type','extent','anchorPhotoId','doors','drawers'].every(key=>Object.hasOwn(basis,key))||basis.type!=='ai_estimated_quantities'||!['whole_project','primary_view'].includes(basis.extent as string)||typeof basis.anchorPhotoId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(basis.anchorPhotoId)||![basis.doors,basis.drawers].every(count=>Number.isInteger(count)&&(count as number)>=0&&(count as number)<=500)||(basis.doors as number)+(basis.drawers as number)===0)return fail()
      if((basis.extent==='primary_view')!==codes.has('unseen_cabinetry'))return fail()
    }
  }
  if (row.status === 'review_required') {
    if (!row.reviewReasons.length || row.lineItems.length || row.subtotal !== null || row.tax !== null || row.total !== null || provisional&&row.basis!==null) return fail()
  } else if (row.status === (provisional?'provisional_estimate':'estimate_ready')) {
    const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 20000000
    if (!provisional&&row.reviewReasons.length || provisional&&row.basis===null || !row.lineItems.length || row.lineItems.length > 4 || !integer(row.subtotal) || row.subtotal < policy.minimumSubtotal || !integer(row.tax) || !integer(row.total)) return fail()
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
    if (!painting || adjustment !== Math.max(0,policy.minimumSubtotal - painting) || sum !== row.subtotal || row.tax !== Math.round(row.subtotal * policy.gstRateBps / 10000) || row.total !== row.subtotal + row.tax) return fail()
    if(provisional){
      const basis=row.basis as NonNullable<ProvisionalEstimatePricing['basis']>
      if((lines.find(line=>line.code==='doors')?.quantity??0)!==basis.doors||(lines.find(line=>line.code==='drawers')?.quantity??0)!==basis.drawers)return fail()
    }
  } else return fail()
  return value as CalculatedEstimatePricing
}
