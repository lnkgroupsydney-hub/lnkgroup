"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Customer, CustomerDetail, CustomerPage, CustomerRecord, ChangeCustomerLinkInput, UnlinkedRecordPage } from "../domain/contracts";
import { useUnsavedChanges, useWorkspaceDraft } from "@/shared/ui/admin-workspace-state";
import { MutationAttempt, ReadLane, type MutationSnapshot } from "./request-state";
import "./customers-console.css";

class CustomerRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function request<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/admin/customers${path}`, {
    cache: "no-store", credentials: "same-origin", signal,
    ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  let value: unknown;
  try { value = await response.json(); } catch { value = null; }
  if (!response.ok) throw new CustomerRequestError(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : `Customer service is unavailable (HTTP ${response.status}).`, response.status);
  return value as T;
}
function time(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(date);
}
function sourceLabel(record: CustomerRecord) { return record.sourceType === "submission" ? "Signed demo submission" : "Enquiry"; }
function contact(value: { name: string | null; email: string | null; phone: string | null; address: string | null }) {
  return <dl className="customers-contact"><div><dt>Name</dt><dd>{value.name || "Not provided"}</dd></div><div><dt>Email</dt><dd>{value.email || "Not provided"}</dd></div><div><dt>Phone</dt><dd>{value.phone || "Not provided"}</dd></div><div><dt>Address</dt><dd>{value.address || "Not provided"}</dd></div></dl>;
}
function PageControls({ page, total, pageSize, disabled, onPage, label }: { page: number; total: number; pageSize: number; disabled: boolean; onPage: (page: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="customers-actions" aria-label={label}><button type="button" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {pages} · {total} records</span><button type="button" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Next</button></nav>;
}
// Only the existing independently authorized file API paths are actionable.
function filePath(url: string | null, kind: "pdf" | "photo") {
  if (!url || !url.startsWith("/api/") || url.startsWith("//") || /[\\\u0000-\u001f]/.test(url)) return null;
  return kind === "pdf" && /^\/api\/operations\/bookings\/[0-9a-f-]{36}\/documents\/(quote|agreement)$/.test(url) ? url
    : kind === "photo" && /^\/api\/operations\/bookings\/[0-9a-f-]{36}\/photos\/[0-9a-f-]{36}$/.test(url) ? url : null;
}

type CustomerInput = { name: string; email: string; phone: string; address: string };
type LinkInput = Omit<ChangeCustomerLinkInput, "idempotencyKey">;
type LinkProposal = { action: "link" | "unlink"; record: CustomerRecord; revision: number };

export function CustomersConsole({ onSignedOut, embedded = false }: { onSignedOut?: () => void; embedded?: boolean } = {}) {
  const [accessEnded, setAccessEnded] = useState(false);
  const [list, setList] = useState<CustomerPage | null>(null), [unlinked, setUnlinked] = useState<UnlinkedRecordPage | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null), [selectedId, setSelectedId] = useWorkspaceDraft<string | null>("customers:selected", null);
  const [search, setSearch] = useWorkspaceDraft("customers:search", ""), [query, setQuery] = useWorkspaceDraft("customers:query", ""), [unlinkedSearch, setUnlinkedSearch] = useWorkspaceDraft("customers:unlinkedSearch", ""), [unlinkedQuery, setUnlinkedQuery] = useWorkspaceDraft("customers:unlinkedQuery", "");
  const [name, setName] = useWorkspaceDraft("customers:name", ""), [email, setEmail] = useWorkspaceDraft("customers:email", ""), [phone, setPhone] = useWorkspaceDraft("customers:phone", ""), [address, setAddress] = useWorkspaceDraft("customers:address", "");
  const [listBusy, setListBusy] = useState(true), [unlinkedBusy, setUnlinkedBusy] = useState(true), [detailBusy, setDetailBusy] = useState(false);
  const [busy, setBusy] = useState(""), [listError, setListError] = useState(""), [unlinkedError, setUnlinkedError] = useState(""), [detailError, setDetailError] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [proposal, setProposal] = useWorkspaceDraft<LinkProposal | null>("customers:proposal", null), [reason, setReason] = useWorkspaceDraft("customers:reason", ""), [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true), blocked = useRef(false), mutating = useRef(false), currentId = useRef<string | null>(null);
  const listLane = useRef(new ReadLane()), unlinkedLane = useRef(new ReadLane()), detailLane = useRef(new ReadLane());
  const [createPending, setCreatePending] = useWorkspaceDraft<MutationSnapshot<CustomerInput> | null>("customers:create-attempt", null);
  const [linkPending, setLinkPending] = useWorkspaceDraft<MutationSnapshot<LinkInput> | null>("customers:link-attempt", null);
  const createAttempt = useRef(new MutationAttempt<CustomerInput>(createPending));
  const linkAttempt = useRef(new MutationAttempt<LinkInput>(linkPending));
  const restored = useRef({ query, unlinkedQuery, selectedId, proposal });
  const detailHeading = useRef<HTMLHeadingElement>(null), listHeading = useRef<HTMLHeadingElement>(null), proposalHeading = useRef<HTMLHeadingElement>(null);
  const failure = useCallback((cause: unknown, target: (text: string) => void) => {
    if (!alive.current || blocked.current || (cause instanceof DOMException && cause.name === "AbortError")) return;
    if (cause instanceof CustomerRequestError && (cause.status === 401 || cause.status === 403)) {
      blocked.current = true; setAccessEnded(true); listLane.current.cancel(); unlinkedLane.current.cancel(); detailLane.current.cancel();
      setList(null); setUnlinked(null); setDetail(null); setSelectedId(null); currentId.current = null;
      setName(""); setEmail(""); setPhone(""); setAddress(""); setSearch(""); setQuery(""); setUnlinkedSearch(""); setUnlinkedQuery("");
      setProposal(null); setReason(""); setConfirmed(false); createAttempt.current.clear(); setCreatePending(null); linkAttempt.current.clear(); setLinkPending(null); setNotice("");
      setError("Administrator access has ended. Sign in again to open company records."); onSignedOut?.(); return;
    }
    target(cause instanceof Error ? cause.message : "Could not complete this request. Please retry.");
  }, [onSignedOut, setSelectedId, setName, setEmail, setPhone, setAddress, setSearch, setQuery, setUnlinkedSearch, setUnlinkedQuery, setProposal, setReason, setCreatePending, setLinkPending]);
  const loadList = useCallback(async (q: string, page = 1) => {
    const lane = listLane.current.begin(); setListBusy(true); setListError("");
    try { const value = await request<CustomerPage>(`?${new URLSearchParams({ q, page: String(page), pageSize: "10" })}`, undefined, lane.signal); if (alive.current && !blocked.current && lane.current()) setList(value); }
    catch (cause) { if (lane.current()) failure(cause, setListError); }
    finally { if (alive.current && lane.current()) setListBusy(false); }
  }, [failure]);
  const loadUnlinked = useCallback(async (q: string, page = 1) => {
    const lane = unlinkedLane.current.begin(); setUnlinkedBusy(true); setUnlinkedError("");
    try { const value = await request<UnlinkedRecordPage>(`/unlinked?${new URLSearchParams({ q, page: String(page), pageSize: "10" })}`, undefined, lane.signal); if (alive.current && !blocked.current && lane.current()) setUnlinked(value); }
    catch (cause) { if (lane.current()) failure(cause, setUnlinkedError); }
    finally { if (alive.current && lane.current()) setUnlinkedBusy(false); }
  }, [failure]);
  const loadDetail = useCallback(async (id: string, focus = false) => {
    const lane = detailLane.current.begin(); currentId.current = id; setSelectedId(id); setDetail(null); setDetailBusy(true); setDetailError("");
    try { const value = await request<CustomerDetail>(`/${encodeURIComponent(id)}`, undefined, lane.signal); if (alive.current && !blocked.current && lane.current() && currentId.current === id) { setDetail(value);
      const previous = restored.current.proposal;
      restored.current.proposal = null;
      if (previous && restored.current.selectedId === id && previous.revision !== value.customer.revision) {
        setConfirmed(false);
        if (!linkAttempt.current.snapshot()) setProposal({ ...previous, revision: value.customer.revision });
        setError("The customer changed while this screen was closed. Review the refreshed customer and source before confirming. Your reason was kept.");
      }
      if (focus) requestAnimationFrame(() => detailHeading.current?.focus()); } }
    catch (cause) { if (lane.current()) failure(cause, setDetailError); }
    finally { if (alive.current && lane.current()) setDetailBusy(false); }
  }, [failure, setSelectedId, setProposal]);
  useEffect(() => {
    alive.current = true; let active = true;
    async function initialize() {
      await Promise.resolve();
      if (active) await Promise.all([loadList(restored.current.query), loadUnlinked(restored.current.unlinkedQuery), ...(restored.current.selectedId ? [loadDetail(restored.current.selectedId)] : [])]);
    }
    void initialize();
    const listRead = listLane.current, unlinkedRead = unlinkedLane.current, detailRead = detailLane.current;
    return () => { active = false; alive.current = false; listRead.cancel(); unlinkedRead.cancel(); detailRead.cancel(); };
  }, [loadList, loadUnlinked, loadDetail]);
  useEffect(() => { if (proposal) proposalHeading.current?.focus(); }, [proposal]);

  function back() { if (mutating.current || linkAttempt.current.snapshot()) return; detailLane.current.cancel(); currentId.current = null; setSelectedId(null); setDetail(null); setProposal(null); setReason(""); setConfirmed(false); linkAttempt.current.clear(); setLinkPending(null); listHeading.current?.focus(); }
  function propose(action: "link" | "unlink", record: CustomerRecord) { if (mutating.current || linkAttempt.current.snapshot()) return; setProposal({ action, record, revision: detail!.customer.revision }); setReason(""); setConfirmed(false); setError(""); linkAttempt.current.clear(); setLinkPending(null); }
  async function create(event: React.FormEvent) {
    event.preventDefault(); if (mutating.current || blocked.current || linkAttempt.current.snapshot()) return;
    mutating.current = true; setBusy("create"); setError(""); setNotice("");
    try {
      const input = createAttempt.current.prepare({ name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim() }, () => crypto.randomUUID());
      setCreatePending(createAttempt.current.snapshot());
      const result = await request<{ customer: Customer }>("", input);
      if (!alive.current || blocked.current) return;
      // Commit is confirmed before follow-up reads. A failed list refresh must
      // never turn this into a retryable create with a new idempotency key.
      createAttempt.current.clear(); setCreatePending(null); setProposal(null); setReason(""); setConfirmed(false); linkAttempt.current.clear(); setLinkPending(null); setName(""); setEmail(""); setPhone(""); setAddress("");
      setNotice(`Customer ${result.customer.name} was created. Follow-up refresh errors do not undo the saved customer.`);
      await Promise.all([loadList(query), loadDetail(result.customer.id, true)]);
    } catch (cause) {
      if (!alive.current || blocked.current) return;
      if (cause instanceof CustomerRequestError && cause.status >= 400 && cause.status < 500 && cause.status !== 409) { createAttempt.current.clear(); setCreatePending(null); }
      failure(cause, setError);
    } finally { if (alive.current) { setBusy(""); mutating.current = false; } }
  }
  async function changeLink(event: React.FormEvent) {
    event.preventDefault(); if (mutating.current || blocked.current || createAttempt.current.snapshot() || !detail || !proposal || !confirmed) return;
    const id = detail.customer.id;
    mutating.current = true; setBusy("link"); setError(""); setNotice("");
    try {
      const input = linkAttempt.current.prepare({ action: proposal.action, sourceType: proposal.record.sourceType, sourceId: proposal.record.sourceId, reason: reason.trim(), expectedRevision: proposal.revision }, () => crypto.randomUUID());
      setLinkPending(linkAttempt.current.snapshot());
      await request<{ customer: Customer }>(`/${encodeURIComponent(id)}/links`, input);
      if (!alive.current || blocked.current) return;
      linkAttempt.current.clear(); setLinkPending(null); setProposal(null); setReason(""); setConfirmed(false);
      setNotice(proposal.action === "link" ? "Record linked. The source record and its documents were preserved." : "Record unlinked. The source record and the audit history were preserved.");
      await Promise.all([loadDetail(id), loadList(query, list?.page), loadUnlinked(unlinkedQuery, unlinked?.page)]);
    } catch (cause) {
      if (!alive.current || blocked.current) return;
      if (cause instanceof CustomerRequestError && cause.status === 409) {
        restored.current.proposal = proposal; restored.current.selectedId = id;
        linkAttempt.current.clear(); setLinkPending(null); setConfirmed(false);
        await Promise.all([loadDetail(id), loadUnlinked(unlinkedQuery, unlinked?.page)]);
        failure(new Error("The customer or record changed. Review the refreshed customer and source, then confirm a new request. Your reason was kept."), setError);
      } else {
        if (cause instanceof CustomerRequestError && cause.status >= 400 && cause.status < 500) { linkAttempt.current.clear(); setLinkPending(null); }
        failure(cause, setError);
      }
    } finally { if (alive.current) { setBusy(""); mutating.current = false; } }
  }
  const discard = useCallback(() => {
    if (createAttempt.current.snapshot() || linkAttempt.current.snapshot()) return;
    setName(""); setEmail(""); setPhone(""); setAddress(""); setProposal(null); setReason(""); setConfirmed(false);
    createAttempt.current.clear(); setCreatePending(null); linkAttempt.current.clear(); setLinkPending(null);
  }, [setName, setEmail, setPhone, setAddress, setProposal, setReason, setCreatePending, setLinkPending]);
  useUnsavedChanges("customers", { dirty: Boolean(name || email || phone || address || proposal || reason || createPending || linkPending), busy: Boolean(busy || createPending || linkPending), onDiscard: discard });
  const disabled = Boolean(busy) || accessEnded;
  return <section className="customers-console" aria-label={embedded ? "Customer records" : undefined} aria-labelledby={embedded ? undefined : "customers-heading"}>
    {!embedded && <h2 id="customers-heading" tabIndex={-1}>Customers</h2>}
    <p>Company customer records and manually classified source records. Matching contact details do not merge customers or verify identity.</p>
    {(createPending || linkPending) && !busy && <p role="status">A previous save has not been confirmed. Retry the unchanged request before editing or leaving this screen.</p>}
    {error && <p className="operations-error" role="alert">{error}</p>}{notice && <p className="operations-notice" role="status">{notice}</p>}
    {!accessEnded && <>
      <section className="operations-panel" aria-labelledby="customers-list-heading">
        <h3 id="customers-list-heading" tabIndex={-1} ref={listHeading}>Find a customer</h3>
        <form className="customers-search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); back(); void loadList(search.trim()); }}>
          <label htmlFor="customer-search">Name, contact or source reference<input id="customer-search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} disabled={disabled} /></label>
          <button type="submit" disabled={disabled}>Search customers</button>
        </form>
        {listBusy && <p role="status">Loading customers…</p>}
        {listError && <div role="alert" className="operations-error"><p>{listError}</p><p>Customer storage may need setup. This is not an empty customer list.</p><button type="button" disabled={disabled || listBusy} onClick={() => void loadList(query, list?.page)}>Retry customers</button></div>}
        {list && !listBusy && !listError && <>
          {list.customers.length === 0 ? <p>{query ? "No customers match this search." : "No customers have been created yet."}</p> : <ul className="customers-cards">{list.customers.map(customer => <li key={customer.id}><h4>{customer.name}</h4><p>{customer.email || customer.phone || "No contact details"}</p><button type="button" disabled={disabled || Boolean(linkPending)} aria-current={selectedId === customer.id ? "true" : undefined} onClick={() => { if (linkAttempt.current.snapshot()) return; setProposal(null); setReason(""); setConfirmed(false); linkAttempt.current.clear(); setLinkPending(null); void loadDetail(customer.id, true); }}>Open customer</button></li>)}</ul>}
          <PageControls page={list.page} total={list.total} pageSize={list.pageSize} disabled={disabled || listBusy} onPage={page => void loadList(query, page)} label="Customer pages" />
        </>}
      </section>
      <section className="operations-panel"><h3>Create customer</h3><form onSubmit={create} aria-busy={busy === "create"}>
        <div className="customers-form-grid"><label htmlFor="customer-name">Name<input id="customer-name" autoComplete="off" required maxLength={120} value={name} onChange={event => setName(event.target.value)} disabled={disabled || Boolean(createPending)} /></label><label htmlFor="customer-email">Email (optional)<input id="customer-email" type="email" autoComplete="off" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={disabled || Boolean(createPending)} /></label><label htmlFor="customer-phone">Phone (optional)<input id="customer-phone" type="tel" autoComplete="off" maxLength={80} value={phone} onChange={event => setPhone(event.target.value)} disabled={disabled || Boolean(createPending)} /></label><label htmlFor="customer-address">Address (optional)<input id="customer-address" autoComplete="off" maxLength={500} value={address} onChange={event => setAddress(event.target.value)} disabled={disabled || Boolean(createPending)} /></label></div>
        <button type="submit" disabled={disabled || Boolean(linkPending)}>{busy === "create" ? "Saving customer…" : "Create customer"}</button>
        <p className="operations-small">Use the name you have checked. A shared email or phone does not identify the same person.</p>
      </form></section>
      {selectedId && <section className="operations-panel" aria-labelledby="customer-detail-heading">
        <button className="operations-button-secondary" type="button" onClick={back} disabled={disabled || Boolean(linkPending)}>Back to customers</button>
        <h3 ref={detailHeading} id="customer-detail-heading" tabIndex={-1}>{detail?.customer.name || "Customer details"}</h3>
        {detailBusy && <p role="status">Loading customer details…</p>}
        {detailError && <div className="operations-error" role="alert"><p>{detailError}</p><button type="button" disabled={disabled || detailBusy} onClick={() => void loadDetail(selectedId)}>Retry details</button></div>}
        {detail && <>
          {contact(detail.customer)}<p className="operations-small">Customer revision {detail.customer.revision} · Updated {time(detail.customer.updatedAt)} (Sydney)</p>
          <h4>Linked records</h4>
          {detail.records.length === 0 ? <p>No source records are linked to this customer.</p> : detail.records.map(record => <article className="customers-source" key={`${record.sourceType}:${record.sourceId}`}><h5>{sourceLabel(record)} · {record.reference}</h5>{contact(record)}<p>Source status: {record.status}</p>{record.booking && <p>Booking: {record.booking.status} · Calendar sync: {record.booking.syncStatus} · Revision {record.booking.revision}</p>}
            <div className="customers-actions">{filePath(record.links.quotePdf, "pdf") && <a className="operations-button operations-button-secondary" href={record.links.quotePdf!} target="_blank" rel="noreferrer">Open quote PDF</a>}{filePath(record.links.agreementPdf, "pdf") && <a className="operations-button operations-button-secondary" href={record.links.agreementPdf!} target="_blank" rel="noreferrer">Open agreement PDF</a>}{record.photos.map((photo, index) => filePath(photo.url, "photo") && <a className="operations-button operations-button-secondary" href={photo.url} key={photo.id} target="_blank" rel="noreferrer">Open private photo {index + 1}</a>)}</div>
            <p className="operations-small">Documents and photos open through their existing private access checks. An unavailable file does not change this customer link.</p><button type="button" disabled={disabled || Boolean(createPending || linkPending)} onClick={() => propose("unlink", record)}>Review unlink</button></article>)}
          <div className="customers-form-grid"><section><h4>Purchases</h4><p>Not available yet.</p></section><section><h4>Billing</h4><p>Not available yet.</p></section></div>
          <h4>Classification history</h4>{detail.audit.length === 0 ? <p>No classification history is available.</p> : <ol className="customers-audit">{detail.audit.map(event => <li key={event.id}><strong>{event.action === "create" ? "Customer created" : event.action === "link" ? "Record linked" : "Record unlinked"}</strong><p>{event.reason}</p>{event.sourceId && <p>Source: {event.sourceType} · {event.sourceId}</p>}<p className="operations-small">{time(event.createdAt)} (Sydney) · Revision {event.revision} · Staff account {event.actorUserId}</p></li>)}</ol>}
        </>}
      </section>}
      <section className="operations-panel"><h3>Unlinked source records</h3><p>Compare the original contact details with a selected customer before linking. Signed demo submissions and related enquiries stay together.</p>
        <form className="customers-search" onSubmit={event => { event.preventDefault(); setUnlinkedQuery(unlinkedSearch.trim()); void loadUnlinked(unlinkedSearch.trim()); }}><label htmlFor="customer-unlinked-search">Source contact or reference<input id="customer-unlinked-search" maxLength={120} value={unlinkedSearch} onChange={event => setUnlinkedSearch(event.target.value)} disabled={disabled} /></label><button type="submit" disabled={disabled}>Search source records</button></form>
        {unlinkedBusy && <p role="status">Loading unlinked records…</p>}{unlinkedError && <div className="operations-error" role="alert"><p>{unlinkedError}</p><button type="button" disabled={disabled || unlinkedBusy} onClick={() => void loadUnlinked(unlinkedQuery, unlinked?.page)}>Retry source records</button></div>}
        {unlinked && !unlinkedBusy && !unlinkedError && <>{unlinked.records.length === 0 ? <p>{unlinkedQuery ? "No unlinked records match this search." : "No unlinked source records."}</p> : <ul className="customers-cards">{unlinked.records.map(record => <li key={`${record.sourceType}:${record.sourceId}`}><h4>{record.reference}</h4><p>{sourceLabel(record)} · {record.status}</p><p>Contact from this source record</p>{contact(record)}<button type="button" disabled={disabled || !detail || detailBusy || Boolean(createPending || linkPending)} onClick={() => propose("link", record)}>Review link to selected customer</button></li>)}</ul>}<PageControls page={unlinked.page} total={unlinked.total} pageSize={unlinked.pageSize} disabled={disabled || unlinkedBusy} onPage={page => void loadUnlinked(unlinkedQuery, page)} label="Unlinked source pages" /></>}
        {!detail && <p className="operations-small">Open a customer to enable manual linking.</p>}
      </section>
      {proposal && detail && <section className="operations-panel customers-confirmation" aria-labelledby="customer-link-heading"><h3 id="customer-link-heading" ref={proposalHeading} tabIndex={-1}>{proposal.action === "link" ? "Confirm record link" : "Confirm record unlink"}</h3><div className="customers-form-grid"><div><h4>Selected customer</h4>{contact(detail.customer)}</div><div><h4>{sourceLabel(proposal.record)} · {proposal.record.reference}</h4>{contact(proposal.record)}<p>Source status: {proposal.record.status}</p></div></div>
        <p>{proposal.action === "link" ? "This classifies the source under the selected customer. It does not change the original submission or verify customer identity." : "This removes the classification from this customer. It preserves the source, documents, booking and audit history."}</p>
        <form onSubmit={changeLink} aria-busy={busy === "link"}><label htmlFor="customer-link-reason">Reason<textarea id="customer-link-reason" required maxLength={500} rows={3} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }} disabled={disabled || Boolean(linkPending)} /></label><label className="customers-checkbox" htmlFor="customer-link-confirm"><input id="customer-link-confirm" type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={disabled} />I compared this source and this customer and confirm this {proposal.action === "link" ? "link" : "unlink"}.</label><div className="customers-actions"><button type="submit" disabled={disabled || Boolean(createPending) || !confirmed || !reason.trim()}>{busy === "link" ? "Saving classification…" : proposal.action === "link" ? "Confirm link" : "Confirm unlink"}</button><button type="button" className="operations-button-secondary" disabled={disabled || Boolean(linkPending)} onClick={() => { if (linkAttempt.current.snapshot()) return; setProposal(null); setReason(""); setConfirmed(false); linkAttempt.current.clear(); setLinkPending(null); detailHeading.current?.focus(); }}>Cancel</button></div></form>
      </section>}
    </>}
  </section>;
}
