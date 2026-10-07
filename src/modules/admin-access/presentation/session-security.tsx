"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUnsavedChanges, useWorkspaceDraft } from "@/shared/ui/admin-workspace-state";
import { authRequest, AuthRequestError } from "./staff-auth-request";

type SessionSummary = {
  current: { expiresAt: number };
  otherSessionCount: number;
  otherSessions: { expiresAt: number }[];
  truncated: boolean;
};

function validSummary(value: SessionSummary) {
  return value && Number.isSafeInteger(value.current?.expiresAt) && Number.isSafeInteger(value.otherSessionCount)
    && value.otherSessionCount >= 0 && Array.isArray(value.otherSessions) && value.otherSessions.length <= 50
    && value.otherSessions.every(item => Number.isSafeInteger(item?.expiresAt))
    && value.truncated === (value.otherSessionCount > value.otherSessions.length);
}

export function SessionSecurity({ onAccessLost, embedded = false }: { onAccessLost: () => void; embedded?: boolean }) {
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [busy, setBusy] = useState("loading");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useWorkspaceDraft("session-security:confirming", false);
  const [cleanupPending, setCleanupPending] = useWorkspaceDraft("session-security:cleanup-pending", false);
  const inFlight = useRef(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);

  const fail = useCallback((cause: unknown) => {
    if (!active.current) return;
    if (cause instanceof AuthRequestError && (cause.status === 401 || cause.status === 403)) {
      active.current = false; controller.current?.abort(); setSummary(null); setConfirming(false); setCleanupPending(false);
      onAccessLost(); return;
    }
    setError(cause instanceof Error ? cause.message : "Session security is unavailable. Refresh the list and try again.");
  }, [onAccessLost, setConfirming, setCleanupPending]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const value = await authRequest<SessionSummary>("sessions", undefined, signal);
    if (!validSummary(value)) throw new Error("Could not confirm the session list. Refresh and try again.");
    if (active.current && !signal?.aborted) setSummary(value);
  }, []);

  useEffect(() => {
    active.current = true;
    const abort = new AbortController(); controller.current = abort;
    inFlight.current = true;
    void load(abort.signal).catch(cause => { if (!abort.signal.aborted) fail(cause); }).finally(() => {
      if (active.current && !abort.signal.aborted) { setBusy(""); inFlight.current = false; }
    });
    return () => { active.current = false; abort.abort(); };
  }, [load, fail]);

  useEffect(() => { if (confirming && !busy) confirmButton.current?.focus(); }, [confirming, busy]);

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("refresh"); setError("");
    try { await load(controller.current?.signal); } catch (cause) { fail(cause); }
    finally { if (active.current) { setBusy(""); inFlight.current = false; } }
  }

  async function revoke() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy("revoke"); setError(""); setNotice("");
    // A route can unmount while the server is already removing other sessions.
    // Persist the uncertain outcome before sending; returning never replays it automatically.
    setCleanupPending(true);
    let cleanupConfirmed = false;
    try {
      const result = await authRequest<{ esnAccessRemoved: boolean; authCleanupComplete: boolean }>("sessions/revoke-others", {}, controller.current?.signal);
      if (result?.esnAccessRemoved !== true || result.authCleanupComplete !== true) throw new Error("Could not confirm session cleanup. Refresh the list and retry.");
      if (!active.current) return;
      cleanupConfirmed = true; setCleanupPending(false); setConfirming(false);
      setNotice("Other sessions have been signed out. Your current session is still open.");
      await load(controller.current?.signal);
      trigger.current?.focus();
    } catch (cause) {
      if (active.current && !cleanupConfirmed && !(cause instanceof AuthRequestError && (cause.status === 401 || cause.status === 403))) {
        // A lost response may follow committed ESN removal. Keep a retry
        // available even after refreshing shows no other registry rows.
        setCleanupPending(true);
      }
      if (active.current && cause instanceof AuthRequestError && cause.code === "AUTH_CLEANUP_PENDING") {
        setCleanupPending(true); setConfirming(false);
        try { await load(controller.current?.signal); } catch (loadError) { fail(loadError); }
      }
      fail(cause);
    } finally { if (active.current) { setBusy(""); inFlight.current = false; } }
  }

  const discard = useCallback(() => {
    if (cleanupPending) return;
    setConfirming(false);
  }, [cleanupPending, setConfirming]);
  useUnsavedChanges("session-security", {
    dirty: confirming || cleanupPending,
    busy: busy === "revoke" || cleanupPending,
    onDiscard: discard,
  });

  const disabled = Boolean(busy);
  const expiry = (time: number) => new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Sydney" }).format(time);
  return <section className="operations-panel staff-session-security" id={embedded ? "staff-session-security-heading" : undefined} aria-label={embedded ? "Session security" : undefined} aria-labelledby={embedded ? undefined : "staff-session-security-heading"} aria-busy={disabled}>
    {!embedded && <h2 id="staff-session-security-heading" tabIndex={-1}>Session security</h2>}
    <p>Review your ESN app sessions. Times are shown in Sydney time.</p>
    {busy === "loading" && <p role="status">Loading your sessions…</p>}
    {error && <p className="operations-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {cleanupPending && busy !== "revoke" && <p role="status">The previous session cleanup has not been confirmed. Review the refreshed list and retry cleanup before leaving this screen.</p>}
    {summary && <>
      <h3>Current session</h3>
      <p>Expires <time dateTime={new Date(summary.current.expiresAt).toISOString()}>{expiry(summary.current.expiresAt)}</time></p>
      <h3>Other app sessions ({summary.otherSessionCount})</h3>
      {summary.otherSessionCount === 0 ? <p>No other active ESN app sessions.</p> : <ul className="staff-session-list">
        {summary.otherSessions.map((item, index) => <li key={`${item.expiresAt}:${index}`}>Expires <time dateTime={new Date(item.expiresAt).toISOString()}>{expiry(item.expiresAt)}</time></li>)}
      </ul>}
      {summary.truncated && <p>Showing the first 50 expiry times. Signing out other sessions covers all {summary.otherSessionCount} other app sessions.</p>}
    </>}
    <p className="operations-small">The count covers ESN app sessions. Other sign-ins may still need Auth cleanup after a failed or interrupted request; you can run cleanup even when the count is zero.</p>
    <p className="operations-small">If access expires or is removed, sign in again and complete your verification. If you cannot sign in, contact the company administrator for account recovery.</p>
    <div className="staff-session-actions">
      <button type="button" onClick={() => void refresh()} disabled={disabled}>{busy === "refresh" ? "Refreshing…" : "Refresh sessions"}</button>
      <button ref={trigger} type="button" onClick={() => setConfirming(true)} disabled={disabled || !summary}>
        {cleanupPending ? "Retry session cleanup" : summary?.otherSessionCount === 0 ? "Clean up other sign-ins" : "Sign out other sessions"}
      </button>
    </div>
    {confirming && <div className="staff-session-confirmation" role="group" aria-labelledby="staff-session-confirm-heading">
      <h3 id="staff-session-confirm-heading">{cleanupPending ? "Retry other-session cleanup?" : "Sign out your other sessions?"}</h3>
      <p>Your other ESN app sessions will lose access and need to sign in again. Your current session stays open.</p>
      <div className="staff-session-actions">
        <button ref={confirmButton} type="button" onClick={() => void revoke()} disabled={disabled}>{busy === "revoke" ? "Signing out…" : cleanupPending ? "Confirm cleanup retry" : "Confirm sign out"}</button>
        <button type="button" disabled={disabled} onClick={() => { setConfirming(false); trigger.current?.focus(); }}>Cancel</button>
      </div>
    </div>}
  </section>;
}
