"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { authRequest, AuthRequestError } from "./staff-auth-request";
import { authenticatorQrImage } from "./authenticator-qr";
import "./staff-admin-console.css";

type StaffSession = {
  authenticated: boolean;
  stage: "signed_out" | "password_change" | "email_verify" | "mfa_enroll" | "mfa_verify" | "ready";
  email?: string;
  emailVerification?: { sent: boolean; expiresAt: number; retryAt: number };
  factors?: { id: string; friendlyName: string }[];
};
type Enrollment = { factorId: string; qrCode: string; secret: string };
type StaffAdminAccess = { onAccessLost: () => void; email?: string; logout: () => Promise<void> };
const StaffAdminContext = createContext<StaffAdminAccess | null>(null);
export function useStaffAdmin() {
  const access = useContext(StaffAdminContext);
  if (!access) throw new Error("useStaffAdmin must be used inside a ready StaffAdminBoundary.");
  return access;
}

export function StaffAdminBoundary({ children, authMain = false }: { children: ReactNode; authMain?: boolean }) {
  const [session, setSession] = useState<StaffSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [now, setNow] = useState(0);
  const inFlight = useRef(false);
  const requestVersion = useRef(0);
  const accessEpoch = useRef(0);
  const mounted = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailCodeInput = useRef<HTMLInputElement>(null);

  const clearSecrets = useCallback(() => {
    setPassword(""); setConfirmation(""); setCode(""); setEnrollment(null); setFactorId("");
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal, epoch = accessEpoch.current) => {
    if (!mounted.current || epoch !== accessEpoch.current) return;
    const version = ++requestVersion.current;
    let state: StaffSession;
    try { state = await authRequest<StaffSession>("session", undefined, signal); }
    catch (cause) {
      if (!mounted.current || epoch !== accessEpoch.current || version !== requestVersion.current || signal?.aborted) return;
      throw cause;
    }
    if (!mounted.current || epoch !== accessEpoch.current || version !== requestVersion.current || signal?.aborted) return;
    const stages = ["signed_out", "password_change", "email_verify", "mfa_enroll", "mfa_verify", "ready"];
    if (!state || !stages.includes(state.stage) || state.authenticated !== (state.stage !== "signed_out")) {
      throw new Error("Could not verify the administrator session. Please retry.");
    }
    setNow(Date.now());
    setSession(state);
    if (state.stage !== "mfa_enroll") setEnrollment(null);
    if (state.stage === "signed_out") clearSecrets();
  }, [clearSecrets]);

  const handleFailure = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "Could not complete this step. Please retry.");
    if (cause instanceof AuthRequestError && cause.status === 401) {
      clearSecrets();
      setSession({ authenticated: false, stage: "signed_out" });
    } else if (cause instanceof AuthRequestError && cause.status === 403) {
      clearSecrets();
      setSession(null);
    }
  }, [clearSecrets]);

  const invalidateRequests = useCallback(() => { accessEpoch.current++; requestVersion.current++; }, []);

  useEffect(() => {
    let active = true; mounted.current = true;
    const controller = new AbortController();
    async function initialize() {
      try { await refresh(controller.signal); }
      catch (cause) { if (active) handleFailure(cause); }
      finally { if (active) setLoading(false); }
    }
    void initialize();
    const recheck = () => {
      if (inFlight.current || document.visibilityState !== "visible") return;
      void refresh(controller.signal).catch((cause) => {
        if (active) { setSession(null); handleFailure(cause); }
      });
    };
    window.addEventListener("focus", recheck);
    return () => { active = false; mounted.current = false; invalidateRequests(); controller.abort(); window.removeEventListener("focus", recheck); };
  }, [refresh, handleFailure, invalidateRequests]);

  useEffect(() => { if (session?.stage) heading.current?.focus(); }, [session?.stage]);

  useEffect(() => {
    if (session?.stage !== "email_verify" || !session.emailVerification) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session?.stage, session?.emailVerification]);

  useEffect(() => {
    if (!busy && session?.stage === "email_verify" && session.emailVerification?.sent) emailCodeInput.current?.focus();
  }, [busy, session?.stage, session?.emailVerification?.sent, session?.emailVerification?.expiresAt]);

  const onAccessLost = useCallback(() => {
    const epoch = ++accessEpoch.current;
    requestVersion.current++; inFlight.current = false;
    clearSecrets(); setSession(null); setError(""); setBusy(""); setLoading(true);
    void refresh(undefined, epoch).catch(cause => {
      if (mounted.current && epoch === accessEpoch.current) handleFailure(cause);
    }).finally(() => {
      if (mounted.current && epoch === accessEpoch.current) setLoading(false);
    });
  }, [clearSecrets, refresh, handleFailure]);

  async function perform(name: string, action: (epoch: number) => Promise<void>) {
    if (inFlight.current) return;
    const epoch = accessEpoch.current;
    inFlight.current = true;
    setBusy(name); setError("");
    try { await action(epoch); } catch (cause) {
      if (mounted.current && epoch === accessEpoch.current) handleFailure(cause);
    } finally {
      if (mounted.current && epoch === accessEpoch.current) { setBusy(""); inFlight.current = false; }
    }
  }

  function login(event: React.FormEvent) {
    event.preventDefault();
    void perform("login", async (epoch) => {
      try { await authRequest("login", { email: email.trim(), password }); }
      finally { if (mounted.current && epoch === accessEpoch.current) setPassword(""); }
      await refresh(undefined, epoch);
    });
  }

  function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 16) { setError("Use at least 16 characters for your new password."); return; }
    if (password !== confirmation) { setError("The two passwords do not match."); return; }
    void perform("password", async (epoch) => {
      try { await authRequest("password", { password }); }
      finally { if (mounted.current && epoch === accessEpoch.current) { setPassword(""); setConfirmation(""); } }
      await refresh(undefined, epoch);
    });
  }

  function enroll() {
    void perform("enroll", async (epoch) => {
      const result = await authRequest<Enrollment>("mfa/enroll", {});
      if (!result || typeof result.factorId !== "string" || typeof result.qrCode !== "string" || typeof result.secret !== "string") {
        throw new Error("Could not load authenticator setup. Please retry.");
      }
      if (mounted.current && epoch === accessEpoch.current) { setEnrollment(result); setCode(""); }
    });
  }

  function sendEmailCode() {
    void perform("email-send", async (epoch) => {
      let result: NonNullable<StaffSession["emailVerification"]>;
      try {
        result = await authRequest<NonNullable<StaffSession["emailVerification"]>>("email/send", {});
        if (!result || result.sent !== true || !Number.isFinite(result.expiresAt) || !Number.isFinite(result.retryAt)) {
          throw new Error("Could not confirm that the code was sent. Please check your email and retry your session.");
        }
      } catch (sendError) {
        // An unsuccessful delivery can still have a server-enforced retry time.
        try { await refresh(undefined, epoch); } catch (refreshError) {
          if (mounted.current && epoch === accessEpoch.current && refreshError instanceof AuthRequestError && (refreshError.status === 401 || refreshError.status === 403)) handleFailure(refreshError);
        }
        throw sendError;
      }
      if (!mounted.current || epoch !== accessEpoch.current) return;
      setCode("");
      setNow(Date.now());
      setSession((current) => current ? { ...current, emailVerification: result } : current);
      await refresh(undefined, epoch);
    });
  }

  function verifyEmailCode(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) { setError("Enter the six-digit code from your email."); return; }
    void perform("email-verify", async (epoch) => {
      try { await authRequest("email/verify", { code }); }
      finally { if (mounted.current && epoch === accessEpoch.current) setCode(""); }
      await refresh(undefined, epoch);
    });
  }

  function verify(event: React.FormEvent) {
    event.preventDefault();
    const selectedFactor = enrollment?.factorId ?? (factorId || session?.factors?.[0]?.id);
    if (!selectedFactor) { setError("Choose an authenticator before continuing."); return; }
    if (!/^\d{6}$/.test(code)) { setError("Enter the six-digit code from your authenticator."); return; }
    void perform("verify", async (epoch) => {
      try { await authRequest("mfa/verify", { factorId: selectedFactor, code }); }
      finally { if (mounted.current && epoch === accessEpoch.current) setCode(""); }
      await refresh(undefined, epoch);
    });
  }

  const logout = useCallback(async () => {
    // Removing ready first also disposes all company data and workspace drafts.
    const epoch = ++accessEpoch.current;
    requestVersion.current++; inFlight.current = true;
    clearSecrets(); setSession(null); setLoading(true); setBusy("logout"); setError("");
    try {
      await authRequest("logout", {});
      await refresh(undefined, epoch);
    } catch (cause) {
      if (mounted.current && epoch === accessEpoch.current) handleFailure(cause);
    } finally {
      if (mounted.current && epoch === accessEpoch.current) { setBusy(""); setLoading(false); inFlight.current = false; }
    }
  }, [clearSecrets, refresh, handleFailure]);

  if (session?.stage === "ready" && session.authenticated) return <StaffAdminContext.Provider value={{ onAccessLost, email: session.email, logout }}>{children}</StaffAdminContext.Provider>;

  const image = enrollment ? authenticatorQrImage(enrollment.qrCode) : null;
  const disabled = Boolean(busy);
  const hasFactors = Boolean(session?.factors?.length);
  const emailVerification = session?.emailVerification;
  const resendSeconds = emailVerification ? Math.max(0, Math.ceil((emailVerification.retryAt - now) / 1000)) : 0;
  const expirySeconds = emailVerification?.sent ? Math.max(0, Math.ceil((emailVerification.expiresAt - now) / 1000)) : 0;
  const AccessContainer = authMain ? "main" : "div";
  return <AccessContainer className="operations-page" id={authMain ? "main-content" : undefined}>
    <a className="skip-link" href="#staff-access-content">Skip to administrator sign in</a>
    <header className="operations-header">
      <Link href="/" aria-label="L&K Group home">L&K Group</Link>
      <span>Private administration</span>
      {session?.authenticated && <button type="button" onClick={() => void logout()} disabled={disabled}>{busy === "logout" ? "Signing out…" : "Sign out"}</button>}
    </header>
    <div className="operations-shell staff-admin-shell" id="staff-access-content">
      <h1 ref={heading} tabIndex={-1}>Administrator access</h1>
      <p className="operations-intro">Sign in with your administrator account and complete the verification steps before opening company records.</p>
      {error && <div className="operations-error" role="alert">{error}</div>}
      {loading && <p role="status">Checking administrator access…</p>}
      {!loading && !session && <section className="operations-panel"><h2>Access unavailable</h2><p>Administrator access could not be verified. Retry to check your session.</p><button type="button" disabled={disabled} onClick={() => void perform("retry", epoch => refresh(undefined, epoch))}>{busy === "retry" ? "Checking…" : "Retry"}</button></section>}
      {session?.stage === "signed_out" && <section className="operations-panel">
        <h2>Sign in</h2>
        <form onSubmit={login} aria-busy={busy === "login"}>
          <label htmlFor="staff-email">Administrator email<input id="staff-email" name="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} disabled={disabled} /></label>
          <label htmlFor="staff-password">Password<input id="staff-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled} /></label>
          <button type="submit" disabled={disabled}>{busy === "login" ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="operations-small staff-admin-help">Use your ESN administrator password. Your Google account password is separate. Access is limited to accounts created by the company.</p>
      </section>}
      {session?.authenticated && session.email && <p className="operations-small staff-admin-email">Signed in as {session.email}</p>}
      {session?.stage === "password_change" && <section className="operations-panel">
        <h2>Replace your temporary password</h2>
        <p>Choose a permanent password of at least 16 characters. Save it in your password manager before continuing.</p>
        <form onSubmit={changePassword} aria-busy={busy === "password"}>
          <label htmlFor="staff-new-password">New password<input id="staff-new-password" name="new-password" type="password" autoComplete="new-password" minLength={16} required value={password} onChange={(event) => setPassword(event.target.value)} disabled={disabled} /></label>
          <label htmlFor="staff-confirm-password">Confirm new password<input id="staff-confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={16} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={disabled} /></label>
          <button type="submit" disabled={disabled}>{busy === "password" ? "Saving password…" : "Save new password"}</button>
        </form>
      </section>}
      {session?.stage === "email_verify" && <section className="operations-panel">
        <h2>Verify your email</h2>
        <p>Receive a six-digit code at your administrator email. You can open your email on this computer; no phone or authenticator app is needed.</p>
        {session.email && <p className="staff-admin-email">Send to <strong>{session.email}</strong></p>}
        <button type="button" onClick={sendEmailCode} disabled={disabled || resendSeconds > 0} aria-describedby="staff-email-delivery-help">
          {busy === "email-send" ? "Sending code…" : resendSeconds > 0 ? `${emailVerification?.sent ? "Resend code" : "Try again"} in ${resendSeconds}s` : emailVerification?.sent ? "Resend code" : "Send verification code"}
        </button>
        <p id="staff-email-delivery-help" className="operations-small staff-admin-help">The code is valid for 10 minutes. If you resend it, only the newest code will work. Check your spam folder if the email does not arrive.</p>
        {emailVerification?.sent && <>
          <p role="status">A verification code was sent. Enter it below to continue.</p>
          <p id="staff-email-code-expiry" className="operations-small staff-admin-countdown">{expirySeconds > 0 ? `This code expires in ${Math.floor(expirySeconds / 60)}:${String(expirySeconds % 60).padStart(2, "0")}.` : "This code has expired. Resend a code to continue."}</p>
          <form onSubmit={verifyEmailCode} aria-busy={busy === "email-verify"}>
            <label htmlFor="staff-email-code">Email verification code<input ref={emailCodeInput} id="staff-email-code" name="email-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="staff-admin-code" aria-describedby="staff-email-code-expiry" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={disabled || expirySeconds === 0} /></label>
            <button type="submit" disabled={disabled || expirySeconds === 0}>{busy === "email-verify" ? "Verifying…" : "Verify and continue"}</button>
          </form>
        </>}
      </section>}
      {session?.stage === "mfa_enroll" && <section className="operations-panel">
        <h2>Set up your authenticator</h2>
        <p>Add this account to an authenticator app on your own device. You will use a six-digit code when signing in.</p>
        {!enrollment ? <button type="button" onClick={enroll} disabled={disabled}>{busy === "enroll" ? "Preparing setup…" : "Set up authenticator"}</button> : <>
          <p>Scan this QR code using your authenticator app.</p>
          {image ? <Image src={image} alt="Authenticator setup QR code" width={240} height={240} unoptimized className="staff-admin-qr" /> : <p>Use the manual setup key below in your authenticator app.</p>}
          <details><summary>Enter the setup key manually</summary><p>Choose a time-based code and use your administrator email as the account name.</p><code className="staff-admin-secret">{enrollment.secret}</code></details>
          <p className="operations-small staff-admin-help">Keep the setup key private. Enter the code shown on your device to complete setup.</p>
        </>}
      </section>}
      {session?.stage === "mfa_verify" && <section className="operations-panel">
        <h2>Verify your device</h2>
        <p>Open the authenticator app you set up for this account and enter its current six-digit code.</p>
        {!hasFactors && <><p>No available authenticator could be loaded. Retry your session or contact the account owner for access recovery.</p><button type="button" disabled={disabled} onClick={() => void perform("retry", epoch => refresh(undefined, epoch))}>Retry</button></>}
      </section>}
      {(session?.stage === "mfa_enroll" && enrollment || session?.stage === "mfa_verify" && hasFactors) && <section className="operations-panel">
        <h2>Authenticator code</h2>
        <form onSubmit={verify} aria-busy={busy === "verify"}>
          {session?.stage === "mfa_verify" && session.factors && session.factors.length > 1 && <label htmlFor="staff-factor">Authenticator<select id="staff-factor" value={factorId || session.factors[0].id} onChange={(event) => setFactorId(event.target.value)} disabled={disabled}>{session.factors.map((factor) => <option key={factor.id} value={factor.id}>{factor.friendlyName || "Authenticator"}</option>)}</select></label>}
          <label htmlFor="staff-code">Six-digit code<input id="staff-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="staff-admin-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} disabled={disabled} /></label>
          <button type="submit" disabled={disabled}>{busy === "verify" ? "Verifying…" : "Verify and continue"}</button>
        </form>
      </section>}
    </div>
  </AccessContainer>;
}
