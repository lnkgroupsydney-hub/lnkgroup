'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Customer, CustomerCandidate, CustomerDetail, CustomerPage, CustomerProperty, PropertyInput, ResolveCustomerInput, ResolveCustomerResult } from '@/modules/customers';
import { customerRequest, CustomerRequestError, CustomerCandidateReview, CustomerPropertyReview } from '@/modules/customers/client';
import { WorkspaceLink, useUnsavedChanges, useWorkspaceNavigation } from '@/shared/ui/admin-workspace-state';
import type { LiveQuoteRequest } from '../index';
import { liveRequest, LiveRequestError, parseLiveRequest } from './request-client';
import { createQuoteCrmLinkClient, parseQuoteCrmRelation, type QuoteCrmContext, type QuoteCrmDraft, type QuoteCrmLinkClient, type QuoteCrmLinkState } from './quote-crm-client';

type Form = { selected: string; propertyId: string; reason: string; different: boolean; site: PropertyInput };
type Contact = QuoteCrmContext['source']['contact'];

const denied = (cause: unknown) => cause instanceof CustomerRequestError && [401, 403].includes(cause.status);
const aborted = (cause: unknown) => cause instanceof DOMException && cause.name === 'AbortError';
const failure = (cause: unknown, fallback: string) => cause instanceof Error && cause.message ? cause.message : fallback;
const address = (value: PropertyInput['address']) => [value.unit ? `Unit ${value.unit}` : '', value.line1, value.suburb, value.state, value.postcode].filter(Boolean).join(', ');
const siteFor = (contact?: Contact): PropertyInput => ({ label: '', address: { line1: contact?.siteAddress ?? '', unit: null, suburb: contact?.suburb ?? '', state: '', postcode: contact?.postcode ?? '', country: 'AU' }, contactName: null, notes: null });
const formFor = (context: QuoteCrmContext | null): Form => ({ selected: context?.relation.customer?.id ?? '', propertyId: context?.relation.property?.id ?? '', reason: '', different: false, site: siteFor(context?.source.contact) });
const savedMessage = (result: ResolveCustomerResult) => result.outcome === 'client_created' ? 'Client created and linked. The original quote and customer access were preserved.' : 'Existing client linked. The original quote and customer access were preserved.';
const reviewKinds = new Set(['property_review', 'customer_review']);
const blockingKinds = new Set(['saving', 'uncertain', 'property_review', 'customer_review', 'conflict']);

/** Reads the current quote and CRM relation. Lost staff access always surfaces as CustomerRequestError. */
async function readQuoteCrmContext(requestId: string, signal: AbortSignal): Promise<QuoteCrmContext> {
  const id = encodeURIComponent(requestId), timed = AbortSignal.any([signal, AbortSignal.timeout(25_000)]);
  const [quote, relation] = await Promise.allSettled([
    liveRequest(`/api/admin/quote-requests/${id}`, { signal: timed }),
    customerRequest<unknown>(`/quote-requests/${id}`, undefined, timed),
  ]);
  const causes = [quote, relation].flatMap(item => item.status === 'rejected' ? [item.reason as unknown] : []);
  const lost = causes.find(cause => denied(cause) || cause instanceof LiveRequestError && [401, 403].includes(cause.status));
  if (lost) throw lost instanceof LiveRequestError ? new CustomerRequestError(lost.message, lost.status) : lost;
  if (causes.length || quote.status !== 'fulfilled' || relation.status !== 'fulfilled') {
    const cause = causes[0];
    if (signal.aborted || aborted(cause)) throw cause;
    if (cause instanceof DOMException || cause instanceof TypeError) throw new Error('The latest quote and client relation could not be loaded. Check the connection and retry.');
    throw cause instanceof Error ? cause : new Error('The latest quote and client relation could not be loaded. Retry.');
  }
  const latest = parseLiveRequest(quote.value.request);
  if (latest.id !== requestId) throw new Error('The latest quote did not match this request. Refresh before linking.');
  const { name, email, phone, siteAddress, suburb, postcode } = latest.payload.contact;
  return { source: { requestId, revision: latest.revision, contact: { name, email, phone, siteAddress, suburb, postcode } }, relation: parseQuoteCrmRelation(relation.value, requestId) };
}

async function readMatches(context: QuoteCrmContext, signal: AbortSignal): Promise<CustomerCandidate[]> {
  if (context.relation.customer) return [{ customer: context.relation.customer, matchedBy: [] }];
  const { name, email, phone } = context.source.contact;
  return (await customerRequest<{ candidates: CustomerCandidate[] }>('/candidates', { name, email, phone }, signal)).candidates;
}

function ContextSummary({ title, context }: { title: string; context: QuoteCrmContext }) {
  const { source, relation } = context;
  return <div><p><strong>{title}</strong></p><dl>
    <div><dt>Quote contact</dt><dd>Revision {source.revision} · {source.contact.name} · {source.contact.email || 'No email'} · {source.contact.phone || 'No phone'}</dd></div>
    <div><dt>Quote site</dt><dd>{[source.contact.siteAddress, source.contact.suburb, source.contact.postcode].filter(Boolean).join(', ') || 'No site address'}</dd></div>
    <div><dt>Linked client</dt><dd>CRM revision {relation.crmRevision} · {relation.customer ? `${relation.customer.name} (${relation.customer.status}, revision ${relation.customer.revision})` : 'No client linked'}</dd></div>
    <div><dt>Linked property</dt><dd>{relation.property ? `${relation.property.label} · ${address(relation.property.address)} (revision ${relation.property.revision})` : 'No property linked'}</dd></div>
  </dl></div>;
}

/** Summarises the exact request the state machine fixed, never the editable form. */
function SubmittedSummary({ title, request, customers, properties }: { title: string; request: ResolveCustomerInput; customers: Customer[]; properties: CustomerProperty[] }) {
  const decision = request.decision, existing = decision?.kind === 'existing' ? customers.find(item => item.id === decision.customerId) : undefined;
  const chosenProperty = request.propertyId ? properties.find(item => item.id === request.propertyId) : undefined;
  const client = decision?.kind === 'existing' ? `Existing client: ${existing?.name ?? 'Selected client'} (reviewed revision ${decision.expectedRevision})`
    : decision?.kind === 'different_person' ? `New client for ${request.name}, confirmed as different from ${decision.reviewedCandidates.length} reviewed ${decision.reviewedCandidates.length === 1 ? 'match' : 'matches'}`
    : `Match the quote contact: ${request.name}${request.email ? ` · ${request.email}` : ''}`;
  const property = request.propertyId ? `Existing property: ${chosenProperty ? `${chosenProperty.label} · ${address(chosenProperty.address)}` : 'Selected property'} (reviewed revision ${request.expectedPropertyRevision ?? 'not recorded'})`
    : request.property ? `${request.propertyDecision ? 'Separate new property' : 'New property'}: ${request.property.label} · ${address(request.property.address)}` : 'No property';
  return <div><p><strong>{title}</strong></p><dl>
    <div><dt>Client</dt><dd>{client}</dd></div>
    {decision && decision.kind !== 'auto' && <div><dt>Client review reason</dt><dd>{decision.reason}</dd></div>}
    <div><dt>Property</dt><dd>{property}</dd></div>
    {request.propertyDecision && <div><dt>Property review</dt><dd>Compared {request.propertyDecision.reviewedProperties.length} saved {request.propertyDecision.reviewedProperties.length === 1 ? 'property' : 'properties'} · Reason: {request.propertyDecision.reason}</dd></div>}
    <div><dt>Checked against</dt><dd>Quote revision {request.source?.expectedSourceRevision} · CRM revision {request.source?.expectedCrmRevision}</dd></div>
  </dl></div>;
}

export function QuoteClientLinker({ request, active, onAccessLost }: { request: LiveQuoteRequest; active: boolean; onAccessLost: () => void }) {
  const [link, setLink] = useState<QuoteCrmLinkState | null>(null);
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<Form>(() => formFor(null)), [formError, setFormError] = useState('');
  const [candidates, setCandidates] = useState<CustomerCandidate[]>([]), [matching, setMatching] = useState(false);
  const [search, setSearch] = useState(''), [searchMatches, setSearchMatches] = useState<CustomerCandidate[]>([]), [searching, setSearching] = useState(false);
  const [properties, setProperties] = useState<CustomerProperty[]>([]), [contextVersion, setContextVersion] = useState(0), [lookupError, setLookupError] = useState('');
  const [reviewedProperties, setReviewedProperties] = useState<CustomerProperty[]>([]), [reviewedCustomers, setReviewedCustomers] = useState<Customer[]>([]);
  const [reviewReason, setReviewReason] = useState(''), [reviewConfirmed, setReviewConfirmed] = useState(false), [reviewError, setReviewError] = useState('');
  const [notice, setNotice] = useState(''), [ended, setEnded] = useState(false);
  const client = useRef<QuoteCrmLinkClient | null>(null), alive = useRef(false), blocked = useRef(false), access = useRef(onAccessLost);
  const initAbort = useRef<AbortController | null>(null), matchAbort = useRef<AbortController | null>(null), searchAbort = useRef<AbortController | null>(null), detailAbort = useRef<AbortController | null>(null);
  const initializeRef = useRef<() => Promise<void>>(async () => {});
  const sectionHeading = useRef<HTMLHeadingElement>(null), stateHeading = useRef<HTMLHeadingElement>(null), statusRegion = useRef<HTMLDivElement>(null), saveButton = useRef<HTMLButtonElement>(null);
  const navigate = useWorkspaceNavigation(), router = useRouter();
  useEffect(() => { access.current = onAccessLost; }, [onAccessLost]);

  const lost = useCallback(() => {
    if (blocked.current) return;
    blocked.current = true;
    [initAbort, matchAbort, searchAbort, detailAbort].forEach(ref => ref.current?.abort());
    const current = client.current; client.current = null; current?.dispose();
    setLink({ kind: 'access_lost' }); setForm(formFor(null)); setFormError(''); setCandidates([]); setMatching(false); setSearch(''); setSearchMatches([]); setSearching(false);
    setProperties([]); setLookupError(''); setReviewedProperties([]); setReviewedCustomers([]); setReviewReason(''); setReviewConfirmed(false); setReviewError('');
    setNotice(''); setLoadError(''); setLoading(false); setEnded(true);
    access.current();
  }, []);
  const lookupFailed = useCallback((cause: unknown, fallback: string) => {
    if (!alive.current || blocked.current || aborted(cause)) return;
    if (denied(cause)) { if (client.current) client.current.loseAccess(); else lost(); return; }
    setLookupError(failure(cause, fallback));
  }, [lost]);
  const resetForContext = useCallback((context: QuoteCrmContext) => {
    setForm(formFor(context)); setFormError(''); setSearch(''); setSearchMatches([]); setProperties([]); setLookupError('');
    setReviewedProperties([]); setReviewedCustomers([]); setReviewReason(''); setReviewConfirmed(false); setReviewError(''); setContextVersion(value => value + 1);
  }, []);

  const initialize = useCallback(async () => {
    if (blocked.current) return;
    initAbort.current?.abort(); matchAbort.current?.abort();
    const controller = new AbortController(); initAbort.current = controller; setLoading(true); setLoadError('');
    try {
      const context = await readQuoteCrmContext(request.id, controller.signal);
      const matches = await readMatches(context, controller.signal);
      if (!alive.current || blocked.current || controller.signal.aborted) return;
      client.current?.dispose();
      const next: QuoteCrmLinkClient = createQuoteCrmLinkClient({
        initial: context,
        readLatest: signal => readQuoteCrmContext(request.id, signal),
        onChange: value => {
          if (!alive.current || client.current !== next) return;
          setLink(value);
          if (value.kind === 'property_review') setReviewedProperties(value.properties);
          if (value.kind === 'customer_review') setReviewedCustomers(value.candidates.map(item => item.customer));
          if (value.kind === 'saved') { setNotice(savedMessage(value.result)); void Promise.resolve().then(() => initializeRef.current()); }
        },
        onAccessLost: () => { if (client.current === next) lost(); },
      });
      client.current = next; setLink(next.getState()); setCandidates(matches); resetForContext(context);
    } catch (cause) {
      if (controller.signal.aborted || !alive.current || blocked.current) return;
      if (denied(cause)) { lost(); return; }
      setLoadError(failure(cause, 'The client relation could not be loaded. Retry.'));
    } finally { if (initAbort.current === controller && alive.current && !blocked.current) setLoading(false); }
  }, [request.id, lost, resetForContext]);
  useEffect(() => { initializeRef.current = initialize; }, [initialize]);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; [initAbort, matchAbort, searchAbort, detailAbort].forEach(ref => ref.current?.abort()); client.current?.dispose(); client.current = null; };
  }, []);
  useEffect(() => {
    if (!active || link || blocked.current) return;
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) void initialize(); });
    return () => { cancelled = true; };
  }, [active, link, initialize]);

  const selected = form.selected;
  useEffect(() => {
    if (!selected || blocked.current) return;
    const controller = new AbortController(); detailAbort.current?.abort(); detailAbort.current = controller;
    void customerRequest<CustomerDetail>(`/${encodeURIComponent(selected)}`, undefined, controller.signal).then(value => {
      if (alive.current && !blocked.current && !controller.signal.aborted && value.customer.id === selected) setProperties(value.properties);
    }).catch(cause => { if (!controller.signal.aborted) lookupFailed(cause, 'Saved properties for this client could not be loaded. Choose the client again to retry.'); });
    return () => controller.abort();
  }, [selected, contextVersion, lookupFailed]);

  const kind = link?.kind, context = link && 'context' in link ? link.context : null;
  const available = [...new Map([...candidates, ...searchMatches].map(item => [item.customer.id, item])).values()];
  const chosen = available.find(item => item.customer.id === form.selected)?.customer;
  const linkedProperty = context?.relation.property?.customerId === form.selected ? context.relation.property : null;
  const propertyOptions = [...new Map([...(linkedProperty ? [linkedProperty] : []), ...properties.filter(item => item.customerId === form.selected && item.status === 'active')].map(item => [item.id, item])).values()];
  const stale = kind === 'ready' && Boolean(context) && request.revision > context!.source.revision;
  const editable = kind === 'ready' && !loading && !matching;
  const knownCustomers = [...available.map(item => item.customer), ...reviewedCustomers, ...(context?.relation.customer ? [context.relation.customer] : [])];
  const knownProperties = [...propertyOptions, ...reviewedProperties];

  const discard = useCallback(() => {
    const current = client.current; if (!current) return;
    const state = current.getState();
    if (state.kind === 'saving' || state.kind === 'uncertain') return;
    if (reviewKinds.has(state.kind)) current.cancelReview();
    const after = current.getState();
    if (after.kind === 'ready') setForm(formFor(after.context));
    setFormError(''); setReviewReason(''); setReviewConfirmed(false); setReviewError('');
  }, []);
  const formDirty = kind === 'ready' && Boolean(context) && Boolean(form.reason || form.different || form.selected !== (context!.relation.customer?.id ?? '') || form.propertyId !== (context!.relation.property?.id ?? ''));
  useUnsavedChanges(`quote-client:${request.id}`, { dirty: formDirty || blockingKinds.has(kind ?? ''), busy: kind === 'saving' || kind === 'uncertain', onDiscard: discard });

  const previousKind = useRef<string | undefined>(undefined);
  useEffect(() => {
    const previous = previousKind.current; previousKind.current = kind;
    if (!kind || kind === previous) return;
    const frame = requestAnimationFrame(() => {
      if (['property_review', 'customer_review', 'conflict', 'uncertain'].includes(kind)) stateHeading.current?.focus();
      else if (kind === 'saved') statusRegion.current?.focus();
      else if (kind === 'ready' && previous && reviewKinds.has(previous)) saveButton.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [kind]);

  async function findExisting() {
    if (!search.trim() || !editable || blocked.current) return;
    searchAbort.current?.abort(); const controller = new AbortController(); searchAbort.current = controller; setSearching(true); setLookupError('');
    try {
      const value = await customerRequest<CustomerPage>(`?${new URLSearchParams({ q: search, status: 'all', page: '1', pageSize: '20' })}`, undefined, controller.signal);
      if (alive.current && !blocked.current && !controller.signal.aborted) setSearchMatches(value.customers.map(customer => ({ customer, matchedBy: [] })));
    } catch (cause) { if (!controller.signal.aborted) lookupFailed(cause, 'Client search could not be completed. Retry the search.'); }
    finally { if (alive.current && !blocked.current && searchAbort.current === controller) setSearching(false); }
  }
  function buildDraft(): QuoteCrmDraft | string {
    const candidate = available.find(item => item.customer.id === form.selected);
    if (form.selected && !candidate) return 'The selected client is no longer in this review. Refresh the client relation and choose again.';
    if (candidate?.customer.status === 'archived') return 'Restore the client before creating a new relation.';
    const reason = form.reason.trim();
    if ((candidate || form.different) && !reason) return 'Enter a review reason before saving.';
    const decision: QuoteCrmDraft['decision'] = candidate ? { kind: 'existing', customerId: candidate.customer.id, expectedRevision: candidate.customer.revision, reason }
      : form.different ? { kind: 'different_person', reason, reviewedCandidates: candidates.map(item => ({ id: item.customer.id, revision: item.customer.revision })) } : { kind: 'auto' };
    if (form.propertyId === 'new') {
      const site = form.site, unit = site.address.unit?.trim();
      return { decision, property: { ...site, label: site.label.trim(), address: { ...site.address, line1: site.address.line1.trim(), unit: unit || null, suburb: site.address.suburb.trim(), state: site.address.state.trim(), postcode: site.address.postcode.trim() } } };
    }
    if (form.propertyId) {
      const property = propertyOptions.find(item => item.id === form.propertyId);
      if (!property) return 'The selected property is no longer available. Choose the property again.';
      return { decision, propertyId: property.id, expectedPropertyRevision: property.revision };
    }
    return { decision };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const current = client.current; if (!current || blocked.current) return;
    if (kind === 'uncertain') { await current.retry(); return; }
    if (!editable || stale) return;
    const draft = buildDraft();
    if (typeof draft === 'string') { setFormError(draft); return; }
    setFormError(''); setNotice(''); setReviewReason(''); setReviewConfirmed(false); setReviewError('');
    await current.save(draft);
  }
  function cancelReview() {
    client.current?.cancelReview(); setReviewReason(''); setReviewConfirmed(false); setReviewError('');
  }
  async function restartFromLatest() {
    const current = client.current; if (!current) return;
    current.restartFromLatest();
    const next = current.getState();
    if (next.kind !== 'ready') return;
    resetForContext(next.context); setNotice(''); setCandidates([]);
    matchAbort.current?.abort(); const controller = new AbortController(); matchAbort.current = controller; setMatching(true);
    requestAnimationFrame(() => sectionHeading.current?.focus());
    try { const matches = await readMatches(next.context, controller.signal); if (alive.current && !blocked.current && !controller.signal.aborted) setCandidates(matches); }
    catch (cause) { if (!controller.signal.aborted) lookupFailed(cause, 'Matching clients could not be loaded. Refresh the client relation to retry.'); }
    finally { if (alive.current && !blocked.current && matchAbort.current === controller) setMatching(false); }
  }

  const headingId = `quote-client-${request.id}`, fieldId = (name: string) => `quote-client-${name}-${request.id}`;
  if (ended || kind === 'access_lost') return <section className="ems-panel" aria-labelledby={headingId}><h3 id={headingId}>Client and property</h3><p className="ems-feedback" role="alert">Company access ended. Sign in again to review the client relation.</p></section>;

  const statusLines = [
    loading && !link ? 'Loading client relation…' : '',
    loading && kind === 'saved' ? 'Loading the updated client relation…' : '',
    matching ? 'Loading matching clients for the latest quote…' : '',
    searching ? 'Searching clients…' : '',
    kind === 'saving' ? 'Sending the client relation. Stay on this page until the result is known.' : '',
    link?.kind === 'conflict' && link.refreshing ? 'Loading the latest quote and client relation…' : '',
  ].filter(Boolean);
  const readyError = formError || (link?.kind === 'ready' ? link.error : null);
  const reviewCustomerName = link && 'draft' in link ? (link.draft.decision?.kind === 'existing' ? knownCustomers.find(item => item.id === (link.draft.decision as { customerId: string }).customerId)?.name : link.context.relation.customer?.name) : undefined;

  return <section className="ems-panel" aria-labelledby={headingId}><h3 id={headingId} ref={sectionHeading} tabIndex={-1}>Client and property</h3>
    <p>Review the client before linking this saved quote. Matching contact details are suggestions; they do not merge people. Customer email verification is required for a new quote relation.</p>
    {stale && context && <div className="ems-feedback" role="alert"><p>The quote changed after this review began. Your input is preserved; review the latest source before saving.</p><p>Reviewed revision {context.source.revision}: {context.source.contact.name} · {context.source.contact.email} · {context.source.contact.siteAddress}</p><p>Latest revision {request.revision}: {request.payload.contact.name} · {request.payload.contact.email} · {request.payload.contact.siteAddress}</p><button type="button" className="ems-button ems-button--secondary" disabled={loading} onClick={() => void initialize()}>Review latest quote and restart linking</button><p>This restarts the client selection and new property form with the latest quote.</p></div>}
    <div ref={statusRegion} tabIndex={-1} role="status" aria-live="polite" className={statusLines.length || notice ? 'ems-feedback' : undefined}>{notice && <span className="block">{notice}</span>}{statusLines.map(line => <span className="block" key={line}>{line}</span>)}</div>
    {loadError && <div className="ems-feedback ems-feedback--error" role="alert"><p>{loadError}{link ? ' The details below are the last loaded version.' : ''}</p><button type="button" className="ems-button ems-button--secondary" disabled={loading} onClick={() => void initialize()}>Retry client relation</button></div>}
    {lookupError && <p role="alert" className="ems-feedback ems-feedback--error">{lookupError}</p>}

    {link?.kind === 'saved' && <div className="ems-summary"><div><strong>{link.result.customer.name}</strong><p>Client: {link.result.customer.status} · CRM revision {link.context.relation.crmRevision}</p><p>{link.result.property ? `${link.result.propertyOutcome === 'property_created' ? 'New property saved' : 'Existing property linked'}: ${link.result.property.label} · ${address(link.result.property.address)}` : 'No property linked.'}</p></div><div><WorkspaceLink className="ems-button ems-button--secondary" href={`/admin/customers/${link.result.customer.id}`}>Open linked client</WorkspaceLink></div></div>}
    {link?.kind !== 'saved' && context?.relation.customer && <div className="ems-summary"><div><strong>{context.relation.customer.name}</strong><p>Client: {context.relation.customer.status} · CRM revision {context.relation.crmRevision}</p><p>{context.relation.property ? `${context.relation.property.label} · ${address(context.relation.property.address)}` : 'No property linked yet.'}</p></div><div><WorkspaceLink className="ems-button ems-button--secondary" href={`/admin/customers/${context.relation.customer.id}`}>Open linked client</WorkspaceLink></div></div>}

    {link?.kind === 'property_review' && <div className="ems-stack">
      <div className="ems-feedback"><h4 ref={stateHeading} tabIndex={-1}>Nothing was saved yet: check the property</h4><p>The new property may be a saved location for {reviewCustomerName ?? 'this client'}. Use an existing property, confirm a separate property with a reason, or cancel to return to your form unchanged.</p></div>
      {(link.error || reviewError) && <p role="alert" className="ems-feedback ems-feedback--error">{reviewError || link.error} Correct the choice below or cancel the review.</p>}
      <CustomerPropertyReview properties={link.properties} entered={link.draft.property} archivedSelectable={false} disabled={false} reason={reviewReason} onReason={value => { setReviewReason(value); setReviewError(''); }} confirmed={reviewConfirmed} onConfirmed={setReviewConfirmed} onExisting={property => { setReviewError(''); void client.current?.useExistingProperty(property.id); }} />
      <div className="ems-actions"><button type="button" className="ems-button" disabled={!reviewConfirmed || !reviewReason.trim()} onClick={() => void client.current?.confirmDifferentProperty(reviewReason.trim())}>Confirm separate property</button><button type="button" className="ems-button ems-button--secondary" onClick={cancelReview}>Cancel review</button></div>
      <p className="ems-list-meta">Cancel keeps your form exactly as entered. Nothing is saved until you choose an existing property or confirm a separate one.</p>
    </div>}

    {link?.kind === 'customer_review' && <div className="ems-stack">
      <div className="ems-feedback"><h4 ref={stateHeading} tabIndex={-1}>Nothing was saved yet: check the client</h4><p>Saved clients share details with this quote contact. Use an existing client, confirm a different person or company with a reason, or cancel to return to your form unchanged. The property choice stays as entered.</p></div>
      {(link.error || reviewError) && <p role="alert" className="ems-feedback ems-feedback--error">{reviewError || link.error}</p>}
      <CustomerCandidateReview candidates={link.candidates} disabled={false} reason={reviewReason} onReason={value => { setReviewReason(value); setReviewError(''); }} confirmed={reviewConfirmed} onConfirmed={setReviewConfirmed} onExisting={customer => {
        if (customer.status === 'archived') { navigate(() => router.push(`/admin/customers/${encodeURIComponent(customer.id)}`)); return; }
        if (!reviewReason.trim()) { setReviewError('Enter the client review reason before using an existing client.'); return; }
        void client.current?.save({ ...link.draft, decision: { kind: 'existing', customerId: customer.id, expectedRevision: customer.revision, reason: reviewReason.trim() } });
      }} />
      <div className="ems-actions"><button type="button" className="ems-button" disabled={!reviewConfirmed || !reviewReason.trim()} onClick={() => void client.current?.save({ ...link.draft, decision: { kind: 'different_person', reason: reviewReason.trim(), reviewedCandidates: link.candidates.map(item => ({ id: item.customer.id, revision: item.customer.revision })) } })}>Link as a reviewed different client</button><button type="button" className="ems-button ems-button--secondary" onClick={cancelReview}>Cancel review</button></div>
    </div>}

    {link?.kind === 'conflict' && <div className="ems-feedback ems-feedback--error">
      <h4 ref={stateHeading} tabIndex={-1}>The quote or client relation changed</h4>
      <p>{link.message} Nothing from this attempt is shown as saved. Compare the details, then restart from the latest version. Your entries below stay visible until you restart.</p>
      <div className="ems-summary">
        <ContextSummary title="When you started" context={link.context} />
        {link.latest ? <ContextSummary title="Latest saved" context={link.latest} /> : <div><p><strong>Latest saved</strong></p><p>{link.refreshing ? 'Loading…' : 'Not loaded yet.'}</p></div>}
      </div>
      {link.latestError && <div role="alert"><p>The latest details could not be loaded: {link.latestError}</p><button type="button" className="ems-button ems-button--secondary" disabled={link.refreshing} onClick={() => void client.current?.refreshConflict()}>Retry loading latest details</button></div>}
      <div className="ems-actions"><button type="button" className="ems-button" disabled={!link.latest || link.refreshing} onClick={() => void restartFromLatest()}>Restart linking from latest</button></div>
      <p className="ems-list-meta">Restarting clears this form and any review choices. Nothing has been saved by this attempt.</p>
    </div>}

    {(link?.kind === 'saving' || link?.kind === 'uncertain') && <div className={link.kind === 'uncertain' ? 'ems-feedback ems-feedback--error' : 'ems-feedback'}>
      {link.kind === 'uncertain' && <><h4 ref={stateHeading} tabIndex={-1}>Result unknown</h4><p role="alert">The result is unknown. Retry the same saved details to recover the result without creating another client or property.</p><p>Editing and leaving this page stay blocked until the retry confirms a result.</p></>}
      <div className="ems-summary"><SubmittedSummary title={link.kind === 'uncertain' ? 'Details waiting for confirmation' : 'Details being sent'} request={link.request} customers={knownCustomers} properties={knownProperties} /></div>
    </div>}

    {link && 'draft' in link && !reviewKinds.has(link.kind) && <form onSubmit={event => void submit(event)} aria-busy={kind === 'saving'}><fieldset disabled={!editable} className="ems-fieldset">
      <legend>Review client selection</legend>
      <div className="ems-field"><label htmlFor={fieldId('search')}>Find another existing client</label><input id={fieldId('search')} type="search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void findExisting(); } }} /></div>
      <div className="ems-actions"><button type="button" className="ems-button ems-button--secondary" disabled={searching || !search.trim()} onClick={() => void findExisting()}>{searching ? 'Finding clients…' : 'Find existing client'}</button></div>
      {available.length > 0 ? <div className="ems-field"><label htmlFor={fieldId('client')}>Existing client</label><select id={fieldId('client')} value={form.selected} onChange={event => { setForm({ ...form, selected: event.target.value, propertyId: '', different: false }); setProperties([]); setFormError(''); }}><option value="">Choose a client or review a separate person</option>{available.map(item => <option key={item.customer.id} value={item.customer.id}>{item.customer.name} · {item.customer.email || item.customer.phone || 'Name match'} · {item.customer.status}</option>)}</select></div> : <p>No matching client found. Saving creates a client for {context?.source.contact.name}. Search above to use a client with different contact details.</p>}
      {chosen?.status === 'archived' && <p className="ems-feedback">This client is archived. <WorkspaceLink href={`/admin/customers/${chosen.id}`}>Review and restore client</WorkspaceLink> before linking.</p>}
      {!form.selected && candidates.length > 0 && <label className="customers-checkbox"><input type="checkbox" checked={form.different} onChange={event => setForm({ ...form, different: event.target.checked })} />I reviewed these candidates and this is a different person or company</label>}
      <div className="ems-field"><label htmlFor={fieldId('reason')}>Review reason{form.selected || form.different ? ' (required)' : ''}</label><textarea id={fieldId('reason')} maxLength={500} required={Boolean(form.selected || form.different)} value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} /></div>
      <div className="ems-field"><label htmlFor={fieldId('property')}>Property</label><select id={fieldId('property')} value={form.propertyId} onChange={event => setForm({ ...form, propertyId: event.target.value })}><option value="">No property selected</option>{propertyOptions.map(item => <option key={item.id} value={item.id}>{item.label} · {item.address.line1}{item.address.unit ? ` · Unit ${item.address.unit}` : ''}</option>)}<option value="new">Add a new property</option></select></div>
      {form.propertyId === 'new' && <div className="ems-detail-grid">
        <div className="ems-field"><label htmlFor={fieldId('label')}>Property label</label><input id={fieldId('label')} required maxLength={120} value={form.site.label} onChange={event => setForm({ ...form, site: { ...form.site, label: event.target.value } })} /></div>
        {(['line1', 'unit', 'suburb', 'state', 'postcode'] as const).map(key => <div className="ems-field" key={key}><label htmlFor={fieldId(key)}>{{ line1: 'Street address', unit: 'Unit / apartment', suburb: 'Suburb', state: 'State', postcode: 'Postcode' }[key]}</label><input id={fieldId(key)} required={key !== 'unit'} maxLength={key === 'line1' ? 250 : key === 'postcode' ? 4 : 120} value={form.site.address[key] ?? ''} onChange={event => setForm({ ...form, site: { ...form.site, address: { ...form.site.address, [key]: event.target.value } } })} /></div>)}
      </div>}
    </fieldset>
      {readyError && <p role="alert" className="ems-feedback ems-feedback--error">{readyError}</p>}
      <p className="ems-list-meta">Editing a property changes its current record. Signed documents, bookings and customer permissions retain their existing records.</p>
      <div className="ems-actions"><button ref={saveButton} className="ems-button" disabled={kind === 'saving' || kind === 'conflict' || (kind === 'ready' && (!editable || stale || chosen?.status === 'archived' || !form.selected && candidates.length > 0 && !form.different))}>{kind === 'saving' ? 'Saving client relation…' : kind === 'uncertain' ? 'Retry unchanged client relation' : 'Save client relation'}</button><button type="button" className="ems-button ems-button--secondary" disabled={!editable} onClick={() => navigate(() => { discard(); void initialize(); })}>Refresh client relation</button></div>
    </form>}
  </section>;
}
