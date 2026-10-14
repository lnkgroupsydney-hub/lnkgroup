import { QUOTE_PRICING_VERSION, quotePricingPolicy } from './pricing.ts'

export const NO_GST_NOTICE = 'No GST charged. The supplier is not registered for GST.'

/** Display the saved price policy, including historical GST estimates. */
export function quotePricingDisplay(version: string = QUOTE_PRICING_VERSION) {
  const policy = quotePricingPolicy(version)
  const includesGst = policy.gstRateBps !== 0
  const startingTotal = policy.minimumSubtotal + Math.round(policy.minimumSubtotal * policy.gstRateBps / 10000)
  const startingAmount = `A$${new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 }).format(startingTotal / 100)}`
  return {
    includesGst,
    startingAmount,
    amountSuffix: includesGst ? 'incl GST' : 'no GST charged',
    taxStatus: includesGst ? 'Including GST' : 'No GST charged',
    taxStatusInline: includesGst ? 'including GST' : 'no GST charged',
    exGstSuffix: includesGst ? ' (ex GST)' : '',
    totalSuffix: includesGst ? ' (incl GST)' : '',
    notice: includesGst ? 'GST is included in this saved estimate.' : NO_GST_NOTICE,
  }
}
