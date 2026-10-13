'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, CalendarDays } from 'lucide-react';
import { StaffPhotoWorkspace } from '@/modules/quotes/client';
import { WorkspaceLink, useWorkspaceDraft } from '@/shared/ui/admin-workspace-state';
import { AdminEmptyState, AdminPanel, AdminStatusBadge, AdminTabs } from '@/shared/ui/admin';
import type { LiveCompanyBookingState } from '../domain/live-contracts';
import { companyBookingRequest, companyMoney, LiveCompanyRequestError, parseCompanyState, record } from './live-booking-client';
import { matchesSchedule, scheduleStatus, scheduleStatusLabels, type ScheduleStatus } from './admin-schedule-view';
import { LiveCompanyBookingEditor } from './live-company-editor';
import './live-booking.css';

const statuses = Object.entries(scheduleStatusLabels) as [ScheduleStatus, string][];
const tabs = [{ id: 'booking', label: 'Visits & confirmation' }, { id: 'photos', label: 'Photos & estimate' }];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function BookingDetail({ requestId, onAccessLost }: { requestId: string; onAccessLost: () => void }) {
  const [tab, setTab] = useState('booking'), [photosVisited, setPhotosVisited] = useState(false);
  return <div className="ems-detail-page">
    <WorkspaceLink href="/admin/schedule" className="ems-back-link"><ArrowLeft size={16} aria-hidden="true" /> Back to schedule</WorkspaceLink>
    <AdminPanel>
      <div className="ems-section-heading"><div><h2>Booking details</h2><p>Review the saved request and exact take-off and installation visits.</p></div><WorkspaceLink className="ems-button ems-button--secondary" href={`/admin/quotes/${requestId}`}>Open quote <ArrowRight size={16} aria-hidden="true" /></WorkspaceLink></div>
      <AdminTabs items={tabs} activeId={tab} onChange={value => { setTab(value); if (value === 'photos') setPhotosVisited(true); }} label="Booking details">
        {(_active, _panelProps, getPanelProps) => <>
          <div {...getPanelProps('booking')}><LiveCompanyBookingEditor requestId={requestId} onAccessLost={onAccessLost} active={tab === 'booking'} /></div>
          <div {...getPanelProps('photos')}>{photosVisited && <StaffPhotoWorkspace requestId={requestId} onAccessLost={onAccessLost} active={tab === 'photos'} />}</div>
        </>}
      </AdminTabs>
    </AdminPanel>
  </div>;
}

export function LiveCompanyBookingSchedule({ onAccessLost, initialRequestId }: { onAccessLost: () => void; initialRequestId?: string }) {
  const [states, setStates] = useState<LiveCompanyBookingState[]>([]);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
  const [query, setQuery] = useWorkspaceDraft('schedule:query', ''), [status, setStatus] = useWorkspaceDraft('schedule:status', ''), [day, setDay] = useWorkspaceDraft('schedule:day', '');
  const active = useRef(false), denied = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null), callbacks = useRef({ onAccessLost });
  useEffect(() => { callbacks.current = { onAccessLost }; }, [onAccessLost]);
  const load = useCallback(async () => {
    const abort = new AbortController(), version = ++generation.current;
    controller.current?.abort(); controller.current = abort; setBusy(true); setError('');
    try {
      const body = await companyBookingRequest('/api/admin/live-bookings', '', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35_000)]) });
      if (!Array.isArray(body.states)) throw new Error('The company booking list could not be verified.');
      const values = body.states.map(value => {
        if (!record(value) || typeof value.requestId !== 'string') throw new Error('A booking request did not match its saved identity.');
        const state = parseCompanyState({ state: value }, value.requestId);
        if (!state) throw new Error('A booking request has no saved submission.');
        return state;
      });
      if (active.current && !denied.current && generation.current === version) { setStates(values); setLoaded(true); }
    } catch (cause) {
      if (!active.current || generation.current !== version || cause instanceof DOMException && cause.name === 'AbortError') return;
      if (cause instanceof LiveCompanyRequestError && [401, 403].includes(cause.status)) {
        denied.current = true; generation.current++; controller.current?.abort(); setStates([]); setQuery(''); setStatus(''); setDay(''); callbacks.current.onAccessLost();
      } else setError(cause instanceof Error ? cause.message : 'Bookings could not be loaded.');
    } finally { if (active.current && generation.current === version) setBusy(false); }
  }, [setQuery, setStatus, setDay]);
  const invalidateRequests = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    if (initialRequestId) return;
    active.current = true; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return load(); });
    return () => { cancelled = true; active.current = false; invalidateRequests(); controller.current?.abort(); };
  }, [load, initialRequestId, invalidateRequests]);
  if (initialRequestId) return <BookingDetail key={initialRequestId} requestId={initialRequestId} onAccessLost={onAccessLost} />;
  const shown = states.filter(state => matchesSchedule(state, query, status, day));
  return <AdminPanel className="ems-schedule-list">
    <div className="ems-section-heading"><div><h2 id="live-schedule-title">Bookings & visits</h2><p>Find a request, review its visits and open the company confirmation.</p></div><button type="button" className="ems-button ems-button--secondary" disabled={busy} onClick={() => void load()}><RefreshCw size={16} aria-hidden="true" /> {busy ? 'Loading bookings…' : 'Refresh bookings'}</button></div>
    <div className="ems-toolbar" role="search" aria-label="Filter loaded booking records">
      <label className="ems-field" htmlFor="schedule-search">Find a booking<input id="schedule-search" type="search" maxLength={120} placeholder="Client, reference or address" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label className="ems-field" htmlFor="schedule-status">Status<select id="schedule-status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All loaded statuses</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="ems-field" htmlFor="schedule-day">Sydney date<input id="schedule-day" type="date" value={day} onChange={event => setDay(event.target.value)} /></label>
      <div className="ems-actions"><button type="button" className="ems-button ems-button--secondary" onClick={() => setDay(today())}><CalendarDays size={16} aria-hidden="true" /> Today</button>{(query || status || day) && <button type="button" className="ems-button ems-button--secondary" onClick={() => { setQuery(''); setStatus(''); setDay(''); }}>Clear filters</button>}</div>
    </div>
    {error && <p className="ems-feedback ems-feedback--danger" role="alert">{error}{loaded ? ' Showing the last successfully loaded records.' : ''}</p>}
    {!loaded && !error && <p role="status">Loading company booking records…</p>}
    {loaded && <><p className="ems-list-meta" role="status">{shown.length} of {states.length} loaded booking records · Australia/Sydney</p><p className="ems-muted">Filters apply to the current loaded list. Requested dates are preferences; processing and confirmed visits keep their saved periods occupied.</p>
      {!shown.length ? <AdminEmptyState title={states.length ? 'No bookings match these filters' : 'No submitted booking requests yet'} description={states.length ? 'Try another date or clear the filters.' : 'Signed customer requests will appear here when they are submitted.'} /> : <ul className="ems-list">{shown.map(state => {
        const contact = state.submission.snapshot.payload.contact, stateStatus = scheduleStatus(state);
        return <li key={state.requestId} className="ems-record-row"><div className="ems-record-main"><h3>{contact.name}</h3><p>{state.submission.reference}</p><p>{contact.siteAddress} · {contact.suburb} {contact.postcode}</p><p>{state.proposal ? `${companyMoney(state.proposal.total)} incl GST · ${state.proposal.segments.length} work periods` : `Requested take-off: ${state.submission.preferredDate}${state.submission.preferredTime ? ` · ${state.submission.preferredTime}` : ' · Time to be reviewed'} (Sydney)`}</p></div><div className="ems-record-actions"><AdminStatusBadge tone={stateStatus === 'confirmed' ? 'success' : ['confirming', 'review_required'].includes(stateStatus) ? 'warning' : 'neutral'}>{scheduleStatusLabels[stateStatus]}</AdminStatusBadge><WorkspaceLink href={`/admin/schedule/${state.requestId}`} className="ems-button ems-button--secondary">Review booking<span className="sr-only"> {state.submission.reference}</span><ArrowRight size={16} aria-hidden="true" /></WorkspaceLink></div></li>;
      })}</ul>}
    </>}
  </AdminPanel>;
}
