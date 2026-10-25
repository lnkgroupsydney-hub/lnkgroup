import type { Customer, CustomerProperty, CustomerCandidate, ResolveCustomerInput, ResolveCustomerResult } from '../../customers/index.ts';
import { validatePropertyDecision, customerRequest, CustomerRequestError, reviewCandidates, reviewProperties, MutationAttempt, ReadLane } from '../../customers/request-client.ts';

export interface QuoteCrmRelation { requestId: string; crmRevision: number; customer: Customer | null; property: CustomerProperty | null }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function parseQuoteCrmRelation(value: unknown, requestId: string): QuoteCrmRelation {
  if (!record(value) || value.requestId !== requestId || !Number.isSafeInteger(value.crmRevision) || Number(value.crmRevision) < 0) throw new Error('The client relation could not be verified. Refresh before linking.');
  if (value.customer !== null && (!record(value.customer) || !uuid(value.customer.id) || value.customer.companyId !== 'lk-group' || typeof value.customer.name !== 'string' || !['active', 'archived'].includes(String(value.customer.status)) || !Number.isSafeInteger(value.customer.revision) || Number(value.customer.revision) < 1)) throw new Error('The linked client could not be verified.');
  if (value.property !== null && (!record(value.customer) || !record(value.property) || !uuid(value.property.id) || value.property.companyId !== 'lk-group' || value.property.customerId !== value.customer.id || !record(value.property.address) || typeof value.property.label !== 'string' || !Number.isSafeInteger(value.property.revision))) throw new Error('The linked property does not belong to this client.');
  return value as unknown as QuoteCrmRelation;
}

export interface QuoteCrmSource {
  requestId: string;
  revision: number;
  contact: { name: string; email: string; phone: string; siteAddress: string; suburb: string; postcode: string };
}
export interface QuoteCrmContext { source: QuoteCrmSource; relation: QuoteCrmRelation }
export type QuoteCrmDraft = Pick<ResolveCustomerInput, 'decision' | 'property' | 'propertyId' | 'expectedPropertyRevision'>;
type WorkingState = { context: QuoteCrmContext; draft: QuoteCrmDraft };
type PropertyReviewState = WorkingState & { kind: 'property_review'; properties: CustomerProperty[]; error: string | null };
type CustomerReviewState = WorkingState & { kind: 'customer_review'; candidates: CustomerCandidate[]; error: string | null };
export type QuoteCrmLinkState =
  | (WorkingState & { kind: 'ready'; error: string | null })
  | (WorkingState & { kind: 'saving'; request: ResolveCustomerInput })
  | PropertyReviewState
  | CustomerReviewState
  | (WorkingState & { kind: 'uncertain'; request: ResolveCustomerInput; message: string })
  | (WorkingState & { kind: 'conflict'; latest: QuoteCrmContext | null; refreshing: boolean; message: string; latestError: string | null })
  | { kind: 'saved'; context: QuoteCrmContext; result: ResolveCustomerResult }
  | { kind: 'access_lost' };
export interface QuoteCrmLinkOptions {
  initial: QuoteCrmContext;
  readLatest: (signal: AbortSignal) => Promise<QuoteCrmContext>;
  onChange?: (state: QuoteCrmLinkState) => void;
  onAccessLost?: () => void;
  newKey?: () => string;
}
export interface QuoteCrmLinkClient {
  getState(): QuoteCrmLinkState;
  save(draft: QuoteCrmDraft): Promise<void>;
  cancelReview(): void;
  useExistingProperty(id: string): Promise<void>;
  confirmDifferentProperty(reason: string): Promise<void>;
  retry(): Promise<void>;
  refreshConflict(): Promise<void>;
  restartFromLatest(): void;
  loseAccess(): void;
  dispose(): void;
}

const positiveRevision = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 1;
function validCustomer(value: unknown): value is Customer {
  return record(value) && uuid(value.id) && value.companyId === 'lk-group' && typeof value.name === 'string'
    && ['active', 'archived'].includes(String(value.status)) && positiveRevision(value.revision)
    && ['email', 'phone', 'address', 'archivedAt'].every(key => value[key] === null || typeof value[key] === 'string')
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}
function validProperty(value: unknown, customerId: string): value is CustomerProperty {
  return record(value) && uuid(value.id) && value.companyId === 'lk-group' && value.customerId === customerId
    && positiveRevision(value.revision) && ['active', 'archived'].includes(String(value.status))
    && typeof value.label === 'string' && record(value.address) && value.address.country === 'AU'
    && ['line1', 'suburb', 'state', 'postcode'].every(key => typeof (value.address as Record<string, unknown>)[key] === 'string')
    && (value.address.unit === null || typeof value.address.unit === 'string')
    && ['contactName', 'notes', 'archivedAt'].every(key => value[key] === null || typeof value[key] === 'string')
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}
function parseContext(value: QuoteCrmContext, requestId: string): QuoteCrmContext {
  if (!record(value) || !record(value.source) || value.source.requestId !== requestId || !uuid(requestId)
    || !positiveRevision(value.source.revision) || !record(value.source.contact)
    || !['name', 'email', 'phone', 'siteAddress', 'suburb', 'postcode'].every(key => typeof (value.source.contact as Record<string, unknown>)[key] === 'string')) throw new Error('The latest quote could not be verified. Refresh before linking.');
  const relation = parseQuoteCrmRelation(value.relation, requestId);
  if (relation.customer && !validCustomer(relation.customer) || relation.property && !validProperty(relation.property, relation.customer!.id)) throw new Error('The latest client relation could not be verified.');
  return structuredClone({ source: value.source, relation });
}
const reviewListValid = (values: { id: string }[]) => values.length > 0 && values.length <= 100 && new Set(values.map(value => value.id)).size === values.length;
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The client relation could not be saved.';

/** Review responses confirm no write occurred; uncertain responses retain the exact attempt. */
export function createQuoteCrmLinkClient({ initial, readLatest, onChange, onAccessLost, newKey = () => crypto.randomUUID() }: QuoteCrmLinkOptions): QuoteCrmLinkClient {
  let state: QuoteCrmLinkState = { kind: 'ready', context: parseContext(initial, initial.source.requestId), draft: {}, error: null };
  const attempt = new MutationAttempt<Omit<ResolveCustomerInput, 'idempotencyKey'>>(), reads = new ReadLane();
  let beforeSave: WorkingState | null = null, review: PropertyReviewState | CustomerReviewState | null = null;
  let controller: AbortController | null = null, generation = 0, disposed = false;
  const active = () => !disposed && state.kind !== 'access_lost';
  function publish(next: QuoteCrmLinkState) {
    state = structuredClone(next);
    // Presentation callbacks cannot change a confirmed server outcome.
    try { onChange?.(structuredClone(state)); } catch { /* The owner handles rendering errors. */ }
  }
  function clear(notify: boolean) {
    generation++; controller?.abort(); controller = null; reads.cancel(); attempt.clear(); beforeSave = null; review = null;
    if (notify) { publish({ kind: 'access_lost' }); onAccessLost?.(); }
    else state = { kind: 'access_lost' };
  }
  function denied(cause: unknown) {
    if (cause instanceof CustomerRequestError && [401, 403].includes(cause.status)) { clear(true); return true; }
    return false;
  }
  function requestValue(context: QuoteCrmContext, draft: QuoteCrmDraft): Omit<ResolveCustomerInput, 'idempotencyKey'> {
    const { source, relation } = context;
    return { name: source.contact.name, email: source.contact.email, phone: source.contact.phone,
      ...(draft.decision ? { decision: structuredClone(draft.decision) } : {}),
      ...(draft.property ? { property: structuredClone(draft.property) } : {}), ...(draft.propertyId ? { propertyId: draft.propertyId } : {}),
      ...(draft.expectedPropertyRevision !== undefined ? { expectedPropertyRevision: draft.expectedPropertyRevision } : {}),
      source: { type: 'quote_request', id: source.requestId, expectedCrmRevision: relation.crmRevision, expectedSourceRevision: source.revision } };
  }
  async function refreshConflict() {
    if (!active() || state.kind !== 'conflict') return;
    const lane = reads.begin(), original = state;
    publish({ ...original, refreshing: true, latestError: null });
    try {
      const value = await readLatest(lane.signal);
      if (!active() || !lane.current() || state.kind !== 'conflict') return;
      publish({ ...state, latest: parseContext(value, original.context.source.requestId), refreshing: false, latestError: null });
    } catch (cause) {
      if (!active() || !lane.current()) return;
      if (!denied(cause) && state.kind === 'conflict') publish({ ...state, refreshing: false, latest: null, latestError: message(cause) });
    }
  }
  async function conflict(context: QuoteCrmContext, draft: QuoteCrmDraft, error: string) {
    attempt.clear(); review = null;
    publish({ kind: 'conflict', context, draft, latest: null, refreshing: false, message: error, latestError: null });
    await refreshConflict();
  }
  function parseResult(value: ResolveCustomerResult, context: QuoteCrmContext, input: ResolveCustomerInput) {
    const changed = record(value) && record(value.customer) && (context.relation.customer?.id !== value.customer.id || value.property !== null && record(value.property) && context.relation.property?.id !== value.property.id);
    if (!record(value) || !['client_created', 'client_reused'].includes(String(value.outcome)) || !validCustomer(value.customer)
      || value.customer.status !== 'active' || !positiveRevision(value.crmRevision)
      || value.crmRevision !== context.relation.crmRevision + (changed ? 1 : 0)
      || (context.relation.customer && value.customer.id !== context.relation.customer.id)
      || (context.relation.property && value.property?.id !== context.relation.property.id)
      || (input.decision?.kind === 'existing' && value.customer.id !== input.decision.customerId)
      || (value.property !== null && (!validProperty(value.property, value.customer.id) || value.property.status !== 'active'))
      || (input.propertyId && value.property?.id !== input.propertyId)
      || (input.propertyId && value.property?.revision !== input.expectedPropertyRevision)
      || ((input.property || input.propertyId) && !value.property)
      || (value.property === null ? value.propertyOutcome !== null : !['property_created', 'property_reused'].includes(String(value.propertyOutcome)))) throw new Error('The saved client relation could not be verified. Retry the unchanged request to recover its result.');
    return parseContext({ source: context.source, relation: { requestId: context.source.requestId, crmRevision: value.crmRevision!, customer: value.customer, property: value.property } }, context.source.requestId);
  }
  async function send(context: QuoteCrmContext, draft: QuoteCrmDraft) {
    const snapshot = attempt.snapshot();
    if (!snapshot || !active()) return;
    const token = ++generation, input = snapshot.value;
    controller = new AbortController(); const signal = controller.signal;
    const timeout = setTimeout(() => controller?.abort(), 30_000);
    publish({ kind: 'saving', context, draft, request: input });
    try {
      if (!active() || generation !== token) return;
      const result = await customerRequest<ResolveCustomerResult>('/resolve', input, signal);
      if (!active() || generation !== token) return;
      const next = parseResult(result, context, input);
      attempt.clear(); beforeSave = null; review = null;
      publish({ kind: 'saved', context: next, result });
    } catch (cause) {
      if (!active() || generation !== token || denied(cause)) return;
      const properties = reviewProperties<unknown>(cause), candidates = reviewCandidates<unknown>(cause);
      if (properties) {
        const customerId = input.decision?.kind === 'existing' ? input.decision.customerId : input.decision?.kind !== 'different_person' ? context.relation.customer?.id : null;
        if (!input.property || !customerId || !properties.every(p => validProperty(p, customerId)) || !reviewListValid(properties as CustomerProperty[])) {
          await conflict(context, draft, 'The property candidates could not be verified. Compare the latest quote before restarting.'); return;
        }
        review = { kind: 'property_review', context, draft, properties: properties as CustomerProperty[], error: null };
        publish(review); return;
      }
      if (candidates) {
        if (!candidates.every(c => record(c) && validCustomer(c.customer) && Array.isArray(c.matchedBy) && c.matchedBy.every(m => ['email', 'phone', 'name'].includes(String(m)))) || !reviewListValid((candidates as CustomerCandidate[]).map(c => c.customer))) {
          await conflict(context, draft, 'The client candidates could not be verified. Compare the latest quote before restarting.'); return;
        }
        review = { kind: 'customer_review', context, draft, candidates: candidates as CustomerCandidate[], error: null };
        publish(review); return;
      }
      if (cause instanceof CustomerRequestError && cause.status === 409) { await conflict(context, draft, message(cause)); return; }
      if (cause instanceof CustomerRequestError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) {
        if (review) publish({ ...review, error: message(cause) });
        else { attempt.clear(); publish({ kind: 'ready', context, draft, error: message(cause) }); }
        return;
      }
      publish({ kind: 'uncertain', context, draft, request: input, message: 'The result is unknown. Retry the unchanged request before editing or leaving this review.' });
    } finally { clearTimeout(timeout); if (generation === token) controller = null; }
  }
  function replaceConfirmed(value: Omit<ResolveCustomerInput, 'idempotencyKey'>) {
    const key = attempt.snapshot()!.value.idempotencyKey;
    attempt.clear(); attempt.prepare(value, () => key);
  }
  async function save(draft: QuoteCrmDraft) {
    if (!active() || state.kind !== 'ready' && state.kind !== 'customer_review') return;
    const context = state.context, input = structuredClone(draft);
    if ((input.propertyId && !positiveRevision(input.expectedPropertyRevision)) || (!input.propertyId && input.expectedPropertyRevision !== undefined)) {
      publish({ ...state, draft: state.kind === 'ready' ? input : state.draft, error: 'Select a property with its reviewed revision before saving.' }); return;
    }
    if (state.kind === 'customer_review') {
      const decision = input.decision;
      const chosen = decision?.kind === 'existing' ? state.candidates.find(c => c.customer.id === decision.customerId)?.customer : null;
      const reviewed = decision?.kind === 'different_person' ? decision.reviewedCandidates : [];
      if (JSON.stringify({ property: input.property, propertyId: input.propertyId, expectedPropertyRevision: input.expectedPropertyRevision }) !== JSON.stringify({ property: state.draft.property, propertyId: state.draft.propertyId, expectedPropertyRevision: state.draft.expectedPropertyRevision })
        || !decision || decision.kind === 'auto' || !decision.reason.trim() || decision.reason.length > 500
        || (decision.kind === 'existing' && (!chosen || chosen.status !== 'active' || chosen.revision !== decision.expectedRevision))
        || (decision.kind === 'different_person' && (reviewed.length !== state.candidates.length || new Set(reviewed.map(c => c.id)).size !== reviewed.length || !state.candidates.every(c => reviewed.some(r => r.id === c.customer.id && r.revision === c.customer.revision))))) {
        publish({ ...state, error: 'Review the current candidates, keep the original property details and give a reason before saving.' }); return;
      }
      replaceConfirmed(requestValue(context, input));
    } else {
      beforeSave = { context: structuredClone(context), draft: structuredClone(input) }; review = null;
      attempt.prepare(requestValue(context, input), newKey);
    }
    await send(context, input);
  }
  async function propertyChoice(id: string | null, reason?: string) {
    if (!active() || state.kind !== 'property_review') return;
    const current = state;
    if (id !== null && !current.properties.some(p => p.id === id && p.status === 'active')) { publish({ ...current, error: 'Choose an active property from the current review.' }); return; }
    let propertyDecision;
    if (id === null) {
      try { propertyDecision = validatePropertyDecision({ kind: 'different_property', reason, reviewedProperties: current.properties.map(p => ({ id: p.id, revision: p.revision })) }); }
      catch (cause) { publish({ ...current, error: message(cause) }); return; }
    }
    const base = requestValue(current.context, current.draft);
    delete base.property; delete base.propertyId; delete base.expectedPropertyRevision;
    const value = id !== null ? { ...base, propertyId: id, expectedPropertyRevision: current.properties.find(p => p.id === id)!.revision } : { ...base, property: current.draft.property, propertyDecision };
    replaceConfirmed(value);
    await send(current.context, current.draft);
  }
  return {
    getState: () => structuredClone(state), save,
    cancelReview() {
      if (!active() || !['property_review', 'customer_review'].includes(state.kind) || !beforeSave) return;
      const previous = beforeSave; attempt.clear(); beforeSave = null; review = null;
      publish({ kind: 'ready', ...previous, error: null });
    },
    useExistingProperty: id => propertyChoice(id), confirmDifferentProperty: reason => propertyChoice(null, reason),
    async retry() { if (active() && state.kind === 'uncertain') await send(state.context, state.draft); },
    refreshConflict,
    restartFromLatest() {
      if (!active() || state.kind !== 'conflict' || state.refreshing || !state.latest) return;
      reads.cancel(); attempt.clear(); beforeSave = null; review = null;
      publish({ kind: 'ready', context: state.latest, draft: {}, error: null });
    },
    loseAccess() { if (active()) clear(true); },
    dispose() { if (!disposed) { disposed = true; clear(false); } },
  };
}
