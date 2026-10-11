'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { LiveQuoteRequestPage, LiveQuoteRequestDetail, LiveQuoteAudit } from '../index';
import { LiveRequestDetails } from './request-details';
import { StaffPhotoWorkspace } from './staff-photo-workspace';
import { displayTime, isRecord, liveRequest, LiveRequestError, parseLiveRequest } from './request-client';
import './live-quote.css';

function parsePage(body: Record<string, unknown>): LiveQuoteRequestPage {
  if (!Array.isArray(body.requests) || !Number.isSafeInteger(body.total) || Number(body.total) < 0 || !Number.isSafeInteger(body.page) || Number(body.page) < 1 || !Number.isSafeInteger(body.pageSize) || Number(body.pageSize) < 1) throw new Error('The saved request list could not be verified.');
  return { requests: body.requests.map(parseLiveRequest), total: Number(body.total), page: Number(body.page), pageSize: Number(body.pageSize) };
}
function parseAudit(value: unknown): LiveQuoteAudit {
  if (!isRecord(value) || typeof value.id !== 'string' || !['save', 'request_review'].includes(String(value.action)) || value.actorType !== 'guest' || !Number.isSafeInteger(value.revision) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('The request history could not be verified.');
  return value as unknown as LiveQuoteAudit;
}
export function LiveQuoteRequestsPanel({ onAccessLost }: { onAccessLost: () => void }) {
  const [list, setList] = useState<LiveQuoteRequestPage | null>(null), [detail, setDetail] = useState<LiveQuoteRequestDetail | null>(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [listError, setListError] = useState(''), [detailError, setDetailError] = useState('');
  const [listBusy, setListBusy] = useState(true), [detailBusy, setDetailBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const alive = useRef(false), denied = useRef(false), listAbort = useRef<AbortController | null>(null), detailAbort = useRef<AbortController | null>(null);
  const selected = useRef<string | null>(null), detailTitle = useRef<HTMLHeadingElement>(null);
  const fail = useCallback((cause: unknown, report: (value: string) => void) => {
    if (!alive.current || denied.current || (cause instanceof DOMException && cause.name === 'AbortError')) return;
    if (cause instanceof LiveRequestError && [401, 403].includes(cause.status)) {
      denied.current = true; listAbort.current?.abort(); detailAbort.current?.abort(); selected.current = null;
      setBlocked(true); setList(null); setDetail(null); setSearch(''); setQuery(''); setListError(''); setDetailError(''); onAccessLost(); return;
    }
    report(cause instanceof Error ? cause.message : 'The request could not be loaded. Please retry.');
  }, [onAccessLost]);
  const loadList = useCallback(async (q: string, page = 1) => {
    listAbort.current?.abort(); const controller = new AbortController(); listAbort.current = controller;
    setListBusy(true); setListError('');
    try {
      const body = await liveRequest(`/api/admin/quote-requests?${new URLSearchParams({ q, page: String(page), pageSize: '10' })}`, { signal: controller.signal });
      const value = parsePage(body);
      if (alive.current && !denied.current && listAbort.current === controller) setList(value);
    } catch (cause) { if (listAbort.current === controller) fail(cause, setListError); }
    finally { if (alive.current && listAbort.current === controller) setListBusy(false); }
  }, [fail]);
  const loadDetail = useCallback(async (id: string) => {
    detailAbort.current?.abort(); const controller = new AbortController(); detailAbort.current = controller; selected.current = id;
    setDetail(null); setDetailBusy(true); setDetailError('');
    try {
      const body = await liveRequest(`/api/admin/quote-requests/${encodeURIComponent(id)}`, { signal: controller.signal });
      const request = parseLiveRequest(body.request);
      if (request.id !== id || !Array.isArray(body.audit)) throw new Error('The saved request did not match. Please reload it.');
      const value = { request, audit: body.audit.map(parseAudit) };
      if (alive.current && !denied.current && detailAbort.current === controller) { setDetail(value); requestAnimationFrame(() => detailTitle.current?.focus()); }
    } catch (cause) { if (detailAbort.current === controller) fail(cause, setDetailError); }
    finally { if (alive.current && detailAbort.current === controller) setDetailBusy(false); }
  }, [fail]);
  useEffect(() => {
    alive.current = true; let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return loadList(''); });
    return () => { cancelled = true; alive.current = false; listAbort.current?.abort(); detailAbort.current?.abort(); };
  }, [loadList]);
  function find(event: FormEvent) { event.preventDefault(); setQuery(search.trim()); void loadList(search.trim()); }
  if (blocked) return <section className="lq-admin admin-card"><h2>Quote requests</h2><p role="alert">Company access ended. Sign in again to view saved requests.</p></section>;
  return <section className="lq-admin admin-card" aria-labelledby="live-requests-title">
    <h2 id="live-requests-title">Customer quote requests</h2>
    <p>Contact and service details appear here as soon as the customer saves. In-progress requests have not yet been sent for review.</p>
    <form onSubmit={find}><label htmlFor="live-request-search">Find by reference, name, email or address</label><div className="lq-actions"><input id="live-request-search" type="search" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} /><button disabled={listBusy}>Search requests</button><button type="button" className="secondary" disabled={listBusy} onClick={() => { void loadList(query, list?.page ?? 1); if (selected.current) void loadDetail(selected.current); }}>Refresh requests</button></div></form>
    {listBusy && <p role="status">Loading saved requests…</p>}
    {listError && <p className="lq-error" role="alert">{listError}{list ? ' The list below is the last successfully loaded version.' : ''}</p>}
    {list && <>
      <p>{list.total} matching {list.total === 1 ? 'request' : 'requests'} · Page {list.page}</p>
      {!list.requests.length && <p>No saved requests match this search.</p>}
      <ul className="lq-admin-list">{list.requests.map(request => <li key={request.id}><div><strong>{request.payload.contact.name} · {request.reference}</strong><span>{request.status === 'review_requested' ? 'Review requested' : 'In progress'} · {request.payload.service ? 'Service details saved' : 'Contact only'}</span><span>{request.payload.contact.email} · {displayTime(request.savedAt)} (Sydney)</span></div><button type="button" className="secondary" onClick={() => void loadDetail(request.id)}>View request<span className="sr-only"> {request.reference}</span></button></li>)}</ul>
      <div className="lq-actions"><button type="button" className="secondary" disabled={listBusy || list.page <= 1} onClick={() => void loadList(query, list.page - 1)}>Previous page</button><button type="button" className="secondary" disabled={listBusy || list.page * list.pageSize >= list.total} onClick={() => void loadList(query, list.page + 1)}>Next page</button></div>
    </>}
    {detailBusy && <p role="status">Loading request details…</p>}
    {detailError && <div className="lq-error" role="alert"><p>{detailError}</p><button type="button" disabled={detailBusy} onClick={() => { if (selected.current) void loadDetail(selected.current); }}>Retry request details</button></div>}
    {detail && <section className="lq-admin-detail" aria-labelledby="live-request-detail-title"><h3 ref={detailTitle} tabIndex={-1} id="live-request-detail-title">{detail.request.reference}</h3><LiveRequestDetails request={detail.request} /><p className="lq-notice">Email ownership is not verified. {detail.request.customerId ? 'A client record is linked.' : 'No client record has been linked automatically.'} Photo-based estimates are subject to scope confirmation and an on-site inspection. No contract or booking is confirmed by an AI assessment.</p><StaffPhotoWorkspace key={detail.request.id} requestId={detail.request.id} onAccessLost={() => fail(new LiveRequestError(403, 'Company access ended.'), setDetailError)} /><h4>Saved history</h4><ol className="lq-audit">{detail.audit.map(item => <li key={item.id}>{item.action === 'request_review' ? 'Company review requested' : 'Details saved'} · Revision {item.revision} · {displayTime(item.createdAt)} (Sydney) · Customer writing session</li>)}</ol></section>}
  </section>;
}
