"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CustomerDetail, CustomerProperty } from "../domain/contracts";
import { useUnsavedChanges, useWorkspaceDraft, useWorkspaceNavigation } from "@/shared/ui/admin-workspace-state";
import { AdminEmptyState, AdminStatusBadge } from "@/shared/ui/admin";
import { MutationAttempt, type MutationSnapshot } from "./request-state";
import { customerRequest, CustomerRequestError, reviewCandidates, reviewProperties } from "./customer-client";
import { CustomerCandidateReview, type Candidate } from "./customer-candidate-review";
import { CustomerPropertyReview } from "./customer-property-review";

type Fields = { name: string; email: string; phone: string; address: string; label: string; line1: string; unit: string; suburb: string; state: string; postcode: string; contactName: string; notes: string };
type Mode = "edit-client" | "archive-client" | "restore-client" | "add-property" | "edit-property" | "archive-property" | "restore-property";
type Draft = { mode: Mode; propertyId?: string; revision: number; fields: Fields; reason: string; needsReview?: boolean };
type Command = { path: string; method: string; input: Record<string, unknown> };
const empty: Fields = { name: "", email: "", phone: "", address: "", label: "", line1: "", unit: "", suburb: "", state: "NSW", postcode: "", contactName: "", notes: "" };

export function CustomerManagement({ detail, tab, disabled, onSaved, onFailure, onLock, registerClear }: {
  detail: CustomerDetail; tab: string; disabled: boolean; onSaved: () => Promise<void>;
  onFailure: (cause: unknown) => void; onLock: (locked: boolean) => void;
  registerClear: (clear: (() => void) | null) => void;
}) {
  const key = `customers:${detail.customer.id}:management`;
  const [draft, setDraft] = useWorkspaceDraft<Draft | null>(`${key}:draft`, null);
  const [pending, setPending] = useWorkspaceDraft<MutationSnapshot<Command> | null>(`${key}:attempt`, null);
  const attempt = useRef(new MutationAttempt<Command>(pending));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [filter, setFilter] = useWorkspaceDraft(`${key}:filter`, "active");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null), [differentConfirmed, setDifferentConfirmed] = useState(false);
  const [propertyCandidates, setPropertyCandidates] = useState<CustomerProperty[] | null>(null), [differentPropertyConfirmed, setDifferentPropertyConfirmed] = useState(false);
  const propertyHeadings = useRef(new Map<string, HTMLHeadingElement>());
  const saving = useRef(false), alive = useRef(true), accessRevoked = useRef(false), heading = useRef<HTMLHeadingElement>(null);
  const navigate = useWorkspaceNavigation();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { onLock(Boolean(busy || pending)); return () => onLock(false); }, [busy, pending, onLock]);
  const draftMode = draft?.mode;
  useEffect(() => { if (draftMode) heading.current?.focus(); }, [draftMode]);
  const clearAccess = useCallback(() => { accessRevoked.current = true; attempt.current.clear(); setPending(null); setDraft(null); setCandidates(null); setDifferentConfirmed(false); setPropertyCandidates(null); setDifferentPropertyConfirmed(false); setNotice(""); setError(""); }, [setDraft, setPending]);
  useEffect(() => { registerClear(clearAccess); return () => registerClear(null); }, [registerClear, clearAccess]);
  const discard = useCallback(() => { if (attempt.current.snapshot()) return; setDraft(null); setCandidates(null); setDifferentConfirmed(false); setPropertyCandidates(null); setDifferentPropertyConfirmed(false); }, [setDraft]);
  useUnsavedChanges(key, { dirty: Boolean(draft || pending), busy: Boolean(busy || pending), onDiscard: discard });
  const locked = disabled || busy || Boolean(pending);
  function open(mode: Mode, property?: CustomerProperty) {
    if (locked || saving.current) return;
    navigate(() => {
      setCandidates(null); setDifferentConfirmed(false); setPropertyCandidates(null); setDifferentPropertyConfirmed(false); setError(""); setNotice("");
      setDraft({ mode, propertyId: property?.id, revision: property ? property.revision : detail.customer.revision, reason: "", fields: property ? { ...empty, label: property.label, ...property.address, unit: property.address.unit || "", contactName: property.contactName || "", notes: property.notes || "" } : { ...empty, name: detail.customer.name, email: detail.customer.email || "", phone: detail.customer.phone || "", address: detail.customer.address || "" } });
    });
  }
  function field(name: keyof Fields, value: string) {
    setDraft(valueDraft => valueDraft ? { ...valueDraft, fields: { ...valueDraft.fields, [name]: value } } : null);
    setCandidates(null); setDifferentConfirmed(false); setPropertyCandidates(null); setDifferentPropertyConfirmed(false);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || disabled || saving.current) return;
    if (!attempt.current.snapshot() && candidates?.length && !differentConfirmed) { setError("Review every matching client before confirming a different person."); return; }
    if (!attempt.current.snapshot() && propertyCandidates?.length && !differentPropertyConfirmed) { setError("Review every matching property before confirming a different location."); return; }
    saving.current = true; setBusy(true); setError(""); setNotice("");
    const base = `/${encodeURIComponent(detail.customer.id)}`;
    const metadata = { expectedRevision: draft.revision, reason: draft.reason.trim(), ...(candidates?.length ? { decision: { kind: "different_person", reason: draft.reason.trim(), reviewedCandidates: candidates.map(({ customer }) => ({ id: customer.id, revision: customer.revision })) } } : {}) };
    const f = draft.fields;
    let command: Command;
    if (draft.mode === "edit-client") command = { path: base, method: "PATCH", input: { ...metadata, name: f.name.trim(), email: f.email.trim(), phone: f.phone.trim(), address: f.address.trim(), ...(candidates?.length ? { decision: { kind: "different_person", reason: draft.reason.trim(), reviewedCandidates: candidates.map(({ customer }) => ({ id: customer.id, revision: customer.revision })) } } : {}) } };
    else if (draft.mode === "archive-client" || draft.mode === "restore-client") command = { path: `${base}/${draft.mode === "archive-client" ? "archive" : "restore"}`, method: "POST", input: metadata };
    else {
      const propertyPath = `${base}/properties${draft.propertyId ? `/${encodeURIComponent(draft.propertyId)}` : ""}`;
      command = draft.mode === "archive-property" || draft.mode === "restore-property" ? { path: `${propertyPath}/${draft.mode === "archive-property" ? "archive" : "restore"}`, method: "POST", input: metadata }
        : { path: propertyPath, method: draft.mode === "edit-property" ? "PATCH" : "POST", input: { ...metadata, label: f.label.trim(), address: { line1: f.line1.trim(), unit: f.unit.trim(), suburb: f.suburb.trim(), state: f.state.trim(), postcode: f.postcode.trim(), country: "AU" }, contactName: f.contactName.trim(), notes: f.notes.trim(), ...(propertyCandidates?.length ? { propertyDecision: { kind: "different_property", reason: draft.reason.trim(), reviewedProperties: propertyCandidates.map(property => ({ id: property.id, revision: property.revision })) } } : {}) } };
    }
    try {
      const frozen = attempt.current.snapshot()?.value ?? attempt.current.prepare(command, () => crypto.randomUUID()); setPending(attempt.current.snapshot());
      const result = await customerRequest<{ propertyOutcome?: string }>(frozen.path, { ...frozen.input, idempotencyKey: frozen.idempotencyKey }, undefined, frozen.method);
      if (accessRevoked.current) return;
      // A confirmed write is final even if the following read fails.
      attempt.current.clear(); setPending(null); setDraft(null); setCandidates(null); setDifferentConfirmed(false); setPropertyCandidates(null); setDifferentPropertyConfirmed(false);
      if (!alive.current || accessRevoked.current) return;
      setNotice(result.propertyOutcome === "property_reused" ? "The existing property was reused. No duplicate property was created." : "Changes saved. Existing source records, signed documents and booking snapshots were preserved.");
      await onSaved();
    } catch (cause) {
      if (!alive.current || accessRevoked.current) return;
      if (cause instanceof CustomerRequestError && (cause.status === 401 || cause.status === 403)) {
        clearAccess(); onFailure(cause); return;
      }
      const matches = reviewCandidates<Candidate>(cause);
      const propertyMatches = reviewProperties<CustomerProperty>(cause);
      if (cause instanceof CustomerRequestError && cause.status >= 400 && cause.status < 500) { attempt.current.clear(); setPending(null); }
      if (matches) { setCandidates(matches); setDifferentConfirmed(false); setError("These contact details match another client. Review the candidates before saving."); }
      else if (propertyMatches) { setPropertyCandidates(propertyMatches); setDifferentPropertyConfirmed(false); setError("This address may match an existing property. Compare the complete addresses and units before saving."); }
      else if (cause instanceof CustomerRequestError && cause.status === 409) {
        setDraft(previous => previous ? { ...previous, needsReview: true } : null);
        setError("This record changed. Your input was kept. Compare it with the latest saved details below, then confirm the current revision before retrying.");
        await onSaved();
      } else setError(cause instanceof Error ? cause.message : "Could not save changes. Retry the unchanged request.");
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  const properties = detail.properties || [];
  const selected = draft?.propertyId ? properties.find(property => property.id === draft.propertyId) : null;
  const latestRevision = selected?.revision ?? detail.customer.revision;
  const stale = Boolean(draft && (draft.needsReview || draft.revision !== latestRevision));
  const stateOnly = draft && ["archive-client", "restore-client", "archive-property", "restore-property"].includes(draft.mode);
  const title = draft?.mode.replaceAll("-", " ");
  return <div hidden={tab !== "summary" && tab !== "properties"}>
    {tab === "summary" && <section aria-label="Manage client"><div className="ems-actions"><AdminStatusBadge tone={detail.customer.status === "archived" ? "warning" : "success"}>{detail.customer.status || "active"}</AdminStatusBadge><button className="ems-button ems-button--secondary" type="button" disabled={locked || detail.customer.status === "archived"} onClick={() => open("edit-client")}>Edit client</button><button className="ems-button ems-button--secondary" type="button" disabled={locked} onClick={() => open(detail.customer.status === "archived" ? "restore-client" : "archive-client")}>{detail.customer.status === "archived" ? "Restore client" : "Archive client"}</button></div><p className="ems-list-meta">The client address retains its original meaning. Manage job locations separately under Properties.</p></section>}
    {tab === "properties" && <section aria-label="Client properties"><div className="ems-toolbar"><h3>Properties</h3><button className="ems-button" type="button" disabled={locked || detail.customer.status === "archived"} onClick={() => open("add-property")}>Add property</button></div><label className="ems-field">Property status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></label>
      {detail.customer.status === "archived" && <p className="ems-feedback">Restore this client before adding or changing properties.</p>}
      {properties.filter(property => filter === "all" || property.status === filter).length === 0 ? <AdminEmptyState title="No properties in this view" description="Add a separate job location for this client, or change the status filter." /> : <ul className="ems-list">{properties.filter(property => filter === "all" || property.status === filter).map(property => <li className="ems-record-row" key={property.id}><div className="ems-record-main"><h4 tabIndex={-1} ref={element => { if (element) propertyHeadings.current.set(property.id, element); else propertyHeadings.current.delete(property.id); }}>{property.label}</h4><AdminStatusBadge>{property.status}</AdminStatusBadge><p>{[property.address.unit, property.address.line1, property.address.suburb, property.address.state, property.address.postcode].filter(Boolean).join(", ")}</p>{property.contactName && <p>Site contact: {property.contactName}</p>}{property.notes && <p>{property.notes}</p>}<p className="ems-list-meta">Revision {property.revision}</p></div><div className="ems-record-actions"><button className="ems-button ems-button--secondary" type="button" disabled={locked || detail.customer.status === "archived" || property.status === "archived"} onClick={() => open("edit-property", property)}>Edit property</button><button className="ems-button ems-button--secondary" type="button" disabled={locked || detail.customer.status === "archived"} onClick={() => open(property.status === "archived" ? "restore-property" : "archive-property", property)}>{property.status === "archived" ? "Restore property" : "Archive property"}</button></div></li>)}</ul>}
    </section>}
    {error && <p className="ems-feedback ems-feedback--error" role="alert">{error}</p>}{notice && <p className="ems-feedback" role="status">{notice}</p>}
    {pending && !busy && <p className="ems-feedback" role="status">The last save was not confirmed. Retry the unchanged details before editing or leaving.</p>}
    {draft && <section className="ems-panel" aria-labelledby={`${key}-heading`}><h3 id={`${key}-heading`} ref={heading} tabIndex={-1}>{title}: {selected?.label || detail.customer.name}</h3>
      {stateOnly && <><p>{draft.mode.startsWith("archive") ? "Archiving hides this record from active lists. You can restore it later. Connected properties, quotes, bookings and documents remain saved." : "Restoring makes this record active again. Existing relationships and documents are preserved."}</p><p>Client: {detail.customer.name} · {detail.records.length} connected records · {properties.length} properties. Properties retain their own active or archived state.</p></>}
      {stale && <div className="ems-feedback"><p>Latest saved revision: {latestRevision}. Your form is based on revision {draft.revision}.</p><p>{selected ? `${selected.label} · ${[selected.address.unit, selected.address.line1, selected.address.suburb, selected.address.state, selected.address.postcode].filter(Boolean).join(", ")} · ${selected.contactName || "No site contact"} · ${selected.notes || "No notes"}` : `${detail.customer.name} · ${detail.customer.email || "No email"} · ${detail.customer.phone || "No phone"} · ${detail.customer.address || "No address"}`} · {selected?.status || detail.customer.status}</p><button className="ems-button ems-button--secondary" type="button" disabled={locked} onClick={() => { setDraft({ ...draft, revision: latestRevision, needsReview: false }); setDifferentConfirmed(false); setDifferentPropertyConfirmed(false); }}>I reviewed the latest details; keep my changes</button></div>}
      <form onSubmit={save} aria-busy={busy}>
        {!stateOnly && <div className="ems-detail-grid">{(draft.mode === "edit-client" ? ["name", "email", "phone", "address"] : ["label", "line1", "unit", "suburb", "state", "postcode", "contactName", "notes"]).map(name => {
          const fieldName = name as keyof Fields;
          const labels: Partial<Record<keyof Fields, string>> = { name: "Name", email: "Email (optional)", phone: "Phone (optional)", address: "Client address (optional)", label: "Property name", line1: "Street address", unit: "Unit/apartment (optional)", suburb: "Suburb", state: "State", postcode: "Postcode", contactName: "Site contact (optional)", notes: "Site notes (optional)" };
          const limits: Partial<Record<keyof Fields, number>> = { name: 120, email: 254, phone: 80, address: 500, label: 120, line1: 300, unit: 80, suburb: 120, state: 20, postcode: 10, contactName: 120, notes: 2000 };
          return <label key={name} className="ems-field">{labels[fieldName]}{fieldName === "notes" ? <textarea rows={3} maxLength={limits[fieldName]} value={draft.fields[fieldName]} disabled={locked} onChange={event => field(fieldName, event.target.value)} /> : <input autoComplete="off" type={fieldName === "email" ? "email" : fieldName === "phone" ? "tel" : "text"} maxLength={limits[fieldName]} required={["name", "label", "line1", "suburb", "state", "postcode"].includes(name)} value={draft.fields[fieldName]} disabled={locked} onChange={event => field(fieldName, event.target.value)} />}</label>;
        })}</div>}
        <label className="ems-field">Reason<textarea required maxLength={500} rows={3} value={draft.reason} disabled={locked} onChange={event => { setDraft({ ...draft, reason: event.target.value }); setDifferentConfirmed(false); setDifferentPropertyConfirmed(false); }} /></label>
        {candidates && <CustomerCandidateReview candidates={candidates} disabled={locked} reason={draft.reason} onReason={reason => setDraft({ ...draft, reason })} confirmed={differentConfirmed} onConfirmed={setDifferentConfirmed} />}
        {propertyCandidates && <CustomerPropertyReview properties={propertyCandidates} disabled={locked} reason={draft.reason} confirmed={differentPropertyConfirmed} onConfirmed={setDifferentPropertyConfirmed} onExisting={draft.mode === "add-property" ? property => {
          discard(); setFilter("all"); setError(""); setNotice(`Existing property selected: ${property.label}. No new record was created.${property.status === "archived" ? " Restore this property before new work uses it." : ""}`);
          requestAnimationFrame(() => propertyHeadings.current.get(property.id)?.focus());
        } : undefined} />}
        <div className="ems-actions"><button className="ems-button" type="submit" disabled={disabled || busy || Boolean(!pending && stale) || !draft.reason.trim() || Boolean(!pending && candidates?.length && !differentConfirmed) || Boolean(!pending && propertyCandidates?.length && !differentPropertyConfirmed)}>{busy ? "Saving changes…" : pending ? "Retry unchanged save" : stateOnly ? `Confirm ${draft.mode.startsWith("archive") ? "archive" : "restore"}` : "Save changes"}</button><button className="ems-button ems-button--secondary" type="button" disabled={locked} onClick={() => navigate(discard)}>Cancel</button></div>
      </form>
    </section>}
  </div>;
}
