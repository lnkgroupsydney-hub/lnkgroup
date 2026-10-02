import { validateQuoteDraft, type QuoteDraft, type QuoteDraftInput } from '../domain/quote-draft.ts';
export interface QuoteDraftRepository {
  read(ownerHash: string): Promise<QuoteDraft | null>;
  save(ownerHash: string, expiresAt: string, revision: number, payload: QuoteDraftInput): Promise<QuoteDraft>;
}
export function quoteDrafts(repository: QuoteDraftRepository) {
  return {
    read: (ownerHash: string) => repository.read(ownerHash),
    save(ownerHash: string, expiresAt: string, revision: number, input: unknown) {
      return repository.save(ownerHash, expiresAt, revision, validateQuoteDraft(input));
    },
  };
}
