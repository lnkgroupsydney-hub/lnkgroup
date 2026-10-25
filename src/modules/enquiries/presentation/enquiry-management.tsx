"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, Search } from "lucide-react";
import { useStaffAdmin } from "@/modules/admin-access/client";
import { WorkspaceLink, useUnsavedChanges, useWorkspaceDraft } from "@/shared/ui/admin-workspace-state";
import { AdminEmptyState, AdminPanel, AdminStatusBadge, AdminTabs } from "@/shared/ui/admin";
import { ValidatedInput, ValidatedTextarea, reportSectionValidity } from "@/shared/ui/validated-input";
import type { EnquiryDetail, EnquiryNote, EnquiryRow, WorkAudit } from "../domain/management";
import { CurrentWorkClient, enquiryActions, parseEnquiryAssignees, parseEnquiryDetail, parseEnquiryList, type WorkClientState, type WorkFieldErrors } from "./enquiry-management-client";
import "./enquiry-management.css";

type Assignees = ReturnType<typeof parseEnquiryAssignees>;
type ListStatus = "active" | "archived" | "all";
type InboxFilters = { q: string; status: ListStatus; page: number };
const PAGE_SIZE = 20;
const defaultFilters: InboxFilters = { q: "", status: "active", page: 1 };
const statusNames: Record<ListStatus, string> = { active: "Active", archived: "Archived", all: "Active and archived" };
const time = (value: string | null) => value ? new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(new Date(value)) : "Not recorded";
const sourceName = (source: EnquiryRow["enquiry"]["source"]) => source === "gmail" ? "Gmail" : "Website";
export const enquiryRecordHref = (id: string) => `/admin/enquiries?enquiry=${encodeURIComponent(id)}`;

/** Keeps one CurrentWorkClient per lane and mirrors each awaited snapshot into React state. */
function useWorkLane<T>(parse: (value: unknown) => T, onAccessLost: () => void) {
  const [client] = useState(() => new CurrentWorkClient<T>(parse));
  const [state, setState] = useState<WorkClientState<T>>(() => client.snapshot());
  const alive = useRef(false), lost = useRef(onAccessLost);
  useEffect(() => { lost.current = onAccessLost; }, [onAccessLost]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; client.clear(); }; }, [client]);
  const run = useCallback(async (action: () => Promise<WorkClientState<T>>) => {
    let next: WorkClientState<T>;
    try {
      const request = action();
      if (alive.current) setState(client.snapshot());
      next = await request;
    } catch (cause) {
      next = { ...client.snapshot(), error: cause instanceof Error ? cause.message : "This request could not start." };
    }
    if (alive.current) { setState(next); if (next.phase === "access_lost") lost.current(); }
    return next;
  }, [client]);
  const clear = useCallback(() => { client.clear(); if (alive.current) setState(client.snapshot()); }, [client]);
  return { client, state, run, clear };
}

/** Access loss clears every lane and buffer once, then hands control to the staff sign-in boundary. */
function useAccessLoss(onAccessLost: () => void, clear: { current: () => void }) {
  const fired = useRef(false);
  return useCallback(() => { if (fired.current) return; fired.current = true; clear.current(); onAccessLost(); }, [onAccessLost, clear]);
}

function ownerName(people: Assignees | null, userId: string | null) {
  if (userId === null) return "Unassigned";
  const match = people?.assignees.find(person => person.userId === userId);
  return match ? match.label : people ? "Former staff account (no longer assignable)" : "Assigned staff member";
}
function staffName(people: Assignees | null, userId: string | null) {
  if (!userId) return "System";
  return people?.assignees.find(person => person.userId === userId)?.label ?? "Staff account";
}

export function EnquiryInbox() {
  const { onAccessLost } = useStaffAdmin();
  const clearOnLoss = useRef<() => void>(() => {}), accessLost = useAccessLoss(onAccessLost, clearOnLoss);
  const list = useWorkLane(parseEnquiryList, accessLost), people = useWorkLane(parseEnquiryAssignees, accessLost);
  const [filters, setFilters] = useWorkspaceDraft<InboxFilters>("enquiries:inbox:filters", defaultFilters);
  const [query, setQuery] = useWorkspaceDraft("enquiries:inbox:query", "");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { clearOnLoss.current = () => { list.clear(); people.clear(); setQuery(""); setFilters(defaultFilters); }; });
  const { run: runList, client: listClient } = list, { run: runPeople, client: peopleClient } = people;
  const load = useCallback((next: InboxFilters) => runList(() => listClient.read(`/api/admin/enquiries?${new URLSearchParams({ status: next.status, q: next.q, page: String(next.page), pageSize: String(PAGE_SIZE) })}`)), [runList, listClient]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return load(filters); });
    return () => { cancelled = true; };
  }, [load, filters]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) return runPeople(() => peopleClient.read("/api/admin/enquiries/assignees")); });
    return () => { cancelled = true; };
  }, [runPeople, peopleClient]);
  // Returning from a record removes the focused link; keep keyboard focus in the inbox.
  useEffect(() => { if (document.activeElement === document.body) heading.current?.focus(); }, []);

  const { phase, data, error } = list.state;
  const loading = phase === "loading", failed = phase === "error";
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const searchLabel = filters.q ? ` matching “${filters.q}”` : "";
  const statusText = loading ? "Loading enquiries…" : failed ? "Enquiries could not be loaded." : data ? `${data.total} ${statusNames[filters.status].toLowerCase()} ${data.total === 1 ? "enquiry" : "enquiries"}${searchLabel} · Page ${Math.min(data.page, totalPages)} of ${totalPages}` : "";
  const filtered = Boolean(filters.q || filters.status !== "active");
  function apply(next: Partial<InboxFilters>) { setFilters({ ...filters, q: query.trim(), page: 1, ...next }); }

  return <AdminPanel className="enquiry-inbox">
    <div className="ems-section-heading"><div><h2 id="enquiry-inbox-title" ref={heading} tabIndex={-1}>Enquiry inbox</h2><p>Website and Gmail enquiries. Assign an owner, keep internal notes and archive enquiries that are handled. Archiving never deletes the original message.</p></div><button type="button" className="ems-button ems-button--secondary" disabled={loading} onClick={() => void load(filters)}><RefreshCw size={16} aria-hidden="true" /> {loading ? "Loading enquiries…" : "Refresh enquiries"}</button></div>
    <form className="ems-toolbar" role="search" aria-label="Filter enquiries" onSubmit={event => { event.preventDefault(); apply({}); }}>
      <div className="ems-field"><label htmlFor="enquiry-search">Search enquiries</label><input id="enquiry-search" type="search" maxLength={120} placeholder="Name, email, phone, address or reference" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="ems-field"><label htmlFor="enquiry-status">Show</label><select id="enquiry-status" value={filters.status} onChange={event => apply({ status: event.target.value as ListStatus })}>{(Object.keys(statusNames) as ListStatus[]).map(value => <option key={value} value={value}>{statusNames[value]}</option>)}</select></div>
      <div className="ems-actions"><button type="submit" className="ems-button ems-button--secondary" disabled={loading}><Search size={16} aria-hidden="true" /> Search</button>{(filtered || query) && <button type="button" className="ems-button ems-button--secondary" onClick={() => { setQuery(""); setFilters(defaultFilters); }}>Clear search</button>}</div>
    </form>
    <p className="ems-list-meta" role="status" aria-live="polite">{statusText}</p>
    <div aria-busy={loading}>
      {failed && <div className="ems-feedback ems-feedback--error" role="alert"><p>{error ?? "Enquiries could not be loaded."} {data ? "The list below is from the last successful load." : ""}</p><button type="button" className="ems-button ems-button--secondary" onClick={() => void load(filters)}>Retry loading enquiries</button></div>}
      {!loading && data && (data.enquiries.length === 0
        ? (data.total > 0 && filters.page > 1
          ? <AdminEmptyState title="This page has no enquiries" description="The list changed since this page was opened."><button type="button" className="ems-button ems-button--secondary" onClick={() => setFilters({ ...filters, page: 1 })}>Go to the first page</button></AdminEmptyState>
          : <AdminEmptyState title={filters.q ? `No enquiries match “${filters.q}”` : filters.status === "archived" ? "No archived enquiries" : filters.status === "all" ? "No enquiries yet" : "No active enquiries"} description={filters.q ? "Check the spelling, or search by email, phone or reference. Change Show to include archived enquiries." : filters.status === "archived" ? "Archived enquiries appear here and can be restored at any time." : "New website and Gmail enquiries appear here when they are received."} />)
        : <ul className="ems-list">{data.enquiries.map(row => <EnquiryListRow key={row.enquiry.id} row={row} people={people.state.data} />)}</ul>)}
      {!loading && data && totalPages > 1 && <nav className="enquiry-pagination" aria-label="Enquiry pages"><button type="button" className="ems-button ems-button--secondary" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}><ArrowLeft size={16} aria-hidden="true" /> Previous page</button><span className="ems-list-meta">Page {Math.min(data.page, totalPages)} of {totalPages}</span><button type="button" className="ems-button ems-button--secondary" disabled={filters.page >= totalPages} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Next page <ArrowRight size={16} aria-hidden="true" /></button></nav>}
    </div>
  </AdminPanel>;
}

function EnquiryListRow({ row, people }: { row: EnquiryRow; people: Assignees | null }) {
  const { enquiry, management } = row, contact = enquiry.summary;
  return <li className="ems-record-row"><div className="ems-record-main">
    <h3>{contact.name || "Name not provided"}</h3>
    <p className="ems-record-meta"><span>{enquiry.reference}</span><span>{sourceName(enquiry.source)}</span><span>Received {time(enquiry.createdAt)} (Sydney)</span></p>
    {contact.siteAddress && <p>{contact.siteAddress}</p>}
    <p className="ems-list-meta">Owner: {ownerName(people, management.assigneeUserId)}</p>
  </div><div className="ems-record-actions"><AdminStatusBadge tone={management.status === "archived" ? "warning" : "neutral"}>{management.status === "archived" ? "Archived" : "Active"}</AdminStatusBadge><WorkspaceLink href={enquiryRecordHref(enquiry.id)} className="ems-button ems-button--secondary">Open enquiry<span className="sr-only"> {enquiry.reference}</span><ArrowRight size={16} aria-hidden="true" /></WorkspaceLink></div></li>;
}

type FormKey = "owner" | "note" | "edit" | "status";
type OwnerDraft = { assigneeUserId: string | null; reason: string; revision: number };
type NoteDraft = { body: string; reason: string; revision: number };
type EditDraft = NoteDraft & { noteId: string };
type StatusDraft = { kind: "archive" | "restore"; reason: string; revision: number };
type Feedback = { tone: "success" | "warning" | "error"; text: string; hint?: string; form?: FormKey; fields?: WorkFieldErrors | null };
const commandNames: Record<FormKey, string> = { owner: "The owner change", note: "The new note", edit: "The note edit", status: "The archive status change" };
const savedText: Record<FormKey, string> = { owner: "Owner saved.", note: "Internal note added.", edit: "Note changes saved.", status: "Enquiry status saved." };
const auditNames: Record<string, string> = { enquiry_assign: "Owner changed", assign: "Owner changed", enquiry_note_add: "Internal note added", note_add: "Internal note added", enquiry_note_edit: "Internal note edited", note_edit: "Internal note edited", enquiry_archive: "Archived", archive: "Archived", enquiry_restore: "Restored", restore: "Restored" };
function conflictText(code: string | null) {
  if (code === "idempotency_conflict") return "This request did not match its original attempt, so nothing was saved. Review the current details and start the change again.";
  if (code === "state_conflict") return "This change is not available for the enquiry's current status. Someone may have archived or restored it. The latest details are shown below and your entry was kept.";
  return "This enquiry changed since you started. Your entry was kept. Compare it with the latest saved details, then save again.";
}

type FieldProblem = { id: string; message: string } | null;
const problem = (id: string, message: string | undefined): FieldProblem => message ? { id: `${id}-error`, message } : null;
const describe = (hint: string | null, error: FieldProblem) => [hint, error?.id].filter(Boolean).join(" ") || undefined;
function FieldError({ error }: { error: FieldProblem }) { return error ? <small id={error.id} className="enquiry-field-error">{error.message}</small> : null; }
function ReasonField({ id, value, disabled, error, onChange }: { id: string; value: string; disabled: boolean; error?: string; onChange: (value: string) => void }) {
  const fault = problem(id, error);
  return <div className="ems-field"><label htmlFor={id}>Reason (staff only)</label><ValidatedInput id={id} validation="text" validationLabel="the reason for this change" required maxLength={500} autoComplete="off" value={value} disabled={disabled} aria-invalid={Boolean(fault) || undefined} aria-describedby={describe(`${id}-hint`, fault)} onChange={event => onChange(event.target.value)} /><small id={`${id}-hint`}>Saved in the activity history. Never sent to the customer.</small><FieldError error={fault} /></div>;
}
function StaleNotice({ text, disabled, onKeep }: { text: string; disabled: boolean; onKeep: () => void }) {
  return <div className="ems-feedback enquiry-compare" role="status"><p><strong>Saved details changed since you started.</strong></p><p>{text}</p><div className="ems-actions"><button type="button" className="ems-button ems-button--secondary" disabled={disabled} onClick={onKeep}>I reviewed the latest details; keep my entry</button></div></div>;
}

export function EnquiryRecord({ enquiryId }: { enquiryId: string }) {
  const { onAccessLost } = useStaffAdmin();
  const clearOnLoss = useRef<() => void>(() => {}), accessLost = useAccessLoss(onAccessLost, clearOnLoss);
  const detail = useWorkLane(parseEnquiryDetail, accessLost), people = useWorkLane(parseEnquiryAssignees, accessLost);
  const actions = useMemo(() => enquiryActions(detail.client, enquiryId), [detail.client, enquiryId]);
  const key = `enquiries:${enquiryId}`;
  const [tab, setTab] = useState("summary");
  const [owner, setOwner] = useWorkspaceDraft<OwnerDraft | null>(`${key}:owner`, null);
  const [note, setNote] = useWorkspaceDraft<NoteDraft | null>(`${key}:note`, null);
  const [edit, setEdit] = useWorkspaceDraft<EditDraft | null>(`${key}:edit`, null);
  const [statusDraft, setStatusDraft] = useWorkspaceDraft<StatusDraft | null>(`${key}:status`, null);
  const [command, setCommand] = useState<FormKey | null>(null), [feedback, setFeedback] = useState<Feedback | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), statusHeading = useRef<HTMLHeadingElement>(null), statusTrigger = useRef<HTMLButtonElement>(null), recovery = useRef<HTMLDivElement>(null);
  const editHeadings = useRef(new Map<string, HTMLButtonElement>());
  const ownerSelect = useRef<HTMLSelectElement>(null), noteInput = useRef<HTMLTextAreaElement>(null), formMessage = useRef<HTMLParagraphElement>(null);
  const forms = { owner: useRef<HTMLFormElement>(null), note: useRef<HTMLFormElement>(null), edit: useRef<HTMLFormElement>(null), status: useRef<HTMLFormElement>(null) };
  const discard = useCallback(() => { setOwner(null); setNote(null); setEdit(null); setStatusDraft(null); }, [setOwner, setNote, setEdit, setStatusDraft]);
  useEffect(() => { clearOnLoss.current = () => { detail.clear(); people.clear(); discard(); setCommand(null); setFeedback(null); }; });

  const { run: runDetail } = detail, { run: runPeople, client: peopleClient } = people;
  // Mutation errors also set phase "error"; only a failed read means the shown details may be out of date.
  const [readFailed, setReadFailed] = useState(false);
  const reload = useCallback(async () => { const next = await runDetail(() => actions.detail()); setReadFailed(next.phase === "error"); return next; }, [runDetail, actions]);
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (cancelled) return; void reload(); void runPeople(() => peopleClient.read("/api/admin/enquiries/assignees")); });
    return () => { cancelled = true; };
  }, [reload, runPeople, peopleClient]);
  const loaded = Boolean(detail.state.data);
  useEffect(() => { heading.current?.focus(); }, [loaded]);
  const statusOpen = Boolean(statusDraft);
  useEffect(() => { if (statusOpen) statusHeading.current?.focus(); }, [statusOpen]);

  const { phase, data } = detail.state, peopleData = people.state.data;
  const saving = phase === "saving", uncertain = phase === "unknown", locked = saving || uncertain;
  // Submitting is held while the latest version reloads (for example right after a 409), so a stale revision is never sent again.
  const submitLocked = locked || phase === "loading" || readFailed;
  useEffect(() => { if (uncertain) recovery.current?.focus(); }, [uncertain]);
  useEffect(() => { if (feedback?.form && feedback.tone !== "success") formMessage.current?.focus(); }, [feedback]);
  useUnsavedChanges(`${key}:guard`, { dirty: Boolean(owner || note || edit || statusDraft) || uncertain, busy: locked, onDiscard: discard });

  const revision = data?.management.revision ?? 0;
  const active = data?.management.status === "active", writable = Boolean(data?.canWrite);
  const clearForm = (form: FormKey) => { if (form === "owner") setOwner(null); else if (form === "note") setNote(null); else if (form === "edit") setEdit(null); else setStatusDraft(null); };
  async function finish(form: FormKey, next: WorkClientState<EnquiryDetail>) {
    if (next.phase === "access_lost") return;
    if (next.phase === "saved") {
      clearForm(form); setCommand(null);
      const latest = await reload();
      setFeedback({ tone: "success", text: latest.phase === "error" ? `${savedText[form]} The latest details could not be loaded; refresh to see them.` : savedText[form] });
      // The submit button was disabled while saving; return keyboard focus to the form the staff member used.
      requestAnimationFrame(() => (form === "status" ? statusTrigger.current : form === "owner" ? ownerSelect.current : form === "note" ? noteInput.current : heading.current)?.focus());
    } else if (next.phase === "conflict") {
      setCommand(null); setFeedback({ tone: "warning", form, text: conflictText(next.code) }); await reload();
    } else if (next.phase === "error") {
      setCommand(null); setFeedback({ tone: "error", form, fields: next.fields, text: next.error ?? "This change could not be saved.", hint: `Nothing was saved. ${next.fields ? "Correct the highlighted fields, then save again." : "Saving again sends a new request."}` });
    }
  }
  async function submit(form: FormKey, start: () => Promise<WorkClientState<EnquiryDetail>>) {
    const draftRevision = form === "owner" ? owner?.revision : form === "note" ? note?.revision : form === "edit" ? edit?.revision : statusDraft?.revision;
    if (submitLocked || draftRevision !== revision || !reportSectionValidity(forms[form].current)) return;
    setFeedback(null); setCommand(form);
    await finish(form, await runDetail(start));
  }
  async function resolve(kind: "check" | "retry") {
    const form = command ?? "status";
    const next = await runDetail(kind === "check" ? actions.check : actions.retry);
    if (next.phase === "unknown") { setFeedback({ tone: "warning", text: next.code && next.code !== "outcome_unknown" && next.error ? next.error : kind === "check" ? "No saved result was found yet. The request may still be processing. Check again, or send the same request again." : "The result is still unknown. Your entry stays locked. Check the saved result or send the same request again." }); return; }
    await finish(form, next);
  }

  if (!data) {
    return <div className="ems-detail-page enquiry-record">
      <WorkspaceLink href="/admin/enquiries" className="ems-back-link"><ArrowLeft size={16} aria-hidden="true" /> Back to enquiries</WorkspaceLink>
      <AdminPanel><h2 ref={heading} tabIndex={-1}>Enquiry record</h2>
        {readFailed ? <div className="ems-feedback ems-feedback--error" role="alert"><p>This enquiry could not be loaded. It may no longer exist, or the connection failed.</p><button type="button" className="ems-button ems-button--secondary" onClick={() => void reload()}>Retry loading</button></div> : <p role="status">Loading enquiry…</p>}
      </AdminPanel>
    </div>;
  }

  const { enquiry, management, notes, audit } = data, contact = enquiry.summary;
  const assignable = peopleData?.assignees ?? [];
  const savedOwner = management.assigneeUserId;
  const ownerValue = owner ? owner.assigneeUserId : savedOwner;
  const ownerStale = Boolean(owner && owner.revision !== revision);
  const noteStale = Boolean(note && note.revision !== revision);
  const editStale = Boolean(edit && edit.revision !== revision);
  const statusStale = Boolean(statusDraft && statusDraft.revision !== revision);
  const editing = edit ? notes.find(item => item.id === edit.noteId) ?? null : null;
  const fieldFor = (form: FormKey, name: string) => feedback?.form === form && feedback.tone === "error" ? feedback.fields?.[name as keyof WorkFieldErrors] : undefined;
  const formError = (form: FormKey) => feedback?.form === form && feedback.tone !== "success" ? <p ref={formMessage} tabIndex={-1} className={`ems-feedback${feedback.tone === "error" ? " ems-feedback--error" : ""}`} role="alert"><span>{feedback.text}</span>{feedback.hint && <> <span>{feedback.hint}</span></>}</p> : null;
  const tabs = [{ id: "summary", label: "Summary" }, { id: "notes", label: `Notes (${notes.length})` }, { id: "activity", label: "Activity" }];

  return <div className="ems-detail-page enquiry-record">
    <WorkspaceLink href="/admin/enquiries" className="ems-back-link"><ArrowLeft size={16} aria-hidden="true" /> Back to enquiries</WorkspaceLink>
    <AdminPanel>
      <div className="ems-section-heading"><div><h2 ref={heading} tabIndex={-1}>{contact.name || "Name not provided"}</h2><p className="ems-record-meta"><span>{enquiry.reference}</span><span>{sourceName(enquiry.source)} enquiry</span><span>Received {time(enquiry.createdAt)} (Sydney)</span></p></div><div className="ems-actions"><AdminStatusBadge tone={active ? "neutral" : "warning"}>{active ? "Active" : "Archived"}</AdminStatusBadge><button type="button" className="ems-button ems-button--secondary" disabled={phase === "loading" || saving} onClick={() => { setFeedback(null); void reload(); }}><RefreshCw size={16} aria-hidden="true" /> {phase === "loading" ? "Refreshing…" : "Refresh"}</button></div></div>
      <p className="ems-list-meta" role="status" aria-live="polite">{saving ? `${commandNames[command ?? "status"]} is being saved…` : feedback?.tone === "success" ? feedback.text : phase === "loading" ? "Refreshing saved details…" : ""}</p>
      {readFailed && <p className="ems-feedback ems-feedback--error" role="alert">The latest details could not be loaded. The details below are from the last successful load. <button type="button" className="ems-button ems-button--secondary" onClick={() => void reload()}>Retry</button></p>}
      {uncertain && <div className="ems-feedback ems-feedback--error" role="alert" ref={recovery} tabIndex={-1}><h3>Save result not confirmed</h3><p>{commandNames[command ?? "status"]} was sent, but the result is unknown. It may already be saved. Your entry is locked so the same request can be checked or sent again without saving it twice.</p>{feedback && !feedback.form && feedback.tone === "warning" && <p>{feedback.text}</p>}<div className="ems-actions"><button type="button" className="ems-button" onClick={() => void resolve("check")}>Check saved result</button><button type="button" className="ems-button ems-button--secondary" onClick={() => void resolve("retry")}>Send the same request again</button></div></div>}
      {!writable && <p className="ems-feedback" role="note">You can view this enquiry. Changing it needs write access.</p>}
      {writable && !active && <p className="ems-feedback" role="note">This enquiry is archived. Restore it to change the owner or add and edit notes.</p>}
      <AdminTabs items={tabs} activeId={tab} onChange={setTab} label="Enquiry record">{(_active, _props, panel) => <>
        <div {...panel("summary")}>
          <dl className="ems-summary"><div><dt>Email</dt><dd>{contact.email || "Not provided"}</dd></div><div><dt>Phone</dt><dd>{contact.phone || "Not provided"}</dd></div><div><dt>Site address</dt><dd>{contact.siteAddress || "Not provided"}</dd></div><div><dt>Owner</dt><dd>{ownerName(peopleData, savedOwner)}</dd></div></dl>
          <h3>Enquiry details</h3><p className="enquiry-note-body">{contact.details || "No details were provided."}</p>
          <p className="ems-list-meta">The original {enquiry.source === "gmail" ? "Gmail" : "website"} enquiry is kept unchanged. Owner, notes and archive status are company records only.</p>
          {writable && active && <form className="enquiry-form" ref={forms.owner} aria-labelledby={`${key}-owner-title`} aria-busy={saving && command === "owner"} onSubmit={event => { event.preventDefault(); if (owner) void submit("owner", () => actions.assign({ expectedRevision: owner.revision, reason: owner.reason.trim(), assigneeUserId: owner.assigneeUserId })); }}>
            <h3 id={`${key}-owner-title`}>Owner</h3>
            {people.state.phase === "error" && !peopleData && <p className="ems-feedback ems-feedback--error" role="alert">The list of staff who can own enquiries could not be loaded. <button type="button" className="ems-button ems-button--secondary" onClick={() => void runPeople(() => peopleClient.read("/api/admin/enquiries/assignees"))}>Retry</button></p>}
            <div className="ems-field"><label htmlFor={`${key}-owner`}>Enquiry owner</label><select ref={ownerSelect} id={`${key}-owner`} aria-invalid={Boolean(fieldFor("owner", "assigneeUserId")) || undefined} aria-describedby={describe(`${key}-owner-hint`, problem(`${key}-owner`, fieldFor("owner", "assigneeUserId")))} value={ownerValue ?? ""} disabled={locked || !peopleData} onChange={event => { const value = event.target.value || null; setFeedback(null); setOwner(value === savedOwner && !owner?.reason ? null : { assigneeUserId: value, reason: owner?.reason ?? "", revision: owner?.revision ?? revision }); }}><option value="">Unassigned</option>{savedOwner && !assignable.some(person => person.userId === savedOwner) && <option value={savedOwner} disabled>{ownerName(peopleData, savedOwner)}</option>}{assignable.map(person => <option key={person.userId} value={person.userId}>{person.label}</option>)}</select><small id={`${key}-owner-hint`}>Only current company admins and owners can be assigned.</small><FieldError error={problem(`${key}-owner`, fieldFor("owner", "assigneeUserId"))} /></div>
            {owner && <>
              {ownerStale && <StaleNotice text={`Latest saved owner: ${ownerName(peopleData, savedOwner)}. Your selection: ${ownerName(peopleData, owner.assigneeUserId)}.`} disabled={submitLocked} onKeep={() => setOwner({ ...owner, revision })} />}
              <ReasonField id={`${key}-owner-reason`} value={owner.reason} disabled={locked} error={fieldFor("owner", "reason")} onChange={reason => setOwner({ ...owner, reason })} />
              {formError("owner")}
              <div className="ems-actions"><button type="submit" className="ems-button" disabled={submitLocked || ownerStale || owner.assigneeUserId === savedOwner}>{saving && command === "owner" ? "Saving owner…" : "Save owner"}</button><button type="button" className="ems-button ems-button--secondary" disabled={locked} onClick={() => { setOwner(null); setFeedback(null); }}>Cancel</button></div>
            </>}
          </form>}
          {writable && <section className="enquiry-form" aria-labelledby={`${key}-status-title`}>
            <h3 id={`${key}-status-title`}>Archive status</h3>
            <p className="ems-muted">{active ? "Archive an enquiry when it no longer needs attention. Archived enquiries can be restored at any time." : `Archived ${time(management.archivedAt)} (Sydney). Restore it to continue working on it.`}</p>
            {!statusDraft && <div className="ems-actions"><button type="button" ref={statusTrigger} className="ems-button ems-button--secondary" disabled={locked} onClick={() => { setFeedback(null); setStatusDraft({ kind: active ? "archive" : "restore", reason: "", revision }); }}>{active ? "Archive enquiry" : "Restore enquiry"}</button></div>}
            {statusDraft && <form className="ems-panel enquiry-form" ref={forms.status} aria-labelledby={`${key}-status-confirm`} aria-busy={saving && command === "status"} onSubmit={event => { event.preventDefault(); const input = { expectedRevision: statusDraft.revision, reason: statusDraft.reason.trim() }; void submit("status", () => statusDraft.kind === "archive" ? actions.archive(input) : actions.restore(input)); }}>
              <h4 id={`${key}-status-confirm`} ref={statusHeading} tabIndex={-1}>{statusDraft.kind === "archive" ? "Archive this enquiry?" : "Restore this enquiry?"}</h4>
              {statusDraft.kind === "archive" ? <ul className="enquiry-impact"><li>It moves out of the active list. Find it under Show: Archived and restore it at any time.</li><li>The original website or Gmail enquiry is not deleted or changed. No email or calendar event is affected.</li><li>The owner and internal notes stay saved. Notes can’t be added or edited while it is archived.</li></ul> : <ul className="enquiry-impact"><li>It returns to the active list.</li><li>The owner, internal notes and activity history are unchanged.</li></ul>}
              {statusStale && <StaleNotice text={`This enquiry is now ${active ? "active" : "archived"} at revision ${revision}.`} disabled={submitLocked} onKeep={() => setStatusDraft({ ...statusDraft, kind: active ? "archive" : "restore", revision })} />}
              <ReasonField id={`${key}-status-reason`} value={statusDraft.reason} disabled={locked} error={fieldFor("status", "reason")} onChange={reason => setStatusDraft({ ...statusDraft, reason })} />
              {formError("status")}
              <div className="ems-actions"><button type="submit" className="ems-button" disabled={submitLocked || statusStale}>{saving && command === "status" ? (statusDraft.kind === "archive" ? "Archiving…" : "Restoring…") : statusDraft.kind === "archive" ? "Confirm archive" : "Confirm restore"}</button><button type="button" className="ems-button ems-button--secondary" disabled={locked} onClick={() => { setStatusDraft(null); setFeedback(null); requestAnimationFrame(() => statusTrigger.current?.focus()); }}>{statusDraft.kind === "archive" ? "Keep active" : "Keep archived"}</button></div>
            </form>}
          </section>}
        </div>
        <div {...panel("notes")}>
          <p className="ems-muted">Internal notes are visible to company staff only and are never sent to the customer. Notes can be edited but not deleted.</p>
          {writable && active && <form className="enquiry-form" ref={forms.note} aria-labelledby={`${key}-note-title`} aria-busy={saving && command === "note"} onSubmit={event => { event.preventDefault(); if (note) void submit("note", () => actions.addNote({ expectedRevision: note.revision, reason: note.reason.trim(), body: note.body.trim() })); }}>
            <h3 id={`${key}-note-title`}>Add an internal note</h3>
            <div className="ems-field"><label htmlFor={`${key}-note-body`}>Note</label><ValidatedTextarea ref={noteInput} id={`${key}-note-body`} aria-invalid={Boolean(fieldFor("note", "body")) || undefined} aria-describedby={describe(`${key}-note-body-hint`, problem(`${key}-note-body`, fieldFor("note", "body")))} validationLabel="the note" required maxLength={3000} rows={4} value={note?.body ?? ""} disabled={locked} onChange={event => { setFeedback(null); const body = event.target.value; setNote(body || note?.reason ? { body, reason: note?.reason ?? "", revision: note?.revision ?? revision } : null); }} /><small id={`${key}-note-body-hint`}>Plain text, up to 3,000 characters.</small><FieldError error={problem(`${key}-note-body`, fieldFor("note", "body"))} /></div>
            {note && <>
              {noteStale && <StaleNotice text="Someone else changed this enquiry. Review the latest notes below; your note was kept." disabled={submitLocked} onKeep={() => setNote({ ...note, revision })} />}
              <ReasonField id={`${key}-note-reason`} value={note.reason} disabled={locked} error={fieldFor("note", "reason")} onChange={reason => setNote({ ...note, reason })} />
            </>}
            {formError("note")}
            <div className="ems-actions"><button type="submit" className="ems-button" disabled={submitLocked || !note?.body.trim() || noteStale}>{saving && command === "note" ? "Adding note…" : "Add note"}</button>{note && <button type="button" className="ems-button ems-button--secondary" disabled={locked} onClick={() => { setNote(null); setFeedback(null); }}>Clear</button>}</div>
          </form>}
          <h3>Saved notes</h3>
          {notes.length === 0 ? <AdminEmptyState title="No internal notes yet" description={active ? "Add a note to record calls, follow-ups or decisions for this enquiry." : "This enquiry has no internal notes."} /> : <ul className="ems-list">{notes.map(item => <NoteRow key={item.id} note={item} people={peopleData} canEdit={writable && active} locked={locked} editing={edit?.noteId === item.id} triggerRef={element => { if (element) editHeadings.current.set(item.id, element); else editHeadings.current.delete(item.id); }} onEdit={() => { setFeedback(null); setEdit({ noteId: item.id, body: item.body, reason: "", revision }); }}>
            {edit?.noteId === item.id && <form className="enquiry-form" ref={forms.edit} aria-label="Edit internal note" aria-busy={saving && command === "edit"} onSubmit={event => { event.preventDefault(); void submit("edit", () => actions.editNote(edit.noteId, { expectedRevision: edit.revision, reason: edit.reason.trim(), body: edit.body.trim() })); }}>
              <div className="ems-field"><label htmlFor={`${key}-edit-body`}>Edit note</label><ValidatedTextarea id={`${key}-edit-body`} aria-invalid={Boolean(fieldFor("edit", "body")) || undefined} aria-describedby={describe(null, problem(`${key}-edit-body`, fieldFor("edit", "body")))} validationLabel="the note" required maxLength={3000} rows={4} value={edit.body} disabled={locked} autoFocus onChange={event => setEdit({ ...edit, body: event.target.value })} /><FieldError error={problem(`${key}-edit-body`, fieldFor("edit", "body"))} /></div>
              {editStale && <StaleNotice text={editing ? `Latest saved note: “${editing.body}”` : "This note changed."} disabled={submitLocked} onKeep={() => setEdit({ ...edit, revision })} />}
              <ReasonField id={`${key}-edit-reason`} value={edit.reason} disabled={locked} error={fieldFor("edit", "reason")} onChange={reason => setEdit({ ...edit, reason })} />
              {formError("edit")}
              <div className="ems-actions"><button type="submit" className="ems-button" disabled={submitLocked || editStale || !edit.body.trim() || edit.body.trim() === editing?.body}>{saving && command === "edit" ? "Saving note…" : "Save note"}</button><button type="button" className="ems-button ems-button--secondary" disabled={locked} onClick={() => { const id = edit.noteId; setEdit(null); setFeedback(null); requestAnimationFrame(() => editHeadings.current.get(id)?.focus()); }}>Cancel</button></div>
            </form>}
          </NoteRow>)}</ul>}
        </div>
        <div {...panel("activity")}><h3>Activity</h3>{audit.length === 0 ? <AdminEmptyState title="No activity yet" description="Owner, note and archive changes appear here after they are saved." /> : <ol className="ems-list">{audit.map(event => <AuditRow key={event.id} event={event} people={peopleData} />)}</ol>}</div>
      </>}</AdminTabs>
    </AdminPanel>
  </div>;
}

function NoteRow({ note, people, canEdit, locked, editing, triggerRef, onEdit, children }: { note: EnquiryNote; people: Assignees | null; canEdit: boolean; locked: boolean; editing: boolean; triggerRef: (element: HTMLButtonElement | null) => void; onEdit: () => void; children?: React.ReactNode }) {
  const edited = note.updatedAt !== note.createdAt;
  return <li className="ems-record-row"><div className="ems-record-main">
    {!editing && <p className="enquiry-note-body">{note.body}</p>}
    <p className="ems-list-meta">Added {time(note.createdAt)} by {staffName(people, note.createdBy)}{edited ? ` · Edited ${time(note.updatedAt)} by ${staffName(people, note.updatedBy)}` : ""} (Sydney)</p>
    {children}
  </div>{canEdit && !editing && <div className="ems-record-actions"><button type="button" ref={triggerRef} className="ems-button ems-button--secondary" disabled={locked} onClick={onEdit}>Edit note</button></div>}</li>;
}

function AuditRow({ event, people }: { event: WorkAudit; people: Assignees | null }) {
  return <li className="ems-record-row"><div className="ems-record-main"><h4>{auditNames[event.action] ?? event.action.replaceAll("_", " ")}</h4>{event.reason && <p>{event.reason}</p>}<p className="ems-list-meta">{time(event.createdAt)} (Sydney) · {staffName(people, event.actorUserId)} · Revision {event.priorRevision} → {event.revision}</p></div></li>;
}
