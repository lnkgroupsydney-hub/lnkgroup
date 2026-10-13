'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { LiveQuoteRequest } from '../index';
import { displayTime, LiveRequestError } from './request-client.ts';
import { CUSTOMER_ACCESS_CHANGED, CUSTOMER_ACCESS_CHANNEL, CustomerAccessLifetime, EMPTY_CUSTOMER_ACCESS, consumeQuoteHandoff, canStartAnotherQuote, canRecoverExpiredCustomerAccess, customerMutation, parseCustomerAccess, parseCustomerChallenge, readCurrentCustomerRequest, readCustomerAccess, type CustomerAccessState } from './customer-access-client.ts';

export interface CustomerAccessPanelProps {
  request: LiveQuoteRequest | null;
  disabled?: boolean;
  hasUnsavedChanges?: boolean;
  initialState?: CustomerAccessState;
  onRestored: (request: LiveQuoteRequest) => void;
  onPrivateAccessLost: () => void;
  onSignedOut: () => void;
  onIdentityChange: (email: string | null) => void;
  onBusyChange: (busy: boolean) => void;
}

export function CustomerAccessPanel({ request, disabled = false, hasUnsavedChanges = false, initialState, onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange }: CustomerAccessPanelProps) {
  const [access, setAccess] = useState(initialState ?? EMPTY_CUSTOMER_ACCESS), [loaded, setLoaded] = useState(Boolean(initialState));
  const [email, setEmail] = useState(''), [token, setToken] = useState(''), [sentTo, setSentTo] = useState('');
  const [retryAt, setRetryAt] = useState(0), [expiresAt, setExpiresAt] = useState(0), [clock, setClock] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [accessExpired, setAccessExpired] = useState(false);
  const [handoff, setHandoff] = useState<string | null>(null), [newQuotePrompt, setNewQuotePrompt] = useState(false);
  const lifecycle = useRef(new CustomerAccessLifetime()), running = useRef(false), callbacks = useRef({ onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange });
  const channel = useRef<BroadcastChannel | null>(null), codeInput = useRef<HTMLInputElement>(null), errorBox = useRef<HTMLDivElement>(null);
  const challengeBinding = useRef<{ email: string; requestId: string; expectedRevision: number } | null>(null);
  const prefix = useId();
  useEffect(() => { callbacks.current = { onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange }; }, [onRestored, onPrivateAccessLost, onSignedOut, onIdentityChange, onBusyChange]);
  const resendSeconds = Math.max(0, Math.ceil((retryAt - clock) / 1000)), expired = Boolean(expiresAt && clock >= expiresAt);
  const linked = Boolean(request && access.requests.some(item => item.id === request.id));
  const currentEmail = request?.payload.contact.email ?? '';
  const matchingIdentity = access.customer?.email.toLowerCase() === currentEmail.toLowerCase();
  function apply(state: CustomerAccessState) { setAccess(state); setLoaded(true); setAccessExpired(false); callbacks.current.onIdentityChange(state.customer?.email ?? null); }
  function announceChange() { channel.current?.postMessage(CUSTOMER_ACCESS_CHANGED); }
  function fail(cause: unknown, clearAccess = true) {
    if (clearAccess && cause instanceof LiveRequestError && [401, 403].includes(cause.status)) { apply(EMPTY_CUSTOMER_ACCESS); setAccessExpired(cause.status === 401); callbacks.current.onPrivateAccessLost(); }
    setError(cause instanceof Error ? cause.message : 'Email access could not be confirmed. Please retry.');
  }
  async function refresh(restore: boolean) {
    const generation = lifecycle.current.begin();
    try {
      const state = await readCustomerAccess();
      if (!lifecycle.current.accepts(generation)) return;
      apply(state);
      if (restore && state.currentRequestId) {
        const restored = await readCurrentCustomerRequest(state.currentRequestId);
        if (lifecycle.current.accepts(generation)) callbacks.current.onRestored(restored);
      }
    } catch (cause) { if (lifecycle.current.accepts(generation)) fail(cause); }
  }
  useEffect(() => {
    const lifetime = lifecycle.current; lifetime.reopen();
    let cancelled = false;
    try {
      const restore = consumeQuoteHandoff(window.location, url => window.history.replaceState(null, '', url));
      if (restore) void Promise.resolve().then(() => { if (!cancelled) { setHandoff(restore); setNotice('Verify the email saved with your previous quote to securely reopen it on this company domain.'); } });
    } catch (cause) { void Promise.resolve().then(() => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'The quote recovery link is invalid.'); }); }
    if (!initialState) void Promise.resolve().then(() => { if (!cancelled) return refresh(false); });
    if (typeof BroadcastChannel !== 'undefined') {
      const current = new BroadcastChannel(CUSTOMER_ACCESS_CHANNEL); channel.current = current;
      current.onmessage = event => {
        if (event.data !== CUSTOMER_ACCESS_CHANGED) return;
        lifecycle.current.invalidate(); challengeBinding.current = null; setToken(''); setSentTo(''); setExpiresAt(0); setRetryAt(0);
        callbacks.current.onPrivateAccessLost(); setNotice('Email access changed in another tab. Loading the current saved access…');
        void refresh(true);
      };
    }
    return () => { cancelled = true; lifetime.close(); channel.current?.close(); channel.current = null; };
    // The panel owns its mount lifecycle; callbacks are read from the current ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!retryAt && !expiresAt) return;
    const tick = () => setClock(Date.now()); tick();
    const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [retryAt, expiresAt]);
  useEffect(() => {
    if (!access.customer) return;
    const timer = setTimeout(() => {
      lifecycle.current.invalidate(); apply(EMPTY_CUSTOMER_ACCESS); setAccessExpired(true); callbacks.current.onPrivateAccessLost();
      setNotice('Your email session has expired. Verify your email again to reopen the quotes you linked.');
    }, Math.max(0, Date.parse(access.customer.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [access.customer]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  async function perform(generation: number, operation: () => Promise<void>, clearAccessOnFailure = true) {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); callbacks.current.onBusyChange(true); setError(''); setNotice('');
    try { await operation(); } catch (cause) { if (lifecycle.current.accepts(generation)) fail(cause, clearAccessOnFailure); }
    finally { running.current = false; if (lifecycle.current.isOpen()) { setBusy(false); callbacks.current.onBusyChange(false); } }
  }
  function sendCode(event?: FormEvent, bind = false) {
    event?.preventDefault(); if (running.current || disabled || resendSeconds || (bind && (!request || hasUnsavedChanges))) return;
    const target = (bind ? currentEmail : email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) { setError('Enter a valid email address.'); return; }
    const binding = bind && request ? { email: target, requestId: request.id, expectedRevision: request.revision } : challengeBinding.current?.email === target ? challengeBinding.current : null;
    const generation = lifecycle.current.begin();
    void perform(generation, async () => {
      const result = parseCustomerChallenge(await customerMutation('send', { email: target, ...(handoff && !bind ? { handoff } : binding ? { requestId: binding.requestId, expectedRevision: binding.expectedRevision } : {}) }));
      if (!lifecycle.current.accepts(generation)) return;
      challengeBinding.current = binding;
      const now = Date.now(); setClock(now); setSentTo(target); setEmail(target); setToken(''); setRetryAt(now + result.retryAfterSeconds * 1000); setExpiresAt(now + result.expiresInSeconds * 1000);
      setNotice(`A verification code has been sent to ${target}. Check your inbox and spam folder. Codes are single use.`);
      requestAnimationFrame(() => codeInput.current?.focus());
    }, false);
  }
  function verify(event: FormEvent) {
    event.preventDefault(); if (running.current || disabled || !/^\d{6,8}$/.test(token) || expired) return;
    const generation = lifecycle.current.begin();
    void perform(generation, async () => {
      const state = parseCustomerAccess(await customerMutation('verify', { token }));
      if (!lifecycle.current.accepts(generation)) return;
      apply(state); challengeBinding.current = null; setHandoff(null); setToken(''); setSentTo(''); setExpiresAt(0); setRetryAt(0);
      if (state.currentRequestId) {
        callbacks.current.onPrivateAccessLost();
        const restored = await readCurrentCustomerRequest(state.currentRequestId);
        if (!lifecycle.current.accepts(generation)) return;
        callbacks.current.onRestored(restored);
      }
      setNotice(state.currentRequestId ? 'Email verified. This saved quote is linked to your email for future access.' : 'Email verified. Choose a linked quote below to continue.'); announceChange();
    }, false);
  }
  function select(requestId: string) {
    if (running.current || disabled || hasUnsavedChanges) return;
    const generation = lifecycle.current.begin();
    void perform(generation, async () => {
      await customerMutation('select', { requestId });
      if (!lifecycle.current.accepts(generation)) return;
      callbacks.current.onPrivateAccessLost();
      const restored = await readCurrentCustomerRequest(requestId);
      const state = await readCustomerAccess();
      if (!lifecycle.current.accepts(generation)) return;
      apply(state); callbacks.current.onRestored(restored); setNotice('Your saved quote, photos and analysis have been reopened.'); announceChange();
    });
  }
  function logout(action: 'sign-out' | 'start-another' | 'recover-expired' = 'sign-out') {
    const startAnother = action === 'start-another', recoverExpired = action === 'recover-expired';
    if (running.current || disabled || (startAnother && !canStartAnotherQuote(request ? { id: request.id, email: currentEmail } : null, access, hasUnsavedChanges)) || (recoverExpired && !canRecoverExpiredCustomerAccess(request, access, hasUnsavedChanges, accessExpired))) return;
    const generation = lifecycle.current.begin();
    void perform(generation, async () => {
      const result = await customerMutation('logout', recoverExpired ? { preserveWritingSession: true } : {});
      if (result.signedOut !== true || (recoverExpired && result.writingSessionPreserved !== true)) throw new Error('Sign out could not be confirmed. Please retry.');
      if (!lifecycle.current.accepts(generation)) return;
      apply(EMPTY_CUSTOMER_ACCESS); challengeBinding.current = null; setHandoff(null); setToken(''); setSentTo(''); setEmail(''); setExpiresAt(0); setRetryAt(0); callbacks.current.onSignedOut(); setNewQuotePrompt(false); setNotice(recoverExpired ? 'Expired email access cleared. Reopening this browser’s quote form.' : startAnother ? 'A blank quote form is opening. Your previous linked quote, photos and receipt remain saved; verify its email to reopen it later.' : 'Signed out of customer quote access. Your company records are retained.'); announceChange();
    });
  }
  const locked = disabled || busy || (!loaded && !error);
  return <section className="lq-customer-access" aria-labelledby={`${prefix}-heading`}>
    <h2 id={`${prefix}-heading`} tabIndex={-1} data-quote-access-heading>Save and reopen your quote by email</h2>
    <p>Verify your email to keep access to a saved quote and reopen it on another device. Only quotes you have linked to your verified email appear here.</p>
    {handoff && <p className="lq-notice">You opened a recovery link for a saved quote from the previous site. Enter the email saved on that quote below. Recovery links expire after 15 minutes and can be used once.</p>}
    {!loaded && !error && <p role="status">Checking your email access…</p>}
    {error && <div ref={errorBox} className="lq-error" role="alert" tabIndex={-1}><p>{error}</p><button type="button" className="secondary" disabled={locked} onClick={() => void refresh(false)}>Check email access again</button></div>}
    {canRecoverExpiredCustomerAccess(request, access, hasUnsavedChanges, accessExpired) && <div className="lq-notice"><p>Your email access has expired. Reopen this browser’s form to continue a saved draft or enter a new quote. Saved records and company administrator access stay unchanged.</p><button type="button" className="secondary" disabled={locked} onClick={() => logout('recover-expired')}>Reopen quote form</button></div>}
    {notice && <p className="lq-notice" role="status" aria-live="polite">{notice}</p>}
    {access.customer ? <>
      <p>Verified email: <strong>{access.customer.email}</strong>. Session ends {displayTime(access.customer.expiresAt)}; you can verify again afterwards.</p>
      {request && !linked && <div className="lq-notice"><p>{matchingIdentity ? 'This browser’s saved quote is not linked to your email yet. Verify its saved email below to keep access.' : 'This browser’s saved quote uses a different email. Verify that saved address below to switch customer access and securely link this quote.'}</p></div>}
      {access.requests.length ? <ul className="lq-customer-list" aria-label="Your linked quotes">{access.requests.map(item => <li key={item.id}><div><strong>{item.reference}</strong><span>{item.status === 'review_requested' ? 'Company review requested' : 'Saved draft'} · Saved {displayTime(item.savedAt)}</span></div><button type="button" className="secondary" disabled={locked || hasUnsavedChanges || request?.id === item.id} onClick={() => select(item.id)}>{request?.id === item.id ? 'Currently open' : 'Open saved quote'}</button></li>)}</ul> : <p>No quotes have been linked to this email yet. A saved quote must be verified while you have access to that specific request. Contact L&amp;K Group if an older unlinked request needs recovery.</p>}
      {hasUnsavedChanges && <p className="lq-muted">Save your current changes before linking or switching quotes.</p>}
      <div className="lq-actions"><button type="button" className="secondary" disabled={locked} onClick={() => void refresh(false)}>Refresh saved quotes</button><button type="button" className="secondary" disabled={locked} onClick={() => logout()}>Sign out of customer access</button></div>
    </> : <form className="lq-fields" onSubmit={event => sendCode(event)}><label htmlFor={`${prefix}-email`}>Email for saved quote access<input id={`${prefix}-email`} name="customer-email" data-quote-email-binding type="email" autoComplete="email" required maxLength={254} value={email} disabled={locked} onChange={event => { setEmail(event.target.value); setError(''); }} /></label><div className="lq-actions"><button type="submit" disabled={locked || resendSeconds > 0}>{resendSeconds ? `Send another code in ${resendSeconds}s` : 'Send email verification code'}</button></div></form>}
    {request && !linked && <div className="lq-notice"><p>Keep this saved quote for later: verify <strong>{currentEmail}</strong>. Save any changes first.</p><button type="button" data-quote-email-binding disabled={locked || hasUnsavedChanges || resendSeconds > 0} onClick={() => sendCode(undefined, true)}>{resendSeconds ? `Verify saved quote in ${resendSeconds}s` : 'Verify email and keep this quote'}</button></div>}
    {sentTo && <form className="lq-fields" onSubmit={verify}><p id={`${prefix}-code-help`}>Enter the code sent to {sentTo}. {expired ? 'This code has expired. Request a new code.' : 'The code expires after 15 minutes.'}</p><label htmlFor={`${prefix}-code`}>Email verification code<input ref={codeInput} id={`${prefix}-code`} name="customer-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" minLength={6} maxLength={8} required aria-describedby={`${prefix}-code-help`} value={token} disabled={locked || expired} onChange={event => setToken(event.target.value.replace(/\D/g, '').slice(0, 8))} /></label><div className="lq-actions"><button type="submit" disabled={locked || expired || !/^\d{6,8}$/.test(token)}>Verify code</button></div></form>}
    {request && <div className="lq-notice">
      <p>To enter a different client, start a separate quote. Editing these details changes the currently open quote.</p>
      <button type="button" className="secondary" disabled={locked || hasUnsavedChanges || !canStartAnotherQuote({ id: request.id, email: currentEmail }, access, hasUnsavedChanges)} onClick={() => setNewQuotePrompt(true)}>Start a new quote</button>
      {!canStartAnotherQuote({ id: request.id, email: currentEmail }, access, hasUnsavedChanges) && <p>Save or discard form changes and verify the email of this specific quote to link it before starting another. This protects access to its saved records.</p>}
      {newQuotePrompt && <div role="group" aria-label="Confirm starting another quote"><p>Your linked quote, photos and any submitted receipt will stay saved. Starting another signs out of customer quote access and opens a blank form; verify the previous email to reopen it. Company administrator access is unchanged. Other tabs share the same customer access.</p><div className="lq-actions"><button type="button" disabled={locked || !canStartAnotherQuote({ id: request.id, email: currentEmail }, access, hasUnsavedChanges)} onClick={() => logout('start-another')}>Keep saved quote and start new</button><button type="button" className="secondary" disabled={locked} onClick={() => setNewQuotePrompt(false)}>Continue current quote</button></div></div>}
    </div>}
    <p className="lq-muted">Email verification saves access only. Estimate approval, booking and signature are separate next steps.</p>
  </section>;
}
