// Public framework-free input contract, shared by demo and live quote capture.
export { validateQuoteDraft, DraftValidationError, PROJECT_INTENTS, TARGET_SURFACES } from './domain/quote-draft.ts'
export type { QuoteDraftInput, ContactDetails, ServiceDetails } from './domain/quote-draft.ts'
