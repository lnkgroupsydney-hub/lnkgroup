'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ValidatedInput } from '@/shared/ui/validated-input';
import { LiveCompanyBookingEditor } from '@/modules/bookings/client';
import { WorkspaceLink, useWorkspaceDraft } from '@/shared/ui/admin-workspace-state';
import { AdminTabs } from '@/shared/ui/admin';
import type { LiveQuoteRequestPage, LiveQuoteRequestDetail, LiveQuoteAudit } from '../index';
import { LiveRequestDetails } from './request-details';
import { StaffPhotoWorkspace } from './staff-photo-workspace';
import { QuoteClientLinker } from './quote-client-linker';
import { StaffQuoteDraftEditor } from './staff-quote-draft-editor';
import { CompanyRevisionPanel, useCompanyRevisionGate } from './company-revision-panel';
import { parseStaffQuoteList } from './staff-quote-client';
import type { LiveBookingState } from '../domain/booking-flow';
import { quotePricingDisplay } from '../domain/pricing-display.ts';
import { BookingSubmissionSummary } from './booking-flow-panel';
import { parseBookingState, bookingRequest } from './booking-flow-client';
import { displayTime, isRecord, liveRequest, LiveRequestError, parseLiveRequest } from './request-client';
import './live-quote.css';

function StaffBookingDetails({ requestId, onAccessLost, active = true }: { requestId: string; onAccessLost: () => void; active?: boolean }) {
  const [state, setState] = useState<LiveBookingState | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const callbacks = useRef({ onAccessLost }), generation = useRef(0), controller = useRef<AbortController | null>(null), alive = useRef(false), reading = useRef(false);
  useEffect(() => { callbacks.current = { onAccessLost }; }, [onAccessLost]);
  const load = useCallback(async () => {
    if (!alive.current || reading.current) return;
    reading.current = true; setBusy(true); controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const version = ++generation.current;
    try {
      const value = parseBookingState(await bookingRequest(`/api/admin/quote-requests/${encodeURIComponent(requestId)}/booking`, requestId, {signal:AbortSignal.any([abort.signal,AbortSignal.timeout(25_000)])}), requestId, false);
      if (alive.current && generation.current === version && !abort.signal.aborted) { setState(value); setError(''); }
    } catch (cause) {
      if (!alive.current || generation.current !== version || abort.signal.aborted || cause instanceof DOMException && cause.name === 'AbortError') return;
      if (cause instanceof LiveRequestError && [401,403].includes(cause.status)) { setState(null); setError(''); callbacks.current.onAccessLost(); }
      else setError(cause instanceof Error ? cause.message : 'Booking request status could not be loaded.');
    } finally { if (generation.current === version) { reading.current = false; if (alive.current) setBusy(false); } }
  }, [requestId]);
  useEffect(() => { alive.current = active; let cancelled = false; void Promise.resolve().then(()=>{if(!cancelled && active) { setBusy(false); return load(); }}); return()=>{cancelled=true;alive.current=false;reading.current=false;controller.current?.abort();}; }, [load, active]);
  const processing = Boolean(state?.submission && (['pending','sending','retrying'].includes(state.submission.emailStatus) || ['pending','syncing','retrying'].includes(state.submission.calendarStatus)));
  useEffect(()=>{if(!active || !processing)return;const timer=setInterval(()=>{if(document.visibilityState === 'visible') void load();},5000);return()=>clearInterval(timer);},[active,processing,load]);
  return <section className="lq-booking ems-panel" aria-label="Customer estimate approval and reservation request"><h4>Customer approval and reservation request</h4>{error && <p className="lq-error" role="alert">{error}</p>}{!state && !error && <p role="status">Loading verified customer and booking request status…</p>}{state && <><p className="lq-notice">{state.verified ? 'Customer email ownership has been verified and this request is linked to verified customer access.' : 'Email ownership has not been verified for this request.'}</p>{state.submission ? <BookingSubmissionSummary submission={state.submission} staff /> : state.approval ? <dl className="lq-details"><div><dt>Estimate approval</dt><dd>{state.approval.stale ? 'Source changed; customer must approve again' : 'Provisional estimate acknowledged'} · {displayTime(state.approval.approvedAt)}</dd></div><div><dt>Approved source</dt><dd>Revision {state.approval.inputRevision} · AI analysis {state.approval.analysisId} · {state.approval.snapshot.photos.length} saved photos</dd></div><div><dt>Preferred start date</dt><dd>{state.approval.preferredDate ?? 'Not selected'} · Company confirmation required; no date held</dd></div><div><dt>Provisional amount</dt><dd>{new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(state.approval.snapshot.pricing.total! / 100)} {quotePricingDisplay(state.approval.snapshot.pricing.pricingVersion).amountSuffix}</dd></div></dl> : <p>No estimate approval or reservation request has been submitted.</p>}</>}<button type="button" className="ems-button ems-button--secondary" disabled={busy || !active} onClick={()=>void load()}>Refresh approval and receipt status</button></section>;
}

/** Booking confirmation with the revised quote state, so staff see why confirmation may be blocked. */
function RevisionAwareBookingEditor({ requestId, active, onAccessLost, onOpenRevision }: { requestId: string; active: boolean; onAccessLost: () => void; onOpenRevision: () => void }) {
  const revisionGate = useCompanyRevisionGate(requestId, active, onAccessLost, onOpenRevision);
  return <LiveCompanyBookingEditor requestId={requestId} active={active} onAccessLost={onAccessLost} revisionGate={revisionGate} />;
}

function parsePage(body: Record<string, unknown>): LiveQuoteRequestPage {
  if (!Array.isArray(body.requests) || !Number.isSafeInteger(body.total) || Number(body.total) < 0 || !Number.isSafeInteger(body.page) || Number(body.page) < 1 || !Number.isSafeInteger(body.pageSize) || Number(body.pageSize) < 1) throw new Error('The saved request list could not be verified.');
  return { requests: body.requests.map(parseLiveRequest), total: Number(body.total), page: Number(body.page), pageSize: Number(body.pageSize) };
}
function parseAudit(value: unknown): LiveQuoteAudit {
  if (!isRecord(value) || typeof value.id !== 'string' || !['save', 'request_review'].includes(String(value.action)) || value.actorType !== 'guest' || !Number.isSafeInteger(value.revision) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('The request history could not be verified.');
  return value as unknown as LiveQuoteAudit;
}
type SourceStatusFilter = 'all' | 'draft' | 'review_requested';
type StaffDraftFilter = 'all' | 'saved' | 'none';
type RequestListState = { search: string; query: string; page: number; selectedId: string | null; status?: SourceStatusFilter; staffDraft?: StaffDraftFilter };
const initialListState: RequestListState = { search: '', query: '', page: 1, selectedId: null, status: 'all', staffDraft: 'all' };
type ListPage = Omit<LiveQuoteRequestPage, 'requests'> & { requests: (LiveQuoteRequestPage['requests'][number] & { staffDraftRevision?: number | null })[] };
type ListFilters = { status: SourceStatusFilter; staffDraft: StaffDraftFilter };
const filtersOf = (value: RequestListState): ListFilters => ({ status: value.status ?? 'all', staffDraft: value.staffDraft ?? 'all' });
const requestTabs = [
  { id: 'summary', label: 'Summary' }, { id: 'photos', label: 'Photos & estimate' },
  { id: 'booking', label: 'Booking' }, { id: 'client', label: 'Client & property' }, { id: 'activity', label: 'Activity' },
];
// Quotes add the staff work copy; the enquiries view keeps its existing tabs.
const quoteTabs = [...requestTabs.slice(0, 3), { id: 'company-revision', label: 'Revised quote' }, requestTabs[3], { id: 'staff-draft', label: 'Internal draft' }, requestTabs[4]];

export function LiveQuoteRequestsPanel({ onAccessLost, requestId, listPath = '/admin/quotes', title = 'Customer quote requests', description = 'Saved customer requests and their latest review status.' }: { onAccessLost: () => void; requestId?: string; listPath?: '/admin/quotes' | '/admin/enquiries'; title?: string; description?: string }) {
  const [filters, setFilters] = useWorkspaceDraft<RequestListState>(`live-requests:${listPath}`, initialListState);
  const initialFilters = useRef(filters);
  const quotesView = listPath === '/admin/quotes', tabs = quotesView ? quoteTabs : requestTabs;
  const [list, setList] = useState<ListPage | null>(null), [detail, setDetail] = useState<LiveQuoteRequestDetail | null>(null);
  const [listError, setListError] = useState(''), [detailError, setDetailError] = useState('');
  const [listBusy, setListBusy] = useState(!requestId), [detailBusy, setDetailBusy] = useState(Boolean(requestId)), [blocked, setBlocked] = useState(false);
  const [tab, setTab] = useState('summary'), [visited, setVisited] = useState<string[]>(['summary']);
  const alive = useRef(false), denied = useRef(false), listAbort = useRef<AbortController | null>(null), detailAbort = useRef<AbortController | null>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null), recordLinks = useRef(new Map<string, HTMLAnchorElement>()), restoreSelection = useRef(true);
  const accessCallback = useRef(onAccessLost);
  useEffect(() => { accessCallback.current = onAccessLost; }, [onAccessLost]);
  const accessLost = useCallback(() => {
    if (denied.current) return;
    denied.current = true; listAbort.current?.abort(); detailAbort.current?.abort(); initialFilters.current = initialListState; recordLinks.current.clear();
    setBlocked(true); setList(null); setDetail(null); setFilters(initialListState); setListError(''); setDetailError(''); setListBusy(false); setDetailBusy(false); setTab('summary'); setVisited(['summary']);
    accessCallback.current();
  }, [setFilters]);
  const fail = useCallback((cause: unknown, report: (value: string) => void) => {
    if (!alive.current || denied.current || (cause instanceof DOMException && cause.name === 'AbortError')) return;
    if (cause instanceof LiveRequestError && [401, 403].includes(cause.status)) { accessLost(); return; }
    report(cause instanceof Error ? cause.message : 'The request could not be loaded. Please retry.');
  }, [accessLost]);
  const loadList = useCallback(async (q: string, page: number, listFilters: ListFilters) => {
    if (denied.current) return;
    listAbort.current?.abort(); const controller = new AbortController(); listAbort.current = controller;
    setListBusy(true); setListError('');
    try {
      const params = new URLSearchParams({ q, page: String(page), pageSize: '10', ...(quotesView ? listFilters : {}) });
      const body = await liveRequest(`/api/admin/quote-requests?${params}`, { signal: controller.signal });
      const value: ListPage = quotesView ? parseStaffQuoteList(body) : parsePage(body);
      if (alive.current && !denied.current && !controller.signal.aborted && listAbort.current === controller) { setList(value); setFilters(previous => ({ ...previous, page: value.page })); }
    } catch (cause) { if (listAbort.current === controller && !controller.signal.aborted) fail(cause, setListError); }
    finally { if (alive.current && !denied.current && listAbort.current === controller) setListBusy(false); }
  }, [fail, setFilters, quotesView]);
  const loadDetail = useCallback(async (id: string) => {
    if (denied.current) return;
    detailAbort.current?.abort(); const controller = new AbortController(); detailAbort.current = controller;
    setDetail(previous => previous?.request.id === id ? previous : null); setDetailBusy(true); setDetailError('');
    try {
      const body = await liveRequest(`/api/admin/quote-requests/${encodeURIComponent(id)}`, { signal: controller.signal });
      const request = parseLiveRequest(body.request);
      if (request.id !== id || !Array.isArray(body.audit)) throw new Error('The saved request did not match. Please reload it.');
      const value = { request, audit: body.audit.map(parseAudit) };
      if (alive.current && !denied.current && !controller.signal.aborted && detailAbort.current === controller) { setDetail(value); }
    } catch (cause) { if (detailAbort.current === controller && !controller.signal.aborted) fail(cause, setDetailError); }
    finally { if (alive.current && !denied.current && detailAbort.current === controller) setDetailBusy(false); }
  }, [fail]);
  useEffect(() => {
    alive.current = true; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) { if (requestId) { setTab('summary'); setVisited(['summary']); return loadDetail(requestId); } return loadList(initialFilters.current.query, initialFilters.current.page, filtersOf(initialFilters.current)); } });
    return () => { cancelled = true; alive.current = false; listAbort.current?.abort(); detailAbort.current?.abort(); };
  }, [loadList, loadDetail, requestId]);
  useEffect(() => {
    if (!list || !restoreSelection.current || !filters.selectedId || requestId) return;
    restoreSelection.current = false;
    const frame = requestAnimationFrame(() => { const link = recordLinks.current.get(filters.selectedId!); link?.focus({ preventScroll: true }); link?.scrollIntoView({ block: 'nearest' }); });
    return () => cancelAnimationFrame(frame);
  }, [list, filters.selectedId, requestId]);
  const loadedId = detail?.request.id;
  useEffect(() => {
    if (!loadedId) return;
    const frame = requestAnimationFrame(() => detailTitle.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [loadedId]);
  function find(event: FormEvent) { event.preventDefault(); const query = filters.search.trim(); setFilters(previous => ({ ...previous, query, page: 1, selectedId: null })); void loadList(query, 1, filtersOf(filters)); }
  function changeFilter(patch: Partial<ListFilters>) {
    setFilters(previous => ({ ...previous, ...patch, page: 1, selectedId: null }));
    void loadList(filters.query, 1, { ...filtersOf(filters), ...patch });
  }
  function chooseTab(id: string) { setTab(id); setVisited(previous => previous.includes(id) ? previous : [...previous, id]); }
  // In-panel shortcuts move focus to the destination tab so keyboard users are not left on a hidden button.
  function jumpToTab(id: string) { chooseTab(id); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[role="tab"][id$="-tab-${id}"]`)?.focus()); }
  if (blocked) return <section className="ems-panel"><h2>{title}</h2><p className="ems-feedback" role="alert">Company access ended. Sign in again to view saved requests.</p></section>;
  if (requestId) return <section className="lq-admin ems-panel" aria-labelledby="live-request-detail-title">
    <div className="ems-actions"><WorkspaceLink className="ems-button ems-button--secondary" href={listPath}>Back to {listPath === '/admin/enquiries' ? 'enquiries' : 'quotes'}</WorkspaceLink><button type="button" className="ems-button ems-button--secondary" disabled={detailBusy} onClick={() => void loadDetail(requestId)}>Refresh request</button></div>
    <h2 id="live-request-detail-title" ref={detailTitle} tabIndex={-1}>{detail?.request.id === requestId ? detail.request.reference : 'Request details'}</h2>
    {detailBusy && <p role="status">Loading request details…</p>}
    {detailError && <div className="ems-feedback ems-feedback--error" role="alert"><p>{detailError}{detail ? ' The details below are the last loaded version.' : ''}</p><button type="button" className="ems-button ems-button--secondary" disabled={detailBusy} onClick={() => void loadDetail(requestId)}>Retry request details</button></div>}
    {detail && detail.request.id === requestId && <>
      <div className="ems-summary"><div><h3>{detail.request.payload.contact.name}</h3><p>{detail.request.payload.contact.email} · {detail.request.payload.contact.phone || 'No phone provided'}</p><p>{detail.request.payload.contact.siteAddress} · {detail.request.payload.contact.suburb} {detail.request.payload.contact.postcode}</p></div><div><span className="ems-status">{detail.request.status === 'review_requested' ? 'Review requested' : 'Details saved'}</span><p className="ems-list-meta">Last saved {displayTime(detail.request.savedAt)} (Sydney)</p><button type="button" className="ems-button" onClick={() => chooseTab(detail.request.status === 'review_requested' ? 'booking' : 'photos')}>{detail.request.status === 'review_requested' ? 'Review booking request' : 'Review photos & estimate'}</button></div></div>
      <AdminTabs activeId={tab} onChange={chooseTab} items={tabs} label="Request detail sections">{(_activeId, _panelProps, getPanelProps) => tabs.map(({ id }) => <section key={`${detail.request.id}:${id}`} {...getPanelProps(id)}>
        {visited.includes(id) && id === 'summary' && <><StaffPhotoWorkspace requestId={detail.request.id} active={tab === 'summary'} compact onAccessLost={accessLost} /><button className="ems-button ems-button--secondary" type="button" onClick={()=>chooseTab('client')}>Review client and property</button><details><summary>Saved contact and service details</summary><LiveRequestDetails request={detail.request} /></details></>}
        {visited.includes(id) && id === 'photos' && <StaffPhotoWorkspace requestId={detail.request.id} active={tab === 'photos'} onAccessLost={accessLost} />}
        {visited.includes(id) && id === 'booking' && <><StaffBookingDetails requestId={detail.request.id} active={tab === 'booking'} onAccessLost={accessLost} />{quotesView ? <RevisionAwareBookingEditor key={detail.request.id} requestId={detail.request.id} active={tab === 'booking'} onAccessLost={accessLost} onOpenRevision={() => jumpToTab('company-revision')} /> : <LiveCompanyBookingEditor requestId={detail.request.id} active={tab === 'booking'} onAccessLost={accessLost} />}</>}
        {visited.includes(id) && id === 'company-revision' && <CompanyRevisionPanel key={detail.request.id} requestId={detail.request.id} active={tab === 'company-revision'} onAccessLost={accessLost} onOpenBooking={() => jumpToTab('booking')} />}
        {visited.includes(id) && id === 'client' && <QuoteClientLinker key={detail.request.id} request={detail.request} active={tab === 'client'} onAccessLost={accessLost} />}
        {visited.includes(id) && id === 'staff-draft' && <StaffQuoteDraftEditor key={detail.request.id} requestId={detail.request.id} active={tab === 'staff-draft'} onAccessLost={accessLost} />}
        {visited.includes(id) && id === 'activity' && <><h3>Saved history</h3>{detail.audit.length ? <ol className="lq-audit">{detail.audit.map(item => <li key={item.id}>{item.action === 'request_review' ? 'Company review requested' : 'Details saved'} · Revision {item.revision} · {displayTime(item.createdAt)} (Sydney) · Customer writing session</li>)}</ol> : <p>No history is available.</p>}</>}
      </section>)}</AdminTabs>
    </>}
  </section>;
  return <section className="lq-admin ems-panel" aria-labelledby="live-requests-title">
    <h2 id="live-requests-title">{title}</h2><p>{description}</p>
    <form className="ems-toolbar" onSubmit={find}><label className="ems-field" htmlFor="live-request-search"><span>Find by reference, name, email or address</span><ValidatedInput validation="text" validationLabel="Request search" id="live-request-search" type="search" maxLength={120} value={filters.search} onChange={event => setFilters(previous => ({ ...previous, search: event.target.value }))} /></label>{quotesView && <><div className="ems-field"><label htmlFor="live-request-status">Customer request status</label><select id="live-request-status" value={filters.status ?? 'all'} disabled={listBusy} onChange={event => changeFilter({ status: event.target.value as SourceStatusFilter })}><option value="all">All requests</option><option value="draft">Details saved</option><option value="review_requested">Review requested</option></select></div><div className="ems-field"><label htmlFor="live-request-staff-draft">Internal draft</label><select id="live-request-staff-draft" value={filters.staffDraft ?? 'all'} disabled={listBusy} onChange={event => changeFilter({ staffDraft: event.target.value as StaffDraftFilter })}><option value="all">With or without</option><option value="saved">Has an internal draft</option><option value="none">No internal draft</option></select></div></>}<div className="ems-actions"><button className="ems-button" disabled={listBusy}>Search requests</button><button type="button" className="ems-button ems-button--secondary" disabled={listBusy} onClick={() => void loadList(filters.query, list?.page ?? filters.page, filtersOf(filters))}>Refresh requests</button></div></form>
    {listBusy && <p role="status">Loading saved requests…</p>}
    {listError && <p className="ems-feedback ems-feedback--error" role="alert">{listError}{list ? ' The list below is the last successfully loaded version.' : ''}</p>}
    {list && <><p className="ems-list-meta">{list.total} matching {list.total === 1 ? 'request' : 'requests'} · Page {list.page}</p>{!list.requests.length && <p>{quotesView && ((filters.status ?? 'all') !== 'all' || (filters.staffDraft ?? 'all') !== 'all') ? 'No saved requests match this search and these filters. Change a filter or clear the search.' : 'No saved requests match this search.'}</p>}
      <ul className="ems-list">{list.requests.map(request => <li className="ems-record-row" key={request.id}><div className="ems-record-main"><strong>{request.payload.contact.name}</strong><span>{request.reference} · {request.payload.service ? 'Kitchen Cabinet Painting' : 'Contact only'}</span><span className="ems-list-meta">Last saved {displayTime(request.savedAt)} (Sydney)</span></div><div className="ems-record-actions"><span className="ems-status">{request.status === 'review_requested' ? 'Review requested' : 'Details saved'}</span>{quotesView && <span className="ems-status ems-status--warning">{request.staffDraftRevision ? `Internal draft · rev ${request.staffDraftRevision}` : 'No internal draft'}</span>}<WorkspaceLink ref={element => { if (element) recordLinks.current.set(request.id, element); else recordLinks.current.delete(request.id); }} className="ems-button ems-button--secondary" href={`${listPath}/${encodeURIComponent(request.id)}`} onClick={() => setFilters(previous => ({ ...previous, selectedId: request.id }))}>View request<span className="sr-only"> {request.reference}</span></WorkspaceLink></div></li>)}</ul>
      <div className="ems-actions"><button type="button" className="ems-button ems-button--secondary" disabled={listBusy || list.page <= 1} onClick={() => void loadList(filters.query, list.page - 1, filtersOf(filters))}>Previous page</button><button type="button" className="ems-button ems-button--secondary" disabled={listBusy || list.page * list.pageSize >= list.total} onClick={() => void loadList(filters.query, list.page + 1, filtersOf(filters))}>Next page</button></div>
    </>}
  </section>;
}
