import type { QuoteRequestStore } from './requests.ts'
import { QuoteRequestError, type QuoteRequestOwner } from '../domain/contracts.ts'
import type { LiveBookingState } from '../domain/booking-flow.ts'

export function verifiedBookingOwnerArgs(owner: QuoteRequestOwner): Record<string, unknown> {
  if (!owner.customer) throw new QuoteRequestError(403, 'Verify your customer email before approving a booking request.')
  if (owner.expectedRequestId && owner.expectedRequestId !== owner.customer.requestId) throw new QuoteRequestError(409, 'The selected quote changed. Reload before continuing.')
  return { companyId: 'lk-group', ownerHash: owner.hash, expectedRequestId: owner.customer.requestId, customerAccess: owner.customer }
}
export function liveBookingFlow(store: QuoteRequestStore) {
  return {
    state: (owner: QuoteRequestOwner) => store.command<LiveBookingState>('state', verifiedBookingOwnerArgs(owner)),
    command: <T>(owner: QuoteRequestOwner, command: string, input: Record<string, unknown>) => store.command<T>(command, { ...input, ...verifiedBookingOwnerArgs(owner) }),
  }
}
