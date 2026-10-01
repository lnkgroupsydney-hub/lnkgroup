"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { ChangeRequest, Enquiry, OperationsDashboard } from "../domain/contracts";
import { syncFailureMessage } from "../domain/sync-result";
import "./operations-console.css";

type Session = {
  authenticated: boolean;
  storage?: "sqlite" | "supabase";
  mode: "local" | "google" | null;
  ownerEmail: string;
  localLoginAvailable: boolean;
  googleConfigured: boolean;
  missingConfiguration: string[];
};
type CalendarOption = { id: string; summary: string; accessRole: string };
type GmailLabel = { id: string; name: string; type: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  let result: unknown;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const message = result && typeof result === "object" && "error" in result && typeof result.error === "string"
      ? result.error : `Request failed (HTTP ${response.status}).`;
    throw new Error(message);
  }
  return result as T;
}
function post<T>(path: string, body?: object) {
  return request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
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
const noOriginSubscription = () => () => {};

export function OperationsConsole() {
  const [session, setSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<OperationsDashboard | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [calendarId, setCalendarId] = useState("");
  const [labelId, setLabelId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [scheduleNotes, setScheduleNotes] = useState("");
  const [editingRevision, setEditingRevision] = useState<number | null>(null);
  const [lastAttempt, setLastAttempt] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState("");
  const callbackUrl = useSyncExternalStore(noOriginSubscription, () => `${window.location.origin}/api/google/callback`, () => "<APP_BASE_URL>/api/google/callback");
  const syncInFlight = useRef(false);
  const selectionsInitialized = useRef(false);

  const loadDashboard = useCallback(async () => {
    const data = await request<OperationsDashboard>("/api/operations");
    setDashboard(data);
    if (!selectionsInitialized.current) {
      setCalendarId(data.calendar.selectedCalendarId ?? "");
      setLabelId(data.gmail.selectedLabelId ?? "");
      selectionsInitialized.current = true;
    }
    return data;
  }, []);

  const loadOptions = useCallback(async (data: OperationsDashboard) => {
    if (!data.calendar.connected) { setCalendars([]); setLabels([]); return; }
    const results = await Promise.allSettled([
      request<{ calendars: CalendarOption[] }>("/api/operations/calendars"),
      request<{ labels: GmailLabel[] }>("/api/operations/gmail/labels"),
    ]);
    if (results[0].status === "fulfilled") setCalendars(results[0].value.calendars);
    if (results[1].status === "fulfilled") setLabels(results[1].value.labels);
    const failures = results.filter((item): item is PromiseRejectedResult => item.status === "rejected");
    if (failures.length) setError(failures.map((item) => item.reason instanceof Error ? item.reason.message : "Could not load Google options.").join(" "));
  }, []);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const state = await request<Session>("/api/operations/session");
        if (!active) return;
        setSession(state);
        if (state.authenticated) {
          const data = await loadDashboard();
          if (active) void loadOptions(data);
        }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "Could not load session."); }
      finally { if (active) setLoading(false); }
    }
    void initialize();
    return () => { active = false; };
  }, [loadDashboard, loadOptions]);

  const doSync = useCallback(async (automatic: boolean) => {
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setLastAttempt(new Date().toISOString());
    setBusy("sync");
    if (!automatic) { setError(""); setNotice(""); }
    try {
      const result = await post("/api/operations/sync");
      const data = await loadDashboard();
      const failure = syncFailureMessage(result) || [data.calendar.error, data.gmail.error].filter(Boolean).join(" ");
      if (failure) {
        setNotice("");
        setSyncResult(`Last sync failed: ${failure}`);
        setError(failure);
        return;
      }
      setError("");
      setSyncResult(`Last sync completed ${timeLabel(new Date().toISOString())}. Calendar and Gmail status is shown below.`);
      if (!automatic) setNotice("Sync completed. Review any pending changes before applying them.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Sync failed.";
      setNotice("");
      setSyncResult(`Last sync failed: ${message}`);
      setError(message);
    } finally { setBusy(""); syncInFlight.current = false; }
  }, [loadDashboard]);

  useEffect(() => {
    if (!session?.authenticated || !dashboard?.calendar.connected || (!dashboard.calendar.selectedCalendarId && !dashboard.gmail.selectedLabelId)) return;
    const timer = window.setInterval(() => { void doSync(true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, dashboard?.calendar.connected, dashboard?.calendar.selectedCalendarId, dashboard?.gmail.selectedLabelId, doSync]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy("login"); setError("");
    try {
      await post("/api/operations/login", { password });
      setPassword("");
      const state = await request<Session>("/api/operations/session");
      setSession(state);
      const data = await loadDashboard();
      await loadOptions(data);
      setNotice("Signed in to company operations.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign in failed."); }
    finally { setBusy(""); }
  }
  async function logout() {
    setBusy("logout"); setError("");
    try {
      await post("/api/operations/logout");
      setDashboard(null); setSelectedId(null); setCalendars([]); setLabels([]);
      selectionsInitialized.current = false;
      setSession(await request<Session>("/api/operations/session"));
      setNotice("Signed out.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sign out failed."); }
    finally { setBusy(""); }
  }
  async function saveCalendar() {
    if (!calendarId) { setError("Select a company-owned calendar first."); return; }
    const selected = calendars.find((item) => item.id === calendarId);
    if (!selected || selected.accessRole !== "owner") { setError("Select a calendar owned by the connected company account."); return; }
    setBusy("calendar"); setError("");
    try { await post("/api/operations/calendar", { calendarId }); await loadDashboard(); setNotice(`Calendar selected: ${selected.summary}.`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save calendar."); }
    finally { setBusy(""); }
  }
  async function saveLabel() {
    if (!labelId) { setError("Select an enquiry label first."); return; }
    setBusy("gmail"); setError("");
    try { await post("/api/operations/gmail", { labelId }); await loadDashboard(); setNotice("Enquiry label selected. Only messages with this label will be imported."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save label."); }
    finally { setBusy(""); }
  }
  function selectEnquiry(enquiry: Enquiry) {
    setSelectedId(enquiry.id);
    setEditingRevision(enquiry.revision);
    setStartLocal(localValue(enquiry.startAt)); setEndLocal(localValue(enquiry.endAt));
    setScheduleNotes(enquiry.scheduleNotes ?? ""); setError("");
  }
  async function saveSchedule(enquiry: Enquiry) {
    if (!startLocal || !endLocal) { setError("Enter both a Sydney start and end time."); return; }
    if (endLocal <= startLocal) { setError("End time must be after start time."); return; }
    setBusy(`schedule-${enquiry.id}`); setError("");
    try {
      const result = await post<{ enquiry: Enquiry }>(`/api/operations/enquiries/${encodeURIComponent(enquiry.id)}/schedule`, { expectedRevision: editingRevision ?? enquiry.revision, startLocal, endLocal, notes: scheduleNotes });
      setEditingRevision(result.enquiry.revision);
      await loadDashboard();
      setNotice(`${enquiry.reference} has a provisional time. It is not a confirmed customer booking.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the provisional time. Refresh and review the current record before retrying."); }
    finally { setBusy(""); }
  }
  async function reviewChange(change: ChangeRequest, action: "approve" | "reject") {
    setBusy(`change-${change.id}`); setError("");
    try {
      await post(`/api/operations/changes/${encodeURIComponent(change.id)}`, { action, expectedRevision: change.revision });
      await loadDashboard();
      setNotice(`Change for ${change.reference} ${action === "approve" ? "approved" : "rejected"}. Review the enquiry and sync status.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review change. Refresh and check its current revision."); }
    finally { setBusy(""); }
  }

  const selected = dashboard?.enquiries.find((item) => item.id === selectedId) ?? null;
  return <div className="operations-page">
    <a className="skip-link" href="#operations-content">Skip to operations</a>
    <header className="operations-header"><Link href="/" aria-label="L&K Group home">L&K Group</Link><span>Private operations · preview</span>{session?.authenticated && <button type="button" onClick={logout} disabled={Boolean(busy)}>Sign out</button>}</header>
    <div className="operations-shell" id="operations-content" tabIndex={-1}>
      <h1>Enquiries and company calendar</h1>
      <p className="operations-intro">Company account: <strong>{session?.ownerEmail ?? "Lnkgroupsydney@gmail.com"}</strong>. {session?.storage === "supabase" ? "Requests are stored privately in the company Supabase database." : session ? "Requests are stored locally on this device." : "Checking data storage…"} It does not send customer email, issue a quote or confirm a booking.</p>
      {error && <div className="operations-error" role="alert">{error}</div>}
      {notice && <div className="operations-notice" role="status">{notice}</div>}
      {loading && <p role="status">Loading operations status…</p>}
      {!loading && !session && <section className="operations-panel"><h2>Operations unavailable</h2><p>Check that the local application server is running, then reload this page.</p><button type="button" onClick={() => window.location.reload()}>Retry</button></section>}
      {session && !session.authenticated && <div className="operations-grid">
        <section className="operations-panel"><h2>Owner sign in</h2>
          {session.localLoginAvailable ? <form onSubmit={login}><label>Local owner password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button type="submit" disabled={Boolean(busy)}>{busy === "login" ? "Signing in…" : "Sign in"}</button></form> : <p>Local owner sign in is not configured. Set the local server environment first, then restart the app. No password is entered into this page until that setup is complete.</p>}
          <p className="operations-small">This is for the local preview only. Do not enter a personal Google password here; Google connection uses Google&apos;s own consent screen.</p>
        </section>
        <SetupPanel session={session} callbackUrl={callbackUrl} />
      </div>}
      {session?.authenticated && dashboard && <>
        <div className="operations-grid">
          <section className="operations-panel"><h2>Company Google connection</h2>
            <p>Signed in as owner via {session.mode === "google" ? "Google" : "local access"}. Connect only <strong>{session.ownerEmail}</strong> and verify the account on Google&apos;s consent screen.</p>
            <p>Connection: <strong>{dashboard.calendar.connected ? `Connected as ${formatUnknown(dashboard.calendar.email)}` : "Not connected"}</strong></p>
            {session.googleConfigured ? <a className="operations-button" href="/api/google/connect">Connect company Google account</a> : <p>Google OAuth is not configured yet. Set the server environment shown below.</p>}
            <p className="operations-small">The connection reads the chosen Gmail enquiry label and can write to the calendar you explicitly select.</p>
          </section>
          <SetupPanel session={session} callbackUrl={callbackUrl} />
        </div>
        <div className="operations-grid">
          <section className="operations-panel"><h2>Calendar</h2>
            <p>Status: <strong>{dashboard.calendar.connected ? "Connected" : "Waiting for Google connection"}</strong>. Selected: {formatUnknown(calendars.find((item) => item.id === dashboard.calendar.selectedCalendarId)?.summary ?? dashboard.calendar.selectedCalendarId)}.</p>
            <p>Last synced: {timeLabel(dashboard.calendar.lastSyncedAt)}.</p>
            {dashboard.calendar.error && <p className="operations-error" role="alert">{dashboard.calendar.error}</p>}
            <label>Company-owned calendar<select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} disabled={!dashboard.calendar.connected}><option value="">Choose a calendar</option>{calendars.map((item) => <option key={item.id} value={item.id} disabled={item.accessRole !== "owner"}>{item.summary} ({item.accessRole})</option>)}</select></label>
            <button type="button" onClick={saveCalendar} disabled={!dashboard.calendar.connected || Boolean(busy)}>{busy === "calendar" ? "Saving…" : "Save calendar"}</button>
          </section>
          <section className="operations-panel"><h2>Gmail enquiry intake</h2>
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
          <p>Use Sync now to read labelled Gmail enquiries and Google Calendar changes. While this dashboard is open and a Gmail label or calendar is selected, it tries again every 60 seconds. Close the page and this polling stops.</p>
          <p>Last attempt: {timeLabel(lastAttempt)}. {syncResult}</p>
          <button type="button" onClick={() => void doSync(false)} disabled={Boolean(busy) || !dashboard.calendar.connected}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>
          <button type="button" className="operations-button-secondary" onClick={() => void loadDashboard().then(loadOptions).catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed."))} disabled={Boolean(busy)}>Refresh records</button>
        </section>
        <section className="operations-panel"><h2>Calendar changes to review ({dashboard.changes.length})</h2>
          {dashboard.changes.length === 0 ? <p>No changes awaiting review.</p> : <ul className="operations-list">{dashboard.changes.map((change) => <li key={change.id}>
            <strong>{change.reference}</strong> · {change.kind} · received {timeLabel(change.createdAt)}
            <p>Proposed Sydney time: {timeLabel(change.proposedStartAt)} → {timeLabel(change.proposedEndAt)}.</p>
            <p className="operations-small">{change.kind === "delete"
              ? "Approving removes the provisional time from this enquiry; rejecting asks Google Calendar to restore it. The enquiry itself remains stored."
              : change.kind === "invalid"
                ? "This Google change has an invalid or ambiguous Sydney time. It cannot be approved. Reject it and correct the event before syncing again."
                : "Check the enquiry and customer commitment before approving a moved provisional time. A stale change may need a fresh sync."}</p>
            <div className="operations-actions"><button type="button" onClick={() => reviewChange(change, "approve")} disabled={Boolean(busy) || change.kind === "invalid"}>{change.kind === "delete" ? "Remove provisional time" : "Approve change"}</button><button type="button" className="operations-button-secondary" onClick={() => reviewChange(change, "reject")} disabled={Boolean(busy)}>{change.kind === "delete" ? "Restore calendar event" : "Reject change"}</button></div>
          </li>)}</ul>}
        </section>
        <section className="operations-panel"><h2>Enquiries ({dashboard.enquiries.length})</h2>
          {dashboard.enquiries.length === 0 ? <p>No requests have been stored or imported yet.</p> : <div className="operations-enquiries">
            <ul className="operations-list operations-inbox">{dashboard.enquiries.map((enquiry) => <li key={enquiry.id}>
              <button type="button" className={selectedId === enquiry.id ? "selected" : ""} onClick={() => selectEnquiry(enquiry)} aria-pressed={selectedId === enquiry.id}>
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
              <div className="operations-schedule"><h4>Provisional Sydney schedule</h4><p>Enter times manually after reviewing scope and availability. Saving this time is not customer confirmation or a final booking. Ambiguous daylight saving times are rejected by the server.</p>
                {editingRevision !== null && selected.revision !== editingRevision && <p className="operations-error" role="alert">This enquiry changed while you were editing. Your entered times are preserved. Saving will be rejected until you reload the latest record.</p>}
                <div className="operations-grid"><label>Start (Sydney)<input type="datetime-local" value={startLocal} onInput={(event) => setStartLocal(event.currentTarget.value)} onChange={(event) => setStartLocal(event.target.value)} /></label><label>End (Sydney)<input type="datetime-local" value={endLocal} onInput={(event) => setEndLocal(event.currentTarget.value)} onChange={(event) => setEndLocal(event.target.value)} /></label></div>
                <label>Internal schedule note <span className="operations-small">Optional</span><textarea rows={3} maxLength={1000} value={scheduleNotes} onChange={(event) => setScheduleNotes(event.target.value)} /></label>
                <div className="operations-actions"><button type="button" onClick={() => saveSchedule(selected)} disabled={Boolean(busy) || (editingRevision !== null && selected.revision !== editingRevision)}>{busy === `schedule-${selected.id}` ? "Saving…" : "Save provisional time"}</button>{editingRevision !== null && selected.revision !== editingRevision && <button type="button" className="operations-button-secondary" onClick={() => selectEnquiry(selected)}>Load latest schedule</button>}</div>
              </div>
            </article> : <p>Select an enquiry to review its details and plan a provisional time.</p>}
          </div>}
        </section>
      </>}
    </div>
  </div>;
}

function SetupPanel({ session, callbackUrl }: { session: Session; callbackUrl: string }) {
  return <section className="operations-panel"><h2>Local setup</h2>
    <p>Configure these values in the server environment, then restart the local app. This page never asks for a Google client secret or access token.</p>
    {session.missingConfiguration.length > 0 ? <p>Missing configuration: <code>{session.missingConfiguration.join(", ")}</code></p> : <p>Required server settings are present. Google account consent and calendar/label selection are still separate steps.</p>}
    <ol>
      <li>Enable local owner access with <code>LOCAL_OPERATIONS_ENABLED=true</code> and set <code>LOCAL_OWNER_PASSWORD</code>.</li>
      <li>In <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Credentials</a>, configure OAuth consent and create a web client for the company integration.</li>
      <li>Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_TOKEN_ENCRYPTION_KEY</code> (64 hexadecimal characters), and <code>APP_BASE_URL</code> to this app&apos;s exact local origin.</li>
      <li>Add this authorised redirect URI to the Google OAuth client: <code className="operations-uri">{callbackUrl}</code>.</li>
      <li>Sign in above, connect <strong>{session.ownerEmail}</strong>, then select a company-owned calendar and the Gmail enquiry label.</li>
    </ol>
    <p className="operations-small">Use company controlled credentials. The app stores connection tokens on the server, not in this page.</p>
  </section>;
}
