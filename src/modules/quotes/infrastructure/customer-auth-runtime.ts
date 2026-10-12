import { createCustomerAuthApi } from './customer-auth-api.ts'
import { customerAuthProvider, customerAuthStore } from './customer-auth-provider.ts'
import { quoteRequestStore } from './store.ts'
import { quoteRequestAccess } from './api.ts'
const api = createCustomerAuthApi({
 store: customerAuthStore, requests: quoteRequestStore, provider: customerAuthProvider,
 baseUrl: () => process.env.APP_BASE_URL, legacyUrl: () => process.env.QUOTE_LEGACY_BASE_URL,
 sessionKey: () => process.env.GOOGLE_TOKEN_ENCRYPTION_KEY, now: Date.now,
 enabled: () => process.env.QUOTE_LIVE_ENABLED === 'true', guestOwner: (req, legacy) => quoteRequestAccess.guestOwner(req, legacy),
})
export async function customerRequestOwner(req: Request) { return api.owner(req) }
export const customerQuoteGet = api.state, customerQuoteSendPost = api.send, customerQuoteVerifyPost = api.verify,
 customerQuoteSelectPost = api.select, customerQuoteLogoutPost = api.logout, customerQuoteHandoffPost = api.handoff
