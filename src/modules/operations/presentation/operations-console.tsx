"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import type { ChangeRequest, Enquiry, GoogleConnectionState, OperationsDashboard } from "../domain/contracts";
import { summarizeSyncError, summarizeSyncResult } from "../domain/sync-result";
import { BookingOperationsPanel } from "@/modules/bookings/client";
import { WorkspaceLink, useWorkspaceDraft, useUnsavedChanges, useWorkspaceNavigation } from "@/shared/ui/admin-workspace-state";
import { PrivateRequestFailure, PrivateRequestLifetime, StalePrivateRequest } from "./request-lifetime";
import "./operations-console.css";

export type OperationsSession = {
  authenticated: boolean;
  storage?: "sqlite" | "supabase";
  mode: "local" | "google" | "staff" | null;
  staffRole?: "owner" | "admin";
  ownerEmail?: string;
  localLoginAvailable: boolean;
  googleConfigured: boolean;
  missingConfiguration?: string[];
};
type CalendarOption = { id: string; summary: string; accessRole: string };
type GmailLabel = { id: string; name: string; type: string };
const connectionLabels: Record<GoogleConnectionState, string> = {
  not_connected: "Not connected", unverified: "Connection saved · verification pending",
  ready: "Last check succeeded", target_required: "Choose a sync target",
  reconnect_required: "Reconnect company Google account", retrying: "Temporary failure · retry pending",
  configuration_error: "Configuration needs attention", permission_denied: "Permissions need attention",
  partial: "More pages waiting to sync",
};
function connectionLabel(status: GoogleConnectionState | undefined, connected: boolean) {
  return status ? connectionLabels[status] : connected ? "Connection saved" : "Not connected";
}

function timeLabel(value: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(date);
}
function localValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
function formatUnknown(value: string | number | null | undefined) { return value === null || value === undefined || value === "" ? "Unknown" : String(value); }
function signedDemoId(enquiry: Enquiry | undefined | null): string | null {
  return enquiry && "demoSubmissionId" in enquiry && typeof enquiry.demoSubmissionId === "string" ? enquiry.demoSubmissionId : null;
}
const noOriginSubscription = () => () => {};

type ScheduleAttempt = { enquiryId: string; expectedRevision: number; startLocal: string; endLocal: string; notes: string };
type WorkspaceProps = { children: ReactNode; onAccessLost?: () => void; onSignedOut?: () => void };
export type OperationsViewName = "enquiries" | "quotes" | "schedule" | "settings";
function useOperationsController({ onAccessLost, onSignedOut }: Omit<WorkspaceProps, "children">) {
  const [session, setSession] = useState<OperationsSession | null>(null);
  const canManageIntegrations = Boolean(session?.authenticated && (session.mode !== "staff" || session.staffRole === "owner"));
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [calendarId, setCalendarId] = useWorkspaceDraft("operations.calendarId", "");
  const [labelId, setLabelId] = useWorkspaceDraft("operations.labelId", "");
  const [selectedId, setSelectedId] = useWorkspaceDraft<string | null>("operations.selectedId", null);
  const [startLocal, setStartLocal] = useWorkspaceDraft("operations.startLocal", "");
  const [endLocal, setEndLocal] = useWorkspaceDraft("operations.endLocal", "");
  const [scheduleNotes, setScheduleNotes] = useWorkspaceDraft("operations.scheduleNotes", "");
  const [scheduleAttempt, setScheduleAttempt] = useWorkspaceDraft<ScheduleAttempt | null>("operations.scheduleAttempt", null);
  const [editingRevision, setEditingRevision] = useWorkspaceDraft<number | null>("operations.editingRevision", null);
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState("");
  const callbackUrl = useSyncExternalStore(noOriginSubscription, () => `${window.location.origin}/api/google/callback`, () => "<APP_BASE_URL>/api/google/callback");
  const syncInFlight = useRef(false);
  const nextAutomaticAttempt = useRef(0);
  const selectionsInitialized = useRef(false);
  const optionsLoaded = useRef("");
  const optionsInFlight = useRef(false);
  const [lifetime] = useState(() => new PrivateRequestLifetime());
  const callbacks = useRef({ onAccessLost, onSignedOut });
  useEffect(() => { callbacks.current = { onAccessLost, onSignedOut }; }, [onAccessLost, onSignedOut]);
  const clearPrivateState = useCallback(() => {
    lifetime.invalidate();
    setDashboard(null); setSession(null); setSelectedId(null); setCalendars([]); setLabels([]);
    setCalendarId(""); setLabelId(""); setStartLocal(""); setEndLocal(""); setScheduleNotes(""); setEditingRevision(null);
    setScheduleAttempt(null);
    setPassword(""); setNotice(""); setError(""); setLastAttempt(null); setSyncResult(""); setBusy("");
    selectionsInitialized.current = false; nextAutomaticAttempt.current = 0; optionsLoaded.current = ""; optionsInFlight.current = false;
  }, [lifetime, setCalendarId, setLabelId, setSelectedId, setStartLocal, setEndLocal, setScheduleNotes, setEditingRevision, setScheduleAttempt]);
  const accessLost = useCallback(() => {
    clearPrivateState();
    (callbacks.current.onAccessLost ?? callbacks.current.onSignedOut)?.();
  }, [clearPrivateState]);
  const request = useCallback(<T,>(path: string, init?: RequestInit) => lifetime.request<T>(path, init, path === "/api/operations/login" ? undefined : accessLost), [lifetime, accessLost]);
  const post = useCallback(<T,>(path: string, body?: object) => request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) }), [request]);
  const reportError = useCallback((cause: unknown, fallback: string) => {
    if (!(cause instanceof StalePrivateRequest)) setError(cause instanceof Error ? cause.message : fallback);
  }, []);
  useEffect(() => {
    lifetime.activate();
    return () => lifetime.dispose();
  }, [lifetime]);

  const loadDashboard = useCallback(async () => {
    const data = await request<OperationsDashboard>("/api/operations");
    setDashboard(data);
    if (!selectionsInitialized.current) {
      setCalendarId(data.calendar.selectedCalendarId ?? "");
      setLabelId(data.gmail.selectedLabelId ?? "");
      selectionsInitialized.current = true;
    }
    return data;
  }, [request, setCalendarId, setLabelId]);

  const loadOptions = useCallback(async (data: OperationsDashboard, allowed = true, force = false) => {
    if (!allowed || (!data.calendar.connected && !data.gmail.connected)) { setCalendars([]); setLabels([]); return; }
    const key = `${data.calendar.connected}:${data.gmail.connected}`;
    if (optionsInFlight.current || (!force && optionsLoaded.current === key)) return;
    optionsInFlight.current = true;
    const generation = lifetime.generation;
    const results = await Promise.allSettled([
      request<{ calendars: CalendarOption[] }>("/api/operations/calendars"),
      request<{ labels: GmailLabel[] }>("/api/operations/gmail/labels"),
    ]);
    if (!lifetime.isCurrent(generation)) return;
    optionsInFlight.current = false;
    if (results.every(item => item.status === "fulfilled")) optionsLoaded.current = key;
    if (results[0].status === "fulfilled") setCalendars(results[0].value.calendars);
    if (results[1].status === "fulfilled") setLabels(results[1].value.labels);
    const failures = results.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failures.length) setError(failures.map((item) => item.reason instanceof Error ? item.reason.message : "Could not load Google options.").join(" "));
  }, [request, lifetime]);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const state = await request<OperationsSession>("/api/operations/session");
        if (!active) return;
        setSession(state);
        if (!state.authenticated && (callbacks.current.onAccessLost || callbacks.current.onSignedOut)) { accessLost(); return; }
        if (state.authenticated) {
          await loadDashboard();
        }
      } catch (cause) { if (active) reportError(cause, "Could not load session."); }
      finally { if (active) setLoading(false); }
    }
    void initialize();
    return () => { active = false; };
  }, [loadDashboard, request, accessLost, reportError]);

  const doSync = useCallback(async (automatic: boolean) => {
    if (!canManageIntegrations) return;
    if (syncInFlight.current || (automatic && Date.now() < nextAutomaticAttempt.current)) return;
    syncInFlight.current = true;
    setLastAttempt(new Date().toISOString());
    setBusy("sync");
    if (!automatic) { setError(""); setNotice(""); }
    try {
      const result = await post("/api/operations/sync");
      await loadDashboard();
      const outcome = summarizeSyncResult(result);
      nextAutomaticAttempt.current = Date.now() + outcome.retryAfterMs;
      setSyncResult(`${timeLabel(new Date().toISOString())} · ${outcome.message}`);
      if (outcome.state === "failed") {
        setNotice("");
        setError(outcome.message);
        return;
      }
      setError("");
      if (!automatic) setNotice(outcome.message);
    } catch (cause) {
      if (cause instanceof StalePrivateRequest) return;
      const outcome = summarizeSyncError(cause);
      nextAutomaticAttempt.current = Date.now() + outcome.retryAfterMs;
      setNotice("");
      setSyncResult(outcome.message);
      setError(outcome.state === "failed" ? outcome.message : "");
    } finally { setBusy(""); syncInFlight.current = false; }
  }, [loadDashboard, canManageIntegrations, post]);

  useEffect(() => {
    if (!canManageIntegrations || !session?.authenticated || !dashboard || (!dashboard.calendar.connected && !dashboard.gmail.connected) || (!dashboard.calendar.selectedCalendarId && !dashboard.gmail.selectedLabelId)) return;
    const timer = window.setInterval(() => { void doSync(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, dashboard, doSync, canManageIntegrations]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy("login"); setError("");
    try {
      await post("/api/operations/login", { password });
      setPassword("");
      const state = await request<OperationsSession>("/api/operations/session");
      setSession(state);
      const data = await loadDashboard();
      await loadOptions(data, state.mode !== "staff" || state.staffRole === "owner");
      setNotice("Signed in to company operations.");
    } catch (cause) { reportError(cause, "Sign in failed."); }
    finally { setBusy(""); }
  }
  async function logout() {
    setBusy("logout"); setError("");
    try {
      await post("/api/operations/logout");
      clearPrivateState();
      if (callbacks.current.onSignedOut) { callbacks.current.onSignedOut(); return; }
      setSession(await request<OperationsSession>("/api/operations/session"));
      setNotice("Signed out.");
    } catch (cause) { reportError(cause, "Sign out failed."); }
    finally { setBusy(""); }
  }
  async function saveCalendar() {
    if (!canManageIntegrations) return;
    if (!calendarId) { setError("Select a company-owned calendar first."); return; }
    const selected = calendars.find((item) => item.id === calendarId);
    if (!selected || selected.accessRole !== "owner") { setError("Select a calendar owned by the connected company account."); return; }
    setBusy("calendar"); setError("");
    try { await post("/api/operations/calendar", { calendarId }); await loadDashboard(); setNotice(`Calendar selected: ${selected.summary}.`); }
    catch (cause) { reportError(cause, "Could not save calendar."); }
    finally { setBusy(""); }
  }
  async function saveLabel() {
    if (!canManageIntegrations) return;
    if (!labelId) { setError("Select an enquiry label first."); return; }
    setBusy("gmail"); setError("");
    try { await post("/api/operations/gmail", { labelId }); await loadDashboard(); setNotice("Enquiry label selected. Only messages with this label will be imported."); }
    catch (cause) { reportError(cause, "Could not save label."); }
    finally { setBusy(""); }
  }
  function selectEnquiry(enquiry: Enquiry) {
    if (scheduleAttempt || busy.startsWith("schedule-")) { setError("Review the pending schedule save before selecting another enquiry."); return; }
    setSelectedId(enquiry.id);
    setEditingRevision(enquiry.revision);
    setStartLocal(localValue(enquiry.startAt)); setEndLocal(localValue(enquiry.endAt));
    setScheduleNotes(enquiry.scheduleNotes ?? ""); setError("");
  }
  async function saveSchedule(enquiry: Enquiry) {
    if (scheduleAttempt && scheduleAttempt.enquiryId !== enquiry.id) return;
    if (!startLocal || !endLocal) { setError("Enter both a Sydney start and end time."); return; }
    if (endLocal <= startLocal) { setError("End time must be after start time."); return; }
    const payload = scheduleAttempt ?? {enquiryId: enquiry.id, expectedRevision: editingRevision ?? enquiry.revision, startLocal, endLocal, notes: scheduleNotes};
    setScheduleAttempt(payload);
    setBusy(`schedule-${enquiry.id}`); setError("");
    try {
      const result = await post<{ enquiry: Enquiry }>(`/api/operations/enquiries/${encodeURIComponent(enquiry.id)}/schedule`, { expectedRevision: payload.expectedRevision, startLocal: payload.startLocal, endLocal: payload.endLocal, notes: payload.notes });
      setScheduleAttempt(null);
      setEditingRevision(result.enquiry.revision);
      await loadDashboard();
      setNotice(`${enquiry.reference} has a provisional time. It is not a confirmed customer booking.`);
    } catch (cause) {
      if (cause instanceof PrivateRequestFailure && [400,409,422].includes(cause.status)) setScheduleAttempt(null);
      reportError(cause, "Could not save the provisional time. Refresh and review the current record before retrying.");
    }
    finally { setBusy(""); }
  }
  async function reviewChange(change: ChangeRequest, action: "approve" | "reject") {
    setBusy(`change-${change.id}`); setError("");
    try {
      await post(`/api/operations/changes/${encodeURIComponent(change.id)}`, { action, expectedRevision: change.revision });
      await loadDashboard();
      setNotice(`Change for ${change.reference} ${action === "approve" ? "approved" : "rejected"}. Review the enquiry and sync status.`);
    } catch (cause) { reportError(cause, "Could not review change. Refresh and check its current revision."); }
    finally { setBusy(""); }
  }

  const selected = dashboard?.enquiries.find((item) => item.id === selectedId) ?? null;
  const scheduleDirty = Boolean(selected && (startLocal !== localValue(selected.startAt) || endLocal !== localValue(selected.endAt) || scheduleNotes !== (selected.scheduleNotes ?? "")));
  useUnsavedChanges("operations.schedule", { dirty: scheduleDirty || Boolean(scheduleAttempt), busy: busy.startsWith("schedule-") || Boolean(scheduleAttempt), onDiscard: () => { if (selected) selectEnquiry(selected); } });
  useUnsavedChanges("operations.targets", { dirty: Boolean(dashboard && (calendarId !== (dashboard.calendar.selectedCalendarId ?? "") || labelId !== (dashboard.gmail.selectedLabelId ?? ""))), busy: busy === "calendar" || busy === "gmail", onDiscard: () => { setCalendarId(dashboard?.calendar.selectedCalendarId ?? ""); setLabelId(dashboard?.gmail.selectedLabelId ?? ""); } });
  return {session, canManageIntegrations, dashboard, password, setPassword, loading, busy, notice, error, calendars, labels, calendarId, setCalendarId, labelId, setLabelId, selectedId, startLocal, setStartLocal, endLocal, setEndLocal, scheduleNotes, setScheduleNotes, editingRevision, scheduleAttempt, lastAttempt, syncResult, callbackUrl, loadDashboard, loadOptions, doSync, login, logout, saveCalendar, saveLabel, selectEnquiry, saveSchedule, reviewChange, selected, reportError, accessLost};
}
const OperationsContext = createContext<ReturnType<typeof useOperationsController> | null>(null);
export function OperationsWorkspaceProvider({children, ...props}: WorkspaceProps) {
  const workspace = useOperationsController(props);
  return <OperationsContext.Provider value={workspace}>{children}</OperationsContext.Provider>;
}
export function useOperationsWorkspace() {
  const workspace = useContext(OperationsContext);
  if (!workspace) throw new Error("Operations views require OperationsWorkspaceProvider.");
  return workspace;
}
export function OperationsConsole({onSignedOut}: {onSignedOut?: () => void} = {}) {
  return <OperationsWorkspaceProvider onSignedOut={onSignedOut}><OperationsContent /></OperationsWorkspaceProvider>;
}
export function OperationsView({view}: {view: OperationsViewName}) {
  return <OperationsContent view={view} />;
}
function OperationsContent({view}: {view?: OperationsViewName}) {
  const navigate = useWorkspaceNavigation();
  const {session, canManageIntegrations, dashboard, password, setPassword, loading, busy, notice, error, calendars, labels, calendarId, setCalendarId, labelId, setLabelId, selectedId, startLocal, setStartLocal, endLocal, setEndLocal, scheduleNotes, setScheduleNotes, editingRevision, scheduleAttempt, lastAttempt, syncResult, callbackUrl, loadDashboard, loadOptions, doSync, login, logout, saveCalendar, saveLabel, selectEnquiry, saveSchedule, reviewChange, selected, reportError, accessLost} = useOperationsWorkspace();
  useEffect(() => {
    if ((!view || view === "settings") && dashboard && canManageIntegrations) void loadOptions(dashboard, true);
  }, [view, dashboard, canManageIntegrations, loadOptions]);
  return <div className={`operations-page${view ? " operations-embedded" : ""}`}>
    {!view && <a className="skip-link" href="#operations-content">Skip to operations</a>}
    {!view && <header className="operations-header"><Link href="/" aria-label="L&K Group home">L&K Group</Link><span>Private operations · preview</span>{session?.authenticated && <button type="button" onClick={logout} disabled={Boolean(busy)}>Sign out</button>}</header>}
    <div className="operations-shell" id="operations-content" tabIndex={-1}>
      {!view && <h1>Enquiries and company calendar</h1>}
      <p className="operations-intro">{session?.authenticated ? <>Company account: <strong>{session.ownerEmail}</strong>. {session.storage === "supabase" ? "Requests are stored privately in the company Supabase database." : "Requests are stored locally on this device."} This panel contains Gmail enquiries and previous company-only demonstrations. Demonstration documents and schedules do not confirm operational bookings. Saved website estimates and signed reservation requests are in {view === "enquiries" ? <>the website requests section above or </> : null}<WorkspaceLink href="/admin/quotes">Quotes</WorkspaceLink>; review and confirm their complete work periods in <WorkspaceLink href="/admin/schedule">Schedule</WorkspaceLink>.</> : "Sign in through the company administrator workspace to review Gmail enquiries and previous demonstrations. Local owner access remains available for the local preview when configured."}</p>
      {error && <div className="operations-error" role="alert">{error}</div>}
      {notice && <div className="operations-notice" role="status">{notice}</div>}
      {loading && <p role="status">Loading operations status…</p>}
      {!loading && !session && <section className="operations-panel"><h2>Operations unavailable</h2><p>Check that the local application server is running, then reload this page.</p><button type="button" onClick={() => window.location.reload()}>Retry</button></section>}
      {session && !session.authenticated && <div className="operations-grid">
        <section className="operations-panel"><h2>Owner sign in</h2>
          {session.localLoginAvailable ? <form onSubmit={login}><label>Local owner password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button type="submit" disabled={Boolean(busy)}>{busy === "login" ? "Signing in…" : "Sign in"}</button></form> : <p>Local owner sign in is not configured. Set the local server environment first, then restart the app. No password is entered into this page until that setup is complete.</p>}
          <p className="operations-small">This is for the local preview only. Do not enter a personal Google password here; Google connection uses Google&apos;s own consent screen.</p>
        </section>
      </div>}
      {session?.authenticated && dashboard && <>
        {canManageIntegrations && (!view || view === "settings") && <>
        <div className="operations-grid">
          <section className="operations-panel"><h2>Company Google connection</h2>
            <p>{session.mode === "staff" ? "Signed in with your verified administrator account." : `Signed in as owner via ${session.mode === "google" ? "Google" : "local access"}.`} Connect only <strong>{session.ownerEmail}</strong> and verify the account on Google&apos;s consent screen.</p>
            <p>Company account: <strong>{dashboard.calendar.email ?? "Not connected"}</strong></p>
            <p>Connection: <strong>{connectionLabel(dashboard.calendar.status, dashboard.calendar.connected)}</strong></p>
            {session.googleConfigured ? <a className="operations-button" href="/api/google/connect">{dashboard.calendar.status === "reconnect_required" || dashboard.gmail.status === "reconnect_required" ? "Reconnect company Google account" : "Connect company Google account"}</a> : <p>Google OAuth is not configured yet. Set the server environment shown below.</p>}
            <p className="operations-small">The connection reads the chosen Gmail enquiry label and can write to the calendar you explicitly select.</p>
          </section>
          <SetupPanel session={session} callbackUrl={callbackUrl} />
        </div>
        <div className="operations-grid">
          <section className="operations-panel"><h2>Calendar</h2>
            <p>Status: <strong>{connectionLabel(dashboard.calendar.status, dashboard.calendar.connected)}</strong>. Selected: {formatUnknown(calendars.find((item) => item.id === dashboard.calendar.selectedCalendarId)?.summary ?? dashboard.calendar.selectedCalendarId)}.</p>
            <p>Last checked: {timeLabel(dashboard.calendar.checkedAt ?? null)}.</p>
            <p>Last synced: {timeLabel(dashboard.calendar.lastSyncedAt)}.</p>
            {dashboard.calendar.error && <p className="operations-error" role="alert">{dashboard.calendar.error}</p>}
            <label>Company-owned calendar<select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} disabled={!dashboard.calendar.connected}><option value="">Choose a calendar</option>{calendars.map((item) => <option key={item.id} value={item.id} disabled={item.accessRole !== "owner"}>{item.summary} ({item.accessRole})</option>)}</select></label>
            <button type="button" onClick={saveCalendar} disabled={!dashboard.calendar.connected || Boolean(busy)}>{busy === "calendar" ? "Saving…" : "Save calendar"}</button>
          </section>
          <section className="operations-panel"><h2>Gmail enquiry intake</h2>
            <p>Status: <strong>{connectionLabel(dashboard.gmail.status, dashboard.gmail.connected)}</strong>. Last checked: {timeLabel(dashboard.gmail.checkedAt ?? null)}.</p>
            <p>Create a dedicated enquiry label in the company Gmail account, then apply it to relevant messages or make a Gmail filter. Only messages in the chosen label are read into this preview.</p>
            <p>Selected label: <strong>{formatUnknown(labels.find((item) => item.id === dashboard.gmail.selectedLabelId)?.name ?? dashboard.gmail.selectedLabelId)}</strong>. Last synced: {timeLabel(dashboard.gmail.lastSyncedAt)}.</p>
            {dashboard.gmail.error && <p className="operations-error" role="alert">{dashboard.gmail.error}</p>}
            <label>Enquiry label<select value={labelId} onChange={(event) => setLabelId(event.target.value)} disabled={!dashboard.gmail.connected}><option value="">Choose a label</option>{labels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <button type="button" onClick={saveLabel} disabled={!dashboard.gmail.connected || Boolean(busy)}>{busy === "gmail" ? "Saving…" : "Save label"}</button>
            <p className="operations-small">Imported email text requires company review. Dates mentioned in email are not booked automatically.</p>
            <div className="operations-quarantine" aria-live="polite">
              <h3>Messages needing import retry ({dashboard.gmail.quarantine.length})</h3>
              {dashboard.gmail.quarantine.length === 0 ? <p className="operations-small">No import failures are currently recorded.</p> : <>
                <p className="operations-small">These labelled message IDs could not be imported. Sync now scans the selected label again and retries them when their page is reached; a large label may take more than one scan. Review the original messages in company Gmail if the failure persists.</p>
                <ul>{dashboard.gmail.quarantine.map((item) => <li key={item.messageId}>
                  <code>{item.messageId}</code> · {item.reason === "payload_too_large" ? "Message exceeds the supported import size" : "Gmail returned an invalid response"} · last seen {timeLabel(item.lastSeenAt)}
                </li>)}</ul>
              </>}
            </div>
          </section>
        </div>
        <section className="operations-panel operations-sync"><h2>Sync and review</h2>
          <p>Use Sync now to read labelled Gmail enquiries and Google Calendar changes. While this dashboard is open, it normally tries again every 60 seconds. Connection or configuration problems pause retries for five minutes. Close the page and this polling stops.</p>
          <p>Last attempt: {timeLabel(lastAttempt)}. {syncResult}</p>
          <button type="button" onClick={() => void doSync(false)} disabled={Boolean(busy) || (!dashboard.calendar.connected && !dashboard.gmail.connected)}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
          <button type="button" className="operations-button-secondary" onClick={() => void loadDashboard().then((data) => loadOptions(data, canManageIntegrations, true)).catch((cause) => reportError(cause, "Refresh failed."))} disabled={Boolean(busy)}>Refresh records</button>
        </section>
        </>}
        {!canManageIntegrations && (!view || view === "settings") && <section className="operations-panel"><h2>Company records</h2><p>Your account can review enquiries and schedules. Company integrations are managed by an owner.</p><button type="button" disabled={Boolean(busy)} onClick={() => void loadDashboard().catch((cause) => reportError(cause, "Refresh failed."))}>Refresh records</button></section>}
        {session.storage === "supabase" && (!view || view === "quotes" || view === "schedule") && <BookingOperationsPanel refreshKey={lastAttempt ?? undefined} onAccessLost={accessLost} view={view === "quotes" ? "quotes" : "schedule"} />}
        {(!view || view === "schedule" || view === "enquiries") && <section className="operations-panel"><h2>Calendar changes to review ({dashboard.changes.length})</h2>
          {dashboard.changes.length === 0 ? <p>No changes awaiting review.</p> : <ul className="operations-list">{dashboard.changes.map((change) => { const isSignedDemo=Boolean(signedDemoId(dashboard.enquiries.find(enquiry=>enquiry.id===change.enquiryId))); return <li key={change.id}>
            <strong>{change.reference}</strong> · {change.kind} · received {timeLabel(change.createdAt)}
            <p>Proposed Sydney time: {timeLabel(change.proposedStartAt)} → {timeLabel(change.proposedEndAt)}.</p>
            <p className="operations-small">{change.kind === "delete"
              ? "Approving removes the provisional time from this enquiry; rejecting asks Google Calendar to restore it. The enquiry itself remains stored."
              : change.kind === "invalid"
                ? "This Google change has an invalid or ambiguous Sydney time. It cannot be approved. Reject it and correct the event before syncing again."
                : "Check the enquiry and customer commitment before approving a moved provisional time. A stale change may need a fresh sync."}</p>
            {isSignedDemo ? <p className="operations-notice">This change belongs to a signed demonstration. Review it in <a href={view ? "/admin/schedule#signed-demo-requests" : "#signed-demo-requests"}>Signed demo requests</a>, create a revised proposal and obtain a new customer signature.</p> : <div className="operations-actions"><button type="button" onClick={() => reviewChange(change, "approve")} disabled={Boolean(busy) || change.kind === "invalid"}>{change.kind === "delete" ? "Remove provisional time" : "Approve change"}</button><button type="button" className="operations-button-secondary" onClick={() => reviewChange(change, "reject")} disabled={Boolean(busy)}>{change.kind === "delete" ? "Restore calendar event" : "Reject change"}</button></div>}
          </li>;})}</ul>}
        </section>}
        {(!view || view === "enquiries") && <section className="operations-panel"><div className="bookings-header"><h2>Gmail and other web enquiries ({dashboard.enquiries.length})</h2><button type="button" className="operations-button-secondary" disabled={Boolean(busy)} onClick={() => void loadDashboard().catch(cause => reportError(cause, "Refresh failed."))}>Refresh Gmail and other enquiries</button></div>
          {dashboard.enquiries.length === 0 ? <p>No Gmail or other web enquiries have been stored or imported in this panel yet. Website quote and reservation requests are listed separately.</p> : <div className="operations-enquiries">
            <ul className="operations-list operations-inbox">{dashboard.enquiries.map((enquiry) => <li key={enquiry.id}>
              <button type="button" className={selectedId === enquiry.id ? "selected" : ""} onClick={() => { if (selectedId !== enquiry.id) navigate(() => selectEnquiry(enquiry)); }} aria-pressed={selectedId === enquiry.id}>
                <strong>{enquiry.reference}</strong><span>{enquiry.source === "gmail" ? "Gmail" : "Web"} · {enquiry.status} · {timeLabel(enquiry.createdAt)}</span><span>{formatUnknown(enquiry.name)} · {formatUnknown(enquiry.email)}</span>
              </button>
            </li>)}</ul>
            {selected ? <article className="operations-detail" aria-labelledby="operations-detail-title">
              <h3 id="operations-detail-title">{selected.reference} · {selected.source === "gmail" ? "Gmail enquiry" : "Web request"}</h3>
              <p>{selected.senderReviewRequired ? "Sender and details require company review." : "Submitted through the web form."} {selected.attachmentCount ? `${selected.attachmentCount} email attachment(s) noted; attachments are not stored or shown here.` : ""}</p>
              <dl>
                <div><dt>Received</dt><dd>{timeLabel(selected.createdAt)}</dd></div>
                <div><dt>Name / email / phone</dt><dd>{formatUnknown(selected.name)} · {formatUnknown(selected.email)} · {formatUnknown(selected.phone)}</dd></div>
                <div><dt>Project</dt><dd>{formatUnknown(selected.projectIntent)}</dd></div>
                <div><dt>Surfaces</dt><dd>{selected.targetSurfaces.length ? selected.targetSurfaces.join(", ") : "Not specified"}</dd></div>
                <div><dt>Location</dt><dd>{formatUnknown(selected.suburb)} {selected.postcode} · {formatUnknown(selected.siteAddress)}</dd></div>
                <div><dt>Doors / drawers</dt><dd>{formatUnknown(selected.doorCount)} / {formatUnknown(selected.drawerCount)}</dd></div>
                <div><dt>Material / colour</dt><dd>{formatUnknown(selected.material)} / {formatUnknown(selected.colourPreference)}</dd></div>
                <div><dt>Preferred date</dt><dd>{formatUnknown(selected.preferredDate)}</dd></div>
                {selected.source !== "gmail" && <div><dt>Message / notes</dt><dd className="operations-message">{formatUnknown(selected.notes)}</dd></div>}
                <div><dt>Calendar</dt><dd>{selected.calendarStatus} · {timeLabel(selected.startAt)} → {timeLabel(selected.endAt)}{selected.calendarError ? ` · ${selected.calendarError}` : ""}</dd></div>
              </dl>
              {selected.source === "gmail" && <section className="operations-thread" aria-labelledby="operations-thread-title">
                <h4 id="operations-thread-title">Imported Gmail thread</h4>
                {selected.gmail ? <>
                  <p className="operations-small">Thread ID: <code>{selected.gmail.threadId}</code>. {selected.gmail.historyTruncated ? "This thread history is limited in this preview; review the original thread in company Gmail for older messages." : "Displayed messages are the bounded text imported into this preview."}</p>
                  <ol>{selected.gmail.messages.map((message) => <li key={message.messageId}>
                    <p><strong>{message.subject || "No subject"}</strong> · {timeLabel(message.receivedAt)}</p>
                    <p className="operations-small">Sender (unverified): {formatUnknown(message.senderName)} · {formatUnknown(message.senderEmail)}</p>
                    <p className="operations-small">Message ID: <code>{message.messageId}</code> · body: {message.bodyStatus.replaceAll("_", " ")} · {message.attachmentCount} attachment(s) noted</p>
                    {message.bodyStatus === "invalid_encoding" || message.bodyStatus === "unavailable" ? <p className="operations-small">Body text could not be imported. Review the message in company Gmail.</p>
                      : message.bodyStatus === "empty" ? <p className="operations-small">No body text was available.</p>
                        : <p className="operations-message">{message.bodyText}{message.bodyStatus === "truncated" ? "\n[Text truncated in this preview.]" : ""}</p>}
                  </li>)}</ol>
                </> : <p className="operations-small">No thread detail is stored for this imported enquiry. Review the company Gmail account.</p>}
              </section>}
              {signedDemoId(selected) ? <p className="operations-notice">This enquiry is linked to an immutable signed demonstration. Use <a href={view ? "/admin/schedule#signed-demo-requests" : "#signed-demo-requests"}>Signed demo requests and company confirmation</a> above to propose work segments and obtain customer reconfirmation.</p> : <div className="operations-schedule"><h4>Provisional Sydney schedule</h4><p>Enter times manually after reviewing scope and availability. Saving this time is not customer confirmation or a final booking. Ambiguous daylight saving times are rejected by the server.</p>
                {editingRevision !== null && selected.revision !== editingRevision && <p className="operations-error" role="alert">This enquiry changed while you were editing. Your entered times are preserved. Saving will be rejected until you reload the latest record.</p>}
                <div className="operations-grid"><label>Start (Sydney)<input type="datetime-local" disabled={Boolean(busy) || Boolean(scheduleAttempt)} value={startLocal} onInput={(event) => setStartLocal(event.currentTarget.value)} onChange={(event) => setStartLocal(event.target.value)} /></label><label>End (Sydney)<input type="datetime-local" disabled={Boolean(busy) || Boolean(scheduleAttempt)} value={endLocal} onInput={(event) => setEndLocal(event.currentTarget.value)} onChange={(event) => setEndLocal(event.target.value)} /></label></div>
                <label>Internal schedule note <span className="operations-small">Optional</span><textarea rows={3} maxLength={1000} disabled={Boolean(busy) || Boolean(scheduleAttempt)} value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} /></label>
                {scheduleAttempt && <p className="operations-notice">The schedule save result is being checked. Retry preserves the same times and original revision. Refresh enquiries to review the stored record.</p>}
                <div className="operations-actions"><button type="button" onClick={() => saveSchedule(selected)} disabled={Boolean(busy) || (!scheduleAttempt && editingRevision !== null && selected.revision !== editingRevision)}>{busy === `schedule-${selected.id}` ? "Saving…" : scheduleAttempt ? "Retry same provisional time" : "Save provisional time"}</button>{editingRevision !== null && selected.revision !== editingRevision && <button type="button" className="operations-button-secondary" disabled={Boolean(scheduleAttempt)} onClick={() => selectEnquiry(selected)}>Load latest schedule</button>}</div>
              </div>}
            </article> : <p>Select an enquiry to review its details and plan a provisional time.</p>}
          </div>}
        </section>}
      </>}
    </div>
  </div>;
}

function SetupPanel({ session, callbackUrl }: { session: OperationsSession; callbackUrl: string }) {
  return <section className="operations-panel"><h2>{session.mode === "staff" ? "Company integration setup" : "Local setup"}</h2>
    <p>Configure these values in the server environment, then restart or redeploy the app. This page never asks for a Google client secret or access token.</p>
    {!Array.isArray(session.missingConfiguration) ? <p>Configuration status could not be confirmed. Refresh this page or check the server settings.</p> : session.missingConfiguration.length > 0 ? <p>Missing configuration: <code>{session.missingConfiguration.join(", ")}</code></p> : session.googleConfigured ? <p>Required server settings are present. Google account consent and calendar/label selection are still separate steps.</p> : <p>Google configuration is not ready. Check the server settings before connecting.</p>}
    <ol>
      {session.mode !== "staff" && <li>Enable local owner access with <code>LOCAL_OPERATIONS_ENABLED=true</code> and set <code>LOCAL_OWNER_PASSWORD</code>.</li>}
      <li>In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Credentials</a>, configure OAuth consent and create a web client for the company integration.</li>
      <li>Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_TOKEN_ENCRYPTION_KEY</code> (64 hexadecimal characters), and <code>APP_BASE_URL</code> to this app&apos;s exact origin (including HTTPS for the company site).</li>
      <li>Add this authorised redirect URI to the Google OAuth client: <code className="operations-uri">{callbackUrl}</code>.</li>
      <li>Sign in above, connect <strong>{session.ownerEmail}</strong>, then select a company-owned calendar and the Gmail enquiry label.</li>
    </ol>
    <p className="operations-small">Use company controlled credentials. The app stores connection tokens on the server, not in this page.</p>
  </section>;
}
