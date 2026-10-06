// Server-only access boundary; the staff flag selects current Auth/MFA checks
// without falling back to a legacy cookie. Callers retain feature/origin gates.
export {requireSession} from './infrastructure/supabase-auth.ts'
export {sydneyLocalToInstant,AppError} from './domain/validation.ts'
