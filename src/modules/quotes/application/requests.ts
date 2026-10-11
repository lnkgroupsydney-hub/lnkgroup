import { LIVE_STORAGE_CONSENT_VERSION, type LiveQuoteRequest, type QuoteRequestActor, type QuoteRequestOwner, type ReviewQuoteRequestInput, type SaveQuoteRequestInput, QuoteRequestError } from '../domain/contracts.ts'
export interface QuoteRequestStore { command<T>(command: string, args: Record<string, unknown>): Promise<T> }
export function quoteRequests(store: QuoteRequestStore) {
  const ownerArgs = (owner: QuoteRequestOwner) => ({ companyId: 'lk-group', ownerHash: owner.hash, expiresAt: owner.expiresAt })
  return {
    read: (owner: QuoteRequestOwner) => store.command<LiveQuoteRequest | null>('read', ownerArgs(owner)),
    save: (owner: QuoteRequestOwner, input: SaveQuoteRequestInput) => store.command<LiveQuoteRequest>('save', { ...ownerArgs(owner), ...input, consentVersion: LIVE_STORAGE_CONSENT_VERSION }),
    review: (owner: QuoteRequestOwner, input: ReviewQuoteRequestInput) => store.command<LiveQuoteRequest>('request_review', { ...ownerArgs(owner), ...input }),
    staff: <T>(actor: QuoteRequestActor, command: 'list' | 'detail', args: Record<string, unknown>) => {
      if (actor.companyId !== 'lk-group') throw new QuoteRequestError(403, 'Company access denied.')
      return store.command<T>(command, { ...args, companyId: actor.companyId, actorUserId: actor.userId, actorSessionId: actor.sessionId })
    },
  }
}
