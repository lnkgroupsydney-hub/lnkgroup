import type { LiveQuoteRequest, QuoteRequestOwner } from './contracts.ts'
export interface VerifiedQuoteCustomer { userId: string; email: string; authSessionId: string; accessToken: string; expiresAt: number }
export interface CustomerQuoteSession extends VerifiedQuoteCustomer { sessionId: string; currentRequestId: string | null }
export interface CustomerQuoteSummary { id: string; reference: string; status: LiveQuoteRequest['status']; savedAt: string; revision: number }
export interface CustomerQuoteState { customer: { email: string; expiresAt: string } | null; requests: CustomerQuoteSummary[]; currentRequestId: string | null }
export interface CustomerAuthProvider {
 send(email: string): Promise<void>
 verify(email: string, token: string): Promise<VerifiedQuoteCustomer>
 identity(accessToken: string): Promise<VerifiedQuoteCustomer>
}
export type CustomerOwnerResolver = (req: Request) => Promise<QuoteRequestOwner | null>
