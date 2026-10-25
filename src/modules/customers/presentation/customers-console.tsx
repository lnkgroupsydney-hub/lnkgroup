"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatSelectedAddress } from "@/shared/address";
import { AddressAutocompleteInput } from "@/shared/ui/address-autocomplete-input";
import { ValidatedInput, reportSectionValidity } from "@/shared/ui/validated-input";
import { useRouter } from "next/navigation";
import type { Customer, CustomerDetail, CustomerPage, CustomerRecord, ChangeCustomerLinkInput, UnlinkedRecordPage, ResolveCustomerInput, ResolveCustomerResult } from "../domain/contracts";
import { AdminWorkspaceStateProvider, WorkspaceLink, useWorkspaceNavigation, useUnsavedChanges, useWorkspaceDraft } from "@/shared/ui/admin-workspace-state";
import { MutationAttempt, ReadLane, type MutationSnapshot } from "./request-state";
import { AdminEmptyState, AdminTabs } from "@/shared/ui/admin";
import { CustomerDetailView, customerTabs } from "./customer-detail-view";
import { contact, sourceLabel, time } from "./customer-record-view";
import { customerRequest as request, CustomerRequestError, reviewCandidates } from "./customer-client";
import { CustomerCandidateReview, type Candidate } from "./customer-candidate-review";
import { CustomerManagement } from "./customer-management";
import "./customers-console.css";

function PageControls({ page, total, pageSize, disabled, onPage, label }: { page: number; total: number; pageSize: number; disabled: boolean; onPage: (page: number) => void; label: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="ems-actions" aria-label={label}><button className="ems-button ems-button--secondary" type="button" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page} of {pages} · {total} records</span><button className="ems-button ems-button--secondary" type="button" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)}>Next</button></nav>;
}

type CustomerInput = Omit<ResolveCustomerInput, "idempotencyKey">;
type LinkInput = Omit<ChangeCustomerLinkInput, "idempotencyKey">;
type LinkProposal = { customerId: string; action: "link" | "unlink"; record: CustomerRecord; revision: number };

type CustomersConsoleProps = { onSignedOut?: () => void; embedded?: boolean; initialCustomerId?: string };
export function CustomersConsole(props: CustomersConsoleProps = {}) {
  if (!props.embedded) return <div className="ems-root customers-standalone"><AdminWorkspaceStateProvider><CustomersWorkspace {...props} /></AdminWorkspaceStateProvider></div>;
  return <CustomersWorkspace {...props} />;
}
function CustomersWorkspace({ onSignedOut, embedded = false, initialCustomerId }: CustomersConsoleProps) {
  const navigate = useWorkspaceNavigation();
  const router = useRouter();
  const classificationKey = `customers:${initialCustomerId || "list"}`;
  const [createOpen, setCreateOpen] = useWorkspaceDraft("customers:create-open", false);
  const [page, setPage] = useWorkspaceDraft("customers:page", 1), [unlinkedPage, setUnlinkedPage] = useWorkspaceDraft("customers:unlinked-page", 1);
  const [activeTab, setActiveTab] = useWorkspaceDraft("customers:tab", "summary");
  const [status, setStatus] = useWorkspaceDraft<"active" | "archived" | "all">("customers:status", "active");
  const statusRef = useRef(status);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null), [candidateBusy, setCandidateBusy] = useState(false);
  const [duplicateReason, setDuplicateReason] = useWorkspaceDraft("customers:duplicate-reason", ""), [differentConfirmed, setDifferentConfirmed] = useState(false);
  const [managementLocked, setManagementLocked] = useState(false);
  const managementClear = useRef<(() => void) | null>(null);
  const registerManagementClear = useCallback((clear: (() => void) | null) => { managementClear.current = clear; }, []);
  const createDialog = useRef<HTMLDialogElement>(null), createTrigger = useRef<HTMLButtonElement>(null);
  const [accessEnded, setAccessEnded] = useState(false);
  const [list, setList] = useState<CustomerPage | null>(null), [unlinked, setUnlinked] = useState<UnlinkedRecordPage | null>(null);
  const [detail, setDetail] = useState<CustomerDetail | null>(null), [selectedId, setSelectedId] = useWorkspaceDraft<string | null>("customers:selected", null);
  const displayedCustomerId = initialCustomerId || (!embedded ? selectedId : null);
  const [search, setSearch] = useWorkspaceDraft("customers:search", ""), [query, setQuery] = useWorkspaceDraft("customers:query", ""), [unlinkedSearch, setUnlinkedSearch] = useWorkspaceDraft("customers:unlinkedSearch", ""), [unlinkedQuery, setUnlinkedQuery] = useWorkspaceDraft("customers:unlinkedQuery", "");
  const [name, setName] = useWorkspaceDraft("customers:name", ""), [email, setEmail] = useWorkspaceDraft("customers:email", ""), [phone, setPhone] = useWorkspaceDraft("customers:phone", ""), [address, setAddress] = useWorkspaceDraft("customers:address", "");
  const [listBusy, setListBusy] = useState(true), [unlinkedBusy, setUnlinkedBusy] = useState(true), [detailBusy, setDetailBusy] = useState(false);
  const [busy, setBusy] = useState(""), [listError, setListError] = useState(""), [unlinkedError, setUnlinkedError] = useState(""), [detailError, setDetailError] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [proposal, setProposal] = useWorkspaceDraft<LinkProposal | null>(`${classificationKey}:proposal`, null), [reason, setReason] = useWorkspaceDraft(`${classificationKey}:reason`, ""), [confirmed, setConfirmed] = useState(false);
  const alive = useRef(true), blocked = useRef(false), mutating = useRef(false), currentId = useRef<string | null>(null);
  const listLane = useRef(new ReadLane()), unlinkedLane = useRef(new ReadLane()), detailLane = useRef(new ReadLane()), candidateLane = useRef(new ReadLane());
  const [createPending, setCreatePending] = useWorkspaceDraft<MutationSnapshot<CustomerInput> | null>("customers:create-attempt", null);
  const [linkPending, setLinkPending] = useWorkspaceDraft<MutationSnapshot<LinkInput> | null>(`${classificationKey}:link-attempt`, null);
  const createAttempt = useRef(new MutationAttempt<CustomerInput>(createPending));
  const linkAttempt = useRef(new MutationAttempt<LinkInput>(linkPending));
  const restored = useRef({ query, unlinkedQuery, selectedId: initialCustomerId || selectedId, proposal, page, unlinkedPage });
  const detailHeading = useRef<HTMLHeadingElement>(null), listHeading = useRef<HTMLHeadingElement>(null), proposalHeading = useRef<HTMLHeadingElement>(null);
  const failure = useCallback((cause: unknown, target: (text: string) => void) => {
    if (!alive.current || blocked.current || (cause instanceof DOMException && cause.name === "AbortError")) return;
    if (cause instanceof CustomerRequestError && (cause.status === 401 || cause.status === 403)) {
      blocked.current = true; setAccessEnded(true); listLane.current.cancel(); unlinkedLane.current.cancel(); detailLane.current.cancel(); candidateLane.current.cancel();
      setCandidates(null); setDuplicateReason(""); setDifferentConfirmed(false);
      managementClear.current?.();
      setCreateOpen(false); setPage(1); setUnlinkedPage(1); setActiveTab("summary"); setListError(""); setUnlinkedError(""); setDetailError(""); setList(null); setUnlinked(null); setDetail(null); setSelectedId(null); currentId.current = null;
      setName(""); setEmail(""); setPhone(""); setAddress(""); setSearch(""); setQuery(""); setUnlinkedSearch(""); setUnlinkedQuery("");
      setProposal(null); setReason(""); setConfirmed(false); createAttempt.current.clear(); setCreatePending(null); linkAttempt.current.clear(); setLinkPending(null); setNotice("");
      restored.current = { query: "", unlinkedQuery: "", selectedId: null, proposal: null, page: 1, unlinkedPage: 1 };
      setError("Administrator access has ended. Sign in again to open company records."); onSignedOut?.(); return;
    }
    target(cause instanceof Error ? cause.message : "Could not complete this request. Please retry.");
  }, [onSignedOut, setSelectedId, setName, setEmail, setPhone, setAddress, setSearch, setQuery, setUnlinkedSearch, setUnlinkedQuery, setProposal, setReason, setCreatePending, setLinkPending, setCreateOpen, setPage, setUnlinkedPage, setActiveTab, setDuplicateReason]);
  const loadList = useCallback(async (q: string, page = 1) => {
    const lane = listLane.current.begin(); setListBusy(true); setListError("");
    try { const value = await request<CustomerPage>(`?${new URLSearchParams({ q, page: String(page), pageSize: "10", status: statusRef.current })}`, undefined, lane.signal); if (alive.current && !blocked.current && lane.current()) { setList(value); setPage(value.page); } }
    catch (cause) { if (lane.current()) failure(cause, setListError); }
    finally { if (alive.current && lane.current()) setListBusy(false); }
  }, [failure, setPage]);
  const loadUnlinked = useCallback(async (q: string, page = 1) => {
    const lane = unlinkedLane.current.begin(); setUnlinkedBusy(true); setUnlinkedError("");
    try { const value = await request<UnlinkedRecordPage>(`/unlinked?${new URLSearchParams({ q, page: String(page), pageSize: "10" })}`, undefined, lane.signal); if (alive.current && !blocked.current && lane.current()) { setUnlinked(value); setUnlinkedPage(value.page); } }
    catch (cause) { if (lane.current()) failure(cause, setUnlinkedError); }
    finally { if (alive.current && lane.current()) setUnlinkedBusy(false); }
  }, [failure, setUnlinkedPage]);
  const loadDetail = useCallback(async (id: string, focus = false) => {
    const lane = detailLane.current.begin(); if (currentId.current !== id) setDetail(null); currentId.current = id; setSelectedId(id); setDetailBusy(true); setDetailError("");
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
      if (active) await Promise.all(initialCustomerId ? [loadDetail(initialCustomerId, true), loadUnlinked(restored.current.unlinkedQuery, restored.current.unlinkedPage)] : [loadList(restored.current.query, restored.current.page), ...(!embedded ? [loadUnlinked(restored.current.unlinkedQuery, restored.current.unlinkedPage), ...(restored.current.selectedId ? [loadDetail(restored.current.selectedId)] : [])] : [])]);
    }
    void initialize();
    const listRead = listLane.current, unlinkedRead = unlinkedLane.current, detailRead = detailLane.current, candidateRead = candidateLane.current;
    return () => { active = false; alive.current = false; listRead.cancel(); unlinkedRead.cancel(); detailRead.cancel(); candidateRead.cancel(); };
  }, [loadList, loadUnlinked, loadDetail, initialCustomerId, embedded]);
  useEffect(() => { if (proposal) proposalHeading.current?.focus(); }, [proposal]);

  function openInline(id: string) {
    if (managementLocked || mutating.current || createAttempt.current.snapshot() || linkAttempt.current.snapshot()) return;
    navigate(() => { setProposal(null); setReason(""); setConfirmed(false); void loadDetail(id, true); });
  }
  function backInline() {
    if (mutating.current || createAttempt.current.snapshot() || linkAttempt.current.snapshot()) return;
    navigate(() => { detailLane.current.cancel(); currentId.current = null; setSelectedId(null); setDetail(null); setProposal(null); setReason(""); setConfirmed(false); listHeading.current?.focus(); });
  }
  function propose(action: "link" | "unlink", record: CustomerRecord) {
    if (record.sourceType === "quote_request" || managementLocked || mutating.current || createAttempt.current.snapshot() || linkAttempt.current.snapshot() || !detail || detail.customer.status === "archived") return;
    const revision = detail.customer.revision;
    navigate(() => { setProposal({ customerId: detail.customer.id, action, record, revision }); setReason(""); setConfirmed(false); setError(""); });
  }
  async function create(event?: React.FormEvent, existing?: Customer) {
    event?.preventDefault(); if (managementLocked || mutating.current || blocked.current || linkAttempt.current.snapshot()) return;
    if (event && !createAttempt.current.snapshot() && !reportSectionValidity(event.currentTarget as HTMLFormElement)) return;
    if (!createAttempt.current.snapshot() && !existing && candidates?.length && !differentConfirmed) { setError("Review every matching customer before creating a different person or company."); return; }
    mutating.current = true; setBusy("create"); setError(""); setNotice("");
    try {
      const input = createAttempt.current.snapshot()?.value ?? createAttempt.current.prepare({ name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(), ...(existing ? { decision: { kind: "existing" as const, customerId: existing.id, expectedRevision: existing.revision, reason: duplicateReason.trim() } } : candidates?.length ? { decision: { kind: "different_person" as const, reason: duplicateReason.trim(), reviewedCandidates: candidates.map(({ customer }) => ({ id: customer.id, revision: customer.revision })) } } : {}) }, () => crypto.randomUUID());
      setCreatePending(createAttempt.current.snapshot());
      const result = await request<ResolveCustomerResult>("/resolve", input);
      if (!alive.current || blocked.current) return;
      // Commit is confirmed before follow-up reads. A failed list refresh must
      // never turn this into a retryable create with a new idempotency key.
      createAttempt.current.clear(); setCreatePending(null); setProposal(null); setReason(""); setConfirmed(false); linkAttempt.current.clear(); setLinkPending(null); setName(""); setEmail(""); setPhone(""); setAddress("");
      setCandidates(null); setDuplicateReason(""); setDifferentConfirmed(false);
      setNotice(`Customer ${result.customer.name} was ${result.outcome === "client_reused" ? "reused; no new customer was created" : "created"}. Follow-up refresh errors do not undo the saved result.`);
      setCreateOpen(false); setSelectedId(result.customer.id);
      await Promise.all([loadList(query, page), ...(!embedded ? [loadDetail(result.customer.id, true)] : [])]);
      if (alive.current && !blocked.current) requestAnimationFrame(() => listHeading.current?.focus());
    } catch (cause) {
      if (!alive.current || blocked.current) return;
      const matches = reviewCandidates<Candidate>(cause);
      if (matches) { createAttempt.current.clear(); setCreatePending(null); setCandidates(matches); setDifferentConfirmed(false); }
      else if (cause instanceof CustomerRequestError && cause.status >= 400 && cause.status < 500) { createAttempt.current.clear(); setCreatePending(null); }
      if (!matches && cause instanceof CustomerRequestError && cause.status === 409) await checkCandidates();
      failure(cause, setError);
    } finally { if (alive.current) { setBusy(""); mutating.current = false; } }
  }
  async function checkCandidates() {
    const lane = candidateLane.current.begin(); setCandidateBusy(true); setError("");
    try { const value = await request<{ candidates: Candidate[] }>("/candidates", { name: name.trim(), email: email.trim(), phone: phone.trim() }, lane.signal); if (alive.current && !blocked.current && lane.current()) { setCandidates(value.candidates); setDifferentConfirmed(false); } }
    catch (cause) { if (lane.current()) failure(cause, setError); }
    finally { if (alive.current && lane.current()) setCandidateBusy(false); }
  }
  function clearCandidateReview() { candidateLane.current.cancel(); setCandidateBusy(false); setCandidates(null); setDifferentConfirmed(false); }
  async function changeLink(event: React.FormEvent) {
    event.preventDefault(); if (mutating.current || blocked.current || createAttempt.current.snapshot() || !detail || !proposal || proposal.customerId !== detail.customer.id || !confirmed) return;
    if (!linkAttempt.current.snapshot() && !reportSectionValidity(event.currentTarget as HTMLFormElement)) return;
    const id = detail.customer.id;
    mutating.current = true; setBusy("link"); setError(""); setNotice("");
    try {
      const input = linkAttempt.current.prepare({ action: proposal.action, sourceType: proposal.record.sourceType, sourceId: proposal.record.sourceId, reason: reason.trim(), expectedRevision: proposal.revision }, () => crypto.randomUUID());
      setLinkPending(linkAttempt.current.snapshot());
      await request<{ customer: Customer }>(`/${encodeURIComponent(id)}/links`, input);
      if (!alive.current || blocked.current) return;
      linkAttempt.current.clear(); setLinkPending(null); setProposal(null); setReason(""); setConfirmed(false);
      setNotice(proposal.action === "link" ? "Record linked. The source record and its documents were preserved." : "Record unlinked. The source record and the audit history were preserved.");
      await Promise.all([loadDetail(id), loadList(query, page), loadUnlinked(unlinkedQuery, unlinked?.page)]);
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
  useEffect(() => {
    const dialog = createDialog.current;
    if (!createOpen || accessEnded || initialCustomerId || !dialog) return;
    const trigger = createTrigger.current;
    dialog.showModal();
    return () => { dialog.close(); trigger?.focus(); };
  }, [createOpen, accessEnded, initialCustomerId]);
  function closeCreate() {
    if (mutating.current || createAttempt.current.snapshot() || linkAttempt.current.snapshot()) return;
    navigate(() => setCreateOpen(false));
  }
  const discard = useCallback(() => {
    if (createAttempt.current.snapshot() || linkAttempt.current.snapshot()) return;
    setCreateOpen(false); setName(""); setEmail(""); setPhone(""); setAddress(""); setProposal(null); setReason(""); setConfirmed(false); setCandidates(null); setDuplicateReason(""); setDifferentConfirmed(false);
    createAttempt.current.clear(); setCreatePending(null); linkAttempt.current.clear(); setLinkPending(null);
  }, [setName, setEmail, setPhone, setAddress, setProposal, setReason, setCreatePending, setLinkPending, setCreateOpen, setDuplicateReason]);
  useUnsavedChanges(classificationKey, { dirty: Boolean(name || email || phone || address || duplicateReason || proposal || reason || createPending || linkPending), busy: Boolean(busy || createPending || linkPending), onDiscard: discard });
  const disabled = Boolean(busy) || accessEnded || managementLocked;
  return <section className="customers-console" aria-label={embedded ? "Client records" : undefined} aria-labelledby={embedded ? undefined : "customers-heading"}>
    {!embedded && <h2 id="customers-heading" tabIndex={-1}>Clients</h2>}
    {error && <p className="ems-feedback ems-feedback--error" role="alert">{error}</p>}
    {notice && <div className="ems-feedback" role="status"><p>{notice}</p>{selectedId && !initialCustomerId && (embedded ? <WorkspaceLink className="ems-button ems-button--secondary" href={`/admin/customers/${encodeURIComponent(selectedId)}`}>Open customer</WorkspaceLink> : <button className="ems-button ems-button--secondary" type="button" onClick={() => openInline(selectedId)}>Open customer</button>)}</div>}
    {(createPending || linkPending) && !busy && <p className="ems-feedback" role="status">A previous save has not been confirmed. Retry the unchanged request before editing or leaving this screen.</p>}
    {!accessEnded && <>
      {!initialCustomerId ? <>
        <section className="ems-panel" aria-labelledby="customers-list-heading">
          <div className="ems-toolbar"><div><h3 id="customers-list-heading" tabIndex={-1} ref={listHeading}>Client list</h3><p className="ems-list-meta">Search company clients or add a client after checking their details.</p></div><button ref={createTrigger} className="ems-button" type="button" disabled={disabled || Boolean(linkPending)} onClick={() => setCreateOpen(true)}>Add client</button></div>
          <form className="ems-toolbar" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); void loadList(search.trim()); }}>
            <label className="ems-field" htmlFor="customer-search">Name, contact or source reference<ValidatedInput validation="text" validationLabel="Customer search" type="search" id="customer-search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} disabled={disabled} /></label>
            <label className="ems-field" htmlFor="customer-status">Client status<select id="customer-status" value={status} disabled={disabled} onChange={event => { const next = event.target.value as typeof status; statusRef.current = next; setStatus(next); void loadList(query); }}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
            <button className="ems-button ems-button--secondary" type="submit" disabled={disabled}>Search customers</button>
          </form>
          {listBusy && <p role="status">Loading customers…</p>}
          {listError && <div role="alert" className="ems-feedback ems-feedback--error"><p>{listError}</p><p>Customer storage may need setup. This is not an empty customer list.</p><button className="ems-button ems-button--secondary" type="button" disabled={disabled || listBusy} onClick={() => void loadList(query, page)}>Retry customers</button></div>}
          {list && !listBusy && !listError && <>
            <p className="ems-list-meta">{list.total} {list.total === 1 ? "client" : "clients"}{query ? " matching this search" : ""}</p>
            {list.customers.length === 0 ? <AdminEmptyState title={query ? "No customers match this search" : "No customers have been created yet"} description={query ? "Try another name, contact or source reference." : "Use Add client to save the first company client."} /> : <ul className="ems-list">{list.customers.map(customer => <li className="ems-record-row" key={customer.id}>
              <div className="ems-record-main"><h4>{customer.name}</h4><p>{customer.email || customer.phone || "No contact details"}</p><p className="ems-list-meta">{customer.status || "active"} · Updated {time(customer.updatedAt)} (Sydney)</p></div>
              <div className="ems-record-actions">{embedded ? <WorkspaceLink className="ems-button ems-button--secondary" aria-current={selectedId === customer.id ? "true" : undefined} href={`/admin/customers/${encodeURIComponent(customer.id)}`}>Open customer</WorkspaceLink> : <button className="ems-button ems-button--secondary" type="button" disabled={disabled || Boolean(createPending || linkPending)} onClick={() => openInline(customer.id)}>Open customer</button>}</div>
            </li>)}</ul>}
            <PageControls page={list.page} total={list.total} pageSize={list.pageSize} disabled={disabled || listBusy} onPage={page => void loadList(query, page)} label="Customer pages" />
          </>}
        </section>
        <dialog ref={createDialog} className="ems-dialog" aria-labelledby="customer-create-heading" onCancel={event => { event.preventDefault(); closeCreate(); }}>
          <div className="ems-toolbar"><h2 id="customer-create-heading">Create customer</h2><button className="ems-button ems-button--secondary" type="button" disabled={disabled || Boolean(createPending || linkPending)} onClick={closeCreate}>Close</button></div>
          <p className="ems-list-meta">Check possible matches before saving. Shared contact details alone do not identify the same person.</p>
          {error && <p className="ems-feedback ems-feedback--error" role="alert">{error}</p>}
          {createPending && !busy && <p role="status">The last save was not confirmed. Retry these unchanged details.</p>}
          <form onSubmit={create} aria-busy={busy === "create"}>
            <div className="ems-detail-grid">
              <label className="ems-field" htmlFor="customer-name">Name<ValidatedInput validation="text" requireLetter validationLabel="Customer name" id="customer-name" autoComplete="off" required maxLength={120} value={name} onChange={event => { setName(event.target.value); clearCandidateReview(); }} disabled={disabled || Boolean(createPending)} /></label>
              <label className="ems-field" htmlFor="customer-email">Email (optional)<ValidatedInput validation="email" validationLabel="Email" id="customer-email" type="email" autoComplete="off" maxLength={254} value={email} onChange={event => { setEmail(event.target.value); clearCandidateReview(); }} disabled={disabled || Boolean(createPending)} /></label>
              <label className="ems-field" htmlFor="customer-phone">Phone (optional)<ValidatedInput validation="phone" validationLabel="Australian phone number" id="customer-phone" type="tel" autoComplete="off" maxLength={80} value={phone} onChange={event => { setPhone(event.target.value); clearCandidateReview(); }} disabled={disabled || Boolean(createPending)} /></label>
              <div className="ems-field address-field"><label htmlFor="customer-address">Address (optional)</label><AddressAutocompleteInput id="customer-address" kind="street" addressContext={address} onAddressSelect={selected => setAddress(formatSelectedAddress(selected))} selectionMessage="Address updated. Check all details and add any missing unit or apartment number." autoComplete="street-address" maxLength={500} value={address} onChange={event => setAddress(event.target.value)} disabled={disabled || Boolean(createPending)} /></div>
            </div>
            <div className="ems-actions"><button className="ems-button ems-button--secondary" type="button" disabled={disabled || candidateBusy || Boolean(createPending)} onClick={() => void checkCandidates()}>{candidateBusy ? "Checking matches…" : "Review matches"}</button></div>
            {candidates?.length ? <CustomerCandidateReview candidates={candidates} disabled={disabled || Boolean(createPending)} reason={duplicateReason} onReason={setDuplicateReason} confirmed={differentConfirmed} onConfirmed={setDifferentConfirmed} onExisting={customer => {
              if (customer.status === "archived") { navigate(() => { discard(); setSelectedId(customer.id); if (embedded) router.push(`/admin/customers/${encodeURIComponent(customer.id)}`); else void loadDetail(customer.id, true); }); return; }
              if (!duplicateReason.trim()) { setError("Enter a review reason before using an existing client."); return; }
              void create(undefined, customer);
            }} /> : candidates && <p role="status">No possible matches found. The server checks again when saving.</p>}
            <div className="ems-actions"><button className="ems-button" type="submit" disabled={disabled || Boolean(linkPending) || candidateBusy || Boolean(!createPending && candidates?.length && !differentConfirmed)}>{busy === "create" ? "Saving customer…" : createPending ? "Retry unchanged create" : candidates?.length ? "Create reviewed different client" : "Create customer"}</button><button className="ems-button ems-button--secondary" type="button" disabled={disabled || Boolean(createPending || linkPending)} onClick={closeCreate}>Cancel</button></div>
          </form>
        </dialog>
      </> : null}
      {displayedCustomerId && <>
        {embedded ? <WorkspaceLink className="ems-button ems-button--secondary" href="/admin/customers">Back to customers</WorkspaceLink> : <button className="ems-button ems-button--secondary" type="button" disabled={disabled || Boolean(createPending || linkPending)} onClick={backInline}>Back to customers</button>}
        <section className="ems-panel" aria-labelledby="customer-detail-heading">
          <h2 ref={detailHeading} id="customer-detail-heading" tabIndex={-1}>{detail?.customer.name || "Customer details"}</h2>
          {detailBusy && <p role="status">Loading customer details…</p>}
          {detailError && <div className="ems-feedback ems-feedback--error" role="alert"><p>{detailError}</p><button className="ems-button ems-button--secondary" type="button" disabled={disabled || detailBusy} onClick={() => void loadDetail(displayedCustomerId)}>Retry details</button></div>}
          {detail && <>
            <div className="ems-summary"><p>{detail.customer.email || detail.customer.phone || "No contact details"}</p><p className="ems-list-meta">Customer revision {detail.customer.revision} · Updated {time(detail.customer.updatedAt)} (Sydney)</p></div>
            <AdminTabs activeId={activeTab} onChange={setActiveTab} items={customerTabs} label="Client details">{(tab, panelProps, getPanelProps) => <><div {...panelProps}>
              <CustomerDetailView detail={detail} tab={tab} disabled={disabled || detail.customer.status === "archived" || Boolean(createPending || linkPending)} onPropose={propose} />
              <CustomerManagement key={detail.customer.id} detail={detail} tab={tab} disabled={Boolean(busy || accessEnded || createPending || linkPending || detailBusy)} onSaved={async () => { await Promise.all([loadDetail(detail.customer.id), loadList(query, page)]); }} onFailure={cause => failure(cause, setError)} onLock={setManagementLocked} registerClear={registerManagementClear} />
              {tab === "records" && <section aria-labelledby="customer-unlinked-heading"><h3 id="customer-unlinked-heading">Unlinked source records</h3><p className="ems-list-meta">Compare original contact details before linking. Signed demo submissions and related enquiries stay together.</p>
                <form className="ems-toolbar" onSubmit={event => { event.preventDefault(); setUnlinkedQuery(unlinkedSearch.trim()); void loadUnlinked(unlinkedSearch.trim()); }}><label className="ems-field" htmlFor="customer-unlinked-search">Source contact or reference<ValidatedInput validation="text" validationLabel="Source record search" type="search" id="customer-unlinked-search" maxLength={120} value={unlinkedSearch} onChange={event => setUnlinkedSearch(event.target.value)} disabled={disabled} /></label><button className="ems-button ems-button--secondary" type="submit" disabled={disabled}>Search source records</button></form>
                {unlinkedBusy && <p role="status">Loading unlinked records…</p>}
                {unlinkedError && <div className="ems-feedback ems-feedback--error" role="alert"><p>{unlinkedError}</p><button className="ems-button ems-button--secondary" type="button" disabled={disabled || unlinkedBusy} onClick={() => void loadUnlinked(unlinkedQuery, unlinkedPage)}>Retry source records</button></div>}
                {unlinked && !unlinkedBusy && !unlinkedError && <>
                  {unlinked.records.length === 0 ? <AdminEmptyState title={unlinkedQuery ? "No unlinked records match this search" : "No unlinked source records"} description="Only available source records without a client classification appear here." /> : <ul className="ems-list">{unlinked.records.map(record => <li className="ems-record-row" key={`${record.sourceType}:${record.sourceId}`}><div className="ems-record-main"><h4>{record.reference}</h4><p>{sourceLabel(record)} · {record.status}</p><details><summary>Original contact details</summary>{contact(record)}</details></div><div className="ems-record-actions"><button className="ems-button ems-button--secondary" type="button" disabled={disabled || detailBusy || Boolean(createPending || linkPending)} onClick={() => propose("link", record)}>Review link to selected customer</button></div></li>)}</ul>}
                  <PageControls page={unlinked.page} total={unlinked.total} pageSize={unlinked.pageSize} disabled={disabled || unlinkedBusy} onPage={page => void loadUnlinked(unlinkedQuery, page)} label="Unlinked source pages" />
                </>}
              </section>}
            </div>{customerTabs.filter(item => item.id !== tab).map(item => <div key={item.id} {...getPanelProps(item.id)} />)}</>}</AdminTabs>
          </>}
        </section>
        {proposal && detail && proposal.customerId === detail.customer.id && <section className="ems-panel customers-confirmation" aria-labelledby="customer-link-heading"><h3 id="customer-link-heading" ref={proposalHeading} tabIndex={-1}>{proposal.action === "link" ? "Confirm record link" : "Confirm record unlink"}</h3><div className="ems-detail-grid"><div><h4>Selected customer</h4>{contact(detail.customer)}</div><div><h4>{sourceLabel(proposal.record)} · {proposal.record.reference}</h4>{contact(proposal.record)}<p>Source status: {proposal.record.status}</p></div></div>
          <p>{proposal.action === "link" ? "This classifies the source under the selected customer. It does not change the original submission or verify customer identity." : "This removes the classification from this customer. It preserves the source, documents, booking and audit history."}</p>
          <form onSubmit={changeLink} aria-busy={busy === "link"}><label className="ems-field" htmlFor="customer-link-reason">Reason<ValidatedInput validation="text" validationLabel="Reason for this link change" id="customer-link-reason" required maxLength={500} value={reason} onChange={event => { setReason(event.target.value); setConfirmed(false); }} disabled={disabled || Boolean(linkPending)} /></label><label className="customers-checkbox" htmlFor="customer-link-confirm"><input id="customer-link-confirm" type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={disabled} />I compared this source and this customer and confirm this {proposal.action === "link" ? "link" : "unlink"}.</label><div className="ems-actions"><button className="ems-button" type="submit" disabled={disabled || Boolean(createPending) || !confirmed || !reason.trim()}>{busy === "link" ? "Saving classification…" : proposal.action === "link" ? "Confirm link" : "Confirm unlink"}</button><button type="button" className="ems-button ems-button--secondary" disabled={disabled || Boolean(linkPending)} onClick={() => { if (linkAttempt.current.snapshot()) return; navigate(() => { setProposal(null); setReason(""); setConfirmed(false); detailHeading.current?.focus(); }); }}>Cancel</button></div></form>
        </section>}
      </>}
    </>}
  </section>;
}
